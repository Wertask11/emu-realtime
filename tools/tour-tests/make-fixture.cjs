/* LOCAL DUMMY fixture: actual markup/styles/templates and native UI handlers;
 * auth/content delivery is stubbed. Generated HTML stays outside public/. */
const fs=require('node:fs'),path=require('node:path');
const {grab}=require('../year-goals-tests/extract.cjs');
const root=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'frontend/public/index.html'),'utf8');
const functions=['_emuPhoneLayout','_emuEnsureAppVisible','_emuCloseFullscreenOverlays','_setEmuHomeTab','_setEmuPageTitle','showEmuFeed','showEmuRequests','showEmuIchinichi','showEmuDiscussion','emuFitKnowledgeFrame','emuFitPhoneFrames','emuFitContact','emuNavToggle','openSpRoom','closeSpRoom','escapeHtml','_emuRenderKnowledgeRequests','spReizoOpen','spReizoClose','_spReizoAppendMsg','_spReizoShowTyping','spReizoSend','spReizoKeydown','spReizoAsk'];
const scripts=[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
const contact=scripts.find(m=>m[1].includes('let selectedType = null;'))[1];
const kb=source.slice(source.indexOf('const SP_REIZO_KB = ['),source.indexOf('let _reizoAgentsStarted'));
const native=functions.map(name=>grab(source,name)).join('\n');
const prefix=`
window.fixtureMessages=[];window.fixtureChatOpens=0;
const EMU_TAB_PAIRS={emuFeedTab:'esnFeed',emuRequestsTab:'esnRequests',emuIchinichiTab:'esnIchinichi',emuDiscussionTab:'esnDiscussion'};
const EMU_PHONE_NAV={emuFeedTab:'ebnFeed',emuRequestsTab:'ebnRequests',emuIchinichiTab:'ebnIchinichi',emuDiscussionTab:'ebnDiscussion'};
let _reizoAgentsStarted=false;
function _emuHealSession(){} function _cancelSpLoadingOverlay(){} function _matchReizoSkill(){return null;}
function _startAlertChecker(){window.fixtureChatOpens++;} function _startTaskRunner(){}
function _emuAddress(){return '';} function _emuFormatDate(){return 'ローカルの架空期限';}
function isBrandUnderMaintenance(){return false;} function spTrackBrand(){}
function openKnowledgeAnswer(){} function openSpPassport(){} function openSpPanel(){}
function loadKnowledgeRequests(){_emuRenderKnowledgeRequests(document.getElementById('emuRequestList'),{forEach(fn){fn({id:'synthetic-request',data(){return {question:'ローカルのダミー募集',context:'実ユーザーの内容ではありません。',status:'open',bounty:0,answerCount:0};}});}});}
function emuT(key){return window.EmuI18n&&window.EmuI18n.t?window.EmuI18n.t(key):({'tab.feed':'知識を読む','tab.requests':'知識を探す','tab.ichinichi':'一日シェア','tab.discussion':'議論'}[key]||key);}
function showEmuToday(){showEmuFeed();}
async function chesHubGo(brand){if(brand==='emu')showEmuFeed();else{document.body.classList.add('sp-dao-open');const fr=document.getElementById('spDaoFrame');if(!fr.src)fr.src='/schoolpark/dao.html';document.body.appendChild(document.getElementById('spDaoPage'));}}
function openSpMobileMenu(){document.body.classList.add('sp-menu-open');} function closeSpMobileMenu(){document.body.classList.remove('sp-menu-open');}
function spDaoReloadAll(app){app.setState({me:{name:'ダミー',initial:'D',line:'ローカル検証'},noMembers:false,members:[{name:'ダミーメンバー',initial:'D',role:'テスト',wisdom:0,done:0,cited:0,share:'計算例'}],quests:[{id:'synthetic-quest',title:'ローカルのダミークエスト',fullTitle:'ダミークエスト',status:'OPEN',need:1,commits:0,budget:'0',owner:'ダミー',due:'期限なし',cardText:'閲覧用テスト',reports:[],reportSteps:[]}],wisdom:[{id:'synthetic-wisdom',tag:'一般',insight:'ローカルのダミー知恵',author:'ダミー',from:'架空データ',experiment:'架空の経験',reports:[],uses:0}],noWisdom:false,guilds:[{id:'synthetic-guild',code:'LOCAL',short:'ダミーギルド',concept:'ローカルの活動',accent:'#0F5C3F',open(){app.setState({screen:'guild',curGuild:{short:'ダミーギルド',concept:'ローカルの活動',body:'閲覧用ルール',noVotes:true,votes:[]}});app.toTop();}}],yearDoc:{title:'ローカル目標',summary:'ダミーの資料です。',blocks:[]},noTreasury:true});}
`;
const boot=`
window.addEventListener('message',function(e){if(e.origin!==location.origin)return;const m=e.data||{};window.fixtureMessages.push(m.type);if(m.type==='emu-knowledge-ready'){e.source.postMessage({type:'emu-knowledge-posts',posts:[{id:'synthetic-post',title:'ローカルのダミー知識',body:'実ユーザーの投稿ではありません。\\n'.repeat(12),author:'synthetic-author',goodCount:0,changeCount:0,acceptedChangeCount:0,createdAt:'2026-10-13',tags:['経験']}],account:'',authors:{},canDraft:false,canSchedule:false},location.origin);}});
document.getElementById('mainApp').style.display='block';
for(const id of ['logoScreen','walletScreen','chesHub','loadingOverlay']){const el=document.getElementById(id);if(el)el.style.display='none';}
_emuEnsureAppVisible();
if(new URLSearchParams(location.search).get('brand')==='schoolpark')chesHubGo('schoolpark');else showEmuFeed();
`;
let html=source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
html=html.replace('</head>','<script src="/emu-i18n.js"></script><script src="/emu-i18n-pages.js"></script><script defer src="/tour/reizo-tour.js"></script><script defer src="/tour/reizo-tour-pages.js"></script></head>');
html=html.replace('</body>','<div style="position:fixed;right:4px;top:2px;z-index:10200;font:10px system-ui;background:#fff;padding:2px;pointer-events:none">LOCAL DUMMY — 本番の録画ではありません</div><script>'+prefix+kb+native+contact+boot+'</script></body>');
const output=process.argv[2]||'/tmp/reizo-tour-fixture.html';fs.writeFileSync(output,html);console.log('LOCAL DUMMY fixture written:',output);
