/* 冷蔵庫くんと話して、知識の下書きにする（11/10）。index.html で読み込む。

   ReizoInterview.request(mode, turns, terms)
     サーバー（backend/reizo-interview.js）に、質問（ask）か下書き（draft）を頼む。
     投稿画面（knowledge.html）からの頼みも、親のこのページが中継してここを通る（ログインの鍵は親が持つため）。

   ReizoSeed … 冷蔵庫くんに聞くの会話から、知識のタネを作る。
     - 「📝 気づいたことを知識にしたい」を押すと、冷蔵庫くんが聞き役になって、もう少し聞き出す。
     - ふつうの会話でも、体験や気づきらしい話をしたら「それ、いい知恵かも！」と一度だけ声をかける。
     - まとめた案は会話の中で見せるだけ。「投稿画面で仕上げる」を押したときだけ、投稿画面に入れて開く。
   会話はこのページの中にだけ持つ（保存しない）。ログインしている人が変わったら捨てる。 */
(function (window, document) {
  'use strict';
  var ENDPOINT = 'https://emu-realtime.onrender.com/api/emu/interview';
  var log = [], owner = null, active = false, offered = false, busy = false, terms = null;

  function uid() { var u = window.auth && window.auth.currentUser; return u ? u.uid : null; }
  function words(code, mode) {
    return ({
      DAILY_LIMIT: mode === 'draft' ? '今日の「まとめる」は3回使ったよ。また明日使えるよ🧊'
        : '今日はたくさん話してくれたね🧊 質問のつづきはまた明日。いまの話は「まとめる」でまとめられるよ。',
      TALK_REQUIRED: 'まずは、あったことや気づいたことを話してみてね🧊',
      DISABLED: 'いまは冷蔵庫くんのAIを使えないみたい🧊',
      BUSY: 'いま少し混んでいるみたい🧊 1分くらい待ってから、もう一度ためしてね。',
      RATE_LIMITED: 'いま少し混んでいるみたい🧊 1分くらい待ってから、もう一度ためしてね。',
      TIMEOUT: '考えるのに時間がかかりすぎちゃった🧊 もう一度ためしてね。'
    })[code] || 'うまくまとめられなかったみたい🧊 時間をおいて、もう一度ためしてね。';
  }
  function cleanTurns(turns) {
    return (Array.isArray(turns) ? turns : []).filter(function (t) {
      return t && (t.role === 'me' || t.role === 'reizo') && typeof t.text === 'string' && t.text.trim();
    }).slice(-16).map(function (t) { return { role: t.role, text: t.text.slice(0, 800) }; });
  }

  async function request(mode, turns, termsIn) {
    try {
      var headers = await window.emuAuthHeaders(true);
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 45000) : null;
      var r = await fetch(ENDPOINT, {
        method: 'POST', headers: headers, signal: controller ? controller.signal : undefined,
        body: JSON.stringify({ mode: mode === 'draft' ? 'draft' : 'ask', turns: cleanTurns(turns),
          terms: mode === 'draft' && termsIn && typeof termsIn === 'object' ? termsIn : undefined })
      });
      if (timer) clearTimeout(timer);
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) return { ok: false, error: words(d.error, mode), code: String(d.error || '') };
      return {
        ok: true, mode: d.mode, remaining: d.remaining, reply: String(d.reply || ''), ready: d.ready === true,
        empty: d.empty === true, title: String(d.title || ''), body: String(d.body || ''), note: String(d.note || ''),
        tags: Array.isArray(d.tags) ? d.tags.map(String).slice(0, 5) : [], lab: d.lab && typeof d.lab === 'object' ? d.lab : null
      };
    } catch (error) {
      return { ok: false, error: /ログイン/.test(String(error && error.message)) ? '冷蔵庫くんと話して書くには、ログインしてね🧊'
        : 'うまくつながらなかったみたい🧊 もう一度ためしてね。' };
    }
  }

  /* 「詳しく整理する」の分類の候補。AI はこの中からだけ選ぶ。読めなければ分類なしでまとめる。 */
  async function labTerms() {
    if (terms) return terms;
    try {
      var r = await fetch('/api/knowledge-lab/taxonomy');
      var j = await r.json();
      var list = r.ok ? (Array.isArray(j) ? j : (j.items || [])) : [];
      var out = {};
      list.forEach(function (t) {
        if (!t || !t.axis || !t.id || !t.label || t.active === false || t.mergedInto) return;
        (out[t.axis] = out[t.axis] || []).push([t.id, t.label]);
      });
      terms = out;
    } catch (_) { terms = {}; }
    return terms;
  }

  /* ── 冷蔵庫くんに聞くの会話から ── */
  function own() { var u = uid(); if (owner !== u) { log = []; active = false; offered = false; owner = u; hideBar(); } }
  function remember(role, text) { own(); if (text && String(text).trim()) { log.push({ role: role, text: String(text).slice(0, 800) }); log = log.slice(-16); } }
  function say(text) { return window._spReizoAppendMsg(text, false); }
  function bubbleOf(div) { return div && div.querySelector ? div.querySelector('.sp-reizo-bubble') : null; }
  function buttons(div, list) {
    var b = bubbleOf(div); if (!b) return;
    var wrap = document.createElement('div'); wrap.className = 'sp-reizo-quick-wrap';
    list.forEach(function (o) {
      var btn = document.createElement('button'); btn.className = 'sp-reizo-quick-btn'; btn.type = 'button'; btn.textContent = o.label;
      btn.onclick = function () { wrap.remove(); o.onClick(); };
      wrap.appendChild(btn);
    });
    b.appendChild(wrap);
    var msgs = document.getElementById('spReizoMessages'); if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }
  function typing() { return typeof window._spReizoShowTyping === 'function' ? window._spReizoShowTyping() : { remove: function () {} }; }

  /* いつでも押せる「この話を知識のタネにする」。聞き役のときと、声をかけたあとだけ出す。 */
  function bar() {
    var panel = document.getElementById('spReizoPanel'); if (!panel) return null;
    var el = document.getElementById('spReizoSeedBar');
    if (!el) {
      el = document.createElement('div'); el.id = 'spReizoSeedBar'; el.hidden = true;
      el.style.cssText = 'padding:6px 12px 0;display:flex;gap:6px;flex-wrap:wrap';
      el.innerHTML = '<button type="button" class="sp-reizo-quick-btn" data-seed-draft>📝 この話を知識のタネにする</button>'
        + '<button type="button" class="sp-reizo-quick-btn" data-seed-stop>ふつうの会話にもどる</button>';
      el.querySelector('[data-seed-draft]').onclick = function () { draft(); };
      el.querySelector('[data-seed-stop]').onclick = function () { active = false; hideBar(); say('わかった！またいつでも話してね🧊'); };
      var input = panel.querySelector('.sp-reizo-input-area');
      panel.insertBefore(el, input || null);
    }
    return el;
  }
  function showBar() { var el = bar(); if (el) el.hidden = false; }
  function hideBar() { var el = document.getElementById('spReizoSeedBar'); if (el) el.hidden = true; }

  function start() {
    own();
    var opening = document.getElementById('spReizoOpening'); if (opening) opening.remove();
    if (!uid()) { say('知識にするには、ログインしてね🧊'); return; }
    active = true; showBar();
    say('いいね！🧊 最近あったことや、やってみて気づいたことを、ぼくに話しかけるみたいに送ってね。\n短くても大丈夫。ぼくが少しずつ聞いて、投稿用にまとめるよ。');
    var input = document.getElementById('spReizoInput'); if (input) { input.placeholder = '気づいたことを話してね…'; input.focus(); }
  }

  /* spReizoSend から呼ばれる。聞き役のときだけ、ふつうの会話の代わりにここで返事をする。 */
  function handle(q) {
    own();
    if (!active) return false;
    remember('me', q);
    if (busy) return true;
    busy = true;
    var t = typing();
    request('ask', log).then(function (d) {
      t.remove(); busy = false;
      if (!d.ok) {
        var m = say(d.error);
        if (d.code === 'DAILY_LIMIT') buttons(m, [{ label: '📝 いまの話をまとめる', onClick: draft }]);
        return;
      }
      remember('reizo', d.reply);
      var div = say(d.reply);
      if (d.ready) buttons(div, [{ label: '📝 投稿用にまとめて！', onClick: draft }, { label: 'もう少し話す', onClick: function () {} }]);
    });
    return true;
  }

  /* ふつうの会話のあとに呼ばれる。体験や気づきらしい話なら、一度だけ声をかける。 */
  var EXPERIENCE = /(気づ|気付|分かった|わかった|やってみ|試し|ためし|失敗|うまくいっ|上手くいっ|学んだ|してみたら|したら|コツ|工夫|経験|助かった|困った)/;
  function after(q, reply) {
    own();
    if (active) return;
    remember('me', q); remember('reizo', reply);
    if (offered || !uid() || String(q).length < 20 || !EXPERIENCE.test(q)) return;
    offered = true;
    var div = say('💡 それ、いい知恵かも！ほかの人の役に立ちそう。知識のタネにしてみる？');
    buttons(div, [
      { label: '📝 知識のタネにする', onClick: draft },
      { label: 'もう少し話してから', onClick: function () { active = true; showBar(); say('うん！その話、もう少し聞かせて🧊 どうなったの？'); } },
      { label: 'いまはいい', onClick: function () {} }
    ]);
  }

  async function draft() {
    own();
    if (busy) return;
    if (!log.some(function (t) { return t.role === 'me'; })) { say('まずは、あったことや気づいたことを話してみてね🧊'); start(); return; }
    busy = true;
    var t = typing();
    var d = await request('draft', log, await labTerms());
    t.remove(); busy = false;
    if (!d.ok) { say(d.error); return; }
    if (d.empty) {
      active = true; showBar();
      say((d.note || 'まだ知識にできる体験が見つからなかったよ') + '🧊\nやってみたことや、うまくいったこと・失敗したことを話してみてね。');
      return;
    }
    var div = say('🧊 こうまとめてみたよ！' + (d.note ? '（' + d.note + '）' : ''));
    var b = bubbleOf(div);
    if (b) {
      var card = document.createElement('div');
      card.style.cssText = 'margin-top:8px;background:#fff;color:#222;border-radius:10px;padding:10px;font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto';
      var title = document.createElement('div'); title.style.fontWeight = '700'; title.textContent = d.title || '（タイトルは投稿画面で）';
      var body = document.createElement('div'); body.style.marginTop = '4px'; body.textContent = d.body;
      card.appendChild(title); card.appendChild(body);
      if (d.tags.length) { var tg = document.createElement('div'); tg.style.cssText = 'margin-top:6px;color:#1f6f5c'; tg.textContent = d.tags.map(function (x) { return '#' + x; }).join(' '); card.appendChild(tg); }
      b.appendChild(card);
    }
    buttons(div, [
      { label: '✍️ 投稿画面で仕上げる', onClick: function () { open(d); } },
      { label: 'もう少し話す', onClick: function () { active = true; showBar(); say('うん！つづきを聞かせて🧊'); } },
      { label: 'やめる', onClick: function () {} }
    ]);
  }
  function open(d) {
    active = false; hideBar(); log = []; offered = false;
    var input = document.getElementById('spReizoInput'); if (input) input.placeholder = '冷蔵庫くんに聞く…';
    if (typeof window.spReizoClose === 'function') window.spReizoClose();
    if (typeof window.emuOpenKnowledgeDraft === 'function') {
      window.emuOpenKnowledgeDraft({ title: d.title, body: d.body, tags: d.tags, lab: d.lab, from: 'reizo-chat' });
    }
  }

  window.ReizoInterview = { request: request, labTerms: labTerms };
  window.ReizoSeed = { start: start, handle: handle, after: after, draft: draft, active: function () { return active; } };
})(window, document);
