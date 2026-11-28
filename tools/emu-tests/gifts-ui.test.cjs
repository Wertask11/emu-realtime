'use strict';
/* EMUER の使い道（11/10）の画面。本物のファイルを Playwright で動かし、サーバーは偽物にする。
   - 知識を読む：カードに「💐 応援」（自分の投稿には出さない）→ 額を選ぶ → 応援の人数が出る。一覧の上に「みんなで決める」→ 1票入れる。
   - SchoolPark のクエスト：協賛の袋が出る → 協賛する → 完走した人は「ご褒美を受け取る」。
   - 体験チケット：交換履歴のボタンで QR が出る。チケットのページは未使用／使用済みを出し、暗証番号で使用済みにする。
   - 届いた応援：ログインしたあと「応援が届いたよ」を出し、見たことにする。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const PUBLIC = path.join(__dirname, '../../frontend/public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/* 親の EmuGifts の偽物。呼ばれた中身を残す。 */
const FAKE_GIFTS = `window.calls=[];window.EmuGifts={
  signedIn:()=>true, petals:()=>{window.petaled=(window.petaled||0)+1;},
  me:async ()=>({ok:true,balance:window.spendable??6,sentToday:0,dailyLimit:100}),
  on:fn=>{window.giftListener=fn;return ()=>{};},
  cheerCounts:async ids=>{window.calls.push(['counts',ids]);return {ok:true,counts:{p1:{people:2,total:8}}};},
  cheer:async (id,n)=>{window.calls.push(['cheer',id,n]);return {ok:true,people:3,total:8+n,balance:42};},
  polls:async ()=>({ok:true,polls:[{id:'poll1',question:'次のグッズは？',options:[{id:'o1',label:'マグ',votes:2},{id:'o2',label:'トート',votes:1}],cost:0,votes:3,open:true,closesAt:null,myVote:null}]}),
  vote:async (id,o)=>{window.calls.push(['vote',id,o]);return {ok:true,poll:{id:'poll1',question:'次のグッズは？',options:[{id:'o1',label:'マグ',votes:3},{id:'o2',label:'トート',votes:1}],cost:0,votes:4,open:true,closesAt:null,myVote:o}};},
  pot:async ()=>({ok:true,pot:30,total:40,sponsors:2,paidOut:10,bonusCount:1,bonus:10,peopleLeft:3}),
  mine:async ()=>({ok:true,completed:true,claimed:false,amount:0}),
  sponsor:async (q,n)=>{window.calls.push(['sponsor',q,n]);return {ok:true,pot:30+n,total:40+n,sponsors:3,paidOut:10,bonusCount:1,bonus:10,peopleLeft:4};},
  claimBonus:async q=>{window.calls.push(['claim',q]);return {ok:true,amount:10,pot:20,total:40,sponsors:2,paidOut:20,bonusCount:2,bonus:10,peopleLeft:2};}
};`;
const KPARENT = `<!doctype html><meta charset="utf-8"><script>${FAKE_GIFTS}</script><iframe id="k" src="/knowledge.html" style="width:1000px;height:1500px"></iframe>
<script>const k=document.getElementById('k');addEventListener('message',e=>{if(e.source===k.contentWindow&&e.data&&e.data.type==='emu-knowledge-ready')window.ready=true;});
window.toK=m=>k.contentWindow.postMessage(m,location.origin);</script>`;
const QUEST = `<!doctype html><meta charset="utf-8"><script>${FAKE_GIFTS}</script><iframe id="d" src="/quest-frame.html" style="width:900px;height:1200px"></iframe>`;
const QUEST_FRAME = `<!doctype html><meta charset="utf-8"><body><div class="sp-quest-side"><div id="dark">ACCEPT</div></div>
<script>window.app={state:{screen:'detail',expId:'q1'}};</script><script src="/schoolpark/quest-sponsor.js"></script></body>`;
const ORDERS = `<!doctype html><meta charset="utf-8"><body><ul><li>コーヒー1杯 · 引換コード <b>AB12CD</b> <button type="button" data-ticket-order="o1" data-ticket-code="AB12CD" data-ticket-name="コーヒー1杯">🎫 チケットを出す</button></li></ul>
<script src="/schoolpark/ticket-qr.js"></script></body>`;
const INBOX = `<!doctype html><meta charset="utf-8"><body><script>window.auth={currentUser:{uid:'U1'}};async function emuAuthHeaders(){return {'Content-Type':'application/json',Authorization:'Bearer T'};}</script><script src="/emu-gifts.js"></script></body>`;

/* 11/24 オーナー：Muse の書き手が「1票 1 EMUER」の投票に入れたが反映されない。
   確かめが window.confirm() で、道具が自動でキャンセルしていた。親（index.html）の本物の emuAsk で聞く。
   ほかの人の票も、開いたまま読み直す。 */
const INDEX_SRC = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const EMU_ASK = INDEX_SRC.slice(INDEX_SRC.indexOf('function emuAsk(message, opts) {'), INDEX_SRC.indexOf('window.emuAsk = emuAsk;')) + 'window.emuAsk = emuAsk;';
const COST_GIFTS = `window.calls=[];window.others=0;window.voteResult=null;
const poll=(mine,extra)=>({id:'poll9',question:'Cityに欲しい店舗は？？',options:[{id:'o1',label:'①飲食',votes:2+extra},{id:'o3',label:'③洋服',votes:1+(mine==='o3'?1:0)}],cost:1,votes:3+extra+(mine?1:0),open:true,closesAt:Date.now()+86400000,myVote:mine});
window.confirm=()=>{window.calls.push(['confirm']);return false;};
window.EmuGifts={signedIn:()=>true,petals:()=>{},on:()=>()=>{},
  me:async ()=>({ok:true,balance:3,sentToday:0,dailyLimit:100}),
  cheerCounts:async ()=>({ok:true,counts:{}}),
  polls:async signed=>{window.calls.push(['polls',!!signed]);const m=window.myVote||null;const p=poll(m,window.others);if(!signed)delete p.myVote;return {ok:true,polls:[p]};},
  vote:async (id,o)=>{window.calls.push(['vote',id,o]);if(window.voteResult)return window.voteResult;window.myVote=o;return {ok:true,poll:poll(o,window.others)};}
};`;
const KCOST = `<!doctype html><meta charset="utf-8"><body><script>${COST_GIFTS}</script><script>${EMU_ASK}</script><iframe id="k" src="/knowledge.html" style="width:1000px;height:1400px"></iframe>
<script>const k=document.getElementById('k');addEventListener('message',e=>{if(e.source===k.contentWindow&&e.data&&e.data.type==='emu-knowledge-ready')window.ready=true;});
window.toK=m=>k.contentWindow.postMessage(m,location.origin);</script></body>`;

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const pages = { '/kcost.html': KCOST, '/kparent.html': KPARENT, '/quest.html': QUEST, '/quest-frame.html': QUEST_FRAME, '/orders.html': ORDERS, '/inbox.html': INBOX };
    if (pages[url.pathname]) { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(pages[url.pathname]); }
    const file = path.join(PUBLIC, path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise((r) => server?.close(r)); });

test('知識を読む：応援のボタン（自分の投稿には出さない）・額を選んで贈る・人数が出る。みんなで決めるに1票入れる', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1500 } });
  try {
    await page.goto(base + '/kparent.html');
    await page.waitForFunction(() => window.ready === true);
    await page.evaluate(() => window.toK({ type: 'emu-knowledge-posts', posts: [
      { id: 'p1', title: '朝の音読', body: '5分だけ', address: '0xbbb', createdAt: Date.now(), goodCount: 0 },
      { id: 'p2', title: '自分の投稿', body: 'わたし', address: '0xaaa', createdAt: Date.now(), goodCount: 0 }
    ], account: '0xaaa', authors: {} }));
    const k = page.frameLocator('#k');
    await k.locator('[data-cheer="p1"]').waitFor();
    assert.equal(await k.locator('[data-cheer="p2"]').count(), 0, '自分の投稿には応援を出さない');
    await k.locator('[data-cheer-line="p1"]').waitFor();
    assert.equal(await k.locator('[data-cheer-line="p1"]').textContent(), '💐 応援 2人・8 EMUER');

    await k.locator('[data-cheer="p1"]').click();
    await k.locator('[data-cheer-have]').getByText('応援に使えるアプリ内EMUER：6 EMUER').waitFor();
    assert.equal(await k.locator('[data-cheer-amount="10"]').isDisabled(), true, '足りない額は押せない');
    assert.equal(await k.locator('[data-cheer-amount="5"]').isDisabled(), false);
    await k.locator('[data-cheer-amount="5"]').click();
    await k.locator('[data-cheer-line="p1"]').getByText('3人・13 EMUER').waitFor();
    assert.deepEqual((await page.evaluate(() => window.calls)).find((c) => c[0] === 'cheer'), ['cheer', 'p1', 5]);
    assert.ok(await page.evaluate(() => window.petaled >= 1), '花びらが舞う');
    /* 自分に応援が届いたと親が知らせたら、その投稿の数をすぐ取り直す */
    const before = (await page.evaluate(() => window.calls)).filter((c) => c[0] === 'counts').length;
    await page.evaluate(() => window.giftListener({ type: 'cheers', postIds: ['p1'] }));
    await page.waitForFunction((n) => window.calls.filter((c) => c[0] === 'counts').length > n, before);
    await k.locator('[data-cheer-line="p1"]').getByText('2人・8 EMUER').waitFor();

    await k.locator('#emuPolls').getByText('次のグッズは？').waitFor();
    await k.locator('[data-poll-vote="o1"]').click();
    await k.locator('#emuPolls').getByText('✓ マグ').waitFor();
    assert.deepEqual((await page.evaluate(() => window.calls)).find((c) => c[0] === 'vote'), ['vote', 'poll1', 'o1']);
  } finally { await page.close(); }
});

test('クエスト：協賛の袋を出す・協賛する・完走した人はご褒美を受け取る', async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => { window.spendable = 60; });
  page.on('dialog', (d) => d.accept());
  try {
    await page.goto(base + '/quest.html');
    const d = page.frameLocator('#d');
    await d.locator('[data-quest-sponsor]').getByText('あと 3人分').waitFor();
    assert.equal(await d.locator('.sp-quest-side > *').nth(1).getAttribute('data-quest-sponsor'), '', '黒い箱のすぐ下に置く');
    /* 11/28：協賛に使えるアプリ内EMUERを、押す前に出す */
    await d.locator('[data-sponsor-spend]').getByText('60 EMUER').waitFor();
    await d.locator('[data-sponsor-amount="10"]').click();
    await d.locator('[data-quest-sponsor]').getByText('協賛 3人').waitFor();
    assert.deepEqual((await page.evaluate(() => window.calls)).find((c) => c[0] === 'sponsor'), ['sponsor', 'q1', 10]);
    await d.locator('[data-sponsor-claim]').click();
    await d.locator('[data-quest-sponsor]').getByText('10 EMUER を受け取りました').waitFor();
    assert.equal(await d.locator('[data-sponsor-claim]').count(), 0);
  } finally { await page.close(); }
});

/* 11/28 オーナー：「パソコン版で協賛しようとしたけど失敗した」。実EMUER（ウォレットの分）しか無い人は、送る前に分かるように */
test('クエスト：協賛に使えるアプリ内EMUERが足りないときは、送らずに理由を出す（実EMUERは使えない）', async () => {
  const page = await browser.newPage();
  const said = [];
  page.on('dialog', (d) => { said.push(d.message()); d.accept(); });
  await page.addInitScript(() => { window.spendable = 0; });
  try {
    await page.goto(base + '/quest.html');
    const d = page.frameLocator('#d');
    await d.locator('[data-sponsor-spend]').getByText('0 EMUER').waitFor();
    assert.match(await d.locator('[data-sponsor-spend]').textContent(), /実EMUER（ウォレットにある分）は協賛に使えません/);
    await d.locator('[data-sponsor-amount="5"]').click();
    await page.waitForTimeout(200);
    assert.match(said.join('\n'), /足りません（いま 0 EMUER）/);
    assert.equal((await page.evaluate(() => window.calls)).filter((c) => c[0] === 'sponsor').length, 0, 'サーバーへは送らない');
  } finally { await page.close(); }
});

test('体験チケット：交換履歴のボタンで QR を出す。チケットのページは未使用を出し、暗証番号で使用済みにする', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(base + '/orders.html');
    await page.click('[data-ticket-order="o1"]');
    await page.locator('#cityTicketQr [data-qr] svg').waitFor();
    assert.match(await page.textContent('#cityTicketQr'), /AB12CD/);
    await page.click('[data-ticket-close]');
    assert.equal(await page.locator('#cityTicketQr').count(), 0);

    let used = false, sent = null;
    await page.route('https://emu-realtime.onrender.com/api/emu/tickets/**', async (route) => {
      const req = route.request();
      const ticket = { productName: 'コーヒー1杯', choice: '', shopName: 'まちのカフェ', status: used ? 'used' : 'unused', usedAt: used ? Date.now() : null, delivery: 'pickup', code: 'AB12CD' };
      if (req.method() === 'POST') {
        sent = JSON.parse(req.postData());
        if (sent.pin !== '4321') return route.fulfill({ status: 403, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"WRONG_PIN"}' });
        used = true; ticket.status = 'used';
      }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, ticket }) });
    });
    await page.goto(base + '/ticket.html?o=o1&c=ab12cd');
    await page.locator('#status').getByText('未使用').waitFor();
    assert.match(await page.textContent('#name'), /コーヒー1杯/);
    await page.fill('#pin', '0000');
    await page.click('#go');
    await page.locator('#msg').getByText('暗証番号がちがいます').waitFor();
    await page.fill('#pin', '4321');
    await page.click('#go');
    await page.locator('#status').getByText('使用済み').waitFor();
    assert.deepEqual(sent, { code: 'AB12CD', pin: '4321' });
    assert.equal(await page.isVisible('#use'), false, '使用済みなら入れる欄を出さない');
  } finally { await page.close(); }
});

test('届いた応援：「応援が届いたよ」と使える残高を出して、見たことにする。そのあとは quick で聞き、届いたらまた出す', async () => {
  const page = await browser.newPage();
  const seen = [], asked = [];
  let fresh = true;
  await page.route('https://emu-realtime.onrender.com/api/emu/gifts/**', async (route) => {
    const u = new URL(route.request().url());
    const h = { 'Access-Control-Allow-Origin': '*' };
    if (u.pathname.endsWith('/inbox')) { asked.push(u.search); if (!fresh) return route.fulfill({ status: 200, contentType: 'application/json', headers: h, body: '{"ok":true,"items":[],"quick":true}' });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: h, body: JSON.stringify({ ok: true, total: 8,
      items: [{ id: 'cheer-' + 'a'.repeat(40), kind: 'cheer', amount: 5, fromName: 'ありす', postTitle: '朝の音読' }, { id: 'cheer-' + 'b'.repeat(40), kind: 'cheer', amount: 3, fromName: 'ぼぶ', postTitle: '朝の音読' }] }) }); }
    if (u.pathname.endsWith('/inbox/seen')) { fresh = false; seen.push(JSON.parse(route.request().postData()).ids); return route.fulfill({ status: 200, contentType: 'application/json', headers: h, body: '{"ok":true,"balance":20}' }); }
    return route.fulfill({ status: 404, headers: h, body: '{}' });
  });
  try {
    await page.goto(base + '/inbox.html');
    await page.evaluate(() => window.EmuGifts.checkInbox());
    await page.getByText('応援が届いたよ！').waitFor();
    assert.match(await page.textContent('[role=dialog]'), /ありすさん、ぼぶさんから、あなたの知恵に合計 8 EMUER/);
    assert.match(await page.textContent('[role=dialog]'), /もう使えます。いまアプリ内EMUERは 20 EMUER。応援・協賛・投票に使えます/);
    await page.getByText('うれしい！').click();
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    await page.evaluate(() => window.EmuGifts.checkInbox());
    assert.equal(seen.length, 1, '見たことにして、同じログインでは2回出さない');
    assert.equal(seen[0].length, 2);
    assert.deepEqual(asked, ['', '?quick=1'], '2回目からは quick で聞く');
    fresh = true;   // 開いている間に、また応援が届いた
    await page.evaluate(() => window.EmuGifts.checkInbox());
    await page.getByText('応援が届いたよ！').waitFor();
  } finally { await page.close(); }
});

test('知識を読む：1票 1 EMUER の投票も、画面の中の「入れる」で入る（confirm() は使わない）。やめる・足りないとき・ほかの人の票', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  try {
    await page.clock.install();         // 45秒ごと・10秒の間引きを、時計を進めて確かめる
    await page.goto(base + '/kcost.html');
    await page.waitForFunction(() => window.ready === true);
    await page.evaluate(() => window.toK({ type: 'emu-knowledge-posts', posts: [], account: '0xaaa', authors: {} }));
    const k = page.frameLocator('#k');
    await k.locator('#emuPolls').getByText('Cityに欲しい店舗は？？').waitFor();
    assert.match(await k.locator('#emuPolls').textContent(), /1票 1 EMUER/);

    /* やめる：票は入らず、もう一度押せる */
    await k.locator('[data-poll-vote="o3"]').click();
    const askBox = page.locator('.emu-ask');
    await askBox.waitFor();
    assert.match(await askBox.textContent(), /「③洋服」に入れます。アプリ内EMUERを 1 使います/);
    await askBox.getByRole('button', { name: 'やめる', exact: true }).click();
    await askBox.waitFor({ state: 'detached' });
    assert.equal((await page.evaluate(() => window.calls)).filter((c) => c[0] === 'vote').length, 0);
    assert.equal(await k.locator('[data-poll-vote="o3"]').isDisabled(), false);

    /* 足りないとき：断られたことが分かり、押せる状態に戻る */
    await page.evaluate(() => { window.voteResult = { ok: false, code: 'INSUFFICIENT_EMUER', error: 'アプリ内EMUERが足りないみたい🧊（いま 0 EMUER）' }; });
    await k.locator('[data-poll-vote="o3"]').click();
    await askBox.getByRole('button', { name: '入れる', exact: true }).click();
    await k.getByText('アプリ内EMUERが足りないみたい🧊（いま 0 EMUER）').first().waitFor();
    assert.equal(await k.locator('[data-poll-vote="o3"]').isDisabled(), false);

    /* 入れる：票が入り、✓ が付く */
    await page.evaluate(() => { window.voteResult = null; });
    await k.locator('[data-poll-vote="o3"]').click();
    await askBox.getByRole('button', { name: '入れる', exact: true }).click();
    await k.locator('#emuPolls').getByText('✓ ③洋服').waitFor();
    const calls = await page.evaluate(() => window.calls);
    assert.deepEqual(calls.filter((c) => c[0] === 'vote').pop(), ['vote', 'poll9', 'o3']);
    assert.equal(calls.filter((c) => c[0] === 'confirm').length, 0, 'ブラウザの confirm() は使わない');

    /* ほかの人の票：開いている間は45秒ごとに読み直す（ログイン不要の一覧だけ）。自分の ✓ は残る */
    await page.evaluate(() => { window.others = 3; window.calls.length = 0; });
    await page.clock.fastForward(46000);
    await k.locator('#emuPolls').getByText('いま 7票').waitFor();
    await k.locator('#emuPolls').getByText('✓ ③洋服').waitFor();
    assert.deepEqual((await page.evaluate(() => window.calls)).filter((c) => c[0] === 'polls'), [['polls', false]], '読み直しはログイン不要の一覧');
    /* 画面に戻ったときも読み直す（10秒以内の重ねがけはしない） */
    await page.evaluate(() => { window.others = 4; });
    await page.clock.fastForward(11000);
    await page.evaluate(() => document.getElementById('k').contentWindow.dispatchEvent(new Event('focus')));
    await k.locator('#emuPolls').getByText('いま 8票').waitFor();
  } finally { await page.close(); }
});
