// Cityの時間帯。起動（ロゴ）画面と同じ決め方にそろえる。
// 朝 4:00–9:59 / 昼 10:00–15:59 / 夜 16:00–3:59。
// 起動画面が決めた時間帯（window.SP_SPLASH_MODE）があればそれを使う。
// 確かめたいときは URL に ?cityTime=morning|day|night（または ?splash=…）を付ける。
const ok = value => /^(morning|day|night)$/.test(value) ? value : '';

export function cityTime(win = window) {
  let mode = '';
  try {
    const query = new URLSearchParams(win.location.search);
    mode = ok(query.get('cityTime')) || ok(query.get('splash'));
  } catch {}
  for (const name of ['self', 'parent', 'top']) {
    if (mode) break;
    try { const w = win[name]; mode = ok(w.__SP_CITY_TIME) || ok(w.SP_SPLASH_MODE); } catch {}
  }
  if (!mode) {
    const h = new Date().getHours();
    mode = h >= 4 && h < 10 ? 'morning' : h >= 10 && h < 16 ? 'day' : 'night';
  }
  return mode;
}

export const CITY_TIME_LABEL = {
  morning: { plaza: '朝の広場へ ↗' },
  day: { plaza: '空の広場へ ↗' },
  night: { plaza: '夜祭りへ ↗' }
};

/* 12月の「挑戦納めカレンダー」（11/28）。日本時間の今日（YYYY-MM-DD）と、その日の City の季節の催し。
   確かめたいときは URL に ?cityDate=2026-12-25 を付ける（または window.__SP_CITY_DATE）。 */
const okDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
export function cityDay(win = window) {
  let day = '';
  try { day = okDay(new URLSearchParams(win.location.search).get('cityDate')); } catch {}
  for (const name of ['self', 'parent', 'top']) {
    if (day) break;
    try { day = okDay(win[name].__SP_CITY_DATE); } catch {}
  }
  return day || new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}
/* xmas … 12/24・25（雪とクリスマスツリー）／newyear … 12/31（年越しの願いと除夜の鐘）／toji … 12/22 冬至 */
export function citySeason(day) {
  return day === '2026-12-24' || day === '2026-12-25' ? 'xmas' : day === '2026-12-31' ? 'newyear' : day === '2026-12-22' ? 'toji' : '';
}
