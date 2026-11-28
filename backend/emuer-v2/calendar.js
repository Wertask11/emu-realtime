'use strict';
/* 12月の「挑戦納めカレンダー」（11/28 オーナー決定：全員に配る・案B）。
   毎日のログインボーナス（ふだんは 1 EMUER）を、2026年12月だけ日付で増やす。
   - 12月の通常日 … 2 EMUER
   - 12/5（土）・12/15（火）… 5 EMUER
   - 12/25（金）クリスマス … 10 EMUER
   - 12/31（木）挑戦納め … 20 EMUER
   日付は日本時間（policy.dayKey と同じ）。1日1回・二重に受け取れない仕組みは今までと同じ（router.js の /daily/login）。
   12月以外は 1 EMUER のまま。 */
const SPECIAL = Object.freeze({
  '2026-12-05': { emuer: 5, name: '週末のクエストDay' },
  '2026-12-15': { emuer: 5, name: '知識シェアDay' },
  '2026-12-22': { emuer: 2, name: '冬至｜願いの泉の夜' },
  '2026-12-25': { emuer: 10, name: 'クリスマス' },
  '2026-12-31': { emuer: 20, name: '挑戦納め' }
});
const MONTH = '2026-12';
function inCalendar(day) { return typeof day === 'string' && day.slice(0, 7) === MONTH; }
/* その日のログインボーナスの額（EMUER の整数） */
function loginAmountFor(day) {
  if (!inCalendar(day)) return 1;
  return SPECIAL[day] ? SPECIAL[day].emuer : 2;
}
/* 画面に出す用：今日の額・今日の名前・次の特別な日 */
function info(day) {
  if (!inCalendar(day) && !(typeof day === 'string' && day >= '2026-11-29' && day < '2026-12-01')) return null;
  const next = Object.keys(SPECIAL).filter((d) => d > day && SPECIAL[d].emuer > 2).sort()[0] || null;
  return {
    name: '挑戦納めカレンダー',
    active: inCalendar(day),
    today: { date: day, emuer: inCalendar(day) ? loginAmountFor(day) : 1, special: SPECIAL[day] ? SPECIAL[day].name : '' },
    next: next ? { date: next, emuer: SPECIAL[next].emuer, special: SPECIAL[next].name } : null
  };
}
module.exports = { SPECIAL, MONTH, loginAmountFor, info };
