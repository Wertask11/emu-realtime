/* emu-ehon.js — 絵本の見た目の小さな手伝い（HTML は変えない）
   1) ギルドの中の見出し（黒いカード）に data-ehon-guild を付ける → emu-ehon.css が絵を切り替える
   2) 帯・カードの絵（band-*・card-*）を、開くたびに仲間の顔ぶれが違う絵（-2・-3）にランダムで差し替える
   3) 見出しの絵の右下に、冷蔵庫くんの仲間を1体ランダムで出す（20体から）
   4) 隠れ冷蔵庫くん：ときどき（約3回に1回）、画面のどこかのカードのかどから小さくのぞく。押すと喜ぶ
   どれも飾りなので、読み上げ（aria-hidden）・タブ移動の対象にしない。動きを減らす設定ではのぞく動きを止める。
   絵の場所は window.EHON_ASSETS（既定 '/ehon/'）で変えられる。 */
(function(){
  var A=window.EHON_ASSETS||'/ehon/';
  var FRIENDS=['amagaeru','onsen','rabbit','gamer','batter','devil','gentleman','hero','vampire','plain','hunter','winter','ninja','chef','pirate','king','astronaut','cowboy','golden','skeleton'];
  var MAP={LEARN:'learn',WORK:'work',PLAY:'play',CONNECT:'connect',WEB3:'web3'};
  var reduced=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  function pick(a){return a[Math.floor(Math.random()*a.length)];}
  /* その日のうちは同じ顔ぶれ（開くたびに変わりすぎない）。sessionStorage が使えなければ毎回ランダム */
  var memo={};try{memo=JSON.parse(sessionStorage.getItem('ehonPick')||'{}');}catch(e){}
  function keep(k,fn){if(memo[k]==null){memo[k]=fn();try{sessionStorage.setItem('ehonPick',JSON.stringify(memo));}catch(e){}}return memo[k];}

  function tagGuild(){
    document.querySelectorAll('[data-tour="guild-detail"]').forEach(function(n){
      var hero=n.closest('[style*="background:#141310"]');if(!hero)return;
      var key=MAP[(n.textContent||'').trim().toUpperCase()]||'';
      if(key&&hero.getAttribute('data-ehon-guild')!==key)hero.setAttribute('data-ehon-guild',key);
    });
  }
  /* 2) 帯・カード：band-practice-day.webp → band-practice-day-2.webp など */
  var RE=/(\/(?:band-(?:practice|search)-(?:morning|day|night)|card-(?:guild|quest|lab|text)))(?:-[23])?\.webp$/;
  function swapArt(){
    document.querySelectorAll('img[src*="band-"],img[src*="card-"]').forEach(function(img){
      if(img.__ehon)return;var m=img.getAttribute('src').match(RE);if(!m)return;img.__ehon=1;
      var v=keep(m[1],function(){return pick(['','-2','-3']);});
      img.src=img.getAttribute('src').replace(RE,m[1]+v+'.webp');
    });
  }
  /* 3) 見出しの絵に仲間を1体 */
  function addFriend(){
    document.querySelectorAll('[style*="background:#141310"],section[style*="background:var(--emu-brand-strong)"]').forEach(function(hero,i){
      if(hero.querySelector(':scope > .ehon-friend'))return;
      var f=keep('hero'+i,function(){return pick(FRIENDS);});
      var im=document.createElement('img');im.className='ehon-friend';im.alt='';im.setAttribute('aria-hidden','true');im.decoding='async';im.draggable=false;
      im.src=A+'friends/friend-'+f+'.webp';hero.appendChild(im);
    });
  }
  /* 4) 隠れ冷蔵庫くん */
  function hidden(){
    if(document.querySelector('.ehon-peek'))return;
    var go=keep('peek',function(){return Math.random()<.34?1:0;});if(!go)return;
    var cards=[].slice.call(document.querySelectorAll('.card,.side-card,.mix-card,.mix-feed-card,[style*="background:#FBF9F3"]')).filter(function(c){return c.offsetWidth>160;});
    if(!cards.length)return;var host=cards[keep('peekAt',function(){return Math.floor(Math.random()*6);})%cards.length];
    /* style を直接さわると、style の文字が書き直されて絵本の見た目（[style*=…]）が外れるので、クラスで足す */
    if(getComputedStyle(host).position==='static')host.classList.add('ehon-peek-host');
    var b=document.createElement('span');b.className='ehon-peek';b.setAttribute('aria-hidden','true');
    b.style.backgroundImage='url('+A+'common/reizo-wave.webp)';
    b.addEventListener('click',function(e){e.stopPropagation();b.style.backgroundImage='url('+A+'common/reizo-happy.webp)';b.classList.add('found');});
    host.appendChild(b);
  }
  function run(){tagGuild();swapArt();addFriend();hidden();}
  var t=null;function soon(){clearTimeout(t);t=setTimeout(run,40);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
  new MutationObserver(soon).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  if(reduced)document.documentElement.classList.add('ehon-still');
})();
