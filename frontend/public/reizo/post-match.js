/* 11/28 オーナー：冷蔵庫くんに「私に合う知識や投稿を探して」と頼んだのに、ナレッジラボ・ギルドなどの公開資料しか出ず、イマイチ。
   →「知識を読む」の投稿からも、あなたに合いそうなものを出す（頼むの結果の下に、別の欄で）。

   決めごと（安全のため）
   - 投稿はAI（Google Gemini）へ送らない。運営が確かめた公開資料だけをAIに渡す今までの決まりは変えない。
   - この端末で、公開されている投稿を読み、言葉とテーマ（タグ）の重なりで並べるだけ。どこにも送らない・残さない。
   - 「あなたの興味」は、自分が書いた投稿のタグと、自分が「役に立った」を押した投稿のタグ（どちらも公開の情報）。
   - 自分の投稿は出さない。料金はかからない（頼むの5 EMUERとは別）。 */
(function (window) {
  'use strict';
  var STOP = ['Emu for SchoolPark', 'SchoolPark', 'Emu', 'エム', '冷蔵庫くん', '探してきて', '探して', 'さがして', '持ってきて', '見つけて', '教えて', 'ください',
    '私に合う', 'わたしに合う', '自分に合う', '僕に合う', '俺に合う', 'おすすめ', 'オススメ', 'の中で', '内で', 'について', 'に関する', 'みたいな', 'ような',
    '知識', '投稿', '記事', 'もの', 'こと', 'やつ', 'その', 'これ', 'あれ', 'して', 'ほしい', '欲しい'];
  function norm(v) { return String(v || '').normalize('NFKC').toLowerCase(); }
  /* 頼んだ文から、探す手がかりの言葉を取り出す（決まり文句は外す） */
  function cues(goal) {
    var s = norm(goal);
    STOP.forEach(function (w) { s = s.split(norm(w)).join(' '); });
    s = s.replace(/[、。,.!?！？「」『』（）()\[\]【】・:：;；"'\/\\\s]+/g, ' ');
    var out = [];
    s.split(' ').forEach(function (w) {
      w = w.replace(/^[をにのはがとでやもへ]+|[をにのはがとでやもへ]+$/g, '');
      if (!w) return;
      if (/^[a-z0-9]+$/.test(w)) { if (w.length >= 2) out.push(w); return; }
      if (w.length <= 3) { if (w.length >= 2) out.push(w); return; }
      for (var i = 0; i + 2 <= w.length; i++) out.push(w.slice(i, i + 2));   // 日本語は2文字ずつ
    });
    return out.filter(function (w, i, l) { return l.indexOf(w) === i; }).slice(0, 40);
  }
  function tagsOf(p) { return String(p.tags || '').split(/[\s,、#＃]+/).map(norm).filter(Boolean); }
  /* 投稿を並べる。posts … 公開の投稿、goal … 頼んだ文、me … 自分のアドレス（小文字）の一覧、myTags … 自分が書いた投稿のタグ */
  function rank(posts, goal, me, myTags, max) {
    var c = cues(goal), mine = me || [], liked = {}, wrote = {};
    (myTags || []).forEach(function (t) { wrote[t] = (wrote[t] || 0) + 1; });
    (posts || []).forEach(function (p) {
      var users = (p.goodUsers || []).map(norm);
      if (mine.some(function (a) { return users.indexOf(a) >= 0; })) tagsOf(p).forEach(function (t) { liked[t] = (liked[t] || 0) + 1; });
    });
    var scored = [];
    (posts || []).forEach(function (p) {
      if (!p || !p.id || !p.title) return;
      if (mine.indexOf(norm(p.address)) >= 0) return;                       // 自分の投稿は出さない
      var users = (p.goodUsers || []).map(norm);
      if (mine.some(function (a) { return users.indexOf(a) >= 0; })) return; // もう役に立ったを押した投稿は出さない
      var text = norm(p.title) + ' ' + norm(p.tags) + ' ' + norm(String(p.body || '').slice(0, 400));
      var tags = tagsOf(p), score = 0, why = '';
      var hits = c.filter(function (w) { return text.indexOf(w) >= 0; });
      if (c.length) score += hits.length / c.length * 6 + (hits.some(function (w) { return norm(p.title).indexOf(w) >= 0; }) ? 1.5 : 0);
      var likeTag = tags.filter(function (t) { return liked[t]; })[0], writeTag = tags.filter(function (t) { return wrote[t]; })[0];
      if (likeTag) score += 2 + Math.min(2, liked[likeTag] * .5);
      if (writeTag) score += 1.5 + Math.min(1.5, wrote[writeTag] * .3);
      score += Math.min(1, (Number(p.goodCount) || 0) / 10);
      if (score < (c.length ? 1.6 : 1.5)) return;
      if (hits.length >= 2 || (hits.length && !likeTag && !writeTag)) why = '頼んだ言葉（' + hits.slice(0, 3).join('・') + '）が入っています';
      else if (likeTag) why = 'あなたが「役に立った」を押した #' + likeTag + ' の知識';
      else if (writeTag) why = 'あなたがよく書く #' + writeTag + ' と同じテーマ';
      else why = '頼んだ言葉が入っています';
      scored.push({ post: p, score: score, why: why });
    });
    scored.sort(function (a, b) { return b.score - a.score || (Number(b.post.goodCount) || 0) - (Number(a.post.goodCount) || 0); });
    return scored.slice(0, max || 3);
  }
  /* 公開の投稿（新しい順に200件）を読む。画像は重いので読まない */
  async function readPosts() {
    if (typeof window._spRestGet !== 'function') return null;
    var fields = ['title', 'body', 'tags', 'address', 'displayName', 'goodCount', 'goodUsers', 'createdAt'];
    var j = await window._spRestGet(':runQuery', false, true, { structuredQuery: {
      from: [{ collectionId: 'posts' }], select: { fields: fields.map(function (f) { return { fieldPath: f }; }) },
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }], limit: 200 } });
    return (Array.isArray(j) ? j : []).filter(function (x) { return x && x.document; }).map(function (x) {
      return Object.assign({ id: decodeURIComponent(String(x.document.name || '').split('/').pop()) }, window._spRestFields(x.document.fields || {}));
    });
  }
  async function find(goal, max) {
    var posts = await readPosts();
    if (!posts) return null;
    var me = [];
    try { me = (typeof window.emuAliasesNow === 'function' ? window.emuAliasesNow() : []).map(norm).filter(Boolean); } catch (_) {}
    var myTags = [];
    posts.forEach(function (p) { if (me.indexOf(norm(p.address)) >= 0) myTags = myTags.concat(tagsOf(p)); });
    return rank(posts, goal, me, myTags, max || 3);
  }
  window.EmuPostMatch = { cues: cues, rank: rank, find: find };
})(window);
