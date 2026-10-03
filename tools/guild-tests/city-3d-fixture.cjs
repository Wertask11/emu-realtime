/* Isolated HTTP fixture. Real DAO, City frontend and City routes; no live auth,
 * payment provider or Firestore. Used only by local browser tests. */
const path=require('node:path'),http=require('node:http');
const express=require('../../backend/node_modules/express');
const {makeFirestore}=require('../../backend/fake-firestore');
const {createIdentity}=require('../../backend/identity');
const {createCityRouter}=require('../../backend/city');
const SPID='SP-AAAA-AAAA-AAAA-AAAA';
async function startFixture(shopCatalog){
 const db=makeFirestore({ches_accounts:{alice:{spid:SPID,walletAddress:'alice'}},sp_auth_links:{'fb:alice':{spid:SPID}},sp_identities:{[SPID]:{spid:SPID,status:'active'}}});
 const original=db.collection;
 db.collection=name=>{const col=original(name);col.orderBy=()=>({limit:n=>({get:async()=>({docs:(await col.get()).docs.slice(0,n)})})});return col;};
 const app=express();app.use(express.json());
 app.use('/api/schoolpark/city',createCityRouter({db,identity:createIdentity({db}),shopCatalog,entitlement:{holdsOfficialPass:async()=>true},rateLimit:()=> (_q,_s,n)=>n(),requireFirebaseUser(q,s,n){if(q.headers.authorization!=='Bearer fixture-alice')return s.status(401).json({error:'AUTH_REQUIRED'});q.identity={uid:'alice'};n();}}));
 app.get('/test/parent',(_q,s)=>s.type('html').send(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style><script>
 window.auth={currentUser:{uid:'alice'}};window._spIdentity={schoolParkId:'${SPID}'};window.__listeners=[];
 window.fbAuth={onAuthStateChanged(a,fn){__listeners.push(fn);return()=>{};}};
 window.__logout=()=>{auth.currentUser=null;__listeners.forEach(fn=>fn(null));};
 window.emuAuthHeaders=async()=>({Authorization:'Bearer fixture-alice','Content-Type':'application/json'});
 window.spEnsureSchoolParkAccess=async()=>({allowed:true});
 window.spDaoReloadAll=app=>{window.__app=app;app.setState({me:{name:'テスト用Passport',initial:'テ',line:'検証環境'}});};
 window.spPassportLoad=async()=>({uid:'alice',addr:'alice',spid:'${SPID}'});window.spCompletedQuests=async()=>[];window.spGuildDefs=async()=>[];
 </script><iframe title="SchoolPark" src="/schoolpark/dao.html"></iframe></html>`));
 app.get('/favicon.ico',(_q,s)=>s.sendStatus(204));
 if(process.env.CITY_FONT_ROOT)app.use('/test/fonts',express.static(process.env.CITY_FONT_ROOT));
 app.use(express.static(path.join(__dirname,'../../frontend/public')));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {base:'http://127.0.0.1:'+server.address().port,db,close:()=>new Promise(r=>server.close(r))};
}
module.exports={startFixture,SPID};
