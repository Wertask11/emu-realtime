'use strict';
/*
 * Emu の投稿を1件だけ見せるページ（frontend/api/emu-post.js）。
 * X・LINE へシェアしたリンクの行き先。
 *
 * こわいのは3つ。
 *   ・利用者が書いた文章で、ページにスクリプトを埋め込めること
 *   ・公開していない投稿・消された投稿が、リンクを知っていれば読めること
 *   ・読めなかっただけなのに「見つかりません」と言うこと
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const mod = require(path.join(__dirname, '../../frontend/api/emu-post.js'));

const ADDR = '0x' + 'a'.repeat(40);
const PNG = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64');

function field(v) {
  if (typeof v === 'number') return { integerValue: String(v) };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (v && typeof v === 'object') {
    const fields = {};
    Object.keys(v).forEach((k) => { fields[k] = field(v[k]); });
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
function docOf(obj) {
  const fields = {};
  Object.keys(obj).forEach((k) => { fields[k] = k === 'createdAt' ? { timestampValue: obj[k] } : field(obj[k]); });
  return { fields };
}
function fakeFetch(store, opts) {
  const o = opts || {};
  return async (url) => {
    if (o.fail) return { ok: false, status: 500, json: async () => ({}) };
    const key = decodeURIComponent(url.split('/documents/')[1].split('?')[0]);
    if (!store[key]) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => docOf(store[key]) };
  };
}
async function call(query, store, opts) {
  const res = { statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
  await mod.handler({ query }, res, { fetch: fakeFetch(store, opts) });
  return res;
}

const POST = {
  title: '朝の15分で読書を続けた話', body: '1. 本を枕元に置く\n2. 1ページだけ読む', tags: 'はじめる,習慣',
  address: ADDR, displayName: '残っている名前', goodCount: 3, createdAt: '2026-10-20T01:00:00Z'
};

test('公開の投稿は、題名・本文・書き手の名前と SNS 用の meta を出す', async () => {
  const r = await call({ id: 'abc123' }, { 'posts/abc123': POST, ['user_profiles/' + ADDR]: { displayName: '俺たちの青春' } });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /^text\/html/);
  assert.match(r.body, /<meta property="og:title" content="朝の15分で読書を続けた話">/);
  assert.match(r.body, /<meta property="og:url" content="https:\/\/schoolpark-emu\.vercel\.app\/p\/abc123">/);
  assert.match(r.body, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(r.body, /俺たちの青春/, 'プロフィールの名前を優先する');
  assert.match(r.body, /#はじめる/);
  assert.match(r.body, /3人の役に立ちました/);
  assert.match(r.headers['content-security-policy'], /default-src 'none'/);
});

test('書いた文章にタグを入れても、ページの中で動かない', async () => {
  const evil = Object.assign({}, POST, { title: '<script>alert(1)</script>', body: '"><img src=x onerror=alert(1)>' });
  const r = await call({ id: 'evil' }, { 'posts/evil': evil });
  assert.equal(r.statusCode, 200);
  assert.ok(!r.body.includes('<script>alert(1)</script>'));
  assert.ok(!r.body.includes('<img src=x onerror'));
  assert.match(r.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('公開でない投稿・消された投稿・無い投稿は「見つかりません」', async () => {
  const store = {
    'posts/private': Object.assign({}, POST, { visibility: 'private' }),
    'posts/gone': Object.assign({}, POST, { knowledgeLab: { tombstone: true } })
  };
  for (const id of ['private', 'gone', 'nothing']) {
    const r = await call({ id }, store);
    assert.equal(r.statusCode, 404, id);
    assert.match(r.body, /見つかりませんでした/);
    assert.ok(!r.body.includes('朝の15分'), id + ' の中身を出してはいけない');
  }
});

test('おかしな ID は Firestore に聞かずに断る', async () => {
  let asked = 0;
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await mod.handler({ query: { id: '../users/x' } }, res, { fetch: async () => { asked++; return { ok: false, status: 404 }; } });
  assert.equal(res.statusCode, 404);
  assert.equal(asked, 0);
});

test('読めなかったときは「見つかりません」ではなく、読み込めなかったと言う', async () => {
  const r = await call({ id: 'abc123' }, {}, { fail: true });
  assert.equal(r.statusCode, 503);
  assert.match(r.body, /読み込めませんでした/);
});

test('画像は ?img=1 で画像として返し、og:image もそこを指す', async () => {
  const store = { 'posts/pic': Object.assign({}, POST, { imageUrl: PNG }) };
  const page = await call({ id: 'pic' }, store);
  assert.match(page.body, /og:image" content="https:\/\/schoolpark-emu\.vercel\.app\/p\/pic\?img=1"/);
  const img = await call({ id: 'pic', img: '1' }, store);
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/png');
  assert.equal(Buffer.from(img.body).toString(), 'fake-png');
});

test('画像の無い投稿は、いつもの画像をカードに使う', async () => {
  const r = await call({ id: 'abc123' }, { 'posts/abc123': POST });
  assert.match(r.body, /og:image" content="https:\/\/schoolpark-emu\.vercel\.app\/logo\.jpg"/);
});

test('/p/<ID> が投稿ページの関数につながっている', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../frontend/vercel.json'), 'utf8'));
  assert.ok(cfg.rewrites.some((r) => r.source === '/p/:id' && r.destination === '/api/emu-post?id=:id'));
});

test('知識を読むのカードにシェアボタンがあり、行き先は /p/<ID>', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../frontend/public/knowledge.html'), 'utf8');
  assert.match(html, /data-share data-id="\$\{esc\(p\.id\)\}"/);
  assert.match(html, /ORIGIN\+'\/p\/'\+encodeURIComponent\(id\)/);
  for (const to of ['x', 'line', 'facebook', 'copy', 'native']) assert.match(html, new RegExp('data-share-to="' + to + '"'));
});
