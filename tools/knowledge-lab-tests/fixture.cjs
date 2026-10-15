'use strict';
// Test accounts and writes are restricted to local emulators, never production.
const PROJECT=process.env.LAB_EMULATOR_PROJECT||'demo-emu-knowledge-lab';
if(!/^demo-emu-knowledge-lab(?:-[a-z0-9-]{1,30})?$/.test(PROJECT))throw new Error('LOCAL_PROJECT_ONLY');
const AUTH_HOST=process.env.LAB_AUTH_EMULATOR_HOST||'127.0.0.1:9199';
if(!['127.0.0.1:9199','127.0.0.1:9299','127.0.0.1:9399'].includes(AUTH_HOST))throw new Error('LOCAL_AUTH_EMULATOR_ONLY');
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8787')throw new Error('LOCAL_EMULATOR_ONLY');
if(process.env.FIREBASE_AUTH_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST!==AUTH_HOST)throw new Error('LOCAL_AUTH_EMULATOR_ONLY');
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8787';process.env.FIREBASE_AUTH_EMULATOR_HOST=AUTH_HOST;process.env.GCLOUD_PROJECT=PROJECT;
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const admin=require('../../backend/node_modules/firebase-admin');const express=require('../../backend/node_modules/express');
const {ensureVerifiedAccount,deriveAddress}=require('../../backend/verified-platform');
const ethers=require('../../backend/node_modules/ethers');const ROOT=path.resolve(__dirname,'../..');
const PASSWORD='Emulator-only-password-123';
async function signIn(role){const r=await fetch('http://'+AUTH_HOST+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:role+'@knowledge-lab.example.invalid',password:PASSWORD,returnSecureToken:true})});const d=await r.json();if(!r.ok)throw new Error('EMULATOR_LOGIN_FAILED');return d.idToken;}
async function createFixture({port=0,reset=true,aiEnv={},aiFetcher}={}){
  if(reset){const r=await fetch('http://127.0.0.1:8787/emulator/v1/projects/'+PROJECT+'/databases/(default)/documents',{method:'DELETE'});if(!r.ok)throw new Error('EMULATOR_RESET_FAILED');}
  const firebase=admin.initializeApp({projectId:PROJECT},'knowledge-lab-'+Date.now()),db=firebase.firestore(),firebaseAdmin={auth:()=>firebase.auth()};
  const identity=require('../../backend/identity').createIdentity({db,ethers}),entitlement=require('../../backend/entitlement').createEntitlement({db,identity});
  const source=fs.readFileSync(path.join(ROOT,'backend/server.js'),'utf8');
  const grab=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)));
  const context={firebaseAdmin,db,ensureVerifiedAccount,identityAccountCache:new Map(),IDENTITY_CACHE_MS:300000,SP_OWNER_ADDRESSES:[deriveAddress('lab-owner').toLowerCase()],rateBuckets:new Map(),Date,Map,String,console};
  vm.createContext(context);
  vm.runInContext(grab('async function requireFirebaseUser(','app.use("/api/auth"')+grab('function requireOwner(','/* Room1')+grab('function rateLimit(','const uploadRateLimit'),context);
  const isOwner=a=>[a.walletAddress,a.account?.chesAddress].some(v=>context.SP_OWNER_ADDRESSES.includes(String(v||'').toLowerCase()));
  const api=require('../../backend/knowledge-lab/router').createKnowledgeLabRouter({db,identity,entitlement,requireFirebaseUser:context.requireFirebaseUser,requireOwner:context.requireOwner,rateLimit:context.rateLimit,isOwner,emuerEnabled:()=>true,aiFetcher,env:{...aiEnv,KNOWLEDGE_LAB_ENABLED:'true',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8787'}});
  const app=express();app.use('/api/knowledge-lab',api.router);
  const server=app.listen(port,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
  const users={};
  for(const role of ['owner','alice','bob','guest']){
    const uid='lab-'+role,email=role+'@knowledge-lab.example.invalid';try{await firebase.auth().createUser({uid,email,password:PASSWORD});}catch(e){if(e.code!=='auth/uid-already-exists'&&e.code!=='auth/email-already-exists')throw e;}
    const token=await signIn(role),decoded=await firebase.auth().verifyIdToken(token),account=await ensureVerifiedAccount(db,decoded);
    const out=await identity.resolveForUid(uid);await db.collection('entitlements').doc(uid).set({plan:role==='guest'?'guest':'plus',source:'emulator-test',startsAt:new Date(0)});
    users[role]={uid,email,token,account,spid:out.spid};
  }
  async function call(method,route,role=null,body){const r=await fetch(base+'/api/knowledge-lab'+route,{method,headers:{'Content-Type':'application/json',...(role?{Authorization:'Bearer '+users[role].token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
  const a={...users.owner,spid:users.owner.spid,walletAddress:users.owner.account.walletAddress.toLowerCase(),owner:true};await api.service.init(a);
  app.get('/test/lab-shell.html',(req,res)=>res.type('html').send(`<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOCAL EMULATOR — Knowledge Lab</title><style>body{margin:0;font:14px sans-serif}header{height:50px;display:flex;gap:12px;align-items:center;padding:0 12px;background:#fff0db}iframe{display:block;width:100%;height:calc(100dvh - 50px);border:0}</style></head><body><header><b>検証用エミュレーター</b><label>ログイン <select id="role"><option>alice</option><option>bob</option><option>owner</option><option>guest</option></select></label><button id="signin">ログイン</button></header><iframe id="lab" title="Knowledge Lab" src="/knowledge-lab.html"></iframe><script>let token=null;window.emuAuthHeaders=async()=>{if(!token)throw new Error('AUTH_REQUIRED');return {'Content-Type':'application/json',Authorization:'Bearer '+token}};document.getElementById('signin').onclick=async()=>{const role=document.getElementById('role').value;const r=await fetch('http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:role+'@knowledge-lab.example.invalid',password:'${PASSWORD}',returnSecureToken:true})});const d=await r.json();if(!r.ok)throw new Error('EMULATOR_LOGIN_FAILED');token=d.idToken;document.getElementById('lab').src='/knowledge-lab.html';};window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===document.getElementById('lab').contentWindow&&e.data?.type==='emu-lab-action'){document.getElementById('lab').contentWindow.postMessage({type:'emu-lab-feedback',message:'既存画面への接続要求を検証環境で受け取りました。'},location.origin);}});</script></body></html>`));
  app.use(express.static(path.join(ROOT,'frontend/public')));
  async function close(){api.close();await new Promise(resolve=>server.close(resolve));await firebase.delete();}
  return {app,server,base,db,api,users,identity,firebase,entitlement,middleware:context,call,close};
}
if(require.main===module){createFixture({port:4200}).then(async f=>{await f.api.service.rebuild({owner:true});await f.api.service.waitForRebuild();console.log('Local emulator frontend: '+f.base+'/test/lab-shell.html');}).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={createFixture,signIn,PROJECT};
