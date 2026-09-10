/* socket.io が読めなかった回でも、SchoolPark が動くことを確かめる。

   index.html は実況（room3）のために socket.io を CDN から読み、
   その少し下で「const socket = io(...)」と、素で呼んでいた。
   CDN が1回でも読めないと io が無く、この行で ReferenceError になる。
   すると、その塊の以降の定義がまるごと消える。

   パスポートもギルドもクエストも、全部この行より下で定義している。
   だから SchoolPark が丸ごと動かなくなり、こう固まった。

     名前          ゲスト
     ギルド        カード0枚
     クエスト      まだクエストがありません
     信用スコア    読み込んでいます…

   落ちたことは画面に出ないので「たまに壊れる」ようにしか見えない。

   ここでは本番の index.html をそのまま出し、CDN だけを止めて確かめる。

   使い方:
     npm ci --prefix tools/guild-tests
     npx playwright install chromium
     node --test tools/guild-tests/socket-missing.test.cjs                     */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const PUB = path.join(__dirname, '..', '..', 'frontend', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };

/* この行より下で定義しているもの。1つでも欠けたら SchoolPark は動かない */
const NEEDED = ['spPassportLoad', 'spDaoWhoAmI', 'spDaoLoadVotes', 'spDaoLoadQuests',
                'spDaoLoadTasks', 'spDaoLoadWisdom', 'spDaoReloadAll', 'spCanGuild'];

let browser, server, port;

before(async () => {
  server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(PUB, u === '/' ? '/index.html' : u);
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      res.end(d);
    });
  });
  await new Promise(r => server.listen(0, r));
  port = server.address().port;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

/* 外へ出ていく通信は全部止める（CDN も含む）。
   socket.io が読めなかった回を、そのまま作り出す。 */
async function openWith(blockSocketIo) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**', route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:' + port)) return route.continue();
    if (!blockSocketIo && url.includes('socket.io')) return route.continue();
    return route.abort();
  });
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  return { page, errors };
}

test('socket.io が読めなくても、SchoolPark の中身は生きている', async () => {
  const { page, errors } = await openWith(true);
  const missing = await page.evaluate(names => names.filter(n => typeof window[n] !== 'function'), NEEDED);
  assert.deepEqual(missing, [], '消えている: ' + missing.join(', '));

  /* let で置いた入れ物も、初期化まで届いているか
     （途中で止まると「Cannot access ... before initialization」になる） */
  const passport = await page.evaluate(async () => {
    try { await window.spPassportLoad(); return 'ok'; } catch (e) { return String(e && e.message); }
  });
  assert.ok(!/before initialization/.test(passport),
    'スクリプトが途中で止まっている: ' + passport);

  assert.deepEqual(errors.filter(m => /io is not defined/.test(m)), [],
    'io が無いことで、まだ落ちている');
  await page.close();
});

test('ギルドの5つは、socket.io が無くても数えられる', async () => {
  const { page } = await openWith(true);
  const n = await page.evaluate(() => (window.SpGuildStore.merge([]) || []).length);
  assert.equal(n, 5);
  await page.close();
});

test('socket は、読めなくても呼べる形で置き換わる', async () => {
  const { page } = await openWith(true);
  const shape = await page.evaluate(() => {
    /* 実況の処理は socket.on / emit をそのまま呼ぶ。投げないことを確かめる */
    try {
      socket.on('x', function () {}); socket.once('x', function () {}); socket.emit('x', {});
      return { ok: true, connected: socket.connected };
    } catch (e) { return { ok: false, err: String(e && e.message) }; }
  });
  assert.equal(shape.ok, true, '置き換えた socket が投げる: ' + shape.err);
  assert.equal(shape.connected, false, 'つながっていないのに、つながった扱いになっている');
  await page.close();
});
