/* Modeless, read-only guidance. No network, account identifiers, or automatic app clicks. */
(function (window, document) {
  'use strict';
  if (window.ReizoTour) return;
  var KEY = 'rk-tour-v1', definitions = new Map(), listeners = new Set();
  var state = { version: 1, tours: Object.create(null) }, storageAvailable = true;
  var active = null, currentScreen = null, generation = 0, cleanup = [], raf = 0, timeout = 0;
  var targetObserver = null, observedTarget = null, scrolled = false;
  var activeDocuments = [];
  var ui = null, source = null, sourceSelector = '', sourceDocument = document, sourceRestore = null, pendingNavigation = 0, navigationSequence = 0;
  var STATES = ['not_started', 'in_progress', 'done', 'skipped'];
  try {
    var raw = window.localStorage.getItem(KEY);
    if (raw) {
      var value = JSON.parse(raw);
      if (!value || value.version !== 1 || !value.tours || typeof value.tours !== 'object' || Array.isArray(value.tours)) throw new Error('version');
      Object.keys(value.tours).forEach(function (id) {
        var item = value.tours[id];
        if (/^(sp|emu)-[a-z-]+$/.test(id) && item && STATES.includes(item.state) && Number.isSafeInteger(item.index) && item.index >= 0)
          state.tours[id] = { state: item.state, index: item.index };
      });
    }
  } catch (error) {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (ignored) { storageAvailable = false; }
  }
  function emit(name, properties) {
    // Local development diagnostics only. Never forward to existing analytics.
    if (['localhost', '127.0.0.1'].includes(window.location.hostname) && window.console && window.console.debug)
      window.console.debug('[ReizoTour]', name, properties || {});
  }
  function notify() { listeners.forEach(function (fn) { fn(); }); }
  function save(id, status, index) {
    state.tours[id] = { state: status, index: index };
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (error) { storageAvailable = false; }
    notify();
  }
  function progress(id) {
    if (!id) {
      var all = Object.create(null);
      definitions.forEach(function (_, key) { all[key] = progress(key); });
      return all;
    }
    var def = definitions.get(id), item = state.tours[id];
    var total = def ? def.steps.length : 0;
    return { state: item ? item.state : 'not_started', index: Math.min(item ? item.index : 0, Math.max(0, total - 1)), total: total };
  }
  function node(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function button(text, action, label) {
    var el = node('button', '', text); el.type = 'button'; el.onclick = action;
    if (label) el.setAttribute('aria-label', label);
    return el;
  }
  function mount() {
    if (ui) return;
    var root = node('div', 'rk-tour'); root.id = 'rk-tour';
    var spot = node('div', 'rk-spotlight'); spot.setAttribute('aria-hidden', 'true');
    var panel = node('section', 'rk-panel');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'rk-tour-title');
    var header = node('div', 'rk-header');
    var mascot = node('img', 'rk-mascot'); mascot.src = '/assets/mascot.jpg'; mascot.alt = '';
    var identity = node('div'); identity.append(node('small', '', '冷蔵庫くんの画面ガイド'));
    var title = node('h2'); title.id = 'rk-tour-title'; identity.append(title);
    var close = button('×', function () { pause(); }, 'ガイドをあとで閉じる'); close.className = 'rk-close';
    header.append(mascot, identity, close);
    var text = node('p', 'rk-text'), count = node('p', 'rk-count'), status = node('p', 'rk-status');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    var actions = node('div', 'rk-actions');
    var back = button('戻る', backStep), next = button('次へ', nextStep);
    next.className = 'rk-primary';
    var skip = button('スキップ', skipTour), later = button('あとで閉じる', function () { pause(); });
    actions.append(back, next, skip, later);
    panel.append(header, count, text, status, actions);
    var toast = node('p', 'rk-toast'); toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
    root.append(spot, panel, toast); document.body.append(root);
    ui = {root:root, spot:spot, panel:panel, title:title, text:text, count:count, status:status, back:back, next:next, skip:skip, later:later, toast:toast};
    panel.hidden = true; spot.hidden = true; toast.hidden = true;
  }
  function announce(text) {
    mount(); ui.toast.textContent = text; ui.toast.hidden = false;
    window.clearTimeout(ui.toastTimer);
    ui.toastTimer = window.setTimeout(function () { ui.toast.hidden = true; }, 6000);
  }
  function watch(target, fn, type, options) {
    target.addEventListener(type, fn, options);
    cleanup.push(function () { target.removeEventListener(type, fn, options); });
  }
  function stopWatching() {
    generation++; window.clearTimeout(timeout); timeout = 0;
    if (raf) window.cancelAnimationFrame(raf); raf = 0;
    cleanup.splice(0).forEach(function (fn) { fn(); });
    targetObserver = null; observedTarget = null;
    activeDocuments = [];
  }
  function restoreFocus() {
    var el = source;
    if ((!el || !el.isConnected) && sourceSelector) {
      try { el = sourceDocument.querySelector(sourceSelector); } catch (ignored) {}
    }
    if (sourceRestore) { try { sourceRestore(el); } catch (ignored) {} }
    if (el && el.isConnected && typeof el.focus === 'function') el.focus({ preventScroll: true });
    source = null; sourceSelector = ''; sourceRestore = null; sourceDocument = document;
  }
  function close(restore) {
    stopWatching(); active = null;
    if (ui) { ui.panel.hidden = true; ui.spot.hidden = true; }
    if (restore !== false) restoreFocus();
  }
  function pause(restore) {
    if (active) { save(active.id, 'in_progress', active.index); emit('tour_pause', {screen:active.id, step:active.index}); }
    close(restore);
  }
  function visible(el) {
    if (!el || !el.isConnected) return false;
    var w = el.ownerDocument.defaultView, r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && w.getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[inert]');
  }
  function documentsFor(def) {
    try { return (def.options.getDocuments ? def.options.getDocuments() : [document]).filter(Boolean); }
    catch (error) { return []; }
  }
  function findTarget(def, step) {
    for (var doc of documentsFor(def)) {
      try {
        var candidates = doc.querySelectorAll(step.target);
        for (var candidate of candidates) if (visible(candidate)) return candidate;
      } catch (ignored) {}
    }
    return null;
  }
  function parentRect(el) {
    var rect = el.getBoundingClientRect(), owner = el.ownerDocument.defaultView;
    var r = {left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom};
    while (owner && owner !== window) {
      var frame = owner.frameElement; if (!frame) return null;
      var f = frame.getBoundingClientRect();
      if (!visible(frame)) return null;
      var sx = f.width / (frame.offsetWidth || f.width), sy = f.height / (frame.offsetHeight || f.height);
      r = {
        left:Math.max(f.left, f.left + (r.left + frame.clientLeft) * sx),
        right:Math.min(f.right, f.left + (r.right + frame.clientLeft) * sx),
        top:Math.max(f.top, f.top + (r.top + frame.clientTop) * sy),
        bottom:Math.min(f.bottom, f.top + (r.bottom + frame.clientTop) * sy)
      };
      owner = frame.ownerDocument.defaultView;
    }
    var vp = window.visualViewport;
    var x = vp ? vp.offsetLeft : 0, y = vp ? vp.offsetTop : 0;
    r.left = Math.max(x, r.left); r.top = Math.max(y, r.top);
    r.right = Math.min(x + (vp ? vp.width : window.innerWidth), r.right);
    r.bottom = Math.min(y + (vp ? vp.height : window.innerHeight), r.bottom);
    if (r.right <= r.left || r.bottom <= r.top) return null;
    r.width = r.right - r.left; r.height = r.bottom - r.top;
    return r;
  }
  function setStyle(el, values) {
    Object.keys(values).forEach(function (key) { if (el.style[key] !== values[key]) el.style[key] = values[key]; });
  }
  function position(el) {
    if (!ui || ui.panel.hidden) return;
    var r = el && parentRect(el), vp = window.visualViewport;
    var vw = vp ? vp.width : window.innerWidth, vh = vp ? vp.height : window.innerHeight;
    var vx = vp ? vp.offsetLeft : 0, vy = vp ? vp.offsetTop : 0;
    var width = Math.min(vw - 16, vw >= 1024 ? 330 : 480);
    setStyle(ui.panel, {width:width + 'px', maxHeight:Math.max(160, vh - 24) + 'px'});
    var h = ui.panel.getBoundingClientRect().height, gap = 14, point = null;
    if (r && vw >= 1024) {
      var candidates = [[r.right+gap,r.top],[r.left-width-gap,r.top],[r.left,r.bottom+gap],[r.left,r.top-h-gap]];
      point = candidates.find(function (p) { return p[0] >= vx+8 && p[0]+width <= vx+vw-8 && p[1] >= vy+8 && p[1]+h <= vy+vh-8; });
    }
    if (!point) {
      var avoid = 0;
      var def = active && definitions.get(active.id);
      if (def && def.options.bottomInset) { try { avoid = def.options.bottomInset(); } catch (ignored) {} }
      var bottom = vy + vh - Math.max(8, avoid + 8), top = bottom - h;
      if (r && top < r.bottom + gap && bottom > r.top - gap) {
        // Prefer the header side when the normal bottom sheet would cover the target.
        if (r.top >= vy + h + gap + 8) top = vy + 8;
        else {
          var spaceAbove = r.top-vy-gap-8, spaceBelow = bottom-r.bottom-gap;
          if (Math.max(spaceAbove, spaceBelow) >= 160) {
            setStyle(ui.panel, {maxHeight:Math.max(spaceAbove, spaceBelow) + 'px'});
            h = ui.panel.getBoundingClientRect().height;
            top = spaceAbove > spaceBelow ? vy + 8 : r.bottom + gap;
          } else {
            // Large content areas cannot fit beside a sheet: move only the relevant scroll container.
            var owner = el.ownerDocument.defaultView;
            var scroll = el.parentElement;
            while (scroll && !/(auto|scroll)/.test(owner.getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement;
            var delta = r.bottom - top + gap;
            if (scroll && scroll.scrollHeight > scroll.clientHeight && delta > 0) scroll.scrollTop += delta;
            else if (delta > 0 && el.ownerDocument.documentElement.scrollHeight > owner.innerHeight) owner.scrollBy(0, delta);
            r = parentRect(el);
          }
        }
      }
      point = [vx + (vw-width)/2, Math.max(vy+8, top)];
    }
    setStyle(ui.panel, {left:Math.round(point[0])+'px', top:Math.round(point[1])+'px'});
    ui.spot.hidden = !r;
    if (r) setStyle(ui.spot, {left:Math.round(r.left-6)+'px', top:Math.round(r.top-6)+'px', width:Math.round(r.width+12)+'px', height:Math.round(r.height+12)+'px'});
  }
  function refresh() {
    if (!active || raf) return;
    raf = window.requestAnimationFrame(function () {
      raf = 0; if (!active) return;
      var def = definitions.get(active.id), step = def.steps[active.index];
      var docs = documentsFor(def);
      if (docs.length !== activeDocuments.length || docs.some(function (doc, i) { return doc !== activeDocuments[i]; })) {
        // An iframe navigation replaces its Document, unlike a template redraw.
        // Rebind listeners so the first real filter click is observed exactly once.
        prepare(); return;
      }
      var el = findTarget(def, step);
      if (el && !scrolled) { el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'}); scrolled = true; }
      if (targetObserver && el !== observedTarget) {
        if (observedTarget) targetObserver.unobserve(observedTarget);
        if (el) targetObserver.observe(el); observedTarget = el;
      }
      if (el && parentRect(el)) {
        window.clearTimeout(timeout); timeout = 0;
        ui.status.textContent = storageAvailable ? '' : 'このブラウザでは進捗を保存できません。案内はこのまま使えます。';
        position(el);
      } else {
        position(null); ui.spot.hidden = true;
        ui.status.textContent = '画面の読み込みを待っています。次へでも進めます。';
        if (!timeout) {
          var token = generation;
          timeout = window.setTimeout(function () {
            if (!active || token !== generation) return;
            emit('tour_target_missing', {screen:active.id, step:active.index});
            announce('対象が見つからないため、このステップを飛ばしました。'); nextStep({missing:true});
          }, 2500);
        }
      }
    });
  }
  function prepare() {
    stopWatching(); mount();
    var def = definitions.get(active.id), step = def.steps[active.index];
    ui.panel.hidden = false; ui.panel.classList.remove('rk-choice');
    ui.title.textContent = step.label; ui.text.textContent = step.text;
    ui.count.textContent = def.options.label + ' · ' + (active.index+1) + ' / ' + def.steps.length;
    ui.status.textContent = ''; ui.back.disabled = active.index === 0;
    ui.next.textContent = active.index === def.steps.length-1 ? '完了' : '次へ';
    ui.next.disabled = false; ui.later.textContent = 'あとで閉じる';
    [ui.back,ui.next,ui.skip,ui.later].forEach(function (el) { el.hidden = false; });
    ui.next.onclick = nextStep; ui.later.onclick = function () { pause(); };
    var el = findTarget(def, step); scrolled = false;
    var token = generation;
    var docs = documentsFor(def), observed = new Set();
    activeDocuments = docs;
    docs.concat([document]).forEach(function (doc) {
      if (observed.has(doc)) return; observed.add(doc);
      watch(doc, refresh, 'scroll', true);
      watch(doc, function (event) { if (event.key === 'Escape' && active) { event.preventDefault(); pause(); } }, 'keydown');
      if (doc.defaultView) watch(doc.defaultView, refresh, 'resize');
      if (window.MutationObserver && doc.body) {
        var mo = new window.MutationObserver(function (records) {
          if (records.some(function (record) { return !ui.root.contains(record.target); })) refresh();
        });
        mo.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});
        cleanup.push(function () { mo.disconnect(); });
      }
      // Read a verified state after native handlers; never suppress or repeat a click.
      if (step.advanceOn && typeof step.advanceOn.read === 'function') watch(doc, function (event) {
        var target = findTarget(def, step);
        if (!target || !target.contains(event.target)) return;
        var before; try { before = step.advanceOn.read(); } catch (error) { return; }
        window.requestAnimationFrame(function () {
          if (!active || token !== generation) return;
          var after; try { after = step.advanceOn.read(); } catch (error) { return; }
          if (after !== before) { emit('tour_step_advance',{screen:active.id,step:active.index,method:'native_state_change'}); nextStep(); }
        });
      }, 'click', true);
    });
    if (window.visualViewport) { watch(window.visualViewport, refresh, 'resize'); watch(window.visualViewport, refresh, 'scroll'); }
    if (window.ResizeObserver) {
      var ro = new window.ResizeObserver(refresh); ro.observe(ui.panel);
      targetObserver = ro; observedTarget = el;
      if (el) ro.observe(el);
      docs.forEach(function (doc) { if (doc.defaultView && doc.defaultView.frameElement) ro.observe(doc.defaultView.frameElement); });
      cleanup.push(function () { ro.disconnect(); });
    }
    save(active.id,'in_progress',active.index); emit('tour_step_view',{screen:active.id,step:active.index});
    ui.next.focus({preventScroll:true}); refresh();
  }
  function start(id, index, invoker) {
    var def = definitions.get(id); if (!def) return false;
    if (def.options.isActive && !def.options.isActive()) return false;
    if (active) pause(false);
    mount(); source = invoker || document.activeElement; sourceDocument = source && source.ownerDocument || document;
    sourceSelector = ''; sourceRestore = def.options.restoreFocus || null;
    if (source && source.dataset.rkSource) sourceSelector = '[data-rk-source="'+source.dataset.rkSource+'"]';
    else if (source && source.dataset.tour) sourceSelector = '[data-tour~="'+source.dataset.tour.split(' ')[0]+'"]';
    active = {id:id,index:Number.isInteger(index)?Math.min(Math.max(0,index),def.steps.length-1):0};
    // Manual replay can finish navigation before its queued DOM observer runs.
    // Acknowledge the already verified screen so that observer does not pause the new guide.
    currentScreen = id;
    emit('tour_start',{screen:id}); prepare(); return true;
  }
  function nextStep(reason) {
    if (!active) return;
    var def = definitions.get(active.id);
    if (active.index === def.steps.length-1) {
      save(active.id,'done',active.index); emit('tour_complete',{screen:active.id}); close();
      announce((reason && reason.missing ? '対象が見つからないため、このステップを飛ばしました。' : '') + 'この画面のガイドを見終わりました。サポートからいつでも見返せます。');
    } else { active.index++; prepare(); }
  }
  function backStep() { if (active && active.index > 0) { active.index--; emit('tour_back',{screen:active.id,step:active.index}); prepare(); } }
  function skipTour() { if (active) { save(active.id,'skipped',active.index); emit('tour_skip',{screen:active.id}); close(); } }
  function enter(id) {
    if (id === currentScreen) { refresh(); return; }
    if (active) pause(false);
    else if (ui && ui.panel.classList.contains('rk-choice')) close(false);
    currentScreen = id;
    if (!id || pendingNavigation || !definitions.has(id)) return;
    if (progress(id).state === 'not_started') start(id);
  }
  async function navigate(id, restart, invoker) {
    var def = definitions.get(id); if (!def) return false;
    invoker = invoker || document.activeElement;
    var request = ++navigationSequence; pendingNavigation = request;
    if (active) pause(false);
    try {
      if (def.options.navigate) await def.options.navigate();
      if (request !== pendingNavigation) return false;
      if (def.options.isActive && !def.options.isActive()) throw new Error('この画面へ移動できませんでした。入れる画面からお試しください。');
      return start(id,restart?0:progress(id).state==='in_progress'?progress(id).index:0,invoker);
    } catch (error) {
      announce(error.message || 'この画面のガイドを開けませんでした。'); return false;
    } finally { if (request === pendingNavigation) pendingNavigation = 0; }
  }
  function resume(id) {
    if (!id) id = definitions.has(currentScreen) && progress(currentScreen).state === 'in_progress' ? currentScreen
      : Array.from(definitions.keys()).find(function (key) { return progress(key).state === 'in_progress'; });
    return id ? navigate(id,false) : Promise.resolve(false);
  }
  function choose(id, onChat, originalSource) {
    if (active) pause(false); else close(false); mount();
    source = originalSource || document.activeElement;
    sourceSelector = ''; sourceRestore = null;
    ui.panel.hidden = false; ui.spot.hidden = true; ui.panel.classList.add('rk-choice');
    ui.title.textContent = '冷蔵庫くん'; ui.count.textContent = '今の画面で、何を見たい？';
    ui.text.textContent = '操作の案内を見ることも、いつものチャットで質問することもできます。'; ui.status.textContent = '';
    ui.back.hidden = true; ui.skip.hidden = true; ui.next.hidden = false; ui.later.hidden = false;
    ui.next.textContent = definitions.has(id) ? 'この画面のガイドを見る' : 'この画面のガイドは準備中'; ui.next.disabled = !definitions.has(id);
    ui.next.onclick = function () { var invoker = source; close(false); navigate(id,false,invoker); };
    ui.later.textContent = '冷蔵庫くんに聞く'; ui.later.onclick = function () { close(false); onChat(); };
    setStyle(ui.panel,{width:Math.min(window.innerWidth-16,330)+'px',maxHeight:'calc(100dvh - 24px)',top:'16px',left:Math.max(8,window.innerWidth-Math.min(window.innerWidth-16,330)-16)+'px'});
    var escape = function (event) { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    watch(document,escape,'keydown'); if (originalSource) watch(originalSource.ownerDocument,escape,'keydown');
    ui.next.focus();
  }
  window.ReizoTour = {
    register:function (id, steps, options) {
      if (!/^(sp|emu)-[a-z-]+$/.test(id) || !Array.isArray(steps) || !steps.length || steps.some(function (step) { return !step || typeof step.target !== 'string' || typeof step.label !== 'string' || typeof step.text !== 'string'; })) throw new Error('Invalid tour definition');
      definitions.set(id,{steps:steps.slice(),options:Object.assign({label:id,brand:id.startsWith('sp-')?'SchoolPark':'Emu'},options)}); notify();
    },
    start:start,next:nextStep,back:backStep,skip:skipTour,later:function () { pause(); },progress:progress,
    resume:resume,restart:function (id) { emit('tour_restart',{screen:id}); return navigate(id,true); },
    enter:enter,refresh:refresh,pause:pause,navigate:navigate,choose:choose,announce:announce,
    current:function () { return currentScreen; },
    list:function () { return Array.from(definitions, function (entry) { return {id:entry[0],label:entry[1].options.label,brand:entry[1].options.brand,total:entry[1].steps.length}; }); },
    subscribe:function (fn) { listeners.add(fn); return function () { listeners.delete(fn); }; }
  };
})(window, document);
