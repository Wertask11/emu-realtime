/* Unified shell only. Existing parent actions remain the source of auth, plans, records and rewards. */
(function () {
  'use strict';
  const ROUTES = {
    read:{tab:'emuFeedTab',title:'知識を読む'},search:{tab:'emuRequestsTab',title:'知識を探す'},
    practice:{tab:'emuPracticeTab',title:'知識を試す'},wisdom:{tab:'emuWisdomTab',title:'知恵ライブラリ'},city:{tab:'emuCityTab',title:'City'}
  };
  const SCREENS = new Set(['logs','guild','experiments','detail','library','city','tasks','yeargoals','propose']);
  const CLASSES = ['emu-knowledge-open','emu-requests-open','emu-profile-open','emu-practice-open','emu-workspace-open','emu-today-open'];
  let current='read', opening=null, requestedScreen='', sequence=0;
  function remember(view) {
    const u=new URL(location.href);u.searchParams.set('view',view);
    history.replaceState(history.state,'',u.pathname+u.search+u.hash);
  }
  function activate(view, workspace=false) {
    if (!ROUTES[view]) return;
    if (!workspace) { sequence++;opening=null;requestedScreen=''; }
    current=view;
    document.body.classList.add('emu-unified');
    document.body.classList.remove(...CLASSES);
    document.body.classList.add(workspace?'emu-workspace-open':view==='read'?'emu-knowledge-open':view==='search'?'emu-requests-open':'emu-practice-open');
    if (!workspace)document.body.classList.remove('sp-dao-open','sp-dao-sidebar');
    window._setEmuHomeTab?.(ROUTES[view].tab);
    const title=document.getElementById('emuPageTitle');if(title){title.removeAttribute('data-i18n');title.textContent=ROUTES[view].title;}
    document.title=ROUTES[view].title+' | Emu for SchoolPark';
    document.querySelectorAll('[data-unified-view]').forEach(el=>{const on=el.dataset.unifiedView===view;el.classList.toggle('active',on);if(on)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
    remember(view);fit();
  }
  function fit() {
    const head=document.querySelector('#emuTodayHome > .eth-topbar');
    const side=document.getElementById('emuSideNav');
    const top=head?.getBoundingClientRect().bottom || document.querySelector('#mainApp > header')?.getBoundingClientRect().bottom || 100;
    const left=side && getComputedStyle(side).display!=='none'?side.getBoundingClientRect().right:0;
    document.documentElement.style.setProperty('--emu-workspace-top',Math.max(0,Math.round(top))+'px');
    document.documentElement.style.setProperty('--emu-workspace-left',Math.max(0,Math.round(left))+'px');
  }
  function practice() {window._emuEnsureAppVisible();activate('practice');window.scrollTo({top:0});}
  async function existing(screen) {
    if(!SCREENS.has(screen))return false;
    if(opening && requestedScreen===screen)return opening;
    requestedScreen=screen;
    const attempt=++sequence;
    const uid=window.auth?.currentUser?.uid;
    opening=(async()=>{
      // Same entry policy as the existing SchoolPark navigation. Opening a screen never commits/joins.
      const access=await window.spEnsureSchoolParkAccess(false);
      if(attempt!==sequence || uid!==window.auth?.currentUser?.uid)return false;
      if(!access?.allowed){window.spShowSchoolParkUnavailable(access);return false;}
      window._emuEnsureAppVisible();
      window.scrollTo({top:0});
      const view=screen==='library'?'wisdom':screen==='city'?'city':'practice';
      activate(view,true);window.openSpDao(screen);
      const frame=document.getElementById('spDaoFrame');
      const start=Date.now();
      let app;
      while(Date.now()-start<12000){
        app=frame?.contentWindow?.app;if(app)break;
        await new Promise(resolve=>setTimeout(resolve,60));
        if(attempt!==sequence || uid!==window.auth?.currentUser?.uid)return false;
      }
      if(!app)throw new Error('活動画面を読み込めませんでした。もう一度お試しください。');
      if(attempt!==sequence || uid!==window.auth?.currentUser?.uid)return false;
      app.go(screen)();fit();
      return true;
    })().catch(error=>{console.warn('Emu navigation:',error.message);window.alert(error.message);return false;}).finally(()=>{if(attempt===sequence){opening=null;requestedScreen='';}});
    return opening;
  }
  function go(view) {
    if(!ROUTES[view])view='read';
    if(view==='practice')return practice();
    if(view==='wisdom')return existing('library');
    if(view==='city')return existing('city');
    sequence++;opening=null;
    if(view==='search')window.showEmuRequests();else window.showEmuFeed();
  }
  function sync(screen) {
    if(!SCREENS.has(screen)||!document.body.classList.contains('emu-workspace-open'))return;
    activate(screen==='library'?'wisdom':screen==='city'?'city':'practice',true);
  }
  async function resumeDialogue() {
    // The existing membership UI offers this URL for scheduled sessions only.
    // Recheck that same server-owned record; do not recreate the retired public directory.
    const uid=window.auth?.currentUser?.uid;
    if(!uid)return false;
    try {
      const response=await window.fetch('https://emu-realtime.onrender.com/api/dialogue/my',{
        headers:await window.emuAuthHeaders(false,{interactive:false}),cache:'no-store'
      });
      const data=await response.json();
      if(uid!==window.auth?.currentUser?.uid)return false;
      if(response.ok && Array.isArray(data.sessions) && data.sessions.some(s=>s.outcome==='scheduled' && (s.venue!=='zoom'||!s.meetingUrl))) {
        window.openRoom3();return true;
      }
    } catch (_) { if(uid!==window.auth?.currentUser?.uid)return false; }
    window.accountGo?.('sessions');return false;
  }
  window.EmuNavigation={activate,go,existing,fit,sync,resumeDialogue,get current(){return current;}};
  window.showEmuPractice=practice;
  window.openEmuPractice=existing;
  window.showEmuWisdom=()=>existing('library');
  window.showEmuCity=()=>existing('city');
  window.addEventListener('resize',fit);
  window.addEventListener('orientationchange',fit);
  const wanted=new URL(location.href).searchParams.get('view');
  // Login and Passport landing remain untouched. Honour a view only after the existing app becomes visible.
  let applied=false, dialogueOpened=false;
  const dialogueRequested=new URL(location.href).searchParams.get('emuDiscussion')==='1';
  const app=document.getElementById('mainApp');
  new MutationObserver(()=>{
    fit();
    if(dialogueRequested && !dialogueOpened && window.auth?.currentUser && app && app.style.display!=='none'){ dialogueOpened=true;queueMicrotask(()=>resumeDialogue()); }
    if(!applied && wanted && ROUTES[wanted] && app && app.style.display!=='none'){
      applied=true;queueMicrotask(()=>go(wanted));
    }
  }).observe(app,{attributes:true,attributeFilter:['style']});
})();
