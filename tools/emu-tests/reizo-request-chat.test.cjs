/* 11/28 オーナー：「冷蔵庫くんに頼む画面は、聞く画面と同じにして。頼むにタブかえる→聞くと同じ画面で、頼める」。
   頼むは会話の窓のまま（reizo/request-chat.js）。窓口・料金の決まりは頼む画面（/economy/）と同じ。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PUB = path.join(__dirname, '../../frontend/public');
const CHAT = fs.readFileSync(path.join(PUB, 'reizo/request-chat.js'), 'utf8');
const MODE = fs.readFileSync(path.join(PUB, 'reizo/mode-switch.js'), 'utf8');
const APP = fs.readFileSync(path.join(PUB, 'economy/app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const fn = (src, start, end) => src.slice(src.indexOf(start), src.indexOf(end)).trim().replace(/\s+/g, ' ');

test('やることの選び方は、頼む画面（economy/app.js）と同じ', () => {
  assert.equal(fn(CHAT, 'function pickTask(', '/* ── 会話の窓'), fn(APP, 'function pickTask(', 'function availableTasks('));
});

test('左上で「頼む」を選ぶと、会話の窓のまま頼むになる。「聞く」に戻せる。送った文は頼むの係が受ける', () => {
  const req = MODE.slice(MODE.indexOf("if (mode === 'request') {"), MODE.indexOf("if (mode === 'guide') {"));
  assert.ok(req.indexOf('window.ReizoAsk.enter()') > 0 && req.indexOf('window.spReizoOpen()') > 0);
  assert.ok(req.indexOf('window.ReizoAsk.enter()') < req.indexOf('window.openReizoRequest'), 'まず会話の窓で頼む（古い頼む画面は ReizoAsk が無いときだけ）');
  assert.ok(MODE.includes("window.ReizoAsk && window.ReizoAsk.active() ? 'request' : 'ask'"), '切り替えの ✓ は、いまのモードに付く');
  const send = INDEX.slice(INDEX.indexOf('async function spReizoSend('), INDEX.indexOf('const skill = _matchReizoSkill(q);'));
  assert.ok(send.indexOf('window.ReizoAsk.handle(q)') > 0 && send.indexOf('window.ReizoAsk.handle(q)') < send.indexOf('window.ReizoSeed.handle(q)'));
  assert.ok(INDEX.indexOf('<script src="/reizo/request-chat.js" defer></script>') < INDEX.indexOf('<script src="/reizo/mode-switch.js" defer></script>'));
});

test('確かめてから払う。払うのは「承認して実行」を押したときだけ。窓口と同意は頼む画面と同じ', () => {
  const run = CHAT.slice(CHAT.indexOf('async function run('), CHAT.indexOf('async function approve('));
  assert.ok(run.includes("api('/quotes'") && !run.includes("api('/jobs'"), '頼んだ時点では確かめるだけ');
  assert.ok(run.includes('承認して実行（5 EMUER）') && run.includes('5 EMUERを払い') && run.includes('/privacy.html'));
  const approve = CHAT.slice(CHAT.indexOf('async function approve('), CHAT.indexOf('function showResult('));
  assert.ok(approve.includes("api('/jobs'") && approve.includes('paymentConsent: true') && approve.includes('aiConsent: true'));
  assert.ok(CHAT.includes("fetch('/api/economy' + path"));
  assert.ok(CHAT.includes('window.ReizoRequestTargets.allowed(target)'), '開くのは決まった行き先だけ');
  assert.ok(APP.includes('new URLSearchParams(location.search).get("artifact")'), 'できた下書き・計画は頼む画面で開く');
});
