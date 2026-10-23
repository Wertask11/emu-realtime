/*
 * Emu の投稿を1件だけ見せるページ（/p/<投稿ID>）。
 *
 * 知識を読む（knowledge.html）の「シェア」から X・LINE などへ貼るリンクの行き先。
 * SNS のカード（タイトル・説明・画像）は、リンクを読みに来たクローラーが
 * HTML の meta を見て作る。クローラーは JavaScript を動かさないので、
 * ここでサーバー側で HTML を組み立てて返す。
 *
 * 読むのは Firestore の posts（allow read: if true）と user_profiles の名前だけ。
 * 公開の読み取りなので、鍵も管理者の権限も使わない。書き込みは一切しない。
 *
 * ?img=1 のときは、投稿の画像だけを返す。投稿の画像は data URL のまま
 * 文書に入っているので、そのままでは og:image に使えないため。
 */
'use strict';

const PROJECT = 'emusch-2a111';
const DOCS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/';
const SITE = 'https://schoolpark-emu.vercel.app';
const DEFAULT_IMAGE = SITE + '/logo.jpg';
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ADDR_RE = /^0x[0-9a-f]{40}$/;
const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/;
const FETCH_MS = 5000;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* Firestore REST の値を、ふつうの値に直す（使う型だけ）。 */
function plain(v) {
  if (!v || typeof v !== 'object') return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) {
    const out = {};
    const f = (v.mapValue && v.mapValue.fields) || {};
    Object.keys(f).forEach(function (k) { out[k] = plain(f[k]); });
    return out;
  }
  return undefined;
}

async function readDoc(path, fetchImpl) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(function () { ctl.abort(); }, FETCH_MS) : null;
  try {
    const r = await fetchImpl(DOCS + path, ctl ? { signal: ctl.signal } : undefined);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('FIRESTORE_' + r.status);
    const d = await r.json();
    const out = {};
    const f = (d && d.fields) || {};
    Object.keys(f).forEach(function (k) { out[k] = plain(f[k]); });
    return out;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* 一覧（知識を読む）に出ないものは、ここでも出さない。
   公開でないもの、Knowledge Lab で消された（tombstone）もの。 */
function shareable(post) {
  if (!post) return false;
  if (post.visibility != null && post.visibility !== 'public') return false;
  if (post.knowledgeLab && post.knowledgeLab.tombstone) return false;
  return !!(String(post.title || '').trim() || String(post.body || '').trim());
}

function oneLine(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function tagList(tags) {
  return String(tags || '').split(/[,、\s]+/).map(function (t) { return t.replace(/^#/, '').trim(); })
    .filter(Boolean).slice(0, 8);
}

function dateJa(iso) {
  const d = new Date(iso || '');
  if (isNaN(d.getTime())) return '';
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return j.getUTCFullYear() + '年' + (j.getUTCMonth() + 1) + '月' + j.getUTCDate() + '日';
}

function page(opts) {
  const o = opts || {};
  const head = '<!doctype html><html lang="ja"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex">'
    + '<title>' + esc(o.title) + '</title>'
    + (o.description ? '<meta name="description" content="' + esc(o.description) + '">' : '')
    + (o.url ? '<link rel="canonical" href="' + esc(o.url) + '">' : '')
    + '<meta property="og:site_name" content="Emu｜SchoolPark">'
    + '<meta property="og:locale" content="ja_JP">'
    + '<meta property="og:type" content="article">'
    + '<meta property="og:title" content="' + esc(o.ogTitle || o.title) + '">'
    + (o.description ? '<meta property="og:description" content="' + esc(o.description) + '">' : '')
    + (o.url ? '<meta property="og:url" content="' + esc(o.url) + '">' : '')
    + '<meta property="og:image" content="' + esc(o.image || DEFAULT_IMAGE) + '">'
    + '<meta name="twitter:card" content="summary_large_image">'
    + '<meta name="theme-color" content="#f08300">'
    + '<style>'
    + '*{box-sizing:border-box}body{margin:0;background:#faf7f2;color:#25211d;font-family:"Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif;line-height:1.85}'
    + 'header{display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:760px;margin:0 auto;padding:18px 16px}'
    + '.brand{font-weight:900;font-size:24px;color:#f08300;text-decoration:none}.brand small{font-size:11px;color:#8a4600;margin-left:8px;font-weight:700}'
    + 'main{max-width:760px;margin:0 auto;padding:0 16px 48px}'
    + 'article{background:#fff;border:1px solid #e8dfd5;border-radius:18px;padding:22px}'
    + '.meta{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px;color:#77716a}.meta b{color:#25211d}'
    + 'h1{font:700 clamp(22px,5vw,28px)/1.45 Georgia,"Yu Mincho",serif;margin:14px 0 12px;overflow-wrap:anywhere}'
    + '.body{white-space:pre-wrap;color:#4b4640;overflow-wrap:anywhere}'
    + '.img{display:block;max-width:100%;max-height:520px;border-radius:12px;margin-top:16px}'
    + '.tags{display:flex;flex-wrap:wrap;gap:7px;margin:18px 0 0}.tags span{background:#f5f2ed;border-radius:999px;padding:4px 10px;font-size:12px;color:#77716a}'
    + '.good{margin-top:16px;font-size:13px;color:#8a4600}'
    + '.cta{margin-top:22px;display:grid;gap:10px}'
    + '.btn{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:12px;font-weight:800;text-decoration:none;text-align:center;padding:12px 16px}'
    + '.btn-main{background:#f08300;color:#fff}.btn-sub{background:#fff;color:#8a4600;border:1px solid #f0c48f}'
    + '.about{margin-top:18px;font-size:13px;color:#77716a}'
    + 'footer{text-align:center;font-size:12px;color:#9a9484;padding:0 16px 32px}'
    + '</style></head><body>';
  return head
    + '<header><a class="brand" href="' + SITE + '/">Emu<small>経験から生まれた知識を、次の誰かへ</small></a></header>'
    + '<main>' + o.main + '</main>'
    + '<footer>運営：合同会社型DAO SchoolPark</footer></body></html>';
}

function postPage(id, post, authorName) {
  const url = SITE + '/p/' + encodeURIComponent(id);
  const title = String(post.title || '').trim() || '（題名なし）';
  const hasImage = IMAGE_RE.test(String(post.imageUrl || ''));
  const image = hasImage ? SITE + '/p/' + encodeURIComponent(id) + '?img=1' : DEFAULT_IMAGE;
  const good = Number(post.goodCount) || 0;
  const tags = tagList(post.tags);
  const main = '<article>'
    + '<div class="meta"><b>' + esc(authorName) + '</b><span>' + esc(dateJa(post.createdAt)) + '</span></div>'
    + '<h1>' + esc(title) + '</h1>'
    + '<div class="body">' + esc(post.body || '') + '</div>'
    + (hasImage ? '<img class="img" src="' + esc(image) + '" alt="">' : '')
    + (tags.length ? '<div class="tags">' + tags.map(function (t) { return '<span>#' + esc(t) + '</span>'; }).join('') + '</div>' : '')
    + (good ? '<p class="good">♡ ' + good + '人の役に立ちました</p>' : '')
    + '</article>'
    + '<div class="cta"><a class="btn btn-main" href="' + SITE + '/">Emuで、ほかの知識も読む</a></div>'
    + '<p class="about">Emu は、やってみた人の経験・失敗・工夫を、次の誰かが使える知識として残す場所です。読むのは無料です。</p>';
  return page({
    title: title + '｜Emu',
    ogTitle: title,
    description: oneLine(post.body, 110) || 'Emu に届いた経験の知識です。',
    url: url,
    image: image,
    main: main
  });
}

function missingPage() {
  return page({
    title: 'この知識は見つかりませんでした｜Emu',
    description: 'Emu の知識は、経験から生まれた知識を次の誰かへ届ける場所です。',
    main: '<article><h1>この知識は見つかりませんでした</h1>'
      + '<p class="body">書いた人が消したか、公開をやめた可能性があります。</p></article>'
      + '<div class="cta"><a class="btn btn-main" href="' + SITE + '/">Emuで、ほかの知識を読む</a></div>'
  });
}

function send(res, status, type, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cache || 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (String(type).indexOf('text/html') === 0) {
    /* 中身は利用者が書いた文章なので、スクリプトは一切動かさない */
    res.setHeader('Content-Security-Policy',
      "default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  }
  res.end(body);
}

async function handler(req, res, deps) {
  const fetchImpl = (deps && deps.fetch) || fetch;
  const q = (req && req.query) || {};
  const id = String(Array.isArray(q.id) ? q.id[0] : (q.id || ''));
  const wantImage = String(Array.isArray(q.img) ? q.img[0] : (q.img || '')) === '1';
  if (!ID_RE.test(id)) return send(res, 404, 'text/html; charset=utf-8', missingPage(), 'public, s-maxage=60');

  let post;
  try {
    post = await readDoc('posts/' + encodeURIComponent(id), fetchImpl);
  } catch (e) {
    /* 読めなかったのに「無い」とは言わない */
    return send(res, 503, 'text/html; charset=utf-8', page({
      title: 'いま読み込めませんでした｜Emu',
      main: '<article><h1>いま読み込めませんでした</h1><p class="body">少し待ってから、もう一度開いてください。</p></article>'
    }));
  }
  if (!shareable(post)) return send(res, 404, 'text/html; charset=utf-8', missingPage(), 'public, s-maxage=60');

  if (wantImage) {
    const m = IMAGE_RE.exec(String(post.imageUrl || ''));
    if (!m) return send(res, 404, 'text/plain; charset=utf-8', 'not found', 'public, s-maxage=60');
    return send(res, 200, 'image/' + m[1], Buffer.from(m[2], 'base64'), 'public, s-maxage=3600, stale-while-revalidate=86400');
  }

  /* 名前は本人が付けたもの（プロフィール）を先に。読めなければ投稿に残っている名前。 */
  let name = '';
  const addr = String(post.address || '').toLowerCase();
  if (ADDR_RE.test(addr)) {
    try {
      const prof = await readDoc('user_profiles/' + addr + '?mask.fieldPaths=displayName', fetchImpl);
      name = String((prof && prof.displayName) || '').trim().slice(0, 30);
    } catch (e) { /* 名前が読めなくても、知識は出す */ }
  }
  name = name || String(post.displayName || '').trim().slice(0, 30) || 'Emu の書き手';
  return send(res, 200, 'text/html; charset=utf-8', postPage(id, post, name), 'public, s-maxage=300, stale-while-revalidate=600');
}

module.exports = function (req, res) { return handler(req, res); };
module.exports.handler = handler;
module.exports.shareable = shareable;
