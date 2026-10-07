/* SchoolPark の公園の「遊び」（ECHO FIELD・林檎の方程式・日常の神々）。

   ECHO FIELD と林檎の方程式は、Emu のために作った覆い（#room3Overlay 1400・#ringoOverlay 1100）で
   開いている。SchoolPark（#spDaoPage 1500）を開いたまま押すと、その下に開いて見えず、
   押しても何も起きないように見えていた（パソコン・スマホとも）。
   日常の神々は小部屋（#spRoomPage）で開くが、小部屋には閉じるボタンが無く、中のページの
   「戻る」が閉じる合図を送る作り。日常の神々には戻る口が無く、SchoolPark に戻れなかった。
   見学の人が日常の神々を押すと、林檎の方程式の扱いになっていた（見学の回数も1回減っていた）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const GODS = readHtml('frontend/public/daily-gods/index.html');

const zOf = (re) => { const m = INDEX.match(re); assert.ok(m, String(re)); return Number(m[1]); };

test('SchoolPark を開いているあいだは、公園の遊び（ECHO FIELD・林檎）が SchoolPark より手前に出る', () => {
  const spDao = zOf(/#spDaoPage \{ display:none; position:fixed; inset:0; z-index:(\d+);/);
  const room3 = zOf(/body\.sp-dao-open #room3Overlay \{ z-index:(\d+); \}/);
  const ringo = zOf(/body\.sp-dao-open #ringoOverlay \{ z-index:(\d+) !important; \}/);
  assert.ok(room3 > spDao, 'ECHO FIELD が SchoolPark の下に開く');
  assert.ok(ringo > spDao, '林檎の方程式が SchoolPark の下に開く');
  /* Emu だけを見ているときは今まで通り（SchoolPark を開いていないときの値は変えない） */
  assert.ok(/\n#room3Overlay\{ z-index:1400; \}/.test(INDEX));
  assert.ok(INDEX.indexOf('<div id="ringoOverlay" style="display:none;position:fixed;inset:0;z-index:1100;') >= 0);
});

test('パスポートから開く星空（sp-star-open）は、今まで通りいちばん手前', () => {
  const dao = INDEX.indexOf('body.sp-dao-open #room3Overlay');
  const star = INDEX.indexOf('body.sp-star-open #room3Overlay { z-index:1900; }');
  assert.ok(dao > 0 && star > dao, '星空の規則があとに無いと、SchoolPark の値で上書きされてパスポートの下に潜る');
});

function stage(plan) {
  const calls = [];
  const stubs = {
    emuHasPlan: (min) => plan !== 'guest',
    emuNeedPlan: (min, what) => { calls.push('need:' + what); return false; },
    _emuTryGuestPlay: async () => { calls.push('ticket'); return { ok: true }; },
    openRingoGame: () => calls.push('ringo'),
    openEchoFieldDirect: () => calls.push('echo'),
    openDailyGods: () => calls.push('gods'),
    alert: () => calls.push('alert')
  };
  const { spOpenPlay } = build(INDEX, ['spOpenPlay'], stubs);
  return { spOpenPlay, calls };
}

test('light 以上は、押した遊びがそのまま開く', async () => {
  for (const [play, want] of [['echo', 'echo'], ['ringo', 'ringo'], ['gods', 'gods']]) {
    const s = stage('light');
    s.spOpenPlay(play);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(s.calls, [want], play);
  }
});

test('見学は林檎の方程式だけ（回数を数えてから開く）。日常の神々で林檎が開いたり回数が減ったりしない', async () => {
  const cases = [
    ['ringo', ['ticket', 'ringo']],
    ['echo', ['need:ECHO FIELD']],
    ['gods', ['need:日常の神々']],
    ['unknown', []]
  ];
  for (const [play, want] of cases) {
    const s = stage('guest');
    s.spOpenPlay(play);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(s.calls, want, play);
  }
});

test('日常の神々に、SchoolPark へ戻る口がある（小部屋を閉じる合図を送る）', () => {
  assert.ok(GODS.indexOf('<button type="button" id="gg-back">← SchoolParkに戻る</button>') >= 0, '戻る口が無い');
  assert.ok(GODS.indexOf("window.top.postMessage({ type: 'spContentClose' }, location.origin)") >= 0, '閉じる合図を送っていない');
  /* 受け取る側（index.html）は、同じオリジンの spContentClose で小部屋を閉じる */
  assert.ok(INDEX.indexOf("if (!ev.data || ev.data.type !== 'spContentClose') return;") >= 0);
  assert.ok(INDEX.indexOf('closeSpRoom();') >= 0);
});
