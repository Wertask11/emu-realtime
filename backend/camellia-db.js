"use strict";
/**
 * Camellia 専用の自作データベース
 * ------------------------------------------------------------
 * 外部のDBサービスに一切依存しない。指定ディレクトリへ自前で永続化する。
 *
 * 設計:
 *   - テーブル1つ = JSONファイル1つ（<dir>/<table>.json）
 *   - 書き込みは tmp へ書いてから rename する「アトミック置換」。
 *     途中でプロセスが落ちても、壊れた中身が本ファイルに残らない。
 *   - 書き込みはテーブルごとに直列化キューで実行し、競合を防ぐ。
 *   - 起動時に全件をメモリへ読み込み、読み取りは同期で返す（高速）。
 *   - 変更は追記ログ（<table>.log.jsonl）にも残す。復旧・監査用。
 *
 * 保存先:
 *   環境変数 CAMELLIA_DATA_DIR で指定する。未指定なら backend/.camellia-data。
 *   ※ Render等の揮発ディスクに置くと再起動で消える。永続ボリュームを指定すること。
 */

const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.CAMELLIA_DATA_DIR
  || path.join(__dirname, ".camellia-data");

/** テーブル名は英数字とアンダースコアのみ（パス経由の書き込みを防ぐ） */
function assertSafeName(name) {
  if (!/^[a-zA-Z0-9_]+$/.test(String(name || ""))) {
    throw new Error("不正なテーブル名: " + name);
  }
}

function newId() {
  return crypto.randomBytes(12).toString("hex");
}

function nowIso() {
  return new Date().toISOString();
}

/** 深いコピー。外に渡した参照から内部データを書き換えられないようにする */
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class Table {
  constructor(db, name) {
    assertSafeName(name);
    this.db = db;
    this.name = name;
    this.file = path.join(db.dir, name + ".json");
    this.logFile = path.join(db.dir, name + ".log.jsonl");
    this.rows = [];
    this.index = new Map();      // id -> row
    this.writeQueue = Promise.resolve(); // 直列化キュー
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);
      this.rows = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      if (e.code !== "ENOENT") {
        console.warn(`⚠️ Camellia DB: ${this.name} の読み込みに失敗。空で開始:`, e.message);
      }
      this.rows = [];
    }
    this.index.clear();
    this.rows.forEach((r) => { if (r && r.id) this.index.set(r.id, r); });
    return this;
  }

  /** 実ファイルへアトミックに書き出す（tmp → rename） */
  _flush() {
    const snapshot = JSON.stringify(this.rows);
    this.writeQueue = this.writeQueue.then(async () => {
      const tmp = this.file + "." + process.pid + "." + Date.now() + ".tmp";
      await fsp.writeFile(tmp, snapshot, "utf8");
      await fsp.rename(tmp, this.file);
    }).catch((e) => {
      console.error(`❌ Camellia DB: ${this.name} の保存に失敗:`, e.message);
    });
    return this.writeQueue;
  }

  /** 変更履歴を追記（失敗しても本体の保存は妨げない） */
  _appendLog(op, payload) {
    const line = JSON.stringify({ at: nowIso(), op, payload }) + "\n";
    fsp.appendFile(this.logFile, line, "utf8").catch(() => {});
  }

  // ── 読み取り（同期・メモリから） ──
  all() { return clone(this.rows); }
  count(where) { return this.find(where).length; }

  findOne(where) {
    const row = this.rows.find(matcher(where));
    return row ? clone(row) : null;
  }

  findById(id) {
    const row = this.index.get(String(id));
    return row ? clone(row) : null;
  }

  find(where, options) {
    const opt = options || {};
    let out = where ? this.rows.filter(matcher(where)) : this.rows.slice();
    if (opt.sort) {
      const key = String(opt.sort).replace(/^-/, "");
      const dir = String(opt.sort).startsWith("-") ? -1 : 1;
      out = out.slice().sort((a, b) => {
        const x = a[key], y = b[key];
        if (x === y) return 0;
        return (x > y ? 1 : -1) * dir;
      });
    }
    if (opt.offset) out = out.slice(Number(opt.offset) || 0);
    if (opt.limit) out = out.slice(0, Number(opt.limit) || 0);
    return clone(out);
  }

  // ── 書き込み ──
  async insert(data) {
    const row = Object.assign({}, clone(data), {
      id: (data && data.id) ? String(data.id) : newId(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    if (this.index.has(row.id)) throw new Error("id が重複しています: " + row.id);
    this.rows.push(row);
    this.index.set(row.id, row);
    this._appendLog("insert", row);
    await this._flush();
    return clone(row);
  }

  async update(id, patch) {
    const row = this.index.get(String(id));
    if (!row) return null;
    const next = clone(patch) || {};
    delete next.id;
    delete next.createdAt;
    Object.assign(row, next, { updatedAt: nowIso() });
    this._appendLog("update", { id: row.id, patch: next });
    await this._flush();
    return clone(row);
  }

  /** 条件に一致する1件を更新、無ければ作成 */
  async upsert(where, data) {
    const existing = this.rows.find(matcher(where));
    if (existing) return this.update(existing.id, data);
    return this.insert(Object.assign({}, where, data));
  }

  async remove(id) {
    const row = this.index.get(String(id));
    if (!row) return false;
    this.rows = this.rows.filter((r) => r.id !== row.id);
    this.index.delete(row.id);
    this._appendLog("remove", { id: row.id });
    await this._flush();
    return true;
  }

  /** 保留中の書き込みが完了するまで待つ（テスト・シャットダウン用） */
  async flushed() { return this.writeQueue; }
}

/** { key: value } / { key: {$in|$gt|$lt|$ne} } に対応する簡易マッチャ */
function matcher(where) {
  if (!where) return () => true;
  const entries = Object.entries(where);
  return (row) => entries.every(([key, cond]) => {
    const value = row ? row[key] : undefined;
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      if ("$in" in cond) return Array.isArray(cond.$in) && cond.$in.includes(value);
      if ("$ne" in cond) return value !== cond.$ne;
      if ("$gt" in cond) return value > cond.$gt;
      if ("$gte" in cond) return value >= cond.$gte;
      if ("$lt" in cond) return value < cond.$lt;
      if ("$lte" in cond) return value <= cond.$lte;
      return false;
    }
    return value === cond;
  });
}

class CamelliaDB {
  constructor(dir) {
    this.dir = dir || DATA_DIR;
    this.tables = new Map();
    fs.mkdirSync(this.dir, { recursive: true });
  }

  table(name) {
    assertSafeName(name);
    if (!this.tables.has(name)) {
      this.tables.set(name, new Table(this, name).load());
    }
    return this.tables.get(name);
  }

  /** 保存先と各テーブルの件数（管理画面の状態表示用） */
  stats() {
    const tables = {};
    this.tables.forEach((t, name) => { tables[name] = t.rows.length; });
    return { dir: this.dir, tables };
  }

  async flushed() {
    return Promise.all([...this.tables.values()].map((t) => t.flushed()));
  }
}

let _instance = null;
/** シングルトン。保存先は CAMELLIA_DATA_DIR で差し替えられる。 */
function getCamelliaDB() {
  if (!_instance) {
    _instance = new CamelliaDB(DATA_DIR);
    console.log("🌸 Camellia DB 保存先:", _instance.dir);
  }
  return _instance;
}

module.exports = { getCamelliaDB, CamelliaDB, DATA_DIR };
