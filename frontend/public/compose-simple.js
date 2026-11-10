/* 投稿フォームをシンプルに（11/10）。knowledge.html の投稿画面で読み込む。
   - 折りたたんだテーマの見出しに、いま選んでいるテーマを出す。選んだら閉じる。
   - 予約の日時欄は、はじめは出さない。「予約投稿」を押したときに出し、日時を選んでからもう一度押すと予約する。
   - 投稿画面を閉じたら、日時欄をまたしまう。 */
(function () {
  'use strict';
  function q(s) { return document.querySelector(s); }
  function syncTheme() {
    var now = q('[data-theme-now]'), active = q('#composeThemes button.active'), fold = q('#composeThemeFold');
    if (now && active && now.textContent !== active.textContent) now.textContent = active.textContent;
    if (fold && active && fold.hidden !== false) fold.hidden = false;
  }
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    if (t.closest('#composeThemes button')) { setTimeout(function () { syncTheme(); var f = q('#composeThemeFold'); if (f) f.open = false; }, 0); return; }
    var s = t.closest('#schedule');
    if (s) {
      var field = q('#scheduleField');
      if (field && field.hidden) {
        e.preventDefault(); e.stopPropagation();
        field.hidden = false;
        var input = q('#scheduledAt'); if (input) { input.focus(); try { input.showPicker && input.showPicker(); } catch (_) {} }
        if (typeof notify === 'function') notify('公開する日時を選んで、もう一度「予約投稿」を押してね');
      }
    }
  }, true);
  function watch() {
    var themes = q('#composeThemes'), composer = q('#composer');
    if (themes && typeof MutationObserver === 'function') new MutationObserver(syncTheme).observe(themes, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    if (composer && typeof MutationObserver === 'function') {
      var wasOpen = composer.classList.contains('open');
      new MutationObserver(function () {
        var open = composer.classList.contains('open');
        if (wasOpen && !open) { var f = q('#scheduleField'); if (f) f.hidden = true; var fold = q('#composeThemeFold'); if (fold) fold.open = false; }
        wasOpen = open;
      }).observe(composer, { attributes: true, attributeFilter: ['class'] });
    }
    syncTheme();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
