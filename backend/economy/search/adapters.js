"use strict";
const { row, publicRow, text, millis } = require("./contracts");
const guildStore = require("../../../frontend/public/schoolpark/guild-store");
const { guides } = require("./guides");
const { hash } = require("../config");
const labModel = require("../../knowledge-lab/model");
const { decideSchoolParkAccess } = require("../../schoolpark-access");
const FIELDS = {
  guild: [
    "name",
    "concept",
    "body",
    "status",
    "visibility",
    "private",
    "isPublic",
    "archived",
    "draft",
    "hidden",
    "deleted",
    "withdrawn",
    "updatedAt",
    "createdAt",
    "aiUseConsent",
  ],
  quest: [
    "title",
    "owner",
    "brief",
    "given",
    "status",
    "visibility",
    "private",
    "isPublic",
    "archived",
    "draft",
    "hidden",
    "deleted",
    "withdrawn",
    "updatedAt",
    "createdAt",
    "guildId",
    "aiUseConsent",
    "due",
    "deadline",
    "deadlineMs",
    "deadlineAt",
    "closesAt",
    "conditions",
    "startsAt",
    "startAtMs",
    "startDate",
  ],
  knowledge_text: [
    "title",
    "summary",
    "theme",
    "subTheme",
    "subSubTheme",
    "status",
    "visibility",
    "private",
    "isPublic",
    "archived",
    "draft",
    "hidden",
    "deleted",
    "withdrawn",
    "updatedAt",
    "createdAt",
    "aiUseConsent",
  ],
  city: [
    "name",
    "createdBy",
    "aiUseConsent",
    "description",
    "fulfillment",
    "cancelPolicy",
    "prices",
    "status",
    "shopId",
    "visibility",
    "private",
    "isPublic",
    "archived",
    "draft",
    "hidden",
    "deleted",
    "withdrawn",
    "stock",
    "sold",
    "reserved",
    "orderDeadlineMs",
    "updatedAtMs",
    "updatedAt",
    "createdAtMs",
    "createdAt",
  ],
};
function createAdapters({ db, knowledge, now = Date.now }) {
  function schoolParkRead(a) {
    if (
      !decideSchoolParkAccess(now(), {
        isOwner: a?.owner === true,
        hasOfficialPass: false,
      }).allowed
    )
      throw Error("READ_NOT_ALLOWED");
  }
  async function scan(col, fields, filter) {
    let q = db.collection(col);
    if (filter) q = q.where(...filter);
    if (typeof q.select !== "function") throw Error("ADAPTER_CONTRACT_CHANGED");
    return (
      await q
        .select(...fields)
        .limit(24)
        .get()
    ).docs;
  }
  async function read(col, id, fields) {
    if (typeof db.getAll !== "function")
      throw Error("ADAPTER_CONTRACT_CHANGED");
    const [s] = await db.getAll(db.collection(col).doc(id), {
      fieldMask: fields,
    });
    return s?.exists ? { id: s.id, data: () => s.data() } : null;
  }
  function guild(d) {
    const p = d.data();
    if (!publicRow(p) || p.aiUseConsent?.allowed === false) return null;
    return row("guild", "guild", d.id, p.name, p.concept || p.body || p.name, {
      ...p,
      authorAIConsent:
        guildStore.OFFICIAL.some((g) => g.id === d.id) ||
        p.aiUseConsent?.allowed === true,
      origin: "ギルド公開説明",
    });
  }
  function quest(d) {
    const p = d.data();
    if (
      !publicRow(p) ||
      p.aiUseConsent?.allowed === false ||
      !["OPEN", "RUNNING"].includes(p.status || "OPEN")
    )
      return null;
    const rawDeadline =
      p.deadlineMs || p.closesAt || p.deadlineAt || p.deadline || p.due;
    const deadlineText =
      typeof rawDeadline === "string" ? rawDeadline.trim() : "";
    const end =
      typeof rawDeadline?.toMillis === "function"
        ? rawDeadline.toMillis()
        : typeof rawDeadline === "number"
          ? rawDeadline
          : /^\d{4}-\d{2}-\d{2}$/.test(deadlineText)
            ? Date.parse(deadlineText + "T23:59:59.999+09:00")
            : /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(deadlineText)
              ? Date.parse(deadlineText)
              : 0;
    if (rawDeadline && (!Number.isFinite(end) || end <= 0)) return null;
    if (end && end <= now()) return null;
    const scenario = /架空|演習用/.test(
      String(p.brief || "") + String(p.given || ""),
    );
    const conditions = String(p.conditions || "").trim();
    const guild =
      guildStore.OFFICIAL.find((g) => g.id === p.guildId)?.name || null;
    const start = millis(p.startsAt || p.startAtMs || p.startDate);
    const facts = {
      participation: "conditions-at-destination",
      status: p.status || "OPEN",
      deadlineMs: end || null,
      startsAtMs: start,
      scenario: scenario ? "exercise" : "public-activity",
      conditions: conditions
        ? conditions.slice(0, 160)
        : "詳細な参加条件はクエスト画面で確認",
      guild,
    };
    const info = [
      scenario
        ? "公式の演習課題（架空の設定を含む）。実在の店舗・主催者との連携を保証しません"
        : "公式公開課題。参加資格・報酬の獲得は保証しません",
      guild ? "分野: " + guild : null,
      String(p.brief || p.given || p.title).slice(0, 170) +
        (String(p.brief || p.given || p.title).length > 170 ? "…" : ""),
      "参加条件: " + facts.conditions.slice(0, 80),
      end ? "受付期限: " + new Date(end).toISOString() : "受付期限は未設定",
    ]
      .filter(Boolean)
      .join("。")
      .slice(0, 400);
    return row("quest", "quest", d.id, p.title, info, {
      ...p,
      authorAIConsent: p.aiUseConsent?.allowed === true,
      origin: "公開クエスト",
      facts,
      originHash: hash([
        p.title,
        p.brief || null,
        p.given || null,
        conditions,
        p.status || "OPEN",
        guild,
        end || null,
        start,
        scenario,
        p.owner || null,
      ]),
    });
  }

  function content(d) {
    const p = d.data();
    if (!publicRow(p)) return null;
    return row(
      "knowledge_text",
      "knowledge_text",
      d.id,
      p.title,
      p.summary || p.title,
      {
        ...p,
        authorAIConsent: p.aiUseConsent?.allowed === true,
        origin: "Knowledge Text公開教材",
      },
    );
  }
  function product(d) {
    const p = d.data();
    if (
      !publicRow(p) ||
      p.aiUseConsent?.allowed === false ||
      p.status !== "live" ||
      p.shopId !== "schoolpark-official" ||
      (p.orderDeadlineMs && p.orderDeadlineMs <= now()) ||
      (p.stock != null &&
        p.stock <= Number(p.sold || 0) + Number(p.reserved || 0))
    )
      return null;
    const price = p.prices?.EMUER;
    if (!Number.isSafeInteger(price) || price < 0) return null;
    const available =
      p.stock == null
        ? null
        : p.stock - Number(p.sold || 0) - Number(p.reserved || 0);
    if (
      available !== null &&
      (!Number.isSafeInteger(available) || available < 0)
    )
      return null;
    const deadline = p.orderDeadlineMs || null;
    if (deadline !== null && !Number.isSafeInteger(deadline)) return null;
    const facts = {
      priceEmuer: price,
      deadlineMs: deadline,
      stockAvailable: available,
      availability: "live-at-check",
      conditions: "商品画面の利用資格・交換枠を確認",
    };
    const details = [
      String(p.description || p.fulfillment || p.name).slice(0, 160) +
        (String(p.description || p.fulfillment || p.name).length > 160
          ? "…"
          : ""),
      "価格 " + price + " EMUER",
      available === null
        ? "在庫上限は未設定（提供保証ではありません）"
        : "確認時点の残り在庫 " + available,
      deadline
        ? "受付期限 " + new Date(deadline).toISOString()
        : "受付期限は未設定",
      String(p.cancelPolicy || "条件は商品画面で確認").slice(0, 90),
    ]
      .join("。")
      .slice(0, 400);
    return row("city", "city_product", d.id, p.name, details, {
      ...p,
      authorAIConsent: true,
      origin: "SchoolPark公式ショップ",
      facts,
      originHash: hash([
        p.name,
        p.description || null,
        p.fulfillment || null,
        p.cancelPolicy || null,
        p.shopId,
        p.status,
        price,
        deadline,
        available,
        p.createdBy || null,
      ]),
    });
  }

  async function post(id, a) {
    if (typeof knowledge?.rawPost !== "function")
      throw Error("ADAPTER_CONTRACT_CHANGED");
    let p;
    try {
      p = await knowledge.rawPost(id, a, true);
    } catch (e) {
      if (["NOT_FOUND", "READER_PLAN_REQUIRED"].includes(e.message))
        return null;
      throw e;
    }
    if (
      !labModel.publicPost(p) ||
      !publicRow(p) ||
      p.knowledgeLab?.aiUseConsent?.allowed !== true
    )
      return null;
    return row(
      "knowledge_lab",
      Number.isInteger(p.knowledgeLab?.revision)
        ? "knowledge_lab"
        : "knowledge",
      id,
      p.title,
      String(p.body || "").slice(0, 400),
      { ...p, authorAIConsent: true, origin: "AI利用に同意した公開知識" },
    );
  }
  const adapters = {
    knowledge_lab: {
      async list(a) {
        if (
          typeof knowledge?.ref !== "function" ||
          typeof knowledge?.rawPost !== "function"
        )
          throw Error("ADAPTER_CONTRACT_CHANGED");
        const status = await knowledge.ref("system", "index").get();
        if (!status.exists || status.data().state !== "ready")
          throw Error("ADAPTER_CONTRACT_CHANGED");
        const index = await knowledge
          .ref("search", "unused")
          .parent.where("active", "==", true)
          .select("postId", "updatedAtMs")
          .limit(24)
          .get();
        const rows = await Promise.all(
          index.docs.slice(0, 16).map((d) => post(d.data().postId || d.id, a)),
        );
        return rows.filter(Boolean);
      },
      get: (id, a) => post(id, a),
    },
    knowledge_text: {
      list: async () =>
        (await scan("room1_contents", FIELDS.knowledge_text))
          .map(content)
          .filter(Boolean),
      get: async (id) => {
        const d = await read("room1_contents", id, FIELDS.knowledge_text);
        return d && content(d);
      },
    },
    guild: {
      async list(a) {
        schoolParkRead(a);
        const extras = await scan("sp_guilds", FIELDS.guild),
          hidden = new Set(
            extras.filter((d) => !publicRow(d.data())).map((d) => d.id),
          );
        return guildStore
          .merge(
            extras
              .filter((d) => publicRow(d.data()))
              .map((d) => ({ ...d.data(), id: d.id })),
          )
          .filter((g) => !hidden.has(g.id))
          .map((g) => guild({ id: g.id, data: () => g }))
          .filter(Boolean);
      },
      async get(id, a) {
        schoolParkRead(a);
        const d = await read("sp_guilds", id, FIELDS.guild);
        if (d) return guild(d);
        const p = guildStore.OFFICIAL.find((g) => g.id === id);
        return p ? guild({ id, data: () => p }) : null;
      },
    },
    quest: {
      project: (id, data) => quest({ id, data: () => data }),
      list: async (a) => {
        schoolParkRead(a);
        return (await scan("sp_quests", FIELDS.quest))
          .map(quest)
          .filter(Boolean);
      },
      get: async (id, a) => {
        schoolParkRead(a);
        const d = await read("sp_quests", id, FIELDS.quest);
        return d && quest(d);
      },
    },
    city: {
      project: (id, data) => product({ id, data: () => data }),
      list: async () =>
        (await scan("mitemiru_products", FIELDS.city, ["status", "==", "live"]))
          .map(product)
          .filter(Boolean),
      get: async (id) => {
        const d = await read("mitemiru_products", id, FIELDS.city);
        return d && product(d);
      },
    },
  };
  for (const domain of ["service", "emuer", "passport", "activities"])
    adapters[domain] = {
      list: async () => guides(now()).filter((s) => s.domain === domain),
      get: async (id) =>
        guides(now()).find((s) => s.domain === domain && s.id === id) || null,
    };
  return adapters;
}
module.exports = { createAdapters, FIELDS };
