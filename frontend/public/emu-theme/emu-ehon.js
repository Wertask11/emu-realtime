/* emu-ehon.js — 絵本の見た目の小さな手伝い（HTML は変えない）
   1) ギルドの中の見出し（黒いカード）に、どのギルドかの印 data-ehon-guild を付ける → emu-ehon.css が絵を切り替える
   画面がテンプレートで描き直されても付け直せるように、変化を見張る。 */
(function(){
  var MAP={LEARN:'learn',WORK:'work',PLAY:'play',CONNECT:'connect',WEB3:'web3'};
  function tag(){
    document.querySelectorAll('[data-tour="guild-detail"]').forEach(function(n){
      var hero=n.closest('[style*="background:#141310"]'); if(!hero) return;
      var key=MAP[(n.textContent||'').trim().toUpperCase()]||'';
      if(key&&hero.getAttribute('data-ehon-guild')!==key) hero.setAttribute('data-ehon-guild',key);
    });
  }
  var t=null;function soon(){clearTimeout(t);t=setTimeout(tag,30);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tag);else tag();
  new MutationObserver(soon).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
})();
