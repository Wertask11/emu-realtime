"use strict";
const { fail } = require("../config");
const { profile } = require("./profile");
function wei(value) {
  if (typeof value !== "string" || !/^\d{1,30}(\.\d{1,18})?$/.test(value))
    return null;
  const [a, b = ""] = value.split(".");
  return BigInt(a) * 10n ** 18n + BigInt(b.padEnd(18, "0"));
}
function createContext({ db, payments, env = {} }) {
  return async function read(a, permissions = {}) {
    if (!a?.uid || !a?.spid) fail("AUTH_REQUIRED", 401);
    const out = {
      balance: { state: "not_consented" },
      achievements: { state: "not_consented" },
      notice: "本人用の情報はGoogle Geminiへ送信しません。",
    };
    if (permissions.balance === true) {
      if (!profile(env)?.balanceAvailable) out.balance = { state: "disabled" };
      else {
        try {
          const b = await payments.balances(
            String(a.walletAddress || "").toLowerCase(),
          );
          const amount = wei(b.spendable);
          out.balance =
            amount === null
              ? { state: "unavailable" }
              : { state: "ready", spendable: b.spendable };
        } catch (_) {
          out.balance = { state: "unavailable" };
        }
      }
    }
    if (permissions.achievements === true) {
      if (!profile(env)?.achievementsAvailable)
        out.achievements = { state: "disabled" };
      else {
        try {
          const results = await Promise.all(
            ["sp_quest_certificates", "sp_stars"].map((col) =>
              db
                .collection(col)
                .where("spid", "==", a.spid)
                .select("status")
                .limit(201)
                .get(),
            ),
          );
          out.achievements = {
            state: "ready",
            questCertificateRecords: Math.min(results[0].size, 200),
            starRecords: Math.min(results[1].size, 200),
            mintedRecords: results
              .flatMap((s) => s.docs.slice(0, 200))
              .filter((d) => d.data().status === "minted").length,
            truncated: results.some((s) => s.size > 200),
            verification: "activity-records-only-not-government-verification",
          };
        } catch (_) {
          out.achievements = { state: "unavailable" };
        }
      }
    }
    return out;
  };
}
module.exports = { createContext, wei };
