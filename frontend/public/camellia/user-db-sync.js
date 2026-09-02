/* Camellia の端末側の記録（表示用の写し）。
   本物は Firestore に置く。ここはその写し。

   以前は Sora(A-026)・Rin(A-031) という架空の利用者を勝手に作っていた。
   画面を作るための見本だったが、本番では邪魔になるので消した。
   すでに作られてしまったぶんも、開いたときに1度だけ片づける。
   片づけるのは「架空ユーザー」の印が付いたものだけ。本物には触らない。 */
(()=>{const DB_KEY='camellia-users-db',CURRENT_KEY='camellia-current-user-id';
/* 架空の見本を片づける。印（occupation が「架空ユーザー」）が付いたものだけ。 */
function sweepDemo(value){let hit=false;Object.keys(value.users||{}).forEach(id=>{const u=value.users[id]||{};if((u.profile||{}).occupation==='架空ユーザー'){delete value.users[id];hit=true;try{if(localStorage.getItem(CURRENT_KEY)===id)localStorage.removeItem(CURRENT_KEY)}catch(e){}}});if(hit)try{localStorage.setItem(DB_KEY,JSON.stringify(value))}catch(e){}return value}
function db(){const value=JSON.parse(localStorage.getItem(DB_KEY)||'null')||{version:2,users:{}};return sweepDemo(value)}function nextId(users){const max=Math.max(0,...Object.keys(users).map(x=>Number(x.replace(/D/g,''))||0));return`A-${String(max+1).padStart(3,'0')}`}function age(date){const b=new Date(date),n=new Date();let a=n.getFullYear()-b.getFullYear();if(n.getMonth()<b.getMonth()||(n.getMonth()===b.getMonth()&&n.getDate()<b.getDate()))a--;return a}
/* 旧: 表示名・メールアドレス・生年月日で自前のアカウントを作る画面。
   SchoolParkパスポートに寄せたので、まるごと不要になった。 */
function sync(){const id=localStorage.getItem(CURRENT_KEY);if(!id)return;const store=db(),account=JSON.parse(localStorage.getItem('camellia-v2')||'{}'),old=store.users[id]||{};store.users[id]={...old,id,name:account.profile?.displayName||old.name||'Camellia User',profile:{...(old.profile||{}),...(account.profile||{})},settings:account.settings||old.settings||{},online:true,lastSeen:new Date().toISOString(),trust:old.trust??0,reward:old.reward??0,location:account.location||null,daily:JSON.parse(localStorage.getItem('camellia-daily-full')||'null'),dailyHistory:JSON.parse(localStorage.getItem('camellia-daily-history')||'[]'),personality:JSON.parse(localStorage.getItem('camellia-personality-full')||'{}'),imports:account.imports||{},chats:account.chats||[],community:JSON.parse(localStorage.getItem('camellia-community-local')||'[]'),avatar:localStorage.getItem('camellia-profile-avatar')||null};localStorage.setItem(DB_KEY,JSON.stringify(store))}/* 自前の登録はやめた。ログインとパスポートは camellia-gate.js が見る。
   門を通った人だけ、この端末の記録を作る（表示用の写し）。 */
window.CamelliaGateDone=function(CA){
  if(!localStorage.getItem(CURRENT_KEY)){
    const store=db(),id=nextId(store.users);
    const name=(CA.account&&CA.account.displayName)||"";
    const birth=(CA.profile&&CA.profile.birthDate)||"";
    store.users[id]={id,name:name||"Camellia User",passport:CA.passport,
      registeredAt:new Date().toISOString(),
      profile:{displayName:name,birthDate:birth,
        birthYear:birth?String(new Date(birth).getFullYear()):"",occupation:"",goal:""},
      settings:{saveData:true,allowLocation:true,useImported:true,externalLlm:true},
      online:true,lastSeen:new Date().toISOString(),trust:0,reward:0,location:null,
      daily:null,dailyHistory:[],personality:{},imports:{},chats:[],community:[]};
    localStorage.setItem(DB_KEY,JSON.stringify(store));
    localStorage.setItem(CURRENT_KEY,id);
    const account=JSON.parse(localStorage.getItem("camellia-v2")||"{}");
    account.profile={...(account.profile||{}),displayName:name,
      birthDate:birth,birthYear:birth?String(new Date(birth).getFullYear()):""};
    account.passport=CA.passport;
    localStorage.setItem("camellia-v2",JSON.stringify(account));
  }
  sync();
};
setInterval(()=>{if(localStorage.getItem(CURRENT_KEY))sync()},1000)})();
