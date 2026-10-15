"use strict";

// Founder approved 2026-10-15. Prices and publication allowances are unchanged.
// Reduced retained-item limits start only after the public advance notice.
const VERSION = "2026-11-01";
const NOTICE_DATE = "2026-10-15";
const EFFECTIVE_AT = Date.parse("2026-11-01T00:00:00+09:00");
const UNLIMITED = 1000000;
const PLANS = {
  guest: {
    amount: 0,
    role: "見学して、少し試す",
    post: 0,
    request: 0,
    answer: 0,
    ichinichi: 0,
    discussion: 0,
    library: 1,
    guestPlay: 3,
    saved: 10,
    notes: 3,
  },
  light: {
    amount: 500,
    role: "自分も参加する",
    post: 5,
    request: 1,
    answer: 5,
    ichinichi: 7,
    discussion: 0,
    library: 30,
    guestPlay: 9999,
    saved: 100,
    notes: 30,
  },
  plus: {
    amount: 3000,
    role: "継続して蓄積・研究する",
    post: 30,
    request: 10,
    answer: 30,
    ichinichi: 31,
    discussion: 10,
    library: 1000,
    guestPlay: 9999,
    saved: 1000,
    notes: 1000,
  },
  pro: {
    amount: 10000,
    role: "人と話しながら進める",
    post: UNLIMITED,
    request: 10,
    answer: 30,
    ichinichi: 31,
    discussion: 10,
    library: 1000,
    guestPlay: 9999,
    saved: 1000,
    notes: 1000,
  },
};
function storageLimits(plan, at = Date.now()) {
  const p = PLANS[plan] || PLANS.guest;
  return {
    saved: at >= EFFECTIVE_AT ? p.saved : 1000,
    notes: at >= EFFECTIVE_AT ? p.notes : 1000,
    drafts: p.library,
  };
}
function catalog(at = Date.now()) {
  return {
    version: VERSION,
    noticeDate: NOTICE_DATE,
    effectiveAt: new Date(EFFECTIVE_AT).toISOString(),
    retainedLimitsActive: at >= EFFECTIVE_AT,
    monthlyPeriod: "Asia/Tokyo-calendar-month",
    plans: Object.entries(PLANS).map(([key, p]) => ({
      key,
      ...p,
      storage: storageLimits(key, at),
      announcedStorage: { saved: p.saved, notes: p.notes, drafts: p.library },
      readerScope: key === "guest" ? "latest-20" : "all-public",
      dialogue: key === "pro",
      dialogueOpportunitiesPer30Days: key === "pro" ? 4 : 0,
    })),
    ai: {
      analysesPerPassportPerDay: 3,
      analysesGlobalPerDay: 10,
      embeddingsGlobalPerDay: 60,
      guaranteed: false,
    },
    officialPass: {
      plan: "plus",
      preservesExistingPurchase: true,
      includesProDialogue: false,
      futureSeriesForSale: false,
    },
  };
}
function calendarWindow(at = Date.now()) {
  const jst = new Date(at + 9 * 3600000);
  const year = jst.getUTCFullYear(),
    month = jst.getUTCMonth();
  return {
    key: "m" + year + "-" + (month + 1),
    start: new Date(Date.UTC(year, month, 1) - 9 * 3600000),
    end: new Date(Date.UTC(year, month + 1, 1) - 9 * 3600000),
  };
}
module.exports = {
  VERSION,
  NOTICE_DATE,
  EFFECTIVE_AT,
  UNLIMITED,
  PLANS,
  storageLimits,
  catalog,
  calendarWindow,
};
