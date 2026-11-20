// Room requests use the existing signed-in Firebase SDK session, never injected tokens.
const API='https://emu-realtime.onrender.com/api/schoolpark/city/room';
export function createRoomBridge(parent=window.parent){
 const initialUid=parent.auth?.currentUser?.uid||'',initialId=parent._spIdentity?.schoolParkId||'';let closed=false;const active=new Set();
 const current=()=>{if(closed||(parent.auth?.currentUser?.uid||'')!==initialUid||(parent._spIdentity?.schoolParkId||'')!==initialId)throw Error('SESSION_CHANGED');if(!initialUid)throw Error('AUTH_REQUIRED');};
 async function request(path,body,method){current();const controller=new AbortController();active.add(controller);const timer=setTimeout(()=>controller.abort(),15000);
  try{const headers=await parent.emuAuthHeaders(body!==undefined,{interactive:false});current();const r=await fetch(API+path,{method:method||(body===undefined?'GET':'POST'),headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:controller.signal});current();const d=await r.json();if(!r.ok||!d.ok)throw Object.assign(Error(d.error||'ROOM_UNAVAILABLE'),{status:r.status});return d;}finally{clearTimeout(timer);active.delete(controller);}
 }
 return{me:()=>request('/me'),save:b=>request('/me',b,'PUT'),reports:before=>request('/admin/reports'+(before?'?before='+before:'')),moderate:b=>request('/admin/moderation',b),destroy(){closed=true;for(const c of active)c.abort();active.clear();}};
}
export async function readPublicRoom(id,{signal}={}){
 if(!/^[A-Za-z0-9_-]{22}$/.test(id||''))throw Error('ROOM_NOT_FOUND');
 const r=await fetch(API+'/'+encodeURIComponent(id),{cache:'no-store',signal}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'ROOM_UNAVAILABLE');return d;
}
let sdkAuth;
// Lazy auth only for explicit like/report. Anonymous viewing creates no SDK or Firestore listener.
async function publicUser(){
 for(const w of [window.opener,window.parent]){try{if(w&&w!==window&&w.location.origin===location.origin&&w.auth?.currentUser)return w.auth.currentUser;}catch(_){}}
 if(!sdkAuth)sdkAuth=(async()=>{const [app,auth,config]=await Promise.all([import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js'),fetch('/__/firebase/init.json').then(r=>{if(!r.ok)throw Error('AUTH_REQUIRED');return r.json();})]);const a=app.getApps().find(a=>a.name==='[DEFAULT]')||app.initializeApp(config),session=auth.getAuth(a);await session.authStateReady();return session;})().catch(e=>{sdkAuth=null;throw e;});
 const session=await sdkAuth;return session.currentUser;
}
export async function publicAction(id,action,body={}){
 if(!/^[A-Za-z0-9_-]{22}$/.test(id||'')||!['like','report'].includes(action))throw Error('ROOM_NOT_FOUND');const user=await publicUser();if(!user)throw Error('AUTH_REQUIRED');
 const token=await user.getIdToken();const r=await fetch(API+'/'+id+'/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(15000)}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'ROOM_UNAVAILABLE');return d;
}
