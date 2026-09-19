'use strict';
// Pure policy helpers. Not connected to production routes or Firestore yet.
const UNIT = 10n ** 18n;
const MONTHLY_CAP = 416000n * UNIT;
const INITIAL_SUPPLY = 10000000n * UNIT;
const START_MS = Date.parse('2026-09-30T15:00:00.000Z');
const JST_MS = 9 * 3600000;
const DAY_MS = 86400000;
function dateAt(ms) {
  if (!Number.isSafeInteger(ms)) throw new TypeError('timestamp must be integer milliseconds');
  const d = new Date(ms + JST_MS);
  if (!Number.isFinite(d.getTime())) throw new RangeError('invalid timestamp');
  return d;
}
function dayKey(ms) { return dateAt(ms).toISOString().slice(0, 10); }
function monthKey(ms) { return dayKey(ms).slice(0, 7); }
function weekKey(ms) {
  const d = dateAt(ms);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY_MS);
  return monday.toISOString().slice(0, 10);
}
function period(plan, action, ms) {
  if (!['convert', 'exchange'].includes(action)) throw new Error('invalid action');
  if (!['light', 'plus', 'pro'].includes(plan)) throw new Error('ineligible plan');
  return { action, plan, key: plan === 'light' ? monthKey(ms) : plan === 'plus' ? weekKey(ms) : null, limit: plan === 'pro' ? null : 1 };
}
function amount(value) {
  if (typeof value !== 'bigint' || value < 0n) throw new TypeError('amount must be nonnegative bigint base units');
  return value;
}
function claimable({remaining, allocated, availableTreasury, paidThisMonth}) {
  [remaining, allocated, availableTreasury, paidThisMonth].forEach(amount);
  if (paidThisMonth > MONTHLY_CAP) throw new RangeError('monthly cap invariant violated');
  return [remaining, allocated, availableTreasury, MONTHLY_CAP-paidThisMonth].reduce((a,b)=>a<b?a:b);
}
function isActive(ms) { dateAt(ms); return ms >= START_MS; }
function dailyRewardKey(passportId, kind, ms) {
  if (typeof passportId !== 'string' || !passportId.trim()) throw new Error('passport required');
  if (!['login', 'public-reflection', 'discussion-conclusion'].includes(kind)) throw new Error('invalid daily reward kind');
  // Internal off-chain key only; do not publish identity or activity keys on-chain.
  return JSON.stringify(['emuer-v2', passportId, kind, dayKey(ms)]);
}
module.exports = { UNIT, MONTHLY_CAP, INITIAL_SUPPLY, START_MS, dayKey, monthKey, weekKey, period, claimable, isActive, dailyRewardKey };
