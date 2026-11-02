/* Explicit, content-free PostHog events. No SDK/autocapture/person profiles/replay. */
(function () {
  'use strict';
  try {
  if (window.EmuAnalytics) return;
  const CONSENT = 'emu.analytics.consent.v1', INTERNAL = 'emu.analytics.internal.v1';
  const VISITOR = 'emu.analytics.visitor.v1', SESSION = 'emu.analytics.session.v1';
  const QUEUE = 'emu.analytics.queue.v1', STARTED = 'emu.analytics.started.v1';
  const HOST = 'https://us.i.posthog.com', TOKEN = 'phc_C7uHQF9QnDo497kex9cdZqwKx53hDBiVU54sBSDHPaks';
  const schemas = {
    session_start: {}, knowledge_list_view: { surface: ['feed'] },
    knowledge_detail_view: { surface: ['feed','source','lab','permalink'] },
    post_create_start: { surface: ['feed','lab','legacy'] }, post_publish: { surface: ['feed','lab'] },
    knowledge_action: { action: ['helpful','improvement','discussion'] },
    quest_list_view: {}, quest_detail_view: {}, quest_join: {}, quest_complete: {},
    knowledge_lab_view: { section: ['library','research','mine','requests','writer'] },
    knowledge_lab_search: { mode: ['lexical','semantic'], result_count: 'count', more: 'boolean' },
    knowledge_lab_research: { stage: ['compare','ai_success','save'], method: ['manual','ai'] },
    knowledge_lab_writer_profile: { stage: ['view','save'] },
    knowledge_lab_save: { kind: ['knowledge','research','draft'] }
  };
  const get = (storage, key) => { try { return storage.getItem(key); } catch (_) { return null; } };
  const put = (storage, key, value) => { try { storage.setItem(key,value); return true; } catch (_) { return false; } };
  const remove = (storage,key) => { try { storage.removeItem(key); } catch (_) {} };
  const uuid = () => crypto.randomUUID();
  const dnt = () => [navigator.doNotTrack, navigator.msDoNotTrack, window.doNotTrack].some(x => x === '1' || x === 'yes') || navigator.globalPrivacyControl === true;
  function visible() {
    try {
      if (document.visibilityState === 'hidden') return false;
      let w = window;
      while (w !== w.parent) {
        const el = w.frameElement;
        if (!el || !el.getClientRects().length) return false;
        let node = el;
        while (node) { const s = w.parent.getComputedStyle(node); if (s.display === 'none' || s.visibility === 'hidden') return false; node = node.parentElement; }
        w = w.parent;
      }
      return true;
    } catch (_) { return false; }
  }
  function sanitize(name, values) {
    if (!Object.hasOwn(schemas,name)) return null;
    const clean = {};
    for (const [key, rule] of Object.entries(schemas[name])) {
      const v = (values || {})[key];
      if (Array.isArray(rule) ? rule.includes(v) : rule === 'count' ? Number.isInteger(v) && v >= 0 && v <= 10000 : typeof v === 'boolean') clean[key] = v;
    }
    return clean;
  }
  let core;
  try { if (parent !== window && parent.location.origin === location.origin) core = parent.EmuAnalytics?._core; } catch (_) {}
  if (!core) {
    let busy = false, timer, failures = 0, memoryVisitor, memorySession;
    const seen = new Set();
    const environment = /^(emu-for-schoolpark|schoolpark-emu)\.vercel\.app$/.test(location.hostname) ? 'production' : /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'local' : 'preview';
    const permitted = () => !dnt() && get(localStorage, CONSENT) === 'yes';
    const internal = () => environment !== 'production' || get(localStorage,INTERNAL) === 'yes';
    function readQueue() {
      try { const q = JSON.parse(get(sessionStorage,QUEUE) || '[]'); return Array.isArray(q) ? q.filter(p => p && Date.now()-p.at < 86400000).slice(-100) : []; } catch (_) { return []; }
    }
    function identity(key, storage, memory) {
      const existing = get(storage,key);
      if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
      const value = memory || uuid(); put(storage,key,value); return value;
    }
    async function flush() {
      clearTimeout(timer);
      if (busy) return;
      if (!permitted()) { remove(sessionStorage,QUEUE); return; }
      const queue = readQueue();
      if (!queue.length) return;
      busy = true;
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(),10000);
      try {
        const response = await fetch(HOST + '/batch/', {
          method:'POST', credentials:'omit', referrerPolicy:'no-referrer', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({api_key:TOKEN,batch:queue.map(x=>x.payload)}), signal:controller.signal
        });
        const body = await response.json().catch(()=>null);
        if (!response.ok || !body || ![1, 'Ok'].includes(body.status)) throw new Error('not_accepted');
        // Remove only the accepted packet IDs; new events may have arrived while awaiting HTTP.
        const accepted = new Set(queue.map(x=>x.id));
        put(sessionStorage,QUEUE,JSON.stringify(readQueue().filter(x=>!accepted.has(x.id))));
        failures = 0; core.delivery = 'http_accepted';
      } catch (_) { failures++; core.delivery = 'pending'; }
      finally { clearTimeout(timeout); busy = false; }
      if (permitted() && readQueue().length && failures < 5) timer = setTimeout(flush,Math.min(60000,2000*Math.pow(2,failures)));
    }
    function enqueue(name, values, localOnlyKey) {
      if (!permitted()) return false;
      const clean = sanitize(name,values); if (!clean) return false;
      const key = localOnlyKey ? name + ':' + localOnlyKey : null;
      if (key && seen.has(key)) return false;
      if (key) { if (seen.size >= 5000) seen.clear(); seen.add(key); }
      memoryVisitor = identity(VISITOR,localStorage,memoryVisitor);
      memorySession = identity(SESSION,sessionStorage,memorySession);
      const id = uuid();
      const payload = { event:name, uuid:id, timestamp:new Date().toISOString(), properties:{
        ...clean, service:'emu_for_schoolpark', environment, traffic_type:internal()?'internal':'user',
        distinct_id:'emu_anon_' + memoryVisitor, $session_id:memorySession, $insert_id:id, $process_person_profile:false, $geoip_disable:true, $ip:'0.0.0.0'
      }};
      const q=readQueue(); q.push({id,at:Date.now(),payload});
      if (!put(sessionStorage,QUEUE,JSON.stringify(q.slice(-100)))) return false;
      clearTimeout(timer); timer=setTimeout(flush,200); return true;
    }
    core = {
      delivery:'idle',
      track(name, values, key) {
        try {
          if (!permitted()) return false;
          const session = identity(SESSION,sessionStorage,memorySession);
          memorySession = session;
          if (get(sessionStorage,STARTED) !== session) {
            if (enqueue('session_start',{},'session:'+session)) put(sessionStorage,STARTED,session);
          }
          return name === 'session_start' ? true : enqueue(name,values,key);
        } catch (_) { return false; }
      },
      consent(allowed) {
        put(localStorage,CONSENT,allowed?'yes':'no');
        if (!allowed) { remove(sessionStorage,QUEUE); remove(localStorage,VISITOR); remove(sessionStorage,SESSION); remove(sessionStorage,STARTED); seen.clear(); memoryVisitor=memorySession=undefined; clearTimeout(timer); }
        else if (visible()) core.track('session_start',{});
        window.dispatchEvent(new Event('emu-analytics-consent'));
      },
      setTestTraffic(enabled) {
        // Set BEFORE consent/actions. Never infer a test person from account or wallet data.
        remove(sessionStorage,QUEUE); remove(sessionStorage,SESSION); remove(sessionStorage,STARTED); memorySession=undefined; seen.clear();
        put(localStorage,INTERNAL,enabled?'yes':'no');
      },
      flush, permitted
    };
    window.addEventListener('online',()=>{failures=0;flush();});
    window.addEventListener('storage', e=>{if (e.key === CONSENT && !permitted()) remove(sessionStorage,QUEUE);});
    document.addEventListener('visibilitychange',()=>{if (visible()) {failures=0;flush();}});
    if (visible() && permitted()) core.track('session_start',{});
    function consentUI() {
      if (parent !== window || document.getElementById('emuAnalyticsChoice')) return;
      if (!dnt() && get(localStorage,CONSENT) === null && /^(\/|\/index\.html|\/knowledge(?:-lab)?\.html)$/.test(location.pathname)) {
        const box=document.createElement('aside'); box.id='emuAnalyticsChoice'; box.setAttribute('aria-label','利用状況の計測');
        box.style.cssText='position:fixed;left:12px;right:12px;bottom:84px;z-index:2900;max-width:520px;margin:auto;padding:14px;border:1px solid #d8d3ca;border-radius:12px;background:#fff;color:#25241e;box-shadow:0 4px 20px #0002;font:14px/1.6 sans-serif';
        box.innerHTML='<p style="margin:0 0 8px">使いやすさの改善のため、匿名の利用状況を計測してよいですか？ 投稿や検索の内容は送りません。</p><a href="/privacy.html#usage-measurement">詳しく見る・設定</a> <button type="button" data-analytics-consent="yes" style="min-height:44px;margin:4px;padding:8px 16px">許可する</button><button type="button" data-analytics-consent="no" style="min-height:44px;padding:8px 16px">許可しない</button>';
        document.body.appendChild(box);
      }
      document.querySelectorAll('[data-analytics-consent]').forEach(button=>button.addEventListener('click',()=>{
        core.consent(button.dataset.analyticsConsent==='yes'); document.getElementById('emuAnalyticsChoice')?.remove(); updateStatus();
      }));
      updateStatus();
    }
    function updateStatus(){const el=document.getElementById('analyticsConsentStatus');if(el)el.textContent=dnt()?'ブラウザのプライバシー設定に従い停止中です。':core.permitted()?'このブラウザでは許可しています。':'このブラウザでは停止しています。';}
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',consentUI,{once:true}); else consentUI();
  }
  const completedRounds = new Map();
  let candidate=null,lastView='';
  function showView() {
    const on=visible();
    if (!on) {lastView='';return;}
    if (candidate && core.permitted()) {
      const signature=candidate.name+':'+candidate.key;
      if(signature!==lastView && core.track(candidate.name,candidate.values))lastView=signature;
    }
  }
  window.EmuAnalytics = {
    _core:core,
    observeQuestCompletion(localKey, rounds) {
      if (!Number.isInteger(rounds) || rounds < 0) return;
      const previous=completedRounds.get(localKey);
      completedRounds.set(localKey,rounds);
      // First snapshot establishes a baseline. Never count historical approvals as a new completion.
      if (previous !== undefined && rounds > previous) core.track('quest_complete',{},localKey+':'+rounds);
    },
    track:(name,values,key)=>core.track(name,values,key),
    view(name,values,key=''){candidate={name,values,key};showView();},
    consent:allowed=>core.consent(allowed), setTestTraffic:value=>core.setTestTraffic(value),
    flush:()=>core.flush(), status:()=>({allowed:core.permitted(),delivery:core.delivery})
  };
  setInterval(showView,1000);
  window.addEventListener('emu-analytics-consent',showView);
  } catch (_) { /* Analytics never blocks the service, including restricted storage environments. */ }
})();
