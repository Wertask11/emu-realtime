'use strict';
// The application itself is served with only test configuration/endpoint changes.
// Authentication and all tested actions use real emulator SDKs and existing app functions.
const {createFixture}=require('./fixture.cjs');const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'../..');
async function main(){
  if(process.env.STRIPE_SECRET_KEY)throw new Error('UNSET_PAYMENT_SECRET_FOR_LOCAL_FIXTURE');
  const f=await createFixture({port:4201}),{app,db,identity,entitlement,middleware:c,base}=f;
  const source=fs.readFileSync(path.join(ROOT,'frontend/public/index.html'),'utf8');
  const serverSource=fs.readFileSync(path.join(ROOT,'backend/server.js'),'utf8');
  const access=require('../../backend/schoolpark-access');Object.assign(c,{identity,entitlement,decideSchoolParkAccess:access.decideSchoolParkAccess,SCHOOLPARK_PASS_PREVIEW_AT:access.PASS_PREVIEW_AT,SCHOOLPARK_PUBLIC_AT:access.PUBLIC_AT});
  const start=serverSource.indexOf('async function optionalFirebaseIdentity('),end=serverSource.indexOf('/* `access`',start);vm.runInContext(serverSource.slice(start,end),c);
  // Move native routes before the existing static handler from the small fixture.
  const router=require('../../backend/node_modules/express').Router();router.use(require('../../backend/node_modules/express').json());
  router.use('/api/auth',require('../../backend/verified-platform').accountRouter({db,firebaseAdmin:c.firebaseAdmin}));
  router.use('/api/activity',require('../../backend/verified-platform').activityRouter({db,requireFirebaseUser:c.requireFirebaseUser}));
  router.use('/api/identity',require('../../backend/identity-router').createIdentityRouter({db,identity,requireFirebaseUser:c.requireFirebaseUser,requireOwner:c.requireOwner,rateLimit:c.rateLimit,ethers:require('../../backend/node_modules/ethers'),walletNonces:new Map(),purgeWalletNonces:()=>{},walletNonceTtlMs:60000}).router);
  router.use('/api/billing',require('../../backend/billing').createBillingRouter({db,entitlement,requireFirebaseUser:c.requireFirebaseUser,requireOwner:c.requireOwner,rateLimit:c.rateLimit}).router);
  router.get('/api/schoolpark/entry-status',c.schoolParkEntryStatus);
  router.use('/api/emuer/v2',require('../../backend/emuer-v2/router').createEmuerV2Router({db,entitlement,requireFirebaseUser:c.requireFirebaseUser,requireOwnAddress:(req,res,next)=>{req.body=req.body||{};const claimed=String(req.body.address||'').toLowerCase();if(claimed&&claimed!==req.identity.walletAddress)return res.status(403).json({error:'ADDRESS_MISMATCH'});req.body.address=req.identity.walletAddress;next();},env:{EMUER_V2_ENABLED:'true',EMUER_V2_LAUNCH_HOLD:'false'}}).router);
  router.get('/api/user/name/:address',async(req,res)=>res.json({name:'エミュレーター検証ユーザー'}));
  let html=source.replace(/https:\/\/emu-realtime\.onrender\.com/g,base).replace(/https:\/\/firestore\.googleapis\.com/g,'http://127.0.0.1:8787').replace(/emusch-2a111/g,'demo-emu-knowledge-lab');
  html=html.replace(/https:\/\/www\.gstatic\.com\/firebasejs\/10\.8\.0/g,'/test/firebase');
  html=html.replace('https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js','/test/ethers.js').replace('https://cdn.socket.io/4.7.2/socket.io.min.js','/test/socket.js');
  router.get('/test/ethers.js',(req,res)=>res.type('js').sendFile('/tmp/knowledge-lab-ethers.js'));
  router.get('/test/socket.js',(req,res)=>res.type('js').sendFile('/tmp/knowledge-lab-socket.js'));
  router.get('/test/firebase/:name',(req,res)=>{if(!/^firebase-(?:app|auth|firestore)\.js$/.test(req.params.name))return res.sendStatus(404);const file=path.join(ROOT,'tools/quest-tests/node_modules/firebase',req.params.name);res.type('js').send(fs.readFileSync(file,'utf8').replace(/https:\/\/www\.gstatic\.com\/firebasejs\/10\.8\.0/g,'/test/firebase'));});
  const cfgStart=html.indexOf('  const firebaseConfig = {'),cfgEnd=html.indexOf('\n  };',cfgStart)+6;
  html=html.slice(0,cfgStart)+'  const firebaseConfig = {apiKey:"emulator-only",projectId:"demo-emu-knowledge-lab",authDomain:"localhost",appId:"emulator-only"};'+html.slice(cfgEnd);
  html=html.replace('getFirestore, initializeFirestore,','getFirestore, initializeFirestore, connectFirestoreEmulator,').replace('getAuth, signInAnonymously,','getAuth, signInAnonymously, connectAuthEmulator, signInWithEmailAndPassword,');
  html=html.replace('  const auth = getAuth(app);','  connectFirestoreEmulator(db,"127.0.0.1",8787);\n  const auth = getAuth(app);\n  connectAuthEmulator(auth,"http://127.0.0.1:9199",{disableWarnings:true});\n  window.__localEmulatorLogin=async(role="alice")=>{if(!["alice","bob","owner","guest"].includes(role))throw new Error("LOCAL_ROLE_ONLY");const cred=await signInWithEmailAndPassword(auth,role+"@knowledge-lab.example.invalid","Emulator-only-password-123");return window.__localEmulatorComplete(cred.user);};');
  html=html.replace('  CHES.whenAuthStateResolved = whenAuthStateResolved;','  window.__localEmulatorComplete=user=>completeCommonFlow(user,"password");\n  CHES.whenAuthStateResolved = whenAuthStateResolved;');
  html=html.replace('<body>','<body><button type="button" id="localEmulatorLogin" style="position:fixed;top:4px;left:4px;z-index:20000" onclick="window.__localLoginResult=window.__localEmulatorLogin()">LOCAL EMULATORでログイン</button>');
  router.get('/test/native.html',(req,res)=>res.type('html').send(html));
  // Recruitment's real /?lab=writer CTA must use the same isolated SDK/config.
  router.get('/',(req,res)=>res.type('html').send(html));
  router.use((req,res,next)=>{if(!/\.(?:html|js)$/.test(req.path))return next();const publicRoot=path.join(ROOT,'frontend/public'),file=path.resolve(publicRoot,'.'+req.path);if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return next();res.type(path.extname(file)).send(fs.readFileSync(file,'utf8').replace(/https:\/\/emu-realtime\.onrender\.com/g,base).replace(/https:\/\/firestore\.googleapis\.com/g,'http://127.0.0.1:8787').replace(/emusch-2a111/g,'demo-emu-knowledge-lab'));});
  // Missing integrations stay visibly unavailable, never return fabricated success.
  router.use('/api',(req,res,next)=>req.path.startsWith('/knowledge-lab')?next():res.status(503).json({error:'NOT_MOUNTED_IN_LOCAL_FIXTURE'}));
  const stack=app.router.stack;
  // Express mounting creates the real Layer; move it before static instead of fabricating one.
  app.use(router);const layer=stack.pop(),staticIndex=stack.findIndex(l=>l.name==='serveStatic');stack.splice(staticIndex,0,layer);
  await f.api.service.rebuild({owner:true});await f.api.service.waitForRebuild();console.log('Native application with actual emulator auth: '+base+'/test/native.html');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
