"use strict";
const { row, publicRow, text } = require("./contracts");
const guildStore = require("../../../frontend/public/schoolpark/guild-store");
const { guides } = require("./guides");
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
    "conditions",
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
    if (!publicRow(p)) return null;
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
    if (!publicRow(p) || !["OPEN", "RUNNING"].includes(p.status || "OPEN"))
      return null;
    const end = Number(p.deadlineMs || 0);
    if (end && end <= now()) return null;
    const info = [
      p.brief || p.given || p.title,
      p.conditions ? "参加条件: " + String(p.conditions) : null,
      p.deadline ? "期限: " + String(p.deadline) : null,
    ]
      .filter(Boolean)
      .join("。")
      .slice(0, 400);
    return row("quest", "quest", d.id, p.title, info, {
      ...p,
      authorAIConsent: p.aiUseConsent?.allowed === true,
      origin: "公開クエスト",
      facts: { participation: "conditions-at-destination" },
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
      p.status !== "live" ||
      p.shopId !== "schoolpark-official" ||
      (p.orderDeadlineMs && p.orderDeadlineMs <= now()) ||
      (p.stock != null &&
        p.stock <= Number(p.sold || 0) + Number(p.reserved || 0))
    )
      return null;
    const price = p.prices?.EMUER;
    if (!Number.isSafeInteger(price) || price < 0) return null;
    const details =
      String(p.description || p.fulfillment || p.name).slice(0, 200) +
      "。価格 " +
      price +
      " EMUER。" +
      (p.orderDeadlineMs
        ? "受付期限 " + new Date(p.orderDeadlineMs).toISOString() + "。"
        : "") +
      String(p.cancelPolicy || "条件は商品画面で確認").slice(0, 100);
    return row("city", "city_product", d.id, p.name, details.slice(0, 400), {
      ...p,
      authorAIConsent: true,
      origin: "SchoolPark公式ショップ",
      facts: {
        priceEmuer: price,
        deadlineMs: p.orderDeadlineMs || null,
        availability: "live-at-check",
        conditions: "商品画面の利用資格・交換枠を確認",
      },
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
