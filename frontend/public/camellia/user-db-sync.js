(()=>{const DB_KEY='camellia-users-db',CURRENT_KEY='camellia-current-user-id';function seed(id,name,mbti,animal,n){const history=[];for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);history.push({date:d.toISOString().slice(0,10),mood:i%2?'😊 穏やか':'🙂 普通',anxiety:(i+n)%8,stress:(i*2+n)%9,loneliness:(i+n)%6,motivation:7-i%3,irritability:i%5,concentration:7-i%3,sleep:6.5,sleepQuality:'🙂 普通',need:'休息',mindNote:'架空の履歴',painPlace:'肩',pain:i%5,fatigue:(i+n)%8,energy:7-i%4,temperature:'36.5',appetite:'普通',cycle:'月経後',lastMenstrualDate:'2026-08-18',symptoms:'肩こり',medication:'なし',bodyNote:'架空の記録',savedAt:new Date().toISOString()})}return{id,name,email:`${name.toLowerCase()}@example.local`,registeredAt:new Date().toISOString(),profile:{displayName:name,birthYear:id==='A-026'?'1992':'1998',occupation:'架空ユーザー',goal:'心身のリズムを整える'},settings:{saveData:true,allowLocation:true,useImported:true,externalLlm:true},online:false,lastSeen:new Date().toISOString(),trust:id==='A-026'?84:66,reward:id==='A-026'?3910:1760,daily:history.at(-1),dailyHistory:history,personality:{bigFive:{extraversion:60+n,agreeableness:75,conscientiousness:70,emotionalStability:55,openness:68},enneagram:{type:id==='A-026'?2:7,scores:[3,5,3,2,3,4,5,2,4]},yg:'架空結果',mbti,animal},imports:{},chats:[],community:[]}}
function db(){const value=JSON.parse(localStorage.getItem(DB_KEY)||'null')||{version:2,users:{}};value.users['A-026']??=seed('A-026','Sora','ISFJ','ひつじ',2);value.users['A-031']??=seed('A-031','Rin','ENFP','ペガサス',5);return value}function nextId(users){const max=Math.max(31,...Object.keys(users).map(x=>Number(x.replace(/\D/g,''))||0));return`A-${String(max+1).padStart(3,'0')}`}function age(date){const b=new Date(date),n=new Date();let a=n.getFullYear()-b.getFullYear();if(n.getMonth()<b.getMonth()||(n.getMonth()===b.getMonth()&&n.getDate()<b.getDate()))a--;return a}
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
