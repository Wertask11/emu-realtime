/* クエストの報告まわり（スマホ版 SchoolPark で #005 WEB3 をやって見つかったもの）。

   1. 同じ人の報告が「メンマ」と「天輝」に分かれていた。
      報告・受けた記録・知恵カードには、書いた瞬間のパスポートの名前が残る。
      パスポートの名前は本人が付けた名前（user_profiles）を先に読むが、
      読めなかったとき（SDK の常時接続が切れていたとき）も「名前が無い」として
      ログイン元の名前（LINEのプロフィール名）に落ちていた。
   2. 報告に投稿の URL を貼ると、スマホで本文が画面の外まで伸びて横に崩れた。
   3. その URL を押しても投稿に行けなかった（文字として出していた）。
   4. スマホのメンバー表は「完走」「引用され」を隠していた（パソコンと違う）。
   5. スマホの知恵ライブラリで、カードが下のカードに重なっていた。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const DAO = readHtml('frontend/public/schoolpark/dao.html');
const bodyOf = (head, end) => { const i = INDEX.indexOf(head); assert.ok(i > 0, head); return INDEX.slice(i, INDEX.indexOf(end || '\n}\n', i)); };

test('URL だけをリンクにする（http / https だけ。文末の句読点やかっこは含めない）', () => {
  const { _spTextParts } = build(INDEX, ['_spTextParts'], { URL });
  const links = (t) => _spTextParts(t).filter((p) => p.href).map((p) => p.href);
  const U = 'https://x.com/DAO_SchoolPark/status/2108194435142148342';
  assert.deepEqual(links(U), [U]);
  assert.deepEqual(links('投稿しました（' + U + '）。'), [U]);
  assert.deepEqual(links('見てね ' + U + '?s=20 よろしく'), [U + '?s=20']);
  assert.deepEqual(links('「' + U + '」、どうぞ'), [U]);
  assert.deepEqual(links('javascript:alert(1) data:text/html,x ftp://a.b'), [], 'http(s) 以外はリンクにしない');
  /* 文字はそのまま残る（欠片をつなげると元の本文になる） */
  const t = '発信の場合：' + U + '\n招待の場合：名前';
  assert.equal(_spTextParts(t).map((p) => p.text).join(''), t);
  const parts = _spTextParts(t);
  assert.deepEqual(parts.map((p) => [p.textShow, p.linkShow]), [['inline', 'none'], ['none', 'inline'], ['inline', 'none']]);
  assert.deepEqual(_spTextParts(''), []);
});

test('報告の本文は折り返し、URL は別のタブで開くリンクとして描く（HTML として流し込まない）', () => {
  const tpl = '<sc-for list="{{ l.bodyParts }}" as="t"><span style="display:{{ t.textShow }}">{{ t.text }}</span><a href="{{ t.href }}" target="_blank" rel="noopener noreferrer"';
  assert.ok(DAO.indexOf(tpl) > 0, '報告の本文がリンクになっていない');
  assert.ok(/white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; min-width:0"><sc-for list="\{\{ l\.bodyParts \}\}"/.test(DAO), '長い URL が折り返さない');
  assert.ok(DAO.indexOf('<sc-for list="{{ r.bodyParts }}" as="t">') > 0, '知恵カードの「つながる報告」の URL もリンクにする');
  assert.equal(/innerHTML/.test(bodyOf('function _spTextParts(text) {')), false);
});

test('書き手の名前は、出すときに本人が付けた名前（プロフィール）を使う。読めなければ残っている名前', () => {
  const known = { '0x8ab838ebb2000000000000000000000000000001': { displayName: 'メンマ' } };
  const { _spNameFor } = build(INDEX, ['_spNameFor'], {
    emuProfileKnown: (a) => known[String(a).toLowerCase()],
    _spShortAddr: (a) => String(a).slice(0, 6) + '…'
  });
  assert.equal(_spNameFor('0x8AB838EBB2000000000000000000000000000001', '天輝'), 'メンマ');
  assert.equal(_spNameFor('0x1111111111111111111111111111111111111111', '単3電池'), '単3電池');
  assert.equal(_spNameFor('0x2222222222222222222222222222222222222222', ''), '0x2222…');
  /* 報告・受けている人・メンバー・知恵カードの4か所で使う */
  assert.ok(INDEX.indexOf('const name = _spNameFor(l.author, l.authorName);') > 0);
  assert.ok(INDEX.indexOf('people.push(_spNameFor(c.id, c.name));') > 0);
  assert.ok(INDEX.indexOf("Object.keys(M).forEach(function (k) { M[k].name = _spNameFor(k, M[k].name); });") > 0);
  assert.ok(INDEX.indexOf('author: _spNameFor(w.author, w.authorName), uses: uses,') > 0);
});

test('パスポートの名前：プロフィールを読めなかったときに、ログイン元の名前で埋めない', () => {
  const b = bodyOf('async function spPassportLoad(force) {');
  assert.ok(b.indexOf('return emuProfileOf(key).then(function (v) { return { ok: true, v: v }; },') > 0, '読めなかったと「名前が無い」を分けていない');
  assert.ok(b.indexOf("name = String(localStorage.getItem('sp_profile_name:' + String(addr || '').toLowerCase()) || '').trim();") > 0, '前に読めた名前を使っていない');
  assert.ok(b.indexOf("if (name && name.indexOf('…') < 0 && !nameUnsure) {") > 0, 'ログイン元の名前を Emu 側にまで写してしまう');
  /* プロフィールの読み取りは、SDK が転んだら普通の通信（REST）で読み直す */
  const p = INDEX.slice(INDEX.indexOf('function emuProfileOf(addr, force) {'), INDEX.indexOf('function emuProfileKnown(addr)'));
  assert.ok(p.indexOf("if (!decided) d = await _spRestDoc('user_profiles/' + encodeURIComponent(key), false);") > 0);
  assert.ok(p.indexOf('snap.metadata && snap.metadata.fromCache') > 0, '手元の控えの「無い」を「無い」と読んでしまう');
});

test('スマホのメンバー表も、パソコンと同じ5列（完走・引用されを隠さない）', () => {
  const mobile = DAO.slice(DAO.indexOf('  mobile: {'), DAO.indexOf('};', DAO.indexOf('  mobile: {')));
  assert.ok(mobile.indexOf("colHide:'block'") > 0, 'スマホで列を隠している');
  assert.ok(mobile.indexOf("table:'minmax(0,1.5fr) repeat(4,minmax(0,1fr))'") > 0, 'スマホの表が5列になっていない');
  assert.ok(DAO.indexOf('display:{{ L.memAvatar }}') > 0);
});

test('知恵ライブラリのカードに height:100% を付けない（スマホで下のカードに重なる）', () => {
  const i = DAO.indexOf('<sc-for list="{{ wisdom }}" as="w"');
  const card = DAO.slice(i, DAO.indexOf('</sc-for>', i));
  assert.ok(card.length > 0);
  assert.equal(/<div style="height:100%/.test(card), false);
});
