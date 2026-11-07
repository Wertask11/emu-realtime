"use strict";
// Test-only projection adapter; never imported by production files.
const { makeFirestore } = require("../../fake-firestore");
const { fixture } = require("../fixture");
const { createRegistry } = require("./registry");
const { hash } = require("../config");
const { PURPOSE, DOMAINS } = require("./profile");
function projectedDatabase() {
  const db = makeFirestore(),
    original = db.collection.bind(db),
    reads = [];
  function project(s, fields) {
    if (!fields) return s;
    const v = s.data() || {};
    return {
      ...s,
      data: () =>
        Object.fromEntries(
          fields.filter((k) => Object.hasOwn(v, k)).map((k) => [k, v[k]]),
        ),
    };
  }
  function wrap(q, col, fields = null) {
    return {
      where: (...args) => wrap(q.where(...args), col, fields),
      limit: (n) => wrap(q.limit(n), col, fields),
      select: (...fs) => wrap(q, col, fs),
      doc: (id) => {
        const ref = original(col).doc(id);
        ref.parent = wrap(original(col), col);
        return ref;
      },
      get: async () => {
        reads.push({ collection: col, fields });
        const s = await q.get();
        const docs = s.docs.map((d) => project(d, fields));
        return { ...s, docs, forEach: (fn) => docs.forEach(fn) };
      },
    };
  }
  db.collection = (col) => wrap(original(col), col);
  db.getAll = async (...args) => {
    const options = args.at(-1)?.fieldMask ? args.pop() : {};
    return Promise.all(
      args.map(async (ref) => {
        reads.push({ collection: ref._col, fields: options.fieldMask || null });
        return project(await ref.get(), options.fieldMask);
      }),
    );
  };
  return { db, reads };
}
async function crossFixture(options = {}) {
  const { db, reads } = projectedDatabase(),
    payloads = [];
  const env = {
    ECONOMY_CROSS_DOMAIN_ENABLED: "true",
    ECONOMY_PRIVATE_BALANCE_ENABLED: "true",
    ECONOMY_PRIVATE_ACHIEVEMENTS_ENABLED: "true",
    ...Object.fromEntries(
      Object.keys(DOMAINS).map((d) => [
        "ECONOMY_SOURCE_" + d.toUpperCase(),
        "true",
      ]),
    ),
    ...options.env,
  };
  const f = fixture({
    ...options,
    db,
    env,
    providerReply: (payload) => {
      payloads.push(payload);
      if (options.providerReply) return options.providerReply(payload);
      const data = JSON.parse(payload.contents[0].parts[0].text),
        chosen = data.sources.slice(0, 4);
      if (!payload.generationConfig.responseSchema.properties.steps)
        return {
          matches: chosen.map((s) => ({ key: s.key, evidence: "summary" })),
        };
      const action = (s) =>
        s.kind === "guild" || s.kind === "quest"
          ? "review_activity"
          : s.kind === "city_product" || s.kind === "emuer_guide"
            ? "review_conditions"
            : s.kind === "passport_guide"
              ? "check_profile"
              : s.kind === "activity_guide"
                ? "open_play_guide"
                : "read_source";
      return {
        matches: chosen.map((s) => ({ key: s.key, evidence: "summary" })),
        steps: chosen.map((s) => ({ key: s.key, action: action(s) })),
        comparisons:
          chosen.length > 1
            ? [
                {
                  keys: chosen.slice(0, 2).map((s) => s.key),
                  basis: "perspectives",
                },
              ]
            : [],
      };
    },
  });
  await f.seed();
  const data = {
    posts: {
      experience: {
        title: "美容師の経験を知識へ",
        body: "施術中の説明を振り返り、接客の工夫と試した結果を残した経験です。",
        visibility: "public",
        updatedAt: new Date(f.now() - 1000),
        knowledgeLab: { revision: 1, aiUseConsent: { allowed: true } },
      },
      refused: {
        title: "美容師の秘密の話",
        body: "許諾しない公開投稿",
        visibility: "public",
        knowledgeLab: { revision: 1, aiUseConsent: { allowed: false } },
      },
      private: {
        title: "美容師の非公開情報",
        body: "PRIVATE-SOURCE-MUST-NOT-LEAVE",
        visibility: "private",
        knowledgeLab: { revision: 1, aiUseConsent: { allowed: true } },
      },
    },
    knowledge_lab_system: { index: { state: "ready" } },
    knowledge_lab_search: {
      experience: { postId: "experience", active: true },
      refused: { postId: "refused", active: true },
      private: { postId: "private", active: true },
    },
    room1_contents: {
      lesson: {
        title: "分散型ネットワークの基礎",
        summary: "ブロックチェーンの仕組みと、技術を試す前に確認する条件。",
        visibility: "public",
      },
      draft: {
        title: "未公開教材",
        summary: "DO-NOT-LEAVE",
        visibility: "private",
      },
    },
    sp_quests: {
      challenge: {
        title: "Web3を小さく試す",
        brief: "公開資料を学び、実際に試して振り返る挑戦。",
        status: "OPEN",
        visibility: "public",
        members: ["PRIVATE-MEMBER"],
      },
    },
    mitemiru_products: {
      ticket: {
        name: "Web3体験チケット",
        description: "技術の基礎と実践を学ぶ体験。",
        status: "live",
        shopId: "schoolpark-official",
        prices: { EMUER: 3 },
        stock: 10,
        sold: 0,
        reserved: 0,
      },
      expired: {
        name: "期限切れ体験",
        description: "古い交換対象",
        status: "live",
        shopId: "schoolpark-official",
        prices: { EMUER: 1 },
        orderDeadlineMs: f.now() - 1,
      },
      privateproduct: {
        name: "非公開商品",
        description: "DO-NOT-LEAVE",
        status: "live",
        shopId: "schoolpark-official",
        prices: { EMUER: 2 },
        private: true,
      },
    },
    sp_stars: {
      mine: {
        spid: "SP-AAAA-AAAA-AAAA-AAAA",
        status: "minted",
        label: "PRIVATE-LABEL",
      },
      others: {
        spid: "SP-BBBB-BBBB-BBBB-BBBB",
        status: "minted",
        label: "OTHER-PERSON",
      },
    },
    sp_quest_certificates: {
      mine: { spid: "SP-AAAA-AAAA-AAAA-AAAA", status: "pending" },
      others: { spid: "SP-BBBB-BBBB-BBBB-BBBB", status: "minted" },
    },
  };
  for (const [col, values] of Object.entries(data))
    for (const [id, v] of Object.entries(values))
      await db.collection(col).doc(id).set(v);
  const knowledge = {
    ref: (kind, id) => db.collection("knowledge_lab_" + kind).doc(id),
    rawPost: async (id, _actor, publicOnly) => {
      if (publicOnly !== true) throw Error("PUBLIC_ONLY_REQUIRED");
      const s = await db.collection("posts").doc(id).get();
      if (!s.exists || s.data().visibility !== "public")
        throw Error("NOT_FOUND");
      return s.data();
    },
  };
  const registry = createRegistry({
    db,
    knowledge,
    payments: f.commerce.servicePayments,
    env: f.env,
    now: f.now,
  });
  f.economy.service.sources.cross = registry;
  const a = await f.actor();
  for (const adapter of Object.values(registry.adapters))
    for (const s of await adapter.list(a))
      await db
        .collection("emuer_v2_agent_source_approvals")
        .doc(hash(s.key))
        .set({
          piiReviewed: true,
          aiUseApproved: true,
          rightsVerified: true,
          authorPermissionConfirmed: true,
          purpose: PURPOSE,
          contentHash: hash([s.title, s.summary]),
          originHash: s.originHash || null,
          validUntilMs: f.now() + 86400000,
        });
  return {
    ...f,
    registry,
    payloads,
    reads,
    knowledge,
    a,
    async request(goal = "Web3を学んで実際に試したい", permissions = {}) {
      const q = await f.economy.service.quote(a, { goal, ...permissions });
      return {
        quoteId: q.id,
        termsVersion: q.termsVersion,
        requestId: "cross-request-00000001",
        paymentConsent: true,
        aiConsent: true,
        searchConsentVersion: q.searchProfile?.version,
        ...permissions,
      };
    },
  };
}
module.exports = { projectedDatabase, crossFixture };
