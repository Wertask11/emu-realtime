/* 冷蔵庫くんに頼む（会話の窓の中で）。11/28 オーナー：「冷蔵庫くんに頼む画面は、聞く画面と同じにして。
   頼むにタブかえる→聞くと同じ画面で、頼める」。

   左上の切り替えで「📋 頼む」を選ぶと、聞くと同じ会話の窓のまま「頼む」になる。
     文で頼む → 冷蔵庫くんが「これをやるね・5 EMUER」と確かめる → 「承認して実行」→ 動く → 結果を会話に出す。
   使う窓口は、頼む画面（/economy/）と同じ /api/economy（料金・返却・台帳・AI送信の決まりは変えない）。
   やることは、頼んだ文から選ぶ（economy/app.js の pickTask と同じ決まり）。保存した計画・これまでの依頼は /economy/ で見る。 */
(function (window, document) {
  'use strict';
  var active = false;
  var LABELS = { '': '探して持ってくる', knowledge_draft: '知識投稿の下書きを作る', quest_plan: 'クエスト挑戦の準備をする',
    guild_plan: 'ギルド活動の計画を作る', city_comparison: 'Cityで使えるものを比べる', wil_plan: '探究の計画を作る' };
  var ACTIVE = ['awaiting_payment', 'awaiting_wallet_payment', 'queued', 'running', 'result_saved', 'refund_pending'];
  var ERRORS = {
    AUTH_REQUIRED: 'ログインしてから頼んでね🧊',
    PASSPORT_REQUIRED: 'SchoolParkパスポートの連携を確かめてね🧊',
    SERVICE_DISABLED: 'いまは頼むを受け付けていないみたい🧊',
    SERVICE_NOT_ELIGIBLE: '頼むは Plus・Pro の人が使えるよ🧊（Free・Light では使えないんだ）',
    AI_AUDIENCE_NOT_VERIFIED: 'AIを使う確認がまだ済んでいないみたい🧊',
    SENSITIVE_INPUT: '名前や連絡先などは書かずに、やってほしいことだけ書いてね🧊',
    AI_DAILY_LIMIT: '今日はもう頼めないみたい（1日3回まで）🧊 また明日ね。',
    AI_BUDGET_LIMIT: '今日のAIの受付はおしまいみたい🧊 また明日ね。',
    AI_PROVIDER_DAY_LIMIT: '今日のAIの受付はおしまいみたい🧊 また明日ね。',
    AI_ADMISSION_RATE_LIMIT: 'いま混んでいるみたい🧊 1分くらい待ってから、もう一度頼んでね（まだ払っていないよ）。',
    INSUFFICIENT_EMUER: '使えるEMUERが足りないみたい🧊（1回 5 EMUER）',
    QUOTE_EXPIRED_OR_CHANGED: '確かめてから時間がたったみたい🧊 もう一度頼んでね（まだ払っていないよ）。',
    SEARCH_SOURCES_UNAVAILABLE: '調べる先を確かめられなかったよ🧊 払っていた場合は、全額戻るよ。'
  };

  /* ── 頼んだ文から、やることを選ぶ（economy/app.js の pickTask と同じ。tools/emu-tests/reizo-request-chat.test.cjs で同じことを確かめる） ── */
  function pickTask(goal, available) {
    const t = String(goal || "");
    const can = (id) => available.includes(id);
    const fetchy = /持ってき|探して|さがして|教えて|見せて|知りたい|どこ|一覧|ある[？?]|ない[？?]/.test(t);
    const make = /作って|つくって|準備|計画|下書き|まとめて|書いて|考えて|整理/.test(t);
    if (fetchy && !make) return "";
    const pick = [
      ["knowledge_draft", /投稿|知識にしたい|知識に|下書き|記事/],
      ["quest_plan", /クエスト/],
      ["guild_plan", /ギルド|LEARN|WORK|PLAY|CONNECT|WEB3/i],
      ["city_comparison", /City|シティ|ショップ|交換|商品|お店/i],
      ["wil_plan", /探究|WIL|学習計画|学びの計画/i],
    ].find(([id, re]) => can(id) && re.test(t));
    return make && pick ? pick[0] : "";
  }

  /* ── 会話の窓 ── */
  function say(text) { return typeof window._spReizoAppendMsg === 'function' ? window._spReizoAppendMsg(text, false) : null; }
  function bubbleOf(msg) { return msg && msg.querySelector('.sp-reizo-bubble'); }
  function scroll() { var m = document.getElementById('spReizoMessages'); if (m) m.scrollTop = m.scrollHeight; }
  function button(text, cls, onClick) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'sp-reizo-quick-btn' + (cls ? ' ' + cls : ''); b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
  function row(bubble, buttons) {
    var w = document.createElement('div'); w.className = 'sp-reizo-quick-wrap rq-row';
    buttons.forEach(function (b) { w.appendChild(b); });
    bubble.appendChild(w); scroll();
    return w;
  }
  function typing() { return typeof window._spReizoShowTyping === 'function' ? window._spReizoShowTyping() : null; }
  function label(text) {
    var now = document.querySelector('#spReizoPanel .sp-reizo-mode-now');
    if (now) now.textContent = text;
    var btn = document.querySelector('#spReizoPanel .sp-reizo-mode');
    if (btn) btn.setAttribute('aria-label', '冷蔵庫くんの使い方を切り替える（いまは' + text.replace(/^\S+\s/, '') + '）');
  }
  function placeholder(on) {
    var input = document.getElementById('spReizoInput');
    if (!input) return;
    if (on) { if (!input.dataset.askPlaceholder) input.dataset.askPlaceholder = input.placeholder; input.placeholder = '冷蔵庫くんに頼む…（例：クエストを持ってきて）'; }
    else if (input.dataset.askPlaceholder) { input.placeholder = input.dataset.askPlaceholder; delete input.dataset.askPlaceholder; }
  }

  /* ── 窓口（/api/economy。頼む画面と同じ） ── */
  async function api(path, body) {
    if (!(window.auth && window.auth.currentUser) || typeof window.emuAuthHeaders !== 'function') throw new Error('AUTH_REQUIRED');
    var headers = new Headers(await window.emuAuthHeaders(true, { interactive: false }));
    headers.set('Content-Type', 'application/json');
    var r = await fetch('/api/economy' + path, { method: body ? 'POST' : 'GET', headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.error || 'ECONOMY_UNAVAILABLE');
    return d;
  }
  function available(me) {
    var tasks = (me && me.service && me.service.workflow && me.service.workflow.enabled && me.service.workflow.tasks) || [];
    return tasks.filter(function (t) { return t.available; }).map(function (t) { return t.id; });
  }

  /* ── 開く（頼む画面の openTarget と同じ行き先だけ） ── */
  function openTarget(target) {
    if (!window.ReizoRequestTargets || !window.ReizoRequestTargets.allowed(target)) return;
    if (typeof window.spReizoClose === 'function') window.spReizoClose();
    if (target.indexOf('/?lab=') === 0) {
      var u = new URL(target, location.origin);
      if (window.openEmuKnowledgeLab) window.openEmuKnowledgeLab(u.searchParams.get('lab'), { post: u.searchParams.get('labPost'), note: u.searchParams.get('labNote') });
    } else if (target.indexOf('/?view=') === 0) {
      var view = new URL(target, location.origin).searchParams.get('view');
      if (window.EmuNavigation && window.EmuNavigation.go) { if (window.closeSpRoom) window.closeSpRoom(); window.EmuNavigation.go(view); }
      else location.assign(target);
    } else if (window.openSpRoom) window.openSpRoom(target, 'Emu for SchoolPark');
    else location.assign(target);
  }
  function openEconomy(query) {
    if (typeof window.spReizoClose === 'function') window.spReizoClose();
    if (window.openSpRoom) window.openSpRoom('/economy/index.html' + (query || ''), '冷蔵庫くんに頼む');
  }

  /* ── 入る・出る ── */
  async function enter() {
    active = true;
    label('📋 頼む');
    placeholder(true);
    var msg = say('📋 頼むモードだよ。やってほしいことを、文で送ってね。\n「これをやるね」と確かめてから動くよ。1回 5 EMUER（うまくいかなかったら全額戻るよ）。');
    var b = bubbleOf(msg);
    if (b) {
      row(b, [
        button('🎯 クエストを持ってきて', '', function () { send('いま受けられるクエストを持ってきて'); }),
        button('📝 知識の下書きを作って', '', function () { send('気づいたことを知識の投稿にしたいので、下書きを作って'); }),
        button('💎 EMUERの使い道', '', function () { send('今のEMUERで何ができる？Cityで使えるものを持ってきて'); }),
        button('📂 これまでの依頼・保存した計画', 'rq-sub', function () { openEconomy(''); })
      ]);
    }
    try {
      var me = await api('/me');
      if (!active || !b) return;
      var note = document.createElement('small'); note.className = 'rq-note';
      note.textContent = me.eligibility && me.eligibility.eligible === false
        ? (ERRORS[me.eligibility.reason] || 'いまの条件では頼めないみたい🧊')
        : '使えるEMUER：' + (me.balances && me.balances.spendable != null ? me.balances.spendable + ' EMUER' : '確かめられませんでした');
      b.appendChild(note); scroll();
    } catch (e) {
      if (active && b && e.message === 'AUTH_REQUIRED') { var n = document.createElement('small'); n.className = 'rq-note'; n.textContent = ERRORS.AUTH_REQUIRED; b.appendChild(n); }
    }
  }
  /* silent：閉じていた窓を開き直すとき（まず「聞く」に戻すだけで、会話には何も足さない） */
  function leave(silent) {
    if (!active) return;
    active = false;
    label('💬 聞く');
    placeholder(false);
    if (!silent) say('💬 聞くモードに戻ったよ。使い方や質問をどうぞ。');
  }
  function send(text) {
    if (typeof window._spReizoAppendMsg === 'function') window._spReizoAppendMsg(text, true);
    run(text);
  }

  /* ── 頼む：確かめる → 承認 → 実行 → 結果 ── */
  async function run(goal) {
    var userAt = window.auth && window.auth.currentUser;
    var wait = typing(), me = null, quote = null, taskType = '';
    try {
      me = await api('/me');
      if (me.eligibility && me.eligibility.eligible === false) throw new Error(me.eligibility.reason || 'SERVICE_NOT_ELIGIBLE');
      taskType = pickTask(goal, available(me));
      var ask = function (t) { return api('/quotes', { goal: goal, method: 'emuer_ledger', taskType: t || undefined, balanceConsent: false, achievementsConsent: false }); };
      var d;
      try { d = await ask(taskType); }
      catch (e) {
        if (!taskType || ['WORK_MATERIAL_UNAVAILABLE', 'WORK_SOURCE_DISABLED', 'WORKFLOW_DISABLED', 'INVALID_WORK_TYPE'].indexOf(e.message) < 0) throw e;
        taskType = ''; d = await ask('');
      }
      quote = d.quote;
    } catch (e) {
      if (wait) wait.remove();
      if (userAt !== (window.auth && window.auth.currentUser)) return;
      say(ERRORS[e.message] || 'うまく確かめられなかったよ🧊 少し待って、もう一度頼んでね（まだ払っていないよ）。');
      return;
    }
    if (wait) wait.remove();
    var plan = (quote.executionPlan || []).slice(0, 5).map(function (p, i) { return (i + 1) + '. ' + p; }).join('\n');
    var msg = say('「' + goal + '」をやるね。\nやること：' + (LABELS[quote.taskType || taskType] || LABELS['']) + (plan ? '\n' + plan : '')
      + '\n\n料金：5 EMUER（うまくいかなかったら全額戻るよ）');
    var b = bubbleOf(msg);
    if (!b) return;
    var fine = document.createElement('small'); fine.className = 'rq-note';
    fine.textContent = '「承認して実行」を押すと、使えるEMUERから5 EMUERを払い、目的の種類と公開資料をGoogle Geminiへ送るよ（入力した文そのものや残高は送らないよ）。';
    var link = document.createElement('a'); link.href = '/privacy.html'; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'データの取り扱い';
    fine.appendChild(document.createTextNode(' ')); fine.appendChild(link);
    var buttons = row(b, [
      button('✅ 承認して実行（5 EMUER）', 'rq-go', function () { buttons.remove(); b.appendChild(fine); approve(goal, quote, userAt); }),
      button('やめる', 'rq-sub', function () { buttons.remove(); say('やめたよ。料金はかかっていないよ🧊'); })
    ]);
    b.appendChild(fine); scroll();
  }
  async function approve(goal, quote, userAt) {
    var wait = typing(), job = null;
    try {
      var d = await api('/jobs', {
        method: quote.method || 'emuer_ledger',
        paymentTermsVersion: quote.paymentTermsVersion || undefined,
        quoteId: quote.id,
        termsVersion: quote.termsVersion,
        requestId: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
        paymentConsent: true,
        aiConsent: true,
        searchConsentVersion: quote.searchProfile ? quote.searchProfile.version : undefined,
        workConsentVersion: quote.workConsentVersion || undefined,
        balanceConsent: false,
        achievementsConsent: false
      });
      job = d.job;
      say('🧊 動き始めたよ。そのまま待っていてね（もう一度頼まなくて大丈夫）。');
      var until = Date.now() + 3 * 60 * 1000;
      while (job && ACTIVE.indexOf(job.state) >= 0 && Date.now() < until) {
        await new Promise(function (r) { setTimeout(r, 4000); });
        if (userAt !== (window.auth && window.auth.currentUser)) { if (wait) wait.remove(); return; }
        job = (await api('/jobs/' + encodeURIComponent(job.id))).job;
      }
    } catch (e) {
      if (wait) wait.remove();
      if (userAt !== (window.auth && window.auth.currentUser)) return;
      say(ERRORS[e.message] || 'うまく受け付けられなかったよ🧊 二重に払うことはないから、「これまでの依頼」で確かめてね。');
      return;
    }
    if (wait) wait.remove();
    if (!job) return;
    if (ACTIVE.indexOf(job.state) >= 0) {
      var m = say('まだ動いているよ🧊 終わったら「これまでの依頼」に出るよ。');
      row(bubbleOf(m), [button('📂 これまでの依頼を見る', 'rq-sub', function () { openEconomy(''); })]);
      return;
    }
    if (job.state === 'refunded' || (job.payment && job.payment.refunded)) { say('うまくいかなかったので、5 EMUERは全額戻したよ🧊 言い方を変えて、もう一度頼んでみてね。'); return; }
    if (job.state !== 'completed') { say(ERRORS[job.error] || 'うまくいかなかったみたい🧊 「これまでの依頼」で確かめてね。'); return; }
    showResult(job);
  }
  function showResult(job) {
    if (job.artifactId) {
      var a = say('できたよ🧊 下書き・計画を保存したよ。');
      row(bubbleOf(a), [button('📄 できた下書き・計画を開く', 'rq-go', function () { openEconomy('?artifact=' + encodeURIComponent(job.artifactId)); })]);
      return;
    }
    var res = job.result || {}, items = (res.results || []).slice(0, 5);
    if (!items.length) { say('見つからなかったよ🧊（作り話の候補は出さないよ）言い方を変えて、もう一度頼んでみてね。'); return; }
    /* 11/28 オーナー：「イマイチ」。前は全部のカードに同じ決まり文句（AIが…選んだ公開資料です）を出し、
       「次にやること」で同じ資料をもう一度並べていた。いまは：
       - カードごとに、その資料の種類（Knowledge Lab など）と、その資料の要約を出す
       - 次にやることは、同じ資料のカードの中に1行で添える（同じカードを2回出さない）
       - 決まり文句は最後に1回だけ（AIは候補を選ぶだけで、文は作らない。作り話を出さないため） */
    var KIND = { knowledge: 'Knowledge Lab', knowledge_lab: 'Knowledge Lab', knowledge_research: 'Knowledge Lab', knowledge_text: 'Knowledge Text',
      guild: 'ギルド', quest: 'クエスト', service_guide: '使い方', city_product: 'City', emuer_guide: 'EMUER', passport_guide: 'Passport', activity_guide: '遊び' };
    var keyOf = function (x) { return String(x.kind || '') + ':' + String(x.id || ''); };
    var stepFor = {};
    (res.steps || []).forEach(function (s) { (s.references || []).forEach(function (k) { if (!stepFor[k]) stepFor[k] = s.text; }); });
    var short = function (v, n) { v = String(v || '').replace(/\s+/g, ' ').trim(); return v.length > n ? v.slice(0, n) + '…' : v; };
    var msg = say(items.length + 'つ持ってきたよ🧊');
    var b = bubbleOf(msg);
    items.forEach(function (r) {
      var card = document.createElement('div'); card.className = 'rq-card';
      if (KIND[r.kind]) { var k = document.createElement('span'); k.className = 'rq-kind'; k.textContent = KIND[r.kind]; card.appendChild(k); }
      var t = document.createElement('b'); t.textContent = r.title || '';
      card.appendChild(t);
      var sum = short(r.evidence, 90);
      if (sum) { var p = document.createElement('div'); p.className = 'rq-why'; p.textContent = sum; card.appendChild(p); }
      var next = stepFor[keyOf(r)];
      if (next) { var n = document.createElement('div'); n.className = 'rq-next'; n.textContent = '次にやること：' + next; card.appendChild(n); }
      if (r.target && window.ReizoRequestTargets && window.ReizoRequestTargets.allowed(r.target))
        card.appendChild(button('開く →', 'rq-open', function () { openTarget(r.target); }));
      b.appendChild(card);
    });
    var note = document.createElement('div'); note.className = 'rq-note';
    note.textContent = 'AIは、頼まれた目的に近い公開資料を選ぶだけで、文は作らないよ（作り話を出さないため）。中身は開いて確かめてね。';
    b.appendChild(note);
    scroll();
  }

  /* spReizoSend から呼ばれる。頼むのときだけ、ふつうの会話の代わりにここで受ける */
  function handle(q) { if (!active) return false; run(q); return true; }

  var st = document.createElement('style');
  st.textContent = [
    '.rq-row{margin-top:10px}',
    '.rq-row .rq-go{background:#D4A843;color:#1d1408;border-color:#D4A843;font-weight:800}',
    '.rq-row .rq-sub{opacity:.85;font-size:12px}',
    '.rq-note{display:block;margin-top:8px;font-size:12px;line-height:1.6;color:#c8b48a}',
    '.rq-note a{color:#e8c46a}',
    '.rq-card{margin-top:8px;padding:8px 10px;border:1px solid rgba(212,168,67,.35);border-radius:10px;background:rgba(212,168,67,.06)}',
    '.rq-card b{display:block;color:#f4d27a}',
    '.rq-why{margin-top:2px;font-size:13px;line-height:1.6;white-space:pre-wrap}',
    '.rq-card .rq-open{margin-top:6px;width:auto;padding:4px 12px;font-size:12px}',
    '.rq-head{margin-top:12px;font-weight:800;color:#f4d27a}',
    '.rq-kind{display:inline-block;margin-bottom:3px;padding:1px 8px;border-radius:999px;border:1px solid rgba(212,168,67,.45);font-size:11px;color:#e8c46a}',
    '.rq-next{margin-top:4px;font-size:12px;line-height:1.6;color:#d9c79a}'
  ].join('\n');
  (document.head || document.documentElement).appendChild(st);

  window.ReizoAsk = { enter: enter, leave: leave, handle: handle, active: function () { return active; }, pickTask: pickTask };
})(window, document);
