"use strict";

/* One completion per person and quest. The reward is reserved from the EMUER v2
   budget in the same Firestore transaction as the operator's approval. */
const express = require("express");
const ethers = require("ethers");
const policy = require("./emuer-v2/policy");

/* ギルドの色。frontend/public/schoolpark/guild-store.js と同じ値。
   証明書の絵と、星空の星の色をそろえるために使う。 */
const GUILD_COLOR = {
  learn: "#0F5C3F", work: "#141310", play: "#C2703D",
  connect: "#B0405A", web3: "#3B382F"
};
const GUILD_LABEL = {
  learn: "LEARN", work: "WORK", play: "PLAY", connect: "CONNECT", web3: "WEB3"
};

/* 証明書に書くクエストの名前。「一般 #001 入門」のような形。
   承認のときと、あとから証明書を作り直すときの両方で使う。
   2か所に同じ組み立てを書いておくと、片方だけ直したときに
   同じクエストの証明書が2つの名前を持つ。 */
function questLabelOf(q) {
  const v = q || {};
  return (v.series === "special" ? "特殊 " : "一般 ") + "#"
    + String(v.questNumber).padStart(3, "0")
    + (Number(v.branch) >= 1 ? "-" + Number(v.branch) : "")
    + (v.stage ? " " + v.stage : "");
}

/* 段ごとの1人あたりの報酬。年内目標の資料どおり。
   入門3日50 ／ 標準7日100 ／ 実践14日200。段の無いクエストは100。
   運営が予算を公開するときに別の額を入れれば、そちらが優先される。 */
const STAGE_EMUER = { "入門": 50, "標準": 100, "実践": 200 };
function defaultPerPerson(quest) {
  return STAGE_EMUER[String(quest && quest.stage || "")] || 100;
}

/* #000 は原点なので、予算も報酬も持たない。 */
const FOUNDER_QUEST_ID = "founder-quest-000";
/* 周回をさかのぼって見るときの上限。承認（渡しそびれを探す）と
   証明書の受け取り（まだ受け取っていないものを探す）で同じ数を使う。
   別々に持つと、片方だけ直したときに食い違う。 */
const ROUND_SCAN_MAX = 20;
function usableQuest(questId, quest) {
  return !!quest && questId !== FOUNDER_QUEST_ID && quest.kind !== "founder"
    && Number.isSafeInteger(Number(quest.questNumber)) && Number(quest.questNumber) >= 1;
}

function createQuestCompletionRouter({ db, requireOwner, requireFirebaseUser, env = process.env }) {
  const router = express.Router();
  const certContract = String(env.SP_QUEST_STAR_CONTRACT || "");
  const certKey = String(env.SP_QUEST_STAR_MINTER_PRIVATE_KEY || "");
  /* 証明書・限定星のNFTを、いま本当に発行できるのか。

     env に2つ入っているだけでは「配れる」と言えない。
     コントラクトを置いたのは運営のウォレットで、MINTER_ROLE は
     そのウォレットに付く。サーバーの発行係は別の住所なので、
     役をもらっていなければ、押しても必ず失敗する。ガス代も要る。

     ここを見ていなかったので「準備中」と出ないまま押せてしまい、
     押しても理由の分からない失敗になっていた。

     RPC を毎回叩かないよう、答えは60秒だけ取っておく。
     秘密鍵はここでも外へ出さない。出すのは発行係の住所だけで、
     これは MINTER_ROLE を与えるために運営が知る必要がある。 */
  /* 一度の発行にかかるガス代のめやす。数えるのは鎖に聞くときだけで、
     ここでは文字のまま置く。組み立てた瞬間に ethers を呼ぶと、
     呼ぶ側の差し替え方ひとつで router が作れなくなる。

     0.01 にしていたが、低すぎた。2026-09-28 に実際に1枚発行したときの
     手数料は 0.0717 POL（基礎手数料が 256 グウェイまで跳ねていた時間帯）。
     つまり残高 0.02 POL でも「発行できます」と答えてしまい、
     押すと失敗する。混んでいるときの1回ぶんを賄える額にする。 */
  const MINT_GAS_FLOOR_MATIC = "0.1";
  let readyCache = { at: 0, body: null };

  function minterAddress() {
    if (!certKey) return null;
    try { return new ethers.Wallet(certKey).address; } catch (e) { return null; }
  }

  async function certificateReadiness() {
    const base = { ready: false, chainId: 137,
      contract: ethers.utils.isAddress(certContract) ? certContract : null,
      minter: null, canMint: false, matic: null, role: "" };
    if (!ethers.utils.isAddress(certContract) || !certKey)
      return { ...base, reason: "NOT_DEPLOYED" };
    const minter = minterAddress();
    if (!minter) return { ...base, reason: "BAD_MINTER_KEY" };
    try {
      const provider = new ethers.providers.JsonRpcProvider(
        env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com");
      const c = new ethers.Contract(certContract, [
        "function MINTER_ROLE() view returns (bytes32)",
        "function hasRole(bytes32,address) view returns (bool)"
      ], provider);
      const role = await c.MINTER_ROLE();
      const [canMint, balance] = await Promise.all([
        c.hasRole(role, minter), provider.getBalance(minter)
      ]);
      const hasGas = balance.gte(ethers.utils.parseEther(MINT_GAS_FLOOR_MATIC));
      /* role はコントラクトから読んだ実物を返す。運営画面で grantRole に
         貼るのはこの値。画面に書き写させると、桁を1つ落として
         静かに別の役を与えてしまう。 */
      return { ...base, minter, canMint, role: String(role || ""),
        matic: ethers.utils.formatEther(balance),
        ready: !!canMint && hasGas,
        reason: !canMint ? "MINTER_NOT_AUTHORIZED" : (!hasGas ? "MINTER_LOW_GAS" : "") };
    } catch (e) {
      /* 鎖に届かないだけかもしれない。準備ができていないとは言い切らず、
         届かなかったことをそのまま返す。 */
      return { ...base, minter, reason: "CHAIN_UNREACHABLE" };
    }
  }

  router.get("/certificate/config", async (_req, res) => {
    res.set("Cache-Control", "no-store, max-age=0");
    const now = Date.now();
    if (readyCache.body && now - readyCache.at < 60_000) return res.json(readyCache.body);
    const body = await certificateReadiness();
    readyCache = { at: now, body };
    return res.json(body);
  });

  /* なぜ発行できなかったのかを、言葉にして返す。
     どれも CERTIFICATE_MINT_FAILED で返していたので、
     役が無いのか、ガスが無いのか、誰にも分からなかった。 */
  /* Polygon は優先手数料（tip）の下限が 25 gwei と決まっている。
     ethers v5 はチェーンに関係なく 1.5 gwei を決め打ちで入れる
     （@ethersproject/providers の base-provider.js を見ること）ので、
     そのまま送るとノードに断られる。実際にこれで発行が止まっていた：

       transaction gas price below minimum:
       gas tip cap 1500000000, minimum needed 25000000000

     下限より少し上（30 gwei）を床にして、混んでいるときは
     チェーンが言う額のほうを使う。上限（maxFee）は基礎手数料の2倍＋tip。
     基礎が跳ねても収まるようにしておく。 */
  const POLYGON_MIN_TIP_GWEI = "30";
  async function polygonFees(provider) {
    const floor = ethers.utils.parseUnits(POLYGON_MIN_TIP_GWEI, "gwei");
    let tip = floor;
    let base = null;
    try {
      const fd = await provider.getFeeData();
      if (fd && fd.maxPriorityFeePerGas && fd.maxPriorityFeePerGas.gt(tip)) {
        tip = fd.maxPriorityFeePerGas;
      }
      base = (fd && fd.lastBaseFeePerGas) || null;
    } catch (e) {
      /* 手数料を聞けなくても送りたい。床の額で出す。 */
    }
    return {
      maxPriorityFeePerGas: tip,
      maxFeePerGas: base ? base.mul(2).add(tip) : tip.mul(2)
    };
  }

  function mintErrorOf(error) {
    const e = error || {};
    const text = JSON.stringify([e.code, e.message, e.reason,
      e.error && e.error.message, e.data,
      e.error && e.error.data]).toLowerCase();
    if (text.includes("insufficient funds")) return "MINTER_OUT_OF_GAS";
    /* OpenZeppelin AccessControl 5.x の AccessControlUnauthorizedAccount。
       セレクタは ethers.utils.id(...) で確かめたもの。 */
    if (text.includes("accesscontrolunauthorizedaccount")
      || text.includes("0xe2517d3f")
      || text.includes("is missing role")) return "MINTER_NOT_AUTHORIZED";
    /* 手数料が Polygon の下限に届いていない。ここは「鎖に届かない」より
       先に見ること。ノードはこれを SERVER_ERROR として返してくるので、
       あとに置くと通信の失敗として片付けられてしまう。
       polygonFees を通していない
       か、下限が引き上げられたときにここへ来る。ガス代が無いのとは
       別の話なので分ける（残高はあるのに送れない）。 */
    if (text.includes("gas price below minimum") || text.includes("gas tip cap")
      || text.includes("transaction underpriced")
      || text.includes("fee cap less than block base fee")) return "MINTER_GAS_PRICE_TOO_LOW";
    /* 鎖に話しかけられていない。役やガスの問題ではないので、分けて返す。
       ここを分けていなかったので、RPC が落ちているだけのときも
       「発行が途中で止まりました」としか出ず、原因が分からなかった。 */
    if (text.includes("network_error") || text.includes("server_error")
      || text.includes("timeout") || text.includes("could not detect network")
      || text.includes("enotfound") || text.includes("econnrefused")
      || text.includes("econnreset") || text.includes("etimedout")
      || text.includes("socket hang up") || text.includes("bad response")
      || text.includes("failed to fetch")) return "CHAIN_UNREACHABLE";
    /* このコントラクトは、同じ完走鍵で2枚目を作らない（AlreadyIssued）。
       記録の側が「まだ」になっているのに鎖には在るときに起きる。 */
    if (text.includes("alreadyissued")) return "CERTIFICATE_ALREADY_ISSUED";
    return "CERTIFICATE_MINT_FAILED";
  }
  router.post("/:questId/budget", requireOwner, async (req, res) => {
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED" });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const questId = String(req.params.questId || "");
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(questId)) return res.status(400).json({ error: "INVALID_QUEST" });
    try {
      const q = await db.collection("sp_quests").doc(questId).get();
      const quest = q.exists ? q.data() || {} : {};
      /* 前は一般 #001 の LEARN しか受け付けなかった。ほかのクエストは
         予算そのものを公開できず、途中報告からの貢献も記録されない。
         クエストなら、どれでも同じ道を通す（#000 だけは除く）。 */
      if (!usableQuest(questId, quest)) return res.status(409).json({ error: "QUEST_NOT_ELIGIBLE" });

      /* 1人あたりの額は、運営が決める。入れなければ段から決める
         （入門50／標準100／実践200、段が無ければ100）。 */
      const perPerson = Number((req.body || {}).perPersonEmuer || defaultPerPerson(quest));
      const total = Number((req.body || {}).totalEmuer || 0);
      if (!Number.isSafeInteger(perPerson) || perPerson <= 0 || perPerson > 1000000)
        return res.status(400).json({ error: "INVALID_PER_PERSON" });
      if (!Number.isSafeInteger(total) || total < perPerson || total > 100000000)
        return res.status(400).json({ error: "INVALID_TOTAL" });

      const label = (quest.series === "special" ? "特殊 " : "一般 ") + "#"
        + String(quest.questNumber).padStart(3, "0")
        + (Number(quest.branch) >= 1 ? "-" + Number(quest.branch) : "")
        + (quest.stage ? " " + quest.stage : "");
      const ref = db.collection("emuer_v2_guild_quest_budgets").doc("quest:" + questId);
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const row = snap.data() || {};
          if (row.status === "published" && Number(row.totalEmuer) === total
              && Number(row.perPersonEmuer || 0) === perPerson) return { alreadyPublished: true };
          throw new Error("BUDGET_EXISTS_DIFFERENT");
        }
        tx.create(ref, {
          schema: "emuer-v2-guild-quest-budget-v1", scopeType: "quest", scopeId: questId,
          title: label + " " + String(quest.title || "").slice(0, 80) + " 完走報酬",
          conditions: "やってみた・つまずいた・気づいたの報告と知恵カードを確認後、運営が完走承認。1人"
            + perPerson + " EMUER、最大" + Math.floor(total / perPerson) + "人。",
          totalEmuer: total, perPersonEmuer: perPerson, allocatedEmuer: 0, status: "published",
          publishedBy: req.identity.walletAddress, publishedAt: new Date(), updatedAt: new Date()
        });
        return { alreadyPublished: false };
      });
      return res.json({ ok: true, totalEmuer: total, perPersonEmuer: perPerson, ...result });
    } catch (error) {
      if (error.message === "BUDGET_EXISTS_DIFFERENT") return res.status(409).json({ error: error.message });
      console.error("Quest budget failed:", error);
      return res.status(500).json({ error: "BUDGET_PUBLISH_FAILED" });
    }
  });
  router.post("/:questId/:address/approve", requireOwner, async (req, res) => {
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED" });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const questId = String(req.params.questId || "");
    const address = String(req.params.address || "").toLowerCase();
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(questId) || !ethers.utils.isAddress(address))
      return res.status(400).json({ error: "INVALID_COMPLETION" });
    const questRef = db.collection("sp_quests").doc(questId);
    const commitRef = questRef.collection("commits").doc(address);
    const budgetRef = db.collection("emuer_v2_guild_quest_budgets").doc("quest:" + questId);
    try {
      const [quest, commit, logs, wisdom, byChes, byWallet] = await Promise.all([
        questRef.get(), commitRef.get(), questRef.collection("logs").get(),
        db.collection("sp_wisdom").where("questId", "==", questId).get(),
        db.collection("ches_accounts").where("chesAddress", "==", address).limit(2).get(),
        db.collection("ches_accounts").where("walletAddress", "==", address).limit(2).get()
      ]);
      const q = quest.exists ? quest.data() || {} : {};
      if (!usableQuest(questId, q)) return res.status(409).json({ error: "QUEST_NOT_ELIGIBLE" });
      if (!commit.exists) return res.status(409).json({ error: "NOT_JOINED" });
      const kinds = new Set();
      logs.forEach(doc => {
        const row = doc.data() || {};
        if (String(row.author || "").toLowerCase() === address) kinds.add(row.kind);
      });
      /* 終えた周回の数。知恵カード1枚が1周の証。

         同じクエストを2回3回とやる人がいる。報告はクエストに積み上がるが、
         知恵カードは周回ごとに別の記録として残る。だから枚数がそのまま
         周回数になる。前はここを「1枚でもあるか」しか見ていなかったので、
         2周目以降は承認する相手が無く、完走も増えなかった。 */
      let rounds = 0;
      wisdom.forEach(doc => { if (String((doc.data() || {}).author || "").toLowerCase() === address) rounds++; });
      if (!["やってみた", "つまずいた", "気づいた"].every(kind => kinds.has(kind)) || !rounds)
        return res.status(409).json({ error: "COMPLETION_EVIDENCE_MISSING" });
      const already = Number((commit.data() || {}).approvedRounds || 0);
      const accounts = [...byChes.docs, ...byWallet.docs];
      const spids = new Set(accounts.map(doc => String((doc.data() || {}).spid || "")));
      if (spids.size !== 1 || ![...spids][0]) return res.status(409).json({ error: "PASSPORT_LINK_REQUIRED" });
      const spid = [...spids][0];
      const identity = await db.collection("sp_identities").doc(spid).get();
      const links = identity.exists ? (identity.data() || {}).links || [] : [];
      const linkedWallet = links.find(link => link && link.kind === "wallet" && ethers.utils.isAddress(link.subject));
      const recipient = String(linkedWallet && linkedWallet.subject || "").toLowerCase();
      if (!ethers.utils.isAddress(recipient))
        return res.status(409).json({ error: "WALLET_REQUIRED" });
      /* 周回ごとに別の鍵。1周目だけは今までと同じ鍵にする
         （すでに出してある報酬と証明書を、作り直さないため）。 */
      const keyOf = (parts) => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(JSON.stringify(parts)));
      const rewardIdOf = (r) => keyOf(["emuer-v2", "quest-completion", questId, spid, ...(r > 1 ? [r] : [])]);

      /* ══════════════════════════════════════════════════════════════
         何周目を認めるのか。

         ふつうは「すでに認めた数の次」。
         ただし、認めてあるのに EMUER が渡っていない周回がある。

         10/1 まで、このサーバーは NOT_STARTED で承認を断っていた。
         そのあいだ運営は管理画面の逃げ道を通り、Firestore へ直接
         approved と approvedRounds を書いていた。完走は記録されたが、
         報酬は1枚も引き当てられていない。

         その状態で「EMUERを渡す」を押すと、approvedRounds（2）が
         知恵カードの枚数（2）に並んでいるので NO_NEW_ROUND で断られた。
         渡すためのボタンが、渡せないと言う状態だった。

         認めてある周回を順に見て、報酬がまだ無いものがあれば、
         そこへ渡す。新しく認めるわけではないので approvedRounds は
         増やさない。
         ══════════════════════════════════════════════════════════════ */
      let topupRound = 0;
      if (already >= rounds) {
        const scan = Math.min(already, ROUND_SCAN_MAX);
        const made = await Promise.all(Array.from({ length: scan },
          (_, i) => db.collection("emuer_v2_rewards").doc(rewardIdOf(i + 1)).get()));
        const miss = made.findIndex(snap => !snap.exists);
        if (miss < 0) return res.status(409).json({ error: "NO_NEW_ROUND" });
        topupRound = miss + 1;
      }
      const round = topupRound || (already + 1);
      const isTopup = topupRound > 0;
      const roundTag = round > 1 ? [round] : [];
      const completionKey = keyOf(["schoolpark", questId, spid, ...roundTag]);
      const certRef = db.collection("sp_quest_certificates").doc(completionKey);
      const rewardKey = JSON.stringify(["emuer-v2", "quest-completion", questId, spid, ...roundTag]);
      const rewardId = keyOf(["emuer-v2", "quest-completion", questId, spid, ...roundTag]);
      const rewardRef = db.collection("emuer_v2_rewards").doc(rewardId);

      /* Resolve the wallet from the account that owns the quest address.
         Never accept a destination supplied by the operator's browser. */
      const result = await db.runTransaction(async tx => {
        const [current, budgetSnap, prior, certificate] = await Promise.all([
          tx.get(commitRef), tx.get(budgetRef), tx.get(rewardRef), tx.get(certRef)
        ]);
        if (!current.exists) throw new Error("NOT_JOINED");
        const was = current.data() || {};
        /* 鍵には周回が混ざっているので、ここで当たるのは「この周をもう
           認めてある」ときだけ。前の周の報酬や証明書には当たらない。 */
        /* 報酬がもう予約してあるなら、この周はもう渡してある。
           証明書だけ先にできていることはある（backfillCertificates が
           作った／サーバーへ届かないまま通した承認のあとに受け取った）。
           そのときは、ここで作るのは報酬だけ。証明書は作り直さない。 */
        if (prior.exists) {
          if (certificate.exists) return { alreadyApproved: true, round: round };
          throw new Error("COMPLETION_STATE_CONFLICT");
        }
        /* 報酬が無いのに証明書だけある。

           渡しそびれ（isTopup）なら、それは起こりうる状態である。
           承認は記録されていて、証明書も受け取り済み、EMUER だけが
           渡っていない。ここで渡す。証明書は作り直さない。

           渡しそびれでないなら、周回そのものが認められていないのに
           証明書だけがある、ということになる。食い違いなので触らない。 */
        if (!isTopup && certificate.exists) throw new Error("COMPLETION_STATE_CONFLICT");
        /* 数えた周回より先へ行っていないか、取引の中でもう一度見る。
           同時に2回押されたときに、二重に払わないため。 */
        const doneRounds = Number(was.approvedRounds || 0);
        /* 渡しそびれていたぶんを渡すときは、新しく認めるわけではない。 */
        if (!isTopup && doneRounds >= rounds) throw new Error("NO_NEW_ROUND");
        /* 承認の印だけが立っていて、報酬も証明書も無いことがある。
           サーバーへ届かないまま管理画面から通した承認がこれ。
           何も払われていないので、ここで引き当て直してよい。
           （この印は運営しか立てられない。firestore.rules の
             sp_quests/{id}/commits/{addr} の update を見ること。）
           前はこれも COMPLETION_STATE_CONFLICT で止めていたので、
           いちど通した承認は、あとから EMUER を渡す道が無かった。 */
        const budget = budgetSnap.exists ? budgetSnap.data() || {} : {};
        if (budget.status !== "published" || budget.scopeType !== "quest" || budget.scopeId !== questId)
          throw new Error("BUDGET_NOT_PUBLISHED");
        const allocated = Number(budget.allocatedEmuer || 0);
        const total = Number(budget.totalEmuer || 0);
        /* 1人あたりの額は、予算を公開したときに決めたもの。
           古い予算（この欄が無いもの）は、段から決める。
           運営のブラウザから送られてきた数は使わない。 */
        const per = Number(budget.perPersonEmuer || defaultPerPerson(q));
        if (!Number.isSafeInteger(per) || per <= 0) throw new Error("BUDGET_NOT_PUBLISHED");
        if (!Number.isSafeInteger(allocated) || !Number.isSafeInteger(total) || allocated + per > total)
          throw new Error("BUDGET_EXCEEDED");
        const now = Date.now();
        const guildId = String(q.guildId || "");
        /* 引き当てた額を、参加の記録そのものに書く。
           管理画面は、この欄があるかどうかで「もう EMUER が動いた承認」と
           「サーバーへ届かないまま通した承認」を見分ける。
           前者は取り消せない（報酬と証明書がもう予約されている）。 */
        /* 認めた日は動かさない。信用スコアと星空の並びが後ろへずれる。 */
        const approvedAt = Number(was.approvedAt) > 0 ? Number(was.approvedAt) : now;
        tx.update(commitRef, { approved: true, approvedAt, approvedBy: req.identity.walletAddress,
          rewardEmuer: per,
          /* 何周ぶん認めたか。完走の数はこれを足して出す。
             渡しそびれていたぶんを渡すだけのときは増やさない。
             増やすと、やってもいない周回を認めたことになる。 */
          approvedRounds: isTopup ? doneRounds : doneRounds + 1,
          lastApprovedAt: now });
        tx.update(budgetRef, { allocatedEmuer: allocated + per, updatedAt: new Date(now) });
        tx.create(rewardRef, {
          schema: "emuer-v2-reward-v1", kind: "quest-completion", key: rewardKey, claimId: rewardId,
          recipient, amountWei: (BigInt(per) * policy.UNIT).toString(), amount: String(per), status: "pending",
          scopeType: "quest", scopeId: questId, createdAt: new Date(now), updatedAt: new Date(now)
        });
        /* 証明書がもうあるなら、作り直さない（受け取り済みのことがある）。 */
        if (!certificate.exists) tx.create(certRef, {
          schema: "schoolpark-quest-star-v1", completionKey, questId, spid, address,
          /* 星空の星と同じ色にする。どのギルドにも属さないクエストは未分類の色。 */
          guildId: guildId, guildColor: GUILD_COLOR[guildId] || "#6E695C",
          questTitle: String(q.title || "").slice(0, 120),
          questLabel: questLabelOf(q),
          amountEmuer: per, round: round,
          completedAt: round > 1 ? now : approvedAt, status: "pending", createdAt: new Date(now)
        });
        return { alreadyApproved: false, amountEmuer: per, round: round, rounds: rounds,
                 toppedUp: isTopup };
      });
      return res.json({ ok: true, rewardId, amountEmuer: result.amountEmuer || 0, ...result });
    } catch (error) {
      const code = String(error.message || "");
      if (["NOT_JOINED", "COMPLETION_STATE_CONFLICT", "BUDGET_NOT_PUBLISHED", "BUDGET_EXCEEDED",
           "NO_NEW_ROUND"].includes(code))
        return res.status(409).json({ error: code });
      console.error("Quest completion failed:", error);
      return res.status(500).json({ error: "COMPLETION_FAILED" });
    }
  });
  router.get("/certificates/:key/metadata", async (req, res) => {
    const key = String(req.params.key || "");
    if (!/^0x[0-9a-f]{64}$/i.test(key) || !db) return res.status(404).json({ error: "NOT_FOUND" });
    const snap = await db.collection("sp_quest_certificates").doc(key).get();
    if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
    const row = snap.data() || {};
    /* 絵も名前も、そのクエストのものにする。
       前はどのクエストで完走しても「#001 LEARN」と書かれた証明書が
       出ていた。#002 を完走した人の手元に #001 の証明書が残る。 */
    const guildId = String(row.guildId || "");
    const guild = GUILD_LABEL[guildId] || "";
    const color = row.guildColor || GUILD_COLOR[guildId] || "#6E695C";
    const label = String(row.questLabel || "").trim();
    const title = String(row.questTitle || "").slice(0, 40);
    /* 2周目以降は、そのことを名前に出す。出さないと、同じクエストの
       証明書がウォレットの中で見分けられない。1周目には付けない
       （すでに出してあるものの名前を変えないため）。 */
    const round = Number(row.round) || 1;
    const roundLabel = round > 1 ? "（" + round + "周目）" : "";
    const caption = ("SchoolPark " + label + (guild ? " " + guild : "")).trim() + roundLabel;
    const esc = t => String(t).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">'
      + '<rect width="640" height="640" fill="#141310"/><circle cx="320" cy="280" r="170" fill="' + esc(color)
      + '" opacity=".35"/><path d="M320 115l42 124 130 2-105 78 39 125-106-75-106 75 39-125-105-78 130-2z" fill="#D0E2BE"/>'
      + '<text x="320" y="520" text-anchor="middle" fill="#F4F1EA" font-size="30" font-family="sans-serif">'
      + esc(caption) + '</text>'
      + '<text x="320" y="562" text-anchor="middle" fill="#D0E2BE" font-size="18" font-family="sans-serif">'
      + esc(title) + '</text></svg>';
    res.set("Cache-Control", "public, max-age=3600");
    const attributes = [{ trait_type: "Quest", value: label || String(row.questId || "") },
      { trait_type: "Completed", value: new Date(row.completedAt).toISOString().slice(0, 10) }];
    if (guild) attributes.unshift({ trait_type: "Guild", value: guild });
    if (Number(row.amountEmuer) > 0) attributes.push({ trait_type: "EMUER", value: String(row.amountEmuer) });
    if (round > 1) attributes.push({ trait_type: "Round", value: String(round) });
    return res.json({
      name: caption + " · Star",
      description: "譲渡不可のクエスト完走証明。星空の星と同じ完走記録から発行されます。",
      image: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
      attributes: attributes
    });
  });
  /* 完走の印はあるのに、証明書の記録が無いことがある。それを作る。

     10/1（EMUER の開始）までサーバーは承認を NOT_STARTED で断る。
     そのとき運営画面は逃げ道を通り、commits に approved と
     approvedRounds だけを直接書く（membership-admin.html の
     data-qapprove を見ること）。証明書はサーバーの取引の中でしか
     作られないので、この道を通った完走には証明書が無い。
     予算が未公開のときや Render が落ちているときも同じ道を通る。

     しかも、あとから認め直して作ることもできない。承認の口は
     approvedRounds を見て「もう済んでいる」と断る（NO_NEW_ROUND）。
     直さないかぎり、その完走の証明書は永久に出ない。

     なので受け取りのときに作る。完走そのものは commits の approved が
     証している。この印は運営しか立てられない（firestore.rules の
     sp_quests/{id}/commits/{addr} の update を見ること）ので、
     本人が勝手に完走を名乗ることはできない。

     EMUER はここでは触らない。証明書は「やった」という記録で、
     報酬とは別のもの。額を書くと、渡していないものを渡したことに
     なってしまうので 0 のままにする。 */
  async function backfillCertificates(questId, spid, keyOfRound, max) {
    const idSnap = await db.collection("sp_identities").doc(spid).get();
    const raw = idSnap.exists ? (idSnap.data() || {}).addresses : null;
    const addrs = Array.isArray(raw) ? raw : [];
    let commit = null;
    let address = "";
    for (const a of addrs) {
      const one = String(a || "").trim().toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(one)) continue;
      const s = await db.collection("sp_quests").doc(questId)
        .collection("commits").doc(one).get();
      if (!s.exists) continue;
      const d = s.data() || {};
      if (d.approved !== true) continue;
      commit = d; address = one; break;
    }
    if (!commit) return 0;                 /* 本当に完走していない */
    const rounds = Math.min(max, Math.max(1, Number(commit.approvedRounds) || 0));
    const qSnap = await db.collection("sp_quests").doc(questId).get();
    const q = qSnap.exists ? qSnap.data() || {} : {};
    const guildId = String(q.guildId || "");
    const now = Date.now();
    let made = 0;
    for (let r = 1; r <= rounds; r += 1) {
      const key = keyOfRound(r);
      const ref = db.collection("sp_quest_certificates").doc(key);
      try {
        await ref.create({
          schema: "schoolpark-quest-star-v1", completionKey: key, questId, spid, address,
          guildId: guildId, guildColor: GUILD_COLOR[guildId] || "#6E695C",
          questTitle: String(q.title || "").slice(0, 120),
          questLabel: questLabelOf(q),
          amountEmuer: 0, round: r,
          completedAt: Number(commit.approvedAt) || now,
          status: "pending", createdAt: new Date(now),
          /* あとから作ったもの、という印。監査のために残す。
             EMUER が引き当てられていないことも、これで見分けられる。 */
          backfilled: true
        });
        made += 1;
      } catch (e) {
        /* 同じ瞬間に承認が通って、先に作られた。それでよい。 */
      }
    }
    return made;
  }

  /* ══════════════════════════════════════════════════════════════
     知恵カードを置く

     「知恵カードは、完了したクエストからしか生まれない」。
     ところが、これを守っている場所がどこにも無かった。
       画面   … 一文が空でないかだけ
       ルール … そのクエストを受けているかだけ
     受けるだけで何枚でも置けて、信用スコアの「知恵 ×5」が
     そのぶん増える状態だった。

     「完了した」は「承認済み」とは読めない。承認の口のほうが
     知恵カード1枚を完走の証拠として要求しているので
     （COMPLETION_EVIDENCE_MISSING を見ること）、
     カードに承認を求めると、どちらも永久に起きない。
     矛盾しない読み方は「やることをやり終えた」＝
     やってみた・つまずいた・気づいた が揃っている、だけ。

     これは Firestore のルールでは守れない。報告は自動のIDで
     並んでいて、ルールはサブコレクションを数えられないため。
     だからここで数える。ルール側は create を閉じる。
     ══════════════════════════════════════════════════════════════ */
  const LOG_KINDS = ["やってみた", "つまずいた", "気づいた"];

  /* 知恵カードが入る棚。画面（index.html の spWisdomTagFor）と同じ決め方。
     Emu の投稿から生まれたものは Emu の棚、それ以外はギルドの棚。
     画面から送られてきた棚の名前は使わない。棚は出どころで決まるもので、
     選ばせるものではないため。 */
  function wisdomTagOf(quest, fromPostId) {
    if (String(fromPostId || "").trim()) return "Emu";
    return GUILD_LABEL[String((quest || {}).guildId || "")] || "その他";
  }

  /* パスポートの名義のうち、このクエストを受けているもの。
     名義は1つとは限らない（ウォレット・LINE・Google で別になる）。 */
  async function committedAddressOf(questId, spid) {
    const idSnap = await db.collection("sp_identities").doc(spid).get();
    const raw = idSnap.exists ? (idSnap.data() || {}).addresses : null;
    const addrs = Array.isArray(raw) ? raw : [];
    for (const a of addrs) {
      const one = String(a || "").trim().toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(one)) continue;
      const s = await db.collection("sp_quests").doc(questId)
        .collection("commits").doc(one).get();
      if (s.exists) return one;
    }
    return "";
  }

  router.post("/:questId/wisdom", requireFirebaseUser, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const questId = String(req.params.questId || "");
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(questId)) return res.status(400).json({ error: "INVALID_QUEST" });
    if (questId === FOUNDER_QUEST_ID) return res.status(409).json({ error: "QUEST_NOT_ELIGIBLE" });
    const spid = String((req.identity.account || {}).spid || "");
    if (!spid) return res.status(409).json({ error: "PASSPORT_LINK_REQUIRED" });

    const b = req.body || {};
    const insight = String(b.insight || "").trim();
    if (!insight) return res.status(400).json({ error: "INSIGHT_REQUIRED" });
    if (insight.length > 200) return res.status(400).json({ error: "INSIGHT_TOO_LONG" });

    const q = await db.collection("sp_quests").doc(questId).get();
    if (!q.exists) return res.status(404).json({ error: "QUEST_NOT_FOUND" });

    const address = await committedAddressOf(questId, spid);
    if (!address) return res.status(409).json({ error: "NOT_TAKEN" });

    /* 前の周が認められるまで、次のカードは置けない。

       知恵カードの枚数が、そのまま周回の数になる（承認の口がそう数える）。
       だから続けて何枚も置けると、運営がまだ認めていない周回まで
       「認められる」ことになり、管理画面の「あと◯周」が実態とずれる。

       置ける条件は「いまある枚数 ≦ 認められた周回の数」。
         1枚目 … 0 ≦ 0 で置ける → 認められて 1
         2枚目 … 1 ≦ 1 で置ける → 認められて 2
       認められる前にもう1枚、はここで止まる。 */
    const mine = await db.collection("sp_wisdom").where("questId", "==", questId).get();
    let placed = 0;
    mine.forEach(d => {
      if (String((d.data() || {}).author || "").toLowerCase() === address) placed += 1;
    });
    const commitSnap = await db.collection("sp_quests").doc(questId)
      .collection("commits").doc(address).get();
    const approvedRounds = Math.max(0,
      Number((commitSnap.data() || {}).approvedRounds) || 0);
    if (placed > approvedRounds) {
      return res.status(409).json({ error: "ROUND_NOT_APPROVED",
        placed, approvedRounds });
    }

    /* やることをやり終えたか。三種そろって初めて置ける。 */
    const logs = await db.collection("sp_quests").doc(questId).collection("logs").get();
    const kinds = new Set();
    logs.forEach(d => {
      const row = d.data() || {};
      if (String(row.author || "").toLowerCase() === address) kinds.add(row.kind);
    });
    const missing = LOG_KINDS.filter(k => !kinds.has(k));
    if (missing.length) return res.status(409).json({ error: "REPORTS_MISSING", missing });

    const quest = q.data() || {};
    const row = {
      questId,
      questTitle: String(quest.title || "").slice(0, 200),
      fromPostId: String(b.fromPostId || "").slice(0, 80),
      fromPostTitle: String(b.fromPostTitle || "").slice(0, 120),
      knowledge: String(b.knowledge || "").slice(0, 200),
      experiment: String(b.experiment || "").slice(0, 200),
      insight: insight.slice(0, 200),
      /* 棚は出どころから決まる。画面の言い値は使わない。 */
      tag: wisdomTagOf(quest, b.fromPostId),
      author: address,
      authorName: String(b.authorName || "").slice(0, 80),
      spid,
      createdAt: Date.now()
    };
    const ref = await db.collection("sp_wisdom").add(row);
    return res.json({ ok: true, id: ref.id, ...row });
  });

  router.post("/:questId/certificate/claim", requireFirebaseUser, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const questId = String(req.params.questId || "");
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(questId)) return res.status(400).json({ error: "INVALID_QUEST" });
    const spid = String((req.identity.account || {}).spid || "");
    if (!spid) return res.status(409).json({ error: "PASSPORT_LINK_REQUIRED" });

    /* 承認は周回ごとに証明書を作る。鍵に round が入るのは2周目以降だけで、
       1周目は付かない（上の roundTag と同じ形にしてある。付けてしまうと、
       すでに出してある1周目の証明書を作り直すことになる）。

       ここでは前まで round を付けずに1つだけ探していた。1周目は当たるが、
       2周目以降の証明書は作られたまま、永久に受け取れなかった。

       どの周を受け取るかは指定させない。まだ受け取っていないもののうち
       いちばん古い1つを出す。押すたびに1つずつ進む。
       周の数は上限（ROUND_SCAN_MAX）まで順に見て、記録が無いところで止める。 */
    const keyOfRound = (r) => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(
      JSON.stringify(["schoolpark", questId, spid, ...(r > 1 ? [r] : [])])));
    let found = 0;
    let pick = null;     /* 受け取る1つ（いちばん古い未受け取り） */
    let last = null;     /* 最後に見た記録。全部受け取り済みのときに返す */
    const scan = async () => {
      found = 0; pick = null; last = null;
      for (let r = 1; r <= ROUND_SCAN_MAX; r += 1) {
        const s = await db.collection("sp_quest_certificates").doc(keyOfRound(r)).get();
        if (!s.exists) break;
        found += 1;
        const d = s.data() || {};
        last = d;
        if (!pick && d.status !== "minted") pick = { ref: s.ref, row: d, round: r, key: keyOfRound(r) };
      }
    };
    await scan();
    /* 見つからない（または全部受け取り済みに見える）ときは、
       完走の印そのものを見に行って、足りない証明書をここで作る。
       なぜ必要かは backfillCertificates に書いてある。 */
    if (!found || !pick) {
      const made = await backfillCertificates(questId, spid, keyOfRound, ROUND_SCAN_MAX);
      if (made) await scan();
    }
    if (!found) return res.status(404).json({ error: "NOT_COMPLETED" });
    if (!pick) return res.json({ ok: true, tokenId: last.tokenId, txHash: last.txHash, alreadyMinted: true });
    const ref = pick.ref;
    const row = pick.row;
    const key = pick.key;
    const identity = await db.collection("sp_identities").doc(spid).get();
    const links = identity.exists ? (identity.data() || {}).links || [] : [];
    const linkedWallet = links.find(link => link && link.kind === "wallet" && ethers.utils.isAddress(link.subject));
    const wallet = String(linkedWallet && linkedWallet.subject || "").toLowerCase();
    if (!ethers.utils.isAddress(wallet)) return res.status(409).json({ error: "WALLET_REQUIRED" });
    if (!ethers.utils.isAddress(certContract) || !certKey) return res.status(503).json({ error: "CERTIFICATE_NOT_DEPLOYED" });
    try {
      const provider = new ethers.providers.JsonRpcProvider(env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com");
      const signer = new ethers.Wallet(certKey, provider);
      const contract = new ethers.Contract(certContract, [
        "function tokenForCompletion(bytes32) view returns (uint256)",
        "function ownerOf(uint256) view returns (address)",
        "function mint(address,bytes32,string) returns (uint256)"
      ], signer);
      let tokenId = await contract.tokenForCompletion(key);
      let txHash = "";
      if (tokenId.isZero()) {
        const uri = "https://emu-realtime.onrender.com/api/schoolpark/quest-completions/certificates/" + key + "/metadata";
        try {
          const tx = await contract.mint(wallet, key, uri, await polygonFees(provider));
          txHash = tx.hash;
          await tx.wait();
        } catch (e) {
          /* 同じ完走鍵で2枚目は作れない（AlreadyIssued）。すれ違いで
             先に発行されていたときにこうなる。鎖の上に在るなら失敗では
             ないので、投げ返さずに読み直して記録のほうを合わせる。 */
          if (mintErrorOf(e) !== "CERTIFICATE_ALREADY_ISSUED") throw e;
        }
        tokenId = await contract.tokenForCompletion(key);
      }
      if (tokenId.isZero()) throw new Error("MINT_NOT_CONFIRMED");
      await ref.set({ status: "minted", tokenId: tokenId.toString(), txHash, mintedTo: (await contract.ownerOf(tokenId)).toLowerCase(), mintedAt: new Date() }, { merge: true });
      return res.json({ ok: true, tokenId: tokenId.toString(), txHash });
    } catch (error) {
      console.error("Quest certificate claim failed:", error);
      readyCache = { at: 0, body: null };   /* 次に聞かれたら、いまの状態を見に行く */
      return res.status(503).json({ error: mintErrorOf(error) });
    }
  });

  /* ══════════════════════════════════════════════════════════════
     限定星

     クエストの完走とは別に、運営が配る星。いまのところ使い道は
     特殊 #002（解剖フェス）の「来た人全員」だが、仕組みは星の種類
     （starId）で分けてあるので、別の催しにも使える。

     設計は証明書と同じ「先に記録、ウォレットができてから発行」。
       1. 運営が配ると sp_stars/{key} に記録ができる（鍵は spid）
       2. 星空にはこの記録から出る。ウォレットは要らない
       3. ウォレットを連携した人が「NFTで受け取る」を押すと発行される
       4. 受け取らなくても記録は消えない。星空の記録が正で、NFTは写し

     コントラクトは証明書と同じものを使う（SP_QUEST_STAR_CONTRACT）。
     もともと「星」のコントラクトなので、分ける理由がない。
     鍵の頭を "schoolpark-star" にしてあるので、完走の鍵とは衝突しない。
     ══════════════════════════════════════════════════════════════ */
  const STAR_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
  const starKeyOf = (starId, spid) =>
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes(
      JSON.stringify(["schoolpark-star", starId, spid])));

  /* 運営が配る。相手は SchoolPark ID で指定する。
     ウォレットは要らない（LINE だけの人にも配れる）。
     二重に配っても増えない（同じ鍵になるので上書きにならず、そのまま返す）。 */
  router.post("/stars/grant", requireOwner, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const b = req.body || {};
    const starId = String(b.starId || "").trim().toLowerCase();
    const spid = String(b.spid || "").trim();
    if (!STAR_ID_RE.test(starId)) return res.status(400).json({ error: "INVALID_STAR_ID" });
    if (!/^SP-[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/i.test(spid))
      return res.status(400).json({ error: "INVALID_SPID" });
    const color = /^#[0-9A-Fa-f]{6}$/.test(String(b.color || "")) ? String(b.color) : "#D4A843";
    const key = starKeyOf(starId, spid);
    const ref = db.collection("sp_stars").doc(key);
    const snap = await ref.get();
    if (snap.exists) return res.json({ ok: true, key, already: true });
    await ref.set({
      schema: "schoolpark-limited-star-v1",
      starId, spid, key,
      label: String(b.label || "限定星").slice(0, 60),
      color,
      note: String(b.note || "").slice(0, 200),
      status: "pending",
      grantedBy: (req.identity && req.identity.walletAddress) || "admin",
      createdAt: new Date()
    });
    return res.json({ ok: true, key, already: false });
  });

  /* 誰に配ったか。イベント当日に「もう配ったか」「何人に配ったか」を
     見るためのもの。星の種類で絞れる。 */
  router.get("/stars/list", requireOwner, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const starId = String(req.query.starId || "").trim().toLowerCase();
    let q = db.collection("sp_stars");
    if (starId) {
      if (!STAR_ID_RE.test(starId)) return res.status(400).json({ error: "INVALID_STAR_ID" });
      q = q.where("starId", "==", starId);
    }
    const snap = await q.limit(500).get();
    const stars = [];
    snap.forEach(d => {
      const v = d.data() || {};
      stars.push({
        key: d.id, starId: v.starId || "", spid: v.spid || "",
        label: v.label || "", color: v.color || "",
        note: v.note || "", minted: v.status === "minted",
        createdAt: v.createdAt || null
      });
    });
    return res.json({ ok: true, total: stars.length, stars });
  });

  /* 自分の限定星。星空の数え上げと、パスポートの「受け取る」に使う。
     ウォレットの有無で結果は変わらない。 */
  router.get("/stars/mine", requireFirebaseUser, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const spid = String((req.identity.account || {}).spid || "");
    if (!spid) return res.json({ ok: true, stars: [] });
    const q = await db.collection("sp_stars").where("spid", "==", spid).limit(200).get();
    const stars = [];
    q.forEach(d => {
      const v = d.data() || {};
      stars.push({
        key: d.id, starId: v.starId || "", label: v.label || "限定星",
        color: v.color || "#D4A843", note: v.note || "",
        minted: v.status === "minted",
        tokenId: v.tokenId || "", grantedAt: v.createdAt || null
      });
    });
    return res.json({ ok: true, stars });
  });

  /* NFTで受け取る。証明書と同じ形。
     ウォレットが無ければ WALLET_REQUIRED を返すだけで、記録は触らない。
     あとで連携してもう一度押せば、そのとき発行される。 */
  router.post("/stars/:starId/claim", requireFirebaseUser, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const starId = String(req.params.starId || "").trim().toLowerCase();
    if (!STAR_ID_RE.test(starId)) return res.status(400).json({ error: "INVALID_STAR_ID" });
    const spid = String((req.identity.account || {}).spid || "");
    if (!spid) return res.status(409).json({ error: "PASSPORT_LINK_REQUIRED" });
    const key = starKeyOf(starId, spid);
    const ref = db.collection("sp_stars").doc(key);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "STAR_NOT_GRANTED" });
    const row = snap.data() || {};
    if (row.status === "minted")
      return res.json({ ok: true, tokenId: row.tokenId, txHash: row.txHash, alreadyMinted: true });

    const identity = await db.collection("sp_identities").doc(spid).get();
    const links = identity.exists ? (identity.data() || {}).links || [] : [];
    const linkedWallet = links.find(link => link && link.kind === "wallet" && ethers.utils.isAddress(link.subject));
    const wallet = String(linkedWallet && linkedWallet.subject || "").toLowerCase();
    if (!ethers.utils.isAddress(wallet)) return res.status(409).json({ error: "WALLET_REQUIRED" });
    if (!ethers.utils.isAddress(certContract) || !certKey) return res.status(503).json({ error: "CERTIFICATE_NOT_DEPLOYED" });
    try {
      const provider = new ethers.providers.JsonRpcProvider(env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com");
      const signer = new ethers.Wallet(certKey, provider);
      const contract = new ethers.Contract(certContract, [
        "function tokenForCompletion(bytes32) view returns (uint256)",
        "function ownerOf(uint256) view returns (address)",
        "function mint(address,bytes32,string) returns (uint256)"
      ], signer);
      let tokenId = await contract.tokenForCompletion(key);
      let txHash = "";
      if (tokenId.isZero()) {
        const uri = "https://emu-realtime.onrender.com/api/schoolpark/quest-completions/stars/" + key + "/metadata";
        try {
          const tx = await contract.mint(wallet, key, uri, await polygonFees(provider));
          txHash = tx.hash;
          await tx.wait();
        } catch (e) {
          /* 証明書と同じ。鎖に在るなら失敗ではない。 */
          if (mintErrorOf(e) !== "CERTIFICATE_ALREADY_ISSUED") throw e;
        }
        tokenId = await contract.tokenForCompletion(key);
      }
      if (tokenId.isZero()) throw new Error("MINT_NOT_CONFIRMED");
      await ref.set({ status: "minted", tokenId: tokenId.toString(), txHash,
        mintedTo: (await contract.ownerOf(tokenId)).toLowerCase(), mintedAt: new Date() }, { merge: true });
      return res.json({ ok: true, tokenId: tokenId.toString(), txHash });
    } catch (error) {
      console.error("Limited star claim failed:", error);
      readyCache = { at: 0, body: null };
      return res.status(503).json({ error: mintErrorOf(error) });
    }
  });

  /* NFTの中身。証明書と同じ作りで、絵は星ひとつ。 */
  router.get("/stars/:key/metadata", async (req, res) => {
    const key = String(req.params.key || "");
    if (!/^0x[0-9a-f]{64}$/i.test(key) || !db) return res.status(404).json({ error: "NOT_FOUND" });
    const snap = await db.collection("sp_stars").doc(key).get();
    if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
    const row = snap.data() || {};
    const color = /^#[0-9A-Fa-f]{6}$/.test(String(row.color || "")) ? row.color : "#D4A843";
    const label = String(row.label || "限定星").slice(0, 60);
    const esc = t => String(t).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">'
      + '<rect width="600" height="600" fill="#14202A"/>'
      + '<circle cx="300" cy="260" r="54" fill="' + color + '"/>'
      + '<circle cx="300" cy="260" r="110" fill="none" stroke="' + color + '" stroke-opacity=".35" stroke-width="2"/>'
      + '<text x="300" y="420" text-anchor="middle" fill="#F4F1EA" font-size="30"'
      + ' font-family="sans-serif">' + esc(label) + '</text>'
      + '<text x="300" y="462" text-anchor="middle" fill="#F4F1EA" fill-opacity=".55" font-size="18"'
      + ' font-family="sans-serif">SchoolPark</text></svg>';
    return res.json({
      name: "SchoolPark " + label,
      description: "譲渡不可の限定星。星空の記録から発行されます。受け取らなくても星は残ります。",
      image: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
      attributes: [{ trait_type: "Star", value: String(row.starId || "") }]
    });
  });

  return router;
}

module.exports = { createQuestCompletionRouter };
