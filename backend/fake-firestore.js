"use strict";

/**
 * テスト用の Firestore の代わり。
 *
 * 大事なのは「取引（トランザクション）の性質」を本物どおりにすること。
 * ここを甘く作ると、取引を使っていないコードでもテストが通ってしまい、
 * 同時に2回ログインしたときに番号が2つ発行される、という
 * 一番起きてほしくない不具合を見逃す。
 *
 * 再現しているもの:
 *   - 読んだ文書が、書き込むまでのあいだに変わっていたら取引をやり直す
 *     （楽観ロック。本物の Firestore と同じ）
 *   - create は、すでに文書があると必ず失敗する
 *   - 取引のコミットは不可分（途中に await を挟まない）
 */

function makeFirestore(seed) {
  const store = new Map();   // "コレクション/文書ID" → { data, version }
  let clock = 0;
  let failNext = null;       // 通信障害の再現用

  const key = (col, id) => col + "/" + id;
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  function maybeFail() {
    if (failNext) {
      const e = new Error(failNext);
      failNext = null;
      throw e;
    }
    if (store._alwaysFail) throw new Error(store._alwaysFail);
  }

  function rawGet(k) { return store.get(k) || null; }

  function applyWrite(k, value, merge, mustCreate) {
    const entry = rawGet(k);
    if (mustCreate && entry) {
      const err = new Error("ALREADY_EXISTS: " + k);
      err.code = 6;
      throw err;
    }
    const base = (merge && entry) ? entry.data : {};
    store.set(k, { data: Object.assign({}, base, clone(value)), version: ++clock });
  }

  function snapshotOf(col, id) {
    const entry = rawGet(key(col, id));
    return {
      exists: !!entry,
      id,
      ref: null,
      data: () => (entry ? clone(entry.data) : undefined),
      _version: entry ? entry.version : 0
    };
  }

  function docRef(col, id) {
    const ref = {
      _col: col, _id: String(id), _key: key(col, String(id)),
      async get() { maybeFail(); return snapshotOf(col, String(id)); },
      async set(value, opts) { maybeFail(); applyWrite(key(col, String(id)), value, !!(opts && opts.merge), false); return ref; },
      async create(value) { maybeFail(); applyWrite(key(col, String(id)), value, false, true); return ref; },
      async delete() { maybeFail(); store.delete(key(col, String(id))); return ref; }
    };
    return ref;
  }

  function docsOf(col, limit) {
    const prefix = col + "/";
    const rows = [];
    for (const [k, entry] of store) {
      if (typeof k !== "string" || !k.startsWith(prefix)) continue;
      rows.push({ id: k.slice(prefix.length), data: () => clone(entry.data) });
      if (limit && rows.length >= limit) break;
    }
    return {
      docs: rows, size: rows.length, empty: rows.length === 0,
      forEach: (fn) => rows.forEach(fn)
    };
  }

  function collection(name) {
    return {
      doc: (id) => docRef(name, id),
      async add(value) {
        maybeFail();
        const id = "auto_" + (++clock);
        applyWrite(key(name, id), value, false, false);
        return docRef(name, id);
      },
      async get() { maybeFail(); return docsOf(name, 0); },
      limit: (n) => ({ async get() { maybeFail(); return docsOf(name, n); } }),
      // このテストでは使わないが、呼ばれても落ちないようにしておく
      where: () => ({ limit: () => ({ async get() { return { empty: true, docs: [] }; } }) })
    };
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function runTransaction(fn) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const reads = new Map();
      const writes = [];
      const tx = {
        async get(ref) {
          const snap = await ref.get();
          reads.set(ref._key, snap._version);
          return snap;
        },
        set(ref, value, opts) { writes.push({ key: ref._key, value, merge: !!(opts && opts.merge) }); return tx; },
        create(ref, value) { writes.push({ key: ref._key, value, merge: false, create: true }); return tx; },
        delete(ref) { writes.push({ key: ref._key, del: true }); return tx; }
      };

      const result = await fn(tx);   // ここでほかの取引と入れ替わる（本物と同じ）

      /* ここから下は同期。await を挟まないので不可分に走る。 */
      let conflict = false;
      for (const [k, version] of reads) {
        const cur = rawGet(k);
        if ((cur ? cur.version : 0) !== version) { conflict = true; break; }
      }
      if (!conflict) {
        for (const w of writes) {
          if (w.create && rawGet(w.key)) { conflict = true; break; }
        }
      }
      if (conflict) { await tick(); continue; }

      for (const w of writes) {
        if (w.del) { store.delete(w.key); continue; }
        applyWrite(w.key, w.value, w.merge, !!w.create);
      }
      return result;
    }
    const err = new Error("ABORTED: too much contention");
    err.code = 10;
    throw err;
  }

  const db = {
    collection, runTransaction,
    // テストから中身を覗く・壊すための入り口
    _store: store,
    _dump(col) {
      const prefix = col + "/";
      const out = {};
      for (const [k, entry] of store) {
        if (typeof k === "string" && k.startsWith(prefix)) out[k.slice(prefix.length)] = clone(entry.data);
      }
      return out;
    },
    _count(col) { return Object.keys(db._dump(col)).length; },
    _failOnce(message) { failNext = message || "NETWORK_DOWN"; },
    _breakAll(message) { store._alwaysFail = message || "NETWORK_DOWN"; },
    _repair() { store._alwaysFail = null; failNext = null; }
  };

  for (const col of Object.keys(seed || {})) {
    for (const id of Object.keys(seed[col] || {})) {
      applyWrite(key(col, id), seed[col][id], false, false);
    }
  }
  return db;
}

module.exports = { makeFirestore };
