/* パソコンの「今日のEmu」を無くし、知識を読むから始める。
   スマホの右上（名前 / プロフィール画像）と投稿の書き手を、保存した名前と写真にそろえる。

   右上は、ログインのときにログイン元の名前（ches_accounts の displayName。
   作ったときのまま変わらない）を書いて、それきりだった。「名前と写真」で
   保存しても、リロードしても、前の名前のまま。写真はどこにも出ていなかった。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const KNOW = readHtml('frontend/public/knowledge.html');
const PAGES = readHtml('frontend/public/emu-i18n-pages.js');

test('左ナビは 01 知識を読む / 02 知識を探す / 03 一日シェア / 04 議論 で、最初に光るのは知識を読む', () => {
  const items = [...INDEX.matchAll(/class="esn-item( active)?"\s+id="(\w+)"\s+onclick="(\w+)\(\)"><i>(\d\d)<\/i>([^<]+)<\/button>/g)]
    .map(m => (m[1] ? '*' : '') + m[4] + m[5]);
  assert.deepEqual(items, ['*01知識を読む', '02知識を探す', '03一日シェア', '04議論']);
});

test('今日のEmu の入口（左ナビ・上のタブ・旧ナビ）が無い', () => {
  for (const id of ['esnToday', 'emuTodayTab', 'emuTodayNavBtn']) {
    assert.equal(INDEX.indexOf('id="' + id + '"'), -1, id + ' が残っている');
  }
  assert.ok(/class="eth-tab active" id="emuFeedTab"/.test(INDEX), '上のタブで最初に光るのが知識を読むになっていない');
});

test('Emuに入る・戻る処理（showEmuToday）は知識を読むを開き、今日のEmu の画面は開かない', () => {
  const i = INDEX.indexOf('function showEmuToday()');
  assert.ok(i > 0);
  const body = INDEX.slice(i, INDEX.indexOf('\n}\n', i));
  assert.ok(body.indexOf('showEmuFeed();') >= 0, '知識を読むを開いていない');
  assert.equal(body.indexOf("classList.add('emu-today-open')"), -1, 'まだ今日のEmu を開いている');
  assert.equal(body.indexOf('emuTodayTab'), -1);
  /* パソコンの左下の EMUER は、今日のEmu の残高の欄から写している。その欄は入ったときに埋める */
  assert.ok(body.indexOf('if (!_emuPhoneLayout()) updateEmuTodayHome();') >= 0, '左下の EMUER が埋まらなくなる');
  assert.equal(INDEX.indexOf("classList.add('emu-today-open')"), -1, 'どこかでまだ今日のEmu を開いている');
});

test('今日のEmu の中身はどの幅でも出さず、EMUER が使う残高の欄は残っている', () => {
  assert.ok(/\n#emuTodayDashboard \{ display:none !important; \}/.test(INDEX), 'パソコンで出てしまう');
  assert.ok(INDEX.indexOf('<strong id="emuTodayBalance">') >= 0, '残高の欄が無いと左下の EMUER と EMUER v2 が書く先を失う');
  assert.ok(INDEX.indexOf("set('esnBalance', from('emuTodayBalance') || '0');") >= 0);
});

test('知識を読むの見出し（KNOWLEDGE FROM EXPERIENCE / 知識を読む / 説明文）を要素ごと消し、検索のすぐ下に並び替えが来る', () => {
  assert.equal(KNOW.indexOf('<header class="heading">'), -1);
  assert.equal(KNOW.indexOf('KNOWLEDGE FROM EXPERIENCE</p>'), -1);
  assert.equal(KNOW.indexOf('.heading'), -1, '見出しの CSS が残っている');
  assert.ok(/<input id="search"[^>]*><\/div><div class="filters" id="topFilters"/.test(KNOW), '検索の次が並び替えになっていない');
});

test('一日シェアの「戻る」は、無くなった今日のEmu ではなく知識を読むと書く', () => {
  assert.ok(PAGES.indexOf('"i.backToEmuToday": "← 知識を読む"') >= 0);
  assert.equal(PAGES.indexOf('← 今日のEmu'), -1);
});

test('「設定」はスマホのメニューだけ（マイライブラリーの下）にあり、名前 / プロフィール画像 を選ぶ', () => {
  const lib = INDEX.indexOf("onclick=\"accountGo('library')\">マイライブラリー</button>");
  const set = INDEX.indexOf("class=\"emu-phone-only\" onclick=\"accountGo('settings')\">設定</button>");
  assert.ok(lib > 0 && set > lib && set - lib < 300, '設定がマイライブラリーの下に無い（またはスマホだけになっていない）');
  assert.ok(INDEX.indexOf("if (what === 'settings') { openSettingsSheet(); return; }") >= 0);
  assert.ok(INDEX.indexOf('<input type="radio" name="emuHeadMode" value="name">名前</label>') >= 0);
  assert.ok(INDEX.indexOf('<input type="radio" name="emuHeadMode" value="avatar">プロフィール画像</label>') >= 0);
  assert.ok(INDEX.indexOf("fetch('https://emu-realtime.onrender.com/api/user/settings'") >= 0, '本人に紐づけて残していない');
});

test('選んでいない人は名前のまま（既存の人の表示を勝手に画像にしない）', () => {
  const { emuHeaderIdentityMode } = build(INDEX, ['emuHeaderIdentityMode'], {
    emuProfileKnown: (a) => ({ '0xa': { headerIdentityMode: 'avatar' }, '0xb': { avatar: 'data:image/png;base64,AAAA' }, '0xc': null })[a],
    _emuAddress: () => globalThis.__addr
  });
  for (const [addr, want] of [['0xa', 'avatar'], ['0xb', 'name'], ['0xc', 'name'], ['0xd', 'name']]) {
    globalThis.__addr = addr;
    assert.equal(emuHeaderIdentityMode(), want, addr);
  }
});

test('写真として出すのは、サーバーが受け付ける形の画像だけ（右上・投稿とも）', () => {
  const { _emuSafeAvatar } = build(INDEX, ['_emuSafeAvatar'], {});
  const { okAvatar } = build(KNOW, ['okAvatar'], {});
  const good = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJ==';
  for (const f of [_emuSafeAvatar, (v) => (okAvatar(v) ? v : '')]) {
    assert.equal(f(good), good);
    for (const bad of ['', null, undefined, 42, 'https://example.com/a.png', 'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/html;base64,PGI+', 'data:image/png;base64,AA"><img src=x onerror=alert(1)>',
      'data:image/png;base64,' + 'A'.repeat(300001)]) {
      assert.equal(f(bad), '', String(bad).slice(0, 40));
    }
  }
});

test('投稿の書き手の名前と写真は、表示のときにプロフィールから引く（投稿のデータには書かない）', () => {
  assert.ok(INDEX.indexOf("window.fbLib.doc(window.db, 'user_profiles', key)") >= 0, 'プロフィールを引いていない');
  assert.ok(INDEX.indexOf('authors:knowledgeAuthorsKnown(authorAddrs)') >= 0, '投稿と一緒に書き手を渡していない');
  assert.ok(KNOW.indexOf("m.type==='emu-knowledge-authors'") >= 0, '知識を読むが書き手を受け取っていない');
  /* 投稿を作るところは今までどおり（写真は入れない） */
  const i = INDEX.indexOf('const postData = {');
  const postData = INDEX.slice(i, INDEX.indexOf('};', i));
  assert.equal(/avatar|photo/i.test(postData), false, '投稿のデータに写真を入れている');
});

test('保存できてから右上を変える（保存に失敗したら、入力しただけの名前は出さない）', () => {
  const ok = INDEX.indexOf("msg.textContent = '保存しました。'; msg.className = 'emu-me-msg ok';");
  const sync = INDEX.indexOf('try { emuProfileSaved(addr, name, meAvatar); } catch (err) {}');
  const fail = INDEX.indexOf("throw new Error(d.error === 'AVATAR_TOO_LARGE'");
  assert.ok(fail > 0 && ok > fail && sync > ok, '保存の結果を見る前に反映している');
});
