'use strict';
/* 冷蔵庫くんと話して、知識の下書きにする（11/10）。入口2つを本物の画面で動かす。
   1. 投稿画面（knowledge.html）の「🗣️ 冷蔵庫くんと話して書く」
      話す → 親へ ask を頼む → 返事が出る → まとめる → 案が出る → 「この案を使う」で空の欄に入る。
   2. 冷蔵庫くんに聞く（index.html の会話の窓 + reizo/interview.js）
      「気づいたことを知識にしたい」→ 聞き役 → まとめる → 「投稿画面で仕上げる」で投稿画面へ渡す。
      ふつうの会話でも、体験らしい話なら一度だけ「知識のタネにする？」と声をかける。
   サーバーと AI は偽物。本番の API へは送らない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { grab } = require('../year-goals-tests/extract.cjs');

const PUBLIC = path.join(__dirname, '../../frontend/public');
const INDEX = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };

/* 投稿画面を iframe で開く親。親の役目（中継・下書きを渡す）は、ここで偽物として返す。 */
const PARENT = `<!doctype html><meta charset="utf-8"><iframe id="k" src="/knowledge.html" style="width:900px;height:1600px"></iframe><script>
window.got=[];window.replies=[];
const k=document.getElementById('k');
addEventListener('message',e=>{if(e.source!==k.contentWindow)return;const m=e.data||{};window.got.push(m);
  if(m.type==='emu-knowledge-ready')window.ready=true;
  if(m.type==='emu-knowledge-interview'){const r=window.replies.shift()||{ok:false,error:'x'};k.contentWindow.postMessage(Object.assign({},r,{type:'emu-knowledge-interview-result',requestId:m.requestId}),location.origin);}
});
window.toKnowledge=m=>k.contentWindow.postMessage(m,location.origin);
</script>`;

/* 冷蔵庫くんの会話の窓（index.html の本物の部品）だけを出したページ。 */
function chatPage() {
  const styles = [...INDEX.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map((x) => x[0]).join('\n');
  const panel = INDEX.match(/<div id="spReizoPanel"[\s\S]*?\n<\/div>/)[0];
  const fns = ['spReizoOpen', 'spReizoClose', 'spReizoAnswer', '_spReizoAppendMsg', '_spReizoShowTyping', 'spReizoSend', 'spReizoKeydown', 'spReizoAsk'].map((n) => grab(INDEX, n)).join('\n');
  return `<!doctype html><html lang="ja"><meta charset="utf-8">${styles}<body>${panel}
<script>let _reizoAgentsStarted=true;function _matchReizoSkill(){return null}function _openReizoContactForm(){}
window.auth={currentUser:{uid:'U1',getIdToken:async()=>'T'}};
async function emuAuthHeaders(){return {'Content-Type':'application/json',Authorization:'Bearer T'};}
window.ReizoKnowledge={answer:()=>null,confident:()=>null};
window.ReizoChat={ask:async()=>'そうなんだね！'};
window.opened=[];window.emuOpenKnowledgeDraft=d=>window.opened.push(d);
${fns}
</script><script src="/reizo/interview.js"></script><script>spReizoOpen();</script></body></html>`;
}

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/parent.html') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(PARENT); }
    if (url.pathname === '/chat.html') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(chatPage()); }
    const file = path.join(PUBLIC, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise((r) => server?.close(r)); });

test('投稿画面：冷蔵庫くんと話して、まとめた案を「この案を使う」で入れる', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1700 } });
  try {
    await page.goto(base + '/parent.html');
    await page.waitForFunction(() => window.ready === true);
    await page.evaluate(() => window.toKnowledge({ type: 'emu-knowledge-open-composer' }));
    const k = page.frameLocator('#k');
    await k.locator('[data-talk-open]').click();
    await assert.doesNotReject(k.locator('[data-talk-log]').getByText('いっしょに書こう').waitFor());

    await page.evaluate(() => window.replies.push({ ok: true, mode: 'ask', reply: 'いい気づきだね！それで、どうなったの？', ready: true }));
    await k.locator('[data-talk-input]').fill('朝に5分だけ音読したら、子どもが自分から本を読むようになった');
    await k.locator('[data-talk-send]').click();
    await k.locator('[data-talk-log]').getByText('どうなったの？').waitFor();
    assert.match(await k.locator('[data-talk-draft]').textContent(), /準備OK/);
    const ask = await page.evaluate(() => window.got.filter((m) => m.type === 'emu-knowledge-interview')[0]);
    assert.equal(ask.mode, 'ask');
    assert.deepEqual(ask.turns, [{ role: 'me', text: '朝に5分だけ音読したら、子どもが自分から本を読むようになった' }]);

    await page.evaluate(() => window.replies.push({ ok: true, mode: 'draft', title: '朝の5分音読', body: '【何をした？】\n朝に5分だけ音読した。', note: '会話をまとめた', tags: ['音読', '朝'], remaining: 2 }));
    await k.locator('[data-talk-draft]').click();
    await k.locator('[data-talk-preview]').waitFor({ state: 'visible' });
    const draftReq = await page.evaluate(() => window.got.filter((m) => m.type === 'emu-knowledge-interview')[1]);
    assert.equal(draftReq.mode, 'draft');
    assert.deepEqual(draftReq.turns.map((t) => t.role), ['me', 'reizo'], '冷蔵庫くんの返事も流れとして渡す');
    assert.match(await k.locator('[data-talk-preview-msg]').textContent(), /今日あと2回/);
    assert.equal(await k.locator('#body').inputValue(), '', '押すまでは入れない');

    await k.locator('[data-talk-use]').click();
    assert.equal(await k.locator('#body').inputValue(), '【何をした？】\n朝に5分だけ音読した。');
    assert.equal(await k.locator('#title').inputValue(), '朝の5分音読');
    assert.equal(await k.locator('#tags').inputValue(), '音読, 朝');
  } finally { await page.close(); }
});

test('投稿画面：本人が書いたタイトルは残す。冷蔵庫くんに聞くからの下書きは投稿画面を開いて入れる', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(base + '/parent.html');
    await page.waitForFunction(() => window.ready === true);
    await page.evaluate(() => window.toKnowledge({ type: 'emu-knowledge-prefill-draft', draft: { title: '雨の日の工夫', body: '【何があった？】\n雨で外遊びができなかった。', tags: ['雨', '遊び'] } }));
    const k = page.frameLocator('#k');
    await k.locator('#composer.open').waitFor();
    assert.equal(await k.locator('#body').inputValue(), '【何があった？】\n雨で外遊びができなかった。');
    assert.equal(await k.locator('#title').inputValue(), '雨の日の工夫');
    assert.equal(await k.locator('#tags').inputValue(), '雨, 遊び');

    /* 本文が書いてあるときは、勝手に置きかえず、案として見せる */
    await page.evaluate(() => window.toKnowledge({ type: 'emu-knowledge-prefill-draft', draft: { title: '別の題', body: '別の本文' } }));
    await k.locator('[data-talk-preview]').waitFor({ state: 'visible' });
    assert.equal(await k.locator('#body').inputValue(), '【何があった？】\n雨で外遊びができなかった。');
    assert.equal(await k.locator('#title').inputValue(), '雨の日の工夫');
  } finally { await page.close(); }
});

test('冷蔵庫くんに聞く：聞き役になって話を聞き、まとめた案を投稿画面へ渡す', async () => {
  const page = await browser.newPage();
  const calls = [];
  await page.route('https://emu-realtime.onrender.com/api/emu/interview', async (route) => {
    const body = JSON.parse(route.request().postData());
    calls.push(body);
    const reply = body.mode === 'ask'
      ? { ok: true, mode: 'ask', reply: 'それ、いい気づきだね！どうなったの？', ready: true, remaining: 19 }
      : { ok: true, mode: 'draft', title: '朝の5分音読', body: '【何をした？】\n朝に5分だけ音読した。', note: 'まとめた', tags: ['音読'], lab: null, remaining: 2 };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(reply) });
  });
  await page.route('**/api/knowledge-lab/taxonomy', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  try {
    await page.goto(base + '/chat.html');
    await page.getByText('📝 気づいたことを知識にしたい').click();
    await page.locator('#spReizoMessages').getByText('話しかけるみたいに送ってね').waitFor();
    assert.equal(await page.locator('#spReizoSeedBar').isVisible(), true);

    await page.fill('#spReizoInput', '朝に5分だけ音読したら、子どもが自分から本を読むようになった');
    await page.click('.sp-reizo-send');
    await page.locator('#spReizoMessages').getByText('どうなったの？').waitFor();
    assert.equal(calls[0].mode, 'ask');
    assert.deepEqual(calls[0].turns, [{ role: 'me', text: '朝に5分だけ音読したら、子どもが自分から本を読むようになった' }]);

    await page.getByText('📝 投稿用にまとめて！').click();
    await page.locator('#spReizoMessages').getByText('こうまとめてみたよ').waitFor();
    assert.equal(calls[1].mode, 'draft');
    assert.deepEqual(calls[1].turns.map((t) => t.role), ['me', 'reizo']);
    await page.getByText('✍️ 投稿画面で仕上げる').click();
    const opened = await page.evaluate(() => window.opened);
    assert.deepEqual(opened, [{ title: '朝の5分音読', body: '【何をした？】\n朝に5分だけ音読した。', tags: ['音読'], lab: null, from: 'reizo-chat' }]);
    assert.equal(await page.locator('#spReizoPanel').evaluate((el) => el.classList.contains('open')), false, '窓を閉じて投稿画面へ');
  } finally { await page.close(); }
});

test('冷蔵庫くんに聞く：体験らしい話なら一度だけ声をかける。質問だけなら声をかけない', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(base + '/chat.html');
    await page.fill('#spReizoInput', 'EMUERってなに？');
    await page.click('.sp-reizo-send');
    await page.locator('#spReizoMessages').getByText('そうなんだね！').waitFor();
    assert.equal(await page.getByText('いい知恵かも').count(), 0);

    await page.fill('#spReizoInput', '宿題を先に15分だけやってみたら、夜にあわてなくなったことに気づいた');
    await page.click('.sp-reizo-send');
    await page.getByText('いい知恵かも').waitFor();
    await page.fill('#spReizoInput', 'ほかにも、朝に準備してみたらうまくいったよ。気づいたことが多い');
    await page.click('.sp-reizo-send');
    await page.locator('#spReizoMessages .sp-reizo-msg-user').nth(2).waitFor();
    await page.waitForTimeout(200);
    assert.equal(await page.getByText('いい知恵かも').count(), 1, '声をかけるのは一度だけ');
  } finally { await page.close(); }
});

test('4つの見出しのうち空いているものを知らせる。「投稿にまとめるの手伝って」で聞き役になり、「ふつうの会話にもどる」で消える', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1700 } });
  try {
    await page.goto(base + '/parent.html');
    await page.waitForFunction(() => window.ready === true);
    await page.evaluate(() => window.toKnowledge({ type: 'emu-knowledge-open-composer' }));
    const k = page.frameLocator('#k');
    await k.locator('[data-talk-open]').click();
    await page.evaluate(() => window.replies.push({ ok: true, mode: 'ask', reply: 'どうなった？', ready: false }));
    await k.locator('[data-talk-input]').fill('ひざ掛けを使った');
    await k.locator('[data-talk-send]').click();
    await k.locator('[data-talk-log]').getByText('どうなった？').waitFor();
    await page.evaluate(() => window.replies.push({ ok: true, mode: 'draft', title: '寒さ対策', body: '【何があった？】\n寒かった。\n\n【何をした？】\nひざ掛け。\n\n【どうなった？】\n暖かい。\n\n【次の人へひとこと】\n', missing: ['【次の人へひとこと】'], tags: [] }));
    await k.locator('[data-talk-draft]').click();
    await k.locator('[data-talk-preview]').waitFor({ state: 'visible' });
    assert.match(await k.locator('[data-talk-preview-msg]').textContent(), /【次の人へひとこと】は、まだ話に出てこなかったので空けてある/);
  } finally { await page.close(); }

  const chat = await browser.newPage();
  const calls = [];
  await chat.route('https://emu-realtime.onrender.com/api/emu/interview', async (route) => {
    calls.push(JSON.parse(route.request().postData()));
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, mode: 'ask', reply: 'それはどんなとき？', ready: false }) });
  });
  try {
    await chat.goto(base + '/chat.html');
    await chat.fill('#spReizoInput', '投稿にまとめるの手伝って');
    await chat.click('.sp-reizo-send');
    await chat.locator('#spReizoMessages').getByText('いっしょにまとめよう').waitFor();
    assert.equal(await chat.locator('#spReizoSeedBar').isVisible(), true, '聞き役になる');
    assert.equal(calls.length, 0, '頼まれただけでは AI に送らない');
    await chat.fill('#spReizoInput', 'ひざ掛けを使ったら暖かかった');
    await chat.click('.sp-reizo-send');
    await chat.locator('#spReizoMessages').getByText('それはどんなとき？').waitFor();
    assert.equal(calls[0].mode, 'ask', '聞き役の質問になる（ふつうの会話には回さない）');
    await chat.getByText('ふつうの会話にもどる').click();
    assert.equal(await chat.locator('#spReizoSeedBar').isVisible(), false, 'ボタンが消える');
  } finally { await chat.close(); }
});
