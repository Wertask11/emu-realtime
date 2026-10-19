'use strict';
if(process.env.LAB_EMULATOR_PROJECT!=='demo-emu-knowledge-lab-ux19')throw Error('DEDICATED_UX_EMULATOR_PROJECT_REQUIRED');
const {main}=require('./native-fixture.cjs');
const path=require('node:path');
const {Server}=require('../../backend/node_modules/socket.io');
main({port:4210,reset:true,platformRegression:true}).then(async f=>{
 // Real local Socket.IO transport prevents irrelevant missing-server errors.
 // Chat/business event handlers are outside this UI test.
 new Server(f.server,{cors:{origin:true,credentials:true}});
 f.app.get('/test/logo.jpg',(req,res)=>res.sendFile(path.resolve(__dirname,'../../frontend/public/logo.jpg')));
 const owner=f.users.owner.account.walletAddress.toLowerCase();
 const base={owner,ownerName:'LOCAL検証運営',title:'LOCAL 知識を試す',knowledge:'LOCAL 公開知識を日々の活動で使う',hypothesis:'LOCAL 自分の条件で役立つかを確かめる',action:'LOCAL 手順を一度試す',measure:'LOCAL 結果と気づきを記録する',intro:'LOCAL 短い実践で知識を試すための検証用クエスト',budget:'1000',budgetCurrency:'JPY',need:1,status:'OPEN',createdAt:Date.now(),closesAt:Date.parse('2026-12-01T00:00:00+09:00'),series:'general',branch:0,guildId:'learn'};
 for(const [id,patch] of [['ux-entry',{questNumber:9,stage:'入門'}],['ux-standard',{questNumber:10,stage:'標準',title:'LOCAL 標準の課題'}],['ux-approved',{questNumber:11,stage:'実践',status:'CLOSED',title:'LOCAL 完走済みの記録'}],['ux-no-stage',{questNumber:12,stage:'',title:'LOCAL 難易度未設定の課題'}]])await f.db.collection('sp_quests').doc(id).set({...base,...patch});
 await f.db.collection('sp_quests').doc('ux-approved').collection('commits').doc(f.users.alice.account.walletAddress.toLowerCase()).set({name:'LOCAL Alice',tookAt:1,approved:true,approvedRounds:1,approvedAt:2});
 await f.db.collection('posts').doc('ux-public-knowledge').set({title:'LOCAL 学んだことを試す',content:'LOCAL 検証環境専用の公開知識。本番の体験談ではありません。',body:'LOCAL 検証用の本文',author:f.users.alice.account.walletAddress,createdAt:Date.now(),visibility:'public',type:'experience',tags:['検証'],goodBy:[]});
 f.app.get('/test/ux-state',async(req,res)=>{
  const docs=async path=>(await f.db.collection(path).get()).docs.map(d=>({id:d.id,fields:d.data()}));
  const counts={};
  for(const path of ['sp_notifications','sp_quest_certificates','sp_stars','emuer_v2_rewards','emuer_v2_ledger'])counts[path]=(await f.db.collection(path).get()).size;
  res.json({guildJoins:await docs('sp_guild_members/learn/joins'),guildSupports:await docs('sp_guild_members/learn/supports'),entryCommits:await docs('sp_quests/ux-entry/commits'),approvedCommits:await docs('sp_quests/ux-approved/commits'),counts});
 });
 console.log('LOCAL UX fixture ready: 4210; real Auth/Firestore; no Production data');
}).catch(e=>{console.error(e.stack||e.code||e.message);process.exitCode=1});
