'use strict';
process.env.LAB_EMULATOR_PROJECT='demo-emu-knowledge-lab-unified';
process.env.LAB_AUTH_EMULATOR_HOST='127.0.0.1:9199';
const {main}=require('../knowledge-lab-tests/native-fixture.cjs');
const {Server}=require('../../backend/node_modules/socket.io');
const fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment}=require('../quest-tests/node_modules/@firebase/rules-unit-testing');
async function start(options={}){
 // Install the unchanged repository rules only in this local demo namespace; never clear records.
 const localRules=await initializeTestEnvironment({projectId:process.env.LAB_EMULATOR_PROJECT,firestore:{host:'127.0.0.1',port:8787,rules:fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8')}});
 await localRules.cleanup();
 const f=await main({port:4220,reset:false,platformRegression:true,profileSettings:true,...options});
 const io=new Server(f.server,{cors:{origin:true,credentials:true},maxHttpBufferSize:16384});
 require('../../backend/dialogue-socket').attachDialogueSocket(io,{
   db:f.db,requireFirebaseUser:f.middleware.requireFirebaseUser,ownerAddresses:f.middleware.SP_OWNER_ADDRESSES
 });
 const actor=f.users.owner.account.walletAddress.toLowerCase();
 async function seed(collection,id,data){try{await f.db.collection(collection).doc(id).create(data);}catch(e){if(e.code!==6 && e.code!=='already-exists')throw e;}}
 await seed('sp_quests','unified-quest',{owner:actor,ownerName:'LOCAL 運営',title:'LOCAL 知識を試すクエスト',knowledge:'LOCAL 元の知識',hypothesis:'LOCAL 小さく試す',action:'LOCAL 一度試し、気づきを記録する',measure:'LOCAL 結果を確認する',intro:'隔離エミュレーターの導線検証専用です。',budget:'1000',budgetCurrency:'JPY',need:1,status:'OPEN',createdAt:Date.now(),closesAt:Date.parse('2026-12-31T00:00:00+09:00'),series:'general',questNumber:9,branch:0,stage:'入門',guildId:'learn'});
 await seed('sp_wisdom','unified-wisdom',{questId:'unified-quest',questTitle:'LOCAL 知識を試すクエスト',author:actor,authorName:'LOCAL 運営',insight:'LOCAL 試した結果を、次の人が使える知恵として残す。',from:'LOCAL 公開知識',experiment:'LOCAL 実践記録',createdAt:Date.now(),tag:'Emu',cited:0});
 await seed('posts','unified-source',{title:'LOCAL 導線検証の知識',body:'LOCAL 隔離エミュレーターのテスト投稿です。本番利用者の記録ではありません。',address:f.users.alice.account.walletAddress.toLowerCase(),displayName:'LOCAL 検証',visibility:'public',tags:'経験',createdAt:Date.now(),updatedAt:Date.now(),goodCount:0,changeCount:0});
 // Every interaction run gets new local evidence without deleting earlier runs.
 f.app.post('/test/unified-scenario',async(_req,res)=>{
  const run=require('node:crypto').randomUUID(),questId='unified-run-'+run,wisdomId='unified-cite-'+run;
  const original=(await f.db.collection('sp_quests').doc('unified-quest').get()).data();
  await seed('sp_quests',questId,{...original,createdAt:Date.now(),closesAt:Date.now()+30*86400000});
  await seed('sp_wisdom',wisdomId,{questId,questTitle:original.title,author:actor,authorName:'LOCAL 運営',insight:'LOCAL 実行別の引用確認 '+run,knowledge:'LOCAL 元の知識',experiment:'LOCAL 検証記録',tag:'Emu',createdAt:Date.now()});
  res.json({questId,wisdomId});
 });
 f.app.get('/test/unified-state',async(req,res)=>{const data={};for(const name of ['posts','sp_wisdom','sp_guild_members/learn/joins','sp_quests/unified-quest/commits','sp_quest_logs','emuer_v2_rewards','emuer_v2_ledger']){const s=await f.db.collection(name).get();data[name]=s.docs.map(d=>({id:d.id,data:d.data()}));}res.json(data);});
 console.log('LOCAL UNIFIED FIXTURE ready '+f.base);return f;
}
if(require.main===module)start().catch(e=>{console.error(e.stack);process.exitCode=1});
module.exports={start};
