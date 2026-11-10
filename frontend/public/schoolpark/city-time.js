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
