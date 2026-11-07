"use strict";
// Native mascot markup/controller and economy entry, local Auth tokens only.
// Legacy background agents are inert in this fixture; no production endpoints.
const fs=require('node:fs'),path=require('node:path');
const {grab}=require('../year-goals-tests/extract.cjs');
const ROOT=path.resolve(__dirname,'../..');
function reizoShell(){
 const html=fs.readFileSync(path.join(ROOT,'frontend/public/index.html'),'utf8');
 const styles=[...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map(x=>x[0]).join('\n');
 const panel=html.match(/<div id="spReizoPanel"[\s\S]*?\n<\/div>/)[0];
 const native=['spReizoOpen','spReizoClose','spReizoAnswer','_spReizoAppendMsg','_spReizoShowTyping','spReizoSend','spReizoKeydown','spReizoAsk','openSpRoom','closeSpRoom'].map(n=>grab(html,n)).join('\n');
 const adapter=fs.readFileSync(path.join(ROOT,'frontend/public/tour/reizo-tour-pages.js'),'utf8').split('\n').find(l=>l.includes('window.ReizoTourAsk=function'));
 return `<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOCAL Reizo + economy</title>${styles}<link rel="stylesheet" href="/tour/reizo-tour.css"><style>body{margin:0;padding:16px;font:16px system-ui;background:#faf7f1;color:#222}header{display:flex;gap:16px;align-items:center}#emuHeaderReizo{width:48px;height:48px}#emuHeaderReizo img{width:36px;height:36px}#spRoomFrame{height:100dvh;width:100%;border:0}</style><body><header><strong>LOCAL 隔離検証</strong><button id="emuHeaderReizo" aria-label="冷蔵庫くん" onclick="ReizoTourAsk(this)"><img src="/assets/mascot.jpg" alt=""></button></header><p data-tour="local-target">実データ・実EMUERを使わない検証画面です。</p>${panel}<div id="spRoomPage"><iframe id="spRoomFrame" title="依頼画面"></iframe></div><script src="/reizo/knowledge.js"></script><script src="/reizo/chat.js"></script><script src="/tour/reizo-tour.js"></script><script src="/economy/entry.js"></script><script src="/reizo-float.js" defer></script><script>
 let _reizoAgentsStarted=false;function _startAlertChecker(){}function _startTaskRunner(){}function _matchReizoSkill(){return null}function spRoomWatchRender(){}
 ${native}
 window.auth={currentUser:null};${grab(html,'emuAuthHeaders')};
 window.testSignIn=async(role)=>{const r=await fetch('/test/login?role='+role),d=await r.json();window.auth.currentUser={uid:d.uid,getIdToken:async()=>d.token};};
 var tour=ReizoTour;function screen(){return 'emu-local-request'}
 ReizoTour.register('emu-local-request',[{target:'[data-tour=local-target]',label:'検証画面のガイド',text:'閲覧だけでは依頼・決済になりません。'}]);
 ${adapter}
 window.testSignIn('alice');
 </script></body></html>`;
}
module.exports={reizoShell};
