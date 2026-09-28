/* 回数の数え方。ここを間違えると、上限に余裕があっても投稿できない。

   決まり（firestore.rules）は roomLeft で
     書いたあとの数 == 書く前の数 + 1
   を確かめている。「上限以内か」だけでなく「ちょうど1つ増えたか」も見る。
   記録を増やさずに投稿されるのを防ぐためで、これ自体は正しい。

   問題は画面側だった。いまの数を getDoc で読んでいたが、専用の通信路
   （WebChannel）が切れると getDoc は unavailable を投げる。
   前はそれを catch して黙って0から数えていたので、すでに2件使っている
   人が post:1 を書きにいき、決まりが期待する3と合わずに毎回
   permission-denied。しかも画面に出るのは上限の案内なので、
   上限を2から5に上げても直らなかった。実際に本番で踏んだ：

     いまの回数: 読めない(unavailable)
     付与: 読めない(unavailable)
     契約: 読めない(unavailable)
     アカウント: 読めない(unavailable)
   それでも出た文言は「light で投稿できるのは 月5件 です」。

   いまは SchoolPark 側と同じ形にしてある。
     専用の通信路（時間で見切る） → だめなら普通の通信（REST）
     どちらでも読めないときは0とみなさず、止めて理由を伝える。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');

/* 書き込みの代わり。何を書きにいったかを控えるだけ。 */
function fakeBatch() {
  const wrote = [];
  return { wrote, set: function (ref, data) { wrote.push(data); } };
}

/* _emuAddUsage だけを取り出して、周りは全部差し替える。
   sdk … getDoc がどう振る舞うか（'ok' | 'throw' | 'hang'）
   rest … 普通の通信がどう返すか（オブジェクト | null=まだ無い | 'throw'） */
function makeUsage(opts) {
  const o = opts || {};
  const calls = { sdk: 0, rest: 0 };
  const stubs = {
    _emuUsageRef: function () { return { path: 'plan_usage/u_r_m2026-9' }; },
    _emuUsageDocId: function () { return 'u_r_m2026-9'; },
    /* 本物と同じ契約にする（index.html の _spSoon）。
         返ってきた … { ok:true, value }
         見切った   … { ok:false }
         例外       … そのまま投げる
       待つ時間だけ短くしてある（本物は 6000ms）。
       長さそのものは下の「見切る時間を渡しているか」で別に見る。 */
    _spSoon: function (promise) {
      let timer = null;
      return Promise.race([
        Promise.resolve(promise).then(function (v) { return { ok: true, value: v }; }),
        new Promise(function (r) { timer = setTimeout(function () { r({ ok: false }); }, 50); })
      ]).finally(function () { if (timer) clearTimeout(timer); });
    },
    _spRestDoc: async function () {
      calls.rest++;
      if (o.rest === 'throw') throw new Error('HTTP 503');
      return o.rest === undefined ? null : o.rest;
    },
    console: { warn: function () {}, error: function () {} },
    window: {
      fbLib: {
        getDoc: function () {
          calls.sdk++;
          if (o.sdk === 'throw') {
            const e = new Error('Failed to get document because the client is offline.');
            e.code = 'unavailable';
            return Promise.reject(e);
          }
          if (o.sdk === 'hang') return new Promise(function () {});   /* 一生返らない */
          const n = o.sdkValue;
          return Promise.resolve({
            exists: function () { return n !== undefined; },
            data: function () { return { post: n }; }
          });
        }
      }
    },
    Date: Date, Number: Number, Error: Error, encodeURIComponent: encodeURIComponent
  };
  const api = build(INDEX, ['_emuAddUsage'], stubs);
  return { add: api._emuAddUsage, calls: calls };
}

test('専用の通信路で読めたときは、その数 + 1 を書く', async () => {
  const u = makeUsage({ sdk: 'ok', sdkValue: 2 });
  const b = fakeBatch();
  await u.add(b, 'post');
  assert.equal(b.wrote.length, 1);
  assert.equal(b.wrote[0].post, 3, '2件使っていたなら3を書く');
  assert.equal(u.calls.rest, 0, '読めたのに普通の通信まで使っている');
});

test('専用の通信路が unavailable でも、普通の通信で読んで正しい数を書く', async () => {
  /* ここが今回の本題。前は0とみなして1を書き、決まりの3と合わずに
     permission-denied になっていた。 */
  const u = makeUsage({ sdk: 'throw', rest: { post: 2 } });
  const b = fakeBatch();
  await u.add(b, 'post');
  assert.equal(b.wrote[0].post, 3,
    '読めないときに0から数えている（上限に余裕があっても弾かれる）');
  assert.equal(u.calls.rest, 1, '普通の通信へ逃げていない');
});

test('専用の通信路が返ってこないときも、見切って普通の通信で読む', async () => {
  const u = makeUsage({ sdk: 'hang', rest: { post: 4 } });
  const b = fakeBatch();
  await u.add(b, 'post');
  assert.equal(b.wrote[0].post, 5);
});

test('その月まだ1件も使っていないときは1を書く', async () => {
  /* _spRestGet は 404 だけ null を返す。「無い」と「読めない」は別物。 */
  const u = makeUsage({ sdk: 'throw', rest: null });
  const b = fakeBatch();
  await u.add(b, 'post');
  assert.equal(b.wrote[0].post, 1, '1件目が書けない');
});

test('どちらでも読めないときは、0とみなさず止める', async () => {
  const u = makeUsage({ sdk: 'throw', rest: 'throw' });
  const b = fakeBatch();
  await assert.rejects(() => u.add(b, 'post'), function (e) {
    assert.ok(e.emuUserMessage, 'そのまま見せてよい文言の印が無い');
    assert.match(e.message, /確認できませんでした/);
    return true;
  });
  assert.equal(b.wrote.length, 0, '読めていないのに書きにいっている');
});

test('数えるのは投稿だけではない（募集・回答も同じ道を通る）', async () => {
  const u = makeUsage({ sdk: 'ok', sdkValue: undefined });
  const b = fakeBatch();
  await u.add(b, 'answer');
  assert.equal(b.wrote[0].answer, 1);
});

test('見切る時間を渡している（渡さないと、返らない相手を待ち続ける）', () => {
  const src = INDEX.slice(INDEX.indexOf('async function _emuAddUsage'));
  const head = src.slice(0, src.indexOf('batch.set('));
  assert.match(head, /_spSoon\(window\.fbLib\.getDoc\(ref\), \d{3,}\)/,
    '_spSoon に待つ時間を渡していない');
});

test('読めなかったことを、黙って0にしていない', () => {
  const src = INDEX.slice(INDEX.indexOf('async function _emuAddUsage'));
  const head = src.slice(0, src.indexOf('batch.set('));
  assert.equal(/catch\s*\([^)]*\)\s*\{[^}]*now\s*=\s*0/.test(head), false,
    '読めないときに0から数えている（この形に戻すと permission-denied に戻る）');
});

/* クエストから投稿フォームを開いたとき、SchoolPark の下に隠れないこと。

   SchoolPark の画面（#spDaoPage）は z-index 1500、投稿フォーム（.modal）は 999。
   クエストの画面から openPostForm() を呼ぶと、フォームは開くのに SchoolPark の
   下に入るので、押しても何も起きないように見える。実際にそうなった。

   ボタンそのものは #003 PLAY を出すまで dao.html から外してあるが、
   戻したときに同じことにならないよう、重なり順はここで見張る。 */
test('クエストから開いた投稿フォームが、SchoolPark より上に出る', () => {
  const spZ = /#spDaoPage\s*\{[^}]*z-index:\s*(\d+)/.exec(INDEX);
  assert.ok(spZ, '#spDaoPage の z-index が読めない');

  const src = INDEX.slice(INDEX.indexOf('function _emuSetPostQuest'));
  const body = src.slice(0, src.indexOf('\n}'));
  const mine = /postFormModal\.style\.zIndex\s*=\s*_emuPostQuest\s*\?\s*'(\d+)'/.exec(body);
  assert.ok(mine, 'クエストから開いたときの重なり順を上げていない');
  assert.ok(Number(mine[1]) > Number(spZ[1]),
    'フォーム(' + mine[1] + ') が SchoolPark(' + spZ[1] + ') より下にある。'
    + '押しても何も起きないように見える');
});

test('#003 を出すまで、Emuに投稿するボタンは出さない', () => {
  const dao = readHtml('frontend/public/schoolpark/dao.html');
  /* コメントの中に手本として残してあるので、実際に描かれる行だけを見る。 */
  const live = dao.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(live.indexOf('cur.postEmu'), -1,
    'Emuに投稿するボタンが出ている。要るのは #003 PLAY だけ');
});
