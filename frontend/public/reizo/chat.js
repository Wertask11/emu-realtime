/* No storage or model key in the browser. Only generated conversation pairs enter history. */
(function(window, document) {
  'use strict';
  var history = [], owner = null, pending = null;
  var endpoint = 'https://emu-realtime.onrender.com/api/reizo/chat';
  function reset(uid) {
    if (pending) pending.abort();
    pending = null; history = []; owner = uid;
  }
  function currentPage() {
    if (document.body.classList.contains('sp-passport-open') || document.body.classList.contains('sp-star-open')) return 'passport';
    if (document.body.classList.contains('sp-dao-open')) {
      try {
        var app = document.getElementById('spDaoFrame').contentWindow.app;
        return { home:'home', logs:'guild', guild:'guild', experiments:'quest', detail:'quest-detail', library:'wisdom', park:'park', plaza:'plaza', members:'contrib', treasury:'treasury', city:'city', tasks:'tasks', yeargoals:'year-goals' }[app.state.screen] || '';
      } catch (_) { return ''; }
    }
    var classes = { 'emu-knowledge-open':'emu-read', 'emu-requests-open':'emu-search', 'emu-ichinichi-open':'emu-share', 'emu-discussion-open':'emu-debate' };
    return Object.keys(classes).map(function(key) { return document.body.classList.contains(key) ? classes[key] : ''; }).find(Boolean) || '';
  }
  async function ask(message) {
    var user = window.auth && window.auth.currentUser;
    if (!user) { reset(null); throw Error('AUTH_REQUIRED'); }
    if (owner !== user.uid) reset(user.uid);
    if (pending) throw Error('BUSY');
    var controller = new AbortController(); pending = controller;
    var page = currentPage();
    var timer;
    var deadline = new Promise(function(_, reject) {
      // A little longer than the server's own limit (backend/reizo/chat.js GENERATE_TIMEOUT_MS = 25s).
      timer = setTimeout(function() { controller.abort(); reject(Object.assign(Error('TIMEOUT'), { category:'timeout' })); }, 30000);
    });
    try {
      return await Promise.race([deadline, (async function() {
        var token = await user.getIdToken();
        if (controller.signal.aborted) throw Error('CANCELLED');
        var response = await fetch(endpoint, {
          method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token },
          signal:controller.signal,
          body:JSON.stringify({ message:message, history:history.slice(-6), currentPage:page })
        });
        if (!response.ok) {
          // Only the server's short category (timeout / rate_limited / ...) is read, to choose the words shown.
          var category = '';
          try { category = String((await response.json()).category || ''); } catch (_) {}
          throw Object.assign(Error('AI_UNAVAILABLE'), { category:category });
        }
        var data = await response.json();
        if (!data || data.provider !== 'gemini' || typeof data.reply !== 'string' || !data.reply.trim()) throw Error('EMPTY_REPLY');
        if (controller.signal.aborted || !window.auth.currentUser || window.auth.currentUser.uid !== user.uid) throw Error('SESSION_CHANGED');
        history.push({ role:'user',text:message.slice(0,500) }, { role:'assistant',text:data.reply.slice(0,500) });
        history = history.slice(-6);
        return data.reply.slice(0,700);
      })()]);
    } finally {
      clearTimeout(timer);
      if (pending === controller) pending = null;
    }
  }
  window.ReizoChat = { ask:ask, currentPage:currentPage, reset:function() { reset(null); } };
  // The existing Firebase initialization happens later in index.html.
  window.addEventListener('load', function() {
    if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
      window.auth.onAuthStateChanged(function(user) {
        var uid = user ? user.uid : null;
        if (owner !== uid) reset(uid);
      });
    }
  });
})(window, document);
