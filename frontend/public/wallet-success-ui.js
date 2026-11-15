/* Wallet UI.  Legacy airdrop signing has been removed. */
const EMUER_V2_API="https://emu-realtime.onrender.com/api/emuer/v2";
const EMUER_V2_ABI=["function claimReward(bytes32,uint256,uint256,bytes) returns (uint256)"];
let emuerV2Config=null;
/* EMUER v2 の設定（/config）は、このページで1回だけ読んで分け合う。
   前は下で読み込む6つの部品がそれぞれ読みに行き、知識の募集の部品は
   0.5秒ごとに読み直していた。Render が起きるまでの数十秒、同じ問い合わせが
   何十本も積み上がっていた。返ってきたら5分は使い回す。失敗したら次に読み直す。
   読めたが断られた（!ok）ときは null。 */
window.emuerV2ConfigOnce=function(){
  const now=Date.now(),c=window.__emuerV2Config;
  if(c&&now-c.at<300000)return c.promise;
  const promise=fetch(EMUER_V2_API+"/config").then(r=>r.json().then(v=>r.ok?v:null));
  window.__emuerV2Config={at:now,promise};
  promise.catch(()=>{if(window.__emuerV2Config&&window.__emuerV2Config.promise===promise)window.__emuerV2Config=null;});
  return promise;
};
const emuerReflectionScript=document.createElement("script");
emuerReflectionScript.src="/change-reflection-ui.js";
document.head.appendChild(emuerReflectionScript);
const emuerKnowledgeBountyScript=document.createElement("script");
emuerKnowledgeBountyScript.src="/knowledge-bounty-v2-ui.js";
document.head.appendChild(emuerKnowledgeBountyScript);
const emuerGuildQuestRewardScript=document.createElement("script");
emuerGuildQuestRewardScript.src="/guild-quest-rewards-ui.js";
document.head.appendChild(emuerGuildQuestRewardScript);
const emuerV2CutoverScript=document.createElement("script");
emuerV2CutoverScript.src="/emuer-v2-cutover-ui.js";
document.head.appendChild(emuerV2CutoverScript);
const emuerV2PublicCopyScript=document.createElement("script");
emuerV2PublicCopyScript.src="/emuer-v2-public-copy.js";
document.head.appendChild(emuerV2PublicCopyScript);

(function(){
  const s=document.createElement("style");
  s.textContent="#walletSuccessOverlay{display:none;position:fixed;inset:0;background:#000b;z-index:9999;align-items:center;justify-content:center}#walletSuccessOverlay.active{display:flex}#walletSuccessCard{background:#fff;border-radius:18px;padding:30px;max-width:360px;width:calc(100% - 44px);text-align:center;color:#172033}.ws-balance{font-size:32px;font-weight:700;color:#167653;margin:8px}.ws-sub{font-size:13px;color:#667085}.ws-btn{width:100%;border:0;border-radius:10px;padding:13px;margin-top:10px;background:#265dd7;color:#fff;font-weight:700;cursor:pointer}.ws-btn:disabled{background:#aab4c8}.ws-close{background:#eef2f8;color:#273047}.ws-alt{background:#fff;color:#265dd7;border:2px solid #265dd7}#wsChoice{text-align:left;line-height:1.6;margin-top:12px}.emu-sum{margin:12px 0 4px;padding:10px 12px;border-radius:12px;background:#f6f8fc;text-align:left;font-size:13px;line-height:1.7;color:#273047}.emu-sum-row{display:flex;flex-wrap:wrap;justify-content:space-between;gap:0 10px}.emu-sum-row span{flex:1 1 12em}.emu-sum-row b{margin-left:auto;white-space:nowrap}.emu-sum-row b.emu-sum-err{white-space:normal}.emu-sum-err{color:#b42318}.emu-sum-total{margin-top:6px;padding-top:6px;border-top:1px solid #dfe5f0;font-weight:700}.emu-sum-reload{margin-top:6px;border:1px solid #265dd7;background:#fff;color:#265dd7;border-radius:999px;padding:6px 12px;font:inherit;font-weight:700;cursor:pointer}";
  document.head.appendChild(s);
  document.body.insertAdjacentHTML("beforeend",'<div id="walletSuccessOverlay"><section id="walletSuccessCard"><h2>ウォレット接続完了</h2><p id="wsAddress" class="ws-sub"></p><p class="ws-sub">ウォレットのEMUER残高（実EMUER）</p><p id="wsBalance" class="ws-balance">---</p><div id="wsBreakdown"></div><p id="wsStatus" class="ws-sub"></p><button id="wsLogin" class="ws-btn" hidden></button><button id="wsLoginApp" class="ws-btn ws-alt" hidden></button><button id="wsClaim" class="ws-btn" hidden></button><button id="wsClaimApp" class="ws-btn ws-alt" hidden></button><p id="wsChoice" class="ws-sub" hidden></p><button class="ws-btn ws-close" onclick="closeWalletSuccessAndStart()">SchoolParkを始める</button></section></div>');
})();
const wsAccount=()=>String(window.connectedAccount||"").toLowerCase();
const wsBtn=()=>document.getElementById("wsClaim");
/* 毎日のぶん（+1 EMUER）のボタン。

   ここは長いあいだ emuLoginBonusBtn を指していた。ところがその id は
   どこにも作られていない。index.html にも、どの JS にも、その id を
   持つ要素が1つも無い。読むところが5か所、作るところが0か所。
   だから毎日のぶんは、押す場所そのものが画面に無かった。

   受け取りの modal は実在するので、そこに置く。 */
const wsLoginBtn=()=>document.getElementById("wsLogin");
/* 鎖の上で受け取れるか（MetaMask などが入っているか）。
   LINE・Google のアプリ内ブラウザには無い。無いのにサーバーへ署名を頼むと、
   画面は「missing provider」で止まり、報酬は署名の期限（15分）のあいだ公式ショップでも使えなくなる。
   だから無いときは、署名を頼む前に止める。 */
const wsCanSign=()=>!!window.ethereum;
const WS_NO_WALLET="ウォレットへ移すには、MetaMask の入ったブラウザ（パソコンや MetaMask アプリ）で開いてください。受け取る前のEMUERは、このまま City の公式ショップで使えます。";
async function wsHeaders(interactive){if(typeof window.emuAuthHeaders!=="function")throw new Error("再ログインしてください。");return window.emuAuthHeaders(!!interactive);}
/* 11/14 オーナー：ウォレットでログインしていても、受け取り方を選べるようにする。
   実EMUER＝Polygon のウォレットへ移す（署名とガス代が要る）。
   アプリ内EMUER（オフチェーン）＝受け取る前のEMUERのまま。公式ショップですぐ使え、あとでウォレットへ移すこともできる。
   MetaMask などが無いところでは、これまでどおりアプリ内EMUERだけ（ウォレットへ移せないため）。 */
const wsLoginAppBtn=()=>document.getElementById("wsLoginApp");
const WS_CHOICE_NOTE="受け取り方を選べます。実EMUER：Polygon のウォレットに入ります（署名とガス代が要ります）。アプリ内EMUER（オフチェーン）：City の公式ショップですぐ使えます。あとでウォレットへ移すこともできます。";
function wsAppOption(text,fn){const b=document.getElementById("wsClaimApp");if(b){if(!text){b.hidden=true;b.onclick=null;}else{b.hidden=false;b.disabled=false;b.textContent=text;b.onclick=fn;}}wsChoiceNote();}
/* 2つのボタンが並んでいるときだけ、違いの説明を出す */
function wsChoiceNote(){const n=document.getElementById("wsChoice");if(!n)return;const two=["wsLoginApp","wsClaimApp"].some(id=>{const b=document.getElementById(id);return b&&!b.hidden;});n.hidden=!two;n.textContent=two?WS_CHOICE_NOTE:"";}
function wsClaimLabel(text,fn,disabled){const b=wsBtn();if(!b)return;b.hidden=false;b.textContent=text;b.disabled=!!disabled;b.onclick=fn;}
/* 受け取るものが無い・読めないときは、黙らずに理由を出す。
   お金の画面で何も出ないのは、壊れているのと見分けがつかない。 */
function wsHideClaim(why){const b=wsBtn();if(b)b.hidden=true;wsAppOption(null);const s=document.getElementById("wsStatus");if(s&&why)s.textContent=why;}
async function wsBalance(account){
  if(!wsCanSign()){document.getElementById("wsBalance").textContent="—";document.getElementById("wsStatus").textContent="ウォレットの残高は、MetaMask の入ったブラウザで出ます。";return;}
  try{const p=new ethers.providers.Web3Provider(window.ethereum);const addr=emuerV2Config?.enabled?emuerV2Config.contract:window.EMUER_CONTRACT_ADDRESS;const abi=emuerV2Config?.enabled?["function balanceOf(address) view returns (uint256)"]:window.EMUER_CONTRACT_ABI;const x=await new ethers.Contract(addr,abi,p).balanceOf(account);document.getElementById("wsBalance").textContent=Number(ethers.utils.formatUnits(x,18)).toLocaleString("ja-JP");document.getElementById("wsStatus").textContent="残高を確認しました";}catch(_){document.getElementById("wsStatus").textContent="残高を取得できませんでした";}
}
async function showWalletSuccessModal(account){document.getElementById("walletSuccessOverlay").classList.add("active");document.getElementById("wsAddress").textContent=account.slice(0,6)+"…"+account.slice(-4);await wsBalance(account);if(emuerV2Config?.enabled){await wsDaily();await wsRewards();}if(typeof wsRenderBreakdown==="function")wsRenderBreakdown(true);}
function closeWalletSuccessAndStart(){
  document.getElementById("walletSuccessOverlay").classList.remove("active");
  /* ウォレットの札から開いたときは、その場に戻すだけでよい。
     本編へ送るのは、最初のログインから開いたときだけ。 */
  if(wsFromWallet){wsFromWallet=false;return;}
  if(typeof window.goTomainapp==="function")window.goTomainapp();
}
/* 受け取りの入り口。

   報酬の一覧も受け取りも、この modal の中にある。ところが
   showWalletSuccessModal を呼ぶところが、どこにもなかった。
   10/2、完走を認めて EMUER を引き当てたのに、画面から受け取る
   道がないことが分かった。ウォレットの札に口を出す。

   押すまで /rewards は読まない。全員ぶんを毎回読むと、
   Firestore の1日の読取がそれだけで減る。 */
let wsFromWallet=false;
function wsOpenRewards(){
  const a=wsAccount();
  if(!a){alert("先にウォレットを接続してください。");return;}
  wsFromWallet=true;
  const c=document.querySelector("#walletSuccessCard .ws-close");
  if(c)c.textContent="閉じる";
  const h=document.querySelector("#walletSuccessCard h2");
  if(h)h.textContent="EMUERの受け取り";
  showWalletSuccessModal(a);
}
window.wsOpenRewards=wsOpenRewards;
function wsAddWalletButton(){
  const box=document.querySelector("#emuValueProfile .eth-wallet-actions");
  if(!box||document.getElementById("wsOpenRewardsBtn"))return;
  const b=document.createElement("button");
  b.type="button";b.id="wsOpenRewardsBtn";b.className="eth-btn";
  b.textContent="報酬を受け取る";b.onclick=wsOpenRewards;
  box.appendChild(b);
}
/* 未請求の報酬。

   ボタンの文字に a.length（件数）を EMUER の額として出していた。
   100 EMUER が2件あると「未請求の報酬 2 EMUER を受け取る」になる。
   お金の画面で額を間違えて出すのは、いちばんやってはいけない。
   額は額、件数は件数として出す。

   受け取りは1件ずつ。押すたびに残りが減り、文字も書き替わる。 */
/* この画面で受け取り終えたもの。

   サーバーは鎖に聞いて受け取り済みを外すが、その読みが追いつかない
   ことがある（1承認待っても、サーバーの繋ぎ先がまだ古いことがある）。
   そのあいだ同じ claimId が一覧の先頭に残り、もう一度押すと
   コントラクトが ClaimUnavailable を返して estimateGas で落ちる。
   この画面で受け取ったものは、こちらでも覚えておいて外す。 */
const wsDone=new Set();
/* 今日のぶんを受け取れるか。受け取りの modal を開いたときに見る。

   一覧（/rewards）には出てこない。毎日のぶんは押したときに作られるので、
   押す前は「待っている報酬」として存在しないため。
   だから一覧が空でも、ここは受け取れることがある。 */
async function wsDaily(){
  const b=wsLoginBtn(); if(!b)return;
  if(!emuerV2Config||!emuerV2Config.enabled){b.hidden=true;return;}
  if(Date.now()<Date.parse(emuerV2Config.startsAt)){
    b.hidden=false;b.disabled=true;b.textContent="10月1日開始";b.onclick=null;return;}
  try{
    const r=await fetch(EMUER_V2_API+"/daily/login/status?address="+encodeURIComponent(wsAccount()),
      {headers:await wsHeaders(false)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){b.hidden=true;return;}
    b.hidden=false;
    const app=wsLoginAppBtn();
    /* サーバーが返すのは claimedToday。claimed を見ていたので、
       受け取り済みでも「受け取れます」と出ていた。 */
    if(d.claimedToday){b.disabled=true;b.textContent="今日のぶんは受け取り済み";b.onclick=null;if(app)app.hidden=true;}
    else if(wsCanSign()&&app){
      /* ウォレットへ移せるところでは、どちらで受け取るかを選んでもらう */
      b.disabled=false;b.textContent="今日のぶん +1 EMUER を実EMUERでウォレットへ";b.onclick=claimEmuV2LoginReward;
      app.hidden=false;app.disabled=false;app.textContent="今日のぶん +1 EMUER をアプリ内EMUERで受け取る";app.onclick=claimEmuV2LoginRewardApp;
    }
    else{b.disabled=false;b.textContent="今日のぶん +1 EMUER を受け取る";b.onclick=claimEmuV2LoginReward;if(app)app.hidden=true;}
    wsChoiceNote();
  }catch(_){b.hidden=true;const app=wsLoginAppBtn();if(app)app.hidden=true;wsChoiceNote();}
}
async function wsRewards(){
  try{
    const r=await fetch(EMUER_V2_API+"/rewards?address="+encodeURIComponent(wsAccount()),{headers:await wsHeaders(false)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){wsHideClaim("報酬を読めませんでした（"+(d.error||r.status)+"）");return;}
    const a=(Array.isArray(d.rewards)?d.rewards:[]).filter(x=>!wsDone.has(String(x&&x.claimId)));
    if(!a.length){
      /* 毎日のぶんが受け取れるのに「ありません」と言い切ると、
         すぐ下に出ているボタンと食い違う。 */
      /* 出していると分かっているときだけ、言い方を変える。
         hidden / disabled が未設定のものを「出ている」と見なさない。 */
      const lb=document.getElementById("wsLogin");
      const daily=!!lb&&lb.hidden===false&&lb.disabled===false;
      wsHideClaim(daily?"活動でたまった報酬は、いまはありません。":"受け取り待ちの報酬はありません。");
      return;}
    const total=a.reduce((n,x)=>n+(Number(x.amount)||0),0);
    /* 2件以上あれば、まとめて1回で受け取る（MetaMask の承認もガス代も1回）。
       1件ずつだと、そのたびにガス代がかかっていた。
       前にまとめたぶん（kind:"bundle"）が1件だけ残っているときは、その札のまま受け取る。 */
    /* MetaMask が無いところでは、ウォレットへ移せない。押せそうな「受け取る」を出すと、
       押しても案内が出るだけで「受け取れない」ように見える（10/29 オーナーから）。
       受け取る前のEMUERは公式ショップでそのまま使えるので、そう書いて、公式ショップを開くボタンにする。 */
    if(!wsCanSign()){
      const st=document.getElementById("wsStatus");
      if(st)st.textContent=`受け取る前のEMUERが ${total.toLocaleString("ja-JP")} EMUER あります（${a.length}件）。City の公式ショップでそのまま使えます。ウォレットへ移すときは、MetaMask の入ったブラウザで開いてください。`;
      wsClaimLabel("City の公式ショップで使う",wsOpenShop,false);
      if(typeof wsAppOption==="function")wsAppOption(null);
      return;}
    /* ウォレットへ移せるところでも、アプリ内EMUERのまま使う道を並べる（11/14）。
       受け取る前のEMUERは、そのままでアプリ内EMUER（オフチェーン）として公式ショップで使える。 */
    const st=document.getElementById("wsStatus");
    if(st)st.textContent=`公式ショップ・みてみる用のアプリ内EMUERが ${total.toLocaleString("ja-JP")} EMUER あります（${a.length}件）。`;
    const label=a.length>1
      ? `実EMUERとしてウォレットへ：${total.toLocaleString("ja-JP")} EMUER（${a.length}件）をまとめて受け取る`
      : `実EMUERとしてウォレットへ：${total.toLocaleString("ja-JP")} EMUER を受け取る`;
    wsClaimLabel(label,a.length>1?()=>wsClaimAll(a):()=>wsClaim(a[0]),false);
    if(typeof wsAppOption==="function")wsAppOption("アプリ内EMUERのまま使う（City の公式ショップ）",wsOpenShop);
  }catch(e){wsHideClaim(String(e&&e.message||"報酬を読めませんでした"));}
}
/* 受け取りの画面を閉じて、City の公式ショップ（EMUERで交換する画面）を開く。 */
function wsOpenShop(){
  document.getElementById("walletSuccessOverlay").classList.remove("active");
  wsFromWallet=false;
  if(typeof window.openEmuShopping==="function")window.openEmuShopping("commerce");
}
async function wsClaim(row){
  if(!wsCanSign()){alert(WS_NO_WALLET);return;}
  try{if(typeof wsAppOption==="function")wsAppOption(null);wsClaimLabel("署名を準備中…",null,true);const r=await fetch(EMUER_V2_API+"/rewards/"+encodeURIComponent(row.claimId)+"/authorization",{method:"POST",headers:await wsHeaders(true),body:JSON.stringify({address:wsAccount()})}),d=await r.json();if(!r.ok)throw new Error(d.error||"報酬を準備できませんでした");const p=new ethers.providers.Web3Provider(window.ethereum);if(Number((await p.getNetwork()).chainId)!==137)throw new Error("Polygon Mainnetに切り替えてください");const x=d.reward,c=new ethers.Contract(emuerV2Config.contract,EMUER_V2_ABI,p.getSigner());wsClaimLabel("MetaMaskで確認…",null,true);await(await c.claimReward(x.claimId,x.totalAmount,x.deadline,x.authorization)).wait();
    /* 受け取れたことを、はっきり出す。お金が動いたのに画面が
       黙っていると、通ったのかどうか分からない。 */
    const got=Number(row&&row.amount)||0;
    document.getElementById("wsStatus").textContent=
      got?`${got.toLocaleString("ja-JP")} EMUER を受け取りました`:"受け取りました";
    wsDone.add(String(row&&row.claimId));
    /* 受け取ったのに、裏のウォレットの札が古いままだった。
       この modal の残高だけ直して、ページの数字は直していなかった。
       同じ画面で違う数字が出るので、まとめて書き替える。 */
    try{if(typeof window.emuerV2RefreshBalance==="function")await window.emuerV2RefreshBalance();}catch(_){}
    await wsBalance(wsAccount());await wsRewards();if(typeof wsRenderBreakdown==="function")wsRenderBreakdown(true);}catch(e){wsClaimLabel("報酬を受け取る",wsRewards,false);alert(e.message||"報酬の受取に失敗しました");}
}
/* まとめて受け取る。サーバーが未請求のぶんを1枚の札（合計額）にまとめて署名する。
   まとめた元の報酬はサーバー側で「まとめ済み」になり、一覧にもう出てこない。
   月の上限やトレジャリーで一部しか払われなかったときは、まとめた札が一覧に残り、
   次にその札のまま残りを受け取れる。 */
async function wsClaimAll(rows){
  if(!wsCanSign()){alert(WS_NO_WALLET);return;}
  try{
    if(typeof wsAppOption==="function")wsAppOption(null);
    wsClaimLabel("署名を準備中…",null,true);
    const r=await fetch(EMUER_V2_API+"/rewards/bundle",{method:"POST",headers:await wsHeaders(true),body:JSON.stringify({address:wsAccount()})}),d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error==="NOTHING_TO_BUNDLE"?"まとめられる報酬がありませんでした。少し待ってからもう一度お試しください。":(d.error||"報酬を準備できませんでした"));
    const p=new ethers.providers.Web3Provider(window.ethereum);
    if(Number((await p.getNetwork()).chainId)!==137)throw new Error("Polygon Mainnetに切り替えてください");
    const x=d.reward,c=new ethers.Contract(emuerV2Config.contract,EMUER_V2_ABI,p.getSigner());
    wsClaimLabel("MetaMaskで確認…",null,true);
    await(await c.claimReward(x.claimId,x.totalAmount,x.deadline,x.authorization)).wait();
    const got=Number(d.amount)||0;
    document.getElementById("wsStatus").textContent=
      (got?`${got.toLocaleString("ja-JP")} EMUER を受け取りました`:"受け取りました")+(d.count>1?`（${d.count}件）`:"");
    (rows||[]).forEach(row=>wsDone.add(String(row&&row.claimId)));
    wsDone.add(String(x&&x.claimId));
    try{if(typeof window.emuerV2RefreshBalance==="function")await window.emuerV2RefreshBalance();}catch(_){}
    await wsBalance(wsAccount());await wsRewards();if(typeof wsRenderBreakdown==="function")wsRenderBreakdown(true);
  }catch(e){
    /* まとめた札を作ったあとで止まったとき（MetaMask で断った等）は、まとめた札が一覧に出る。
       一覧を読み直して、出ているものを押せるようにする。 */
    await wsRewards();
    alert(e.message||"報酬の受取に失敗しました");
  }
}
/* MetaMask が無いときは、今日のぶんを「待っている報酬」として作るだけにする（サーバーは署名を出さない）。
   ウォレットに移す前のEMUERとして、すぐ公式ショップで使える。 */
async function wsRecordLoginReward(b){
  b.disabled=true;b.textContent="受け取っています…";
  const r=await fetch(EMUER_V2_API+"/daily/login",{method:"POST",headers:await wsHeaders(true),body:JSON.stringify({address:wsAccount(),claim:false})}),d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error==="SELF_CUSTODY_WALLET_REQUIRED"?"ウォレットを連携すると受け取れます。":(d.error||"ログイン報酬を受け取れませんでした"));
  b.disabled=true;b.textContent="今日のぶんは受け取り済み";b.onclick=null;
  const app=wsLoginAppBtn();if(app)app.hidden=true;wsChoiceNote();
  const st=document.getElementById("wsStatus");
  if(st)st.textContent="1 EMUER を受け取りました。ウォレットに移す前のEMUERとしてたまり、City の公式ショップでそのまま使えます。";
  try{if(typeof window.emuerV2RefreshBalance==="function")await window.emuerV2RefreshBalance();}catch(_){}
  if(typeof wsRenderBreakdown==="function")wsRenderBreakdown(true);
}
/* ウォレットへ移せるところで「アプリ内EMUERで受け取る」を選んだとき。署名は頼まない。
   受け取ったぶんは一覧（受け取る前のEMUER）に出るので、あとでウォレットへ移すこともできる。 */
async function claimEmuV2LoginRewardApp(){
  const b=wsLoginBtn(),app=wsLoginAppBtn();
  if(b)b.disabled=true;if(app)app.disabled=true;
  try{
    await wsRecordLoginReward(b);
    const st=document.getElementById("wsStatus"),msg=st?st.textContent:"";
    await wsRewards();
    /* 一覧を読み直すと上の知らせが書き替わるので、受け取った知らせを先に戻す */
    if(st&&msg)st.textContent=msg+" "+st.textContent;
  }catch(e){await wsDaily();alert(e.message||"ログイン報酬の受取に失敗しました");}
}
async function claimEmuV2LoginReward(){
  try{
    const b=wsLoginBtn();
    if(!wsCanSign())return await wsRecordLoginReward(b);
    const app=wsLoginAppBtn();if(app){app.hidden=true;wsChoiceNote();}
    b.disabled=true;b.textContent="署名を準備中…";
    const r=await fetch(EMUER_V2_API+"/daily/login",{method:"POST",headers:await wsHeaders(true),body:JSON.stringify({address:wsAccount()})}),d=await r.json();
    if(!r.ok)throw new Error(d.error||"ログイン報酬を準備できませんでした");
    const p=new ethers.providers.Web3Provider(window.ethereum);
    if(Number((await p.getNetwork()).chainId)!==137)throw new Error("Polygon Mainnetに切り替えてください");
    const x=d.reward,c=new ethers.Contract(emuerV2Config.contract,EMUER_V2_ABI,p.getSigner());
    b.textContent="MetaMaskで確認…";
    await(await c.claimReward(x.claimId,x.totalAmount,x.deadline,x.authorization)).wait();
    b.disabled=true;b.textContent="今日のぶんは受け取り済み";b.onclick=null;
    const st=document.getElementById("wsStatus");
    if(st)st.textContent="1 EMUER を受け取りました";
    /* 毎日のぶんは、押したときに「待っている報酬」として作られる。
       受け取ったあともサーバーの一覧にしばらく残るので、こちらで外す。
       外さないと、すぐ下の一覧に同じものが出て、押すと鎖が
       ClaimUnavailable を返す（受け取り済みのため）。 */
    wsDone.add(String(x&&x.claimId));
    try{if(typeof window.emuerV2RefreshBalance==="function")await window.emuerV2RefreshBalance();}catch(_){}
    await wsBalance(wsAccount());
    await wsRewards();
  }catch(e){
    /* 断った・失敗したときは、2つの選び方をもう一度出す */
    try{await wsDaily();}catch(_){const b=wsLoginBtn();if(b){b.disabled=false;b.textContent="今日のぶん +1 EMUER を受け取る";b.onclick=claimEmuV2LoginReward;}}
    alert(e.message||"ログイン報酬の受取に失敗しました");
  }
}
/* ── EMUERのうちわけ（11/15 オーナー：「ばらばらすぎる。通信エラーなのか、本当に無いのか、あるのか、はっきりして」）──

   EMUERは3つの場所にある。画面ごとに別の場所だけを「残高」と呼んでいたので、同じ人に 0・2・0 と違う数が出ていた。
     ・実EMUER（ウォレット）……Polygon のコントラクトの残高。読むのは公開のRPC（MetaMask が無くても読める）
     ・アプリ内EMUER（公式ショップ・みてみる用）……受け取る前の報酬（/api/emuer/v2/rewards）
     ・アプリ内EMUER（応援・協賛・投票用）……応援の台帳（/api/emu/gifts/me）
   どの画面も、この1つの読み方で3つを同じ名前で出す。読めなかったものは 0 にせず「読み込めませんでした」と出す。 */
const EMU_SUM_RPCS=["https://polygon-bor-rpc.publicnode.com","https://polygon.drpc.org","https://1rpc.io/matic"];
const EMU_GIFTS_API="https://emu-realtime.onrender.com/api/emu/gifts";
let emuSumCache=null;
async function emuSumPart(fn){try{return{state:"ok",value:Number(await fn())||0};}catch(e){return{state:"error",message:String(e&&e.message||e)};}}
async function emuSumChain(addr,cfg){
  if(!cfg||!cfg.enabled||!cfg.contract)throw new Error("CONFIG_UNAVAILABLE");
  if(!window.ethers)throw new Error("ETHERS_UNAVAILABLE");
  let last=null;
  for(const url of EMU_SUM_RPCS){
    try{const p=new ethers.providers.StaticJsonRpcProvider(url,{name:"matic",chainId:137});
      const v=await new ethers.Contract(cfg.contract,["function balanceOf(address) view returns (uint256)"],p).balanceOf(addr);
      return Number(ethers.utils.formatUnits(v,18));}catch(e){last=e;}
  }
  throw last||new Error("RPC_UNAVAILABLE");
}
window.emuEmuerSummary=function(force){
  const addr=wsAccount();
  if(!force&&emuSumCache&&emuSumCache.addr===addr&&Date.now()-emuSumCache.at<20000)return emuSumCache.promise;
  const promise=(async()=>{
    if(!addr)return{address:"",chain:{state:"none"},shop:{state:"none"},cheer:{state:"none"}};
    let cfg=null;try{cfg=await window.emuerV2ConfigOnce();}catch(_){}
    const [chain,shop,cheer]=await Promise.all([
      emuSumPart(()=>emuSumChain(addr,cfg)),
      emuSumPart(async()=>{const r=await fetch(EMUER_V2_API+"/rewards?address="+encodeURIComponent(addr),{headers:await wsHeaders(false)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||("HTTP "+r.status));
        return(Array.isArray(d.rewards)?d.rewards:[]).filter(x=>!wsDone.has(String(x&&x.claimId))).reduce((n,x)=>n+(Number(x.amount)||0),0);}),
      emuSumPart(async()=>{const r=await fetch(EMU_GIFTS_API+"/me",{headers:await wsHeaders(true)});const d=await r.json().catch(()=>({}));if(!r.ok||typeof d.balance!=="number")throw new Error(d.error||("HTTP "+r.status));return d.balance;})
    ]);
    return{address:addr,chain,shop,cheer};
  })();
  emuSumCache={addr,at:Date.now(),promise};
  return promise;
};
function emuSumValue(p){return p&&p.state==="ok"?Number(p.value).toLocaleString("ja-JP")+" EMUER":p&&p.state==="error"?"読み込めませんでした（通信エラー）":"—";}
/* うちわけの表（文字はすべてこちらで決めたもの。数は数として出す） */
window.emuEmuerBreakdownHtml=function(s){
  const rows=[["実EMUER（ウォレット）",s.chain],["アプリ内EMUER（公式ショップ・みてみる用）",s.shop],["アプリ内EMUER（応援・協賛・投票用）",s.cheer]];
  const all=rows.every(r=>r[1]&&r[1].state==="ok");
  const anyErr=rows.some(r=>r[1]&&r[1].state==="error");
  const total=all?rows.reduce((n,r)=>n+r[1].value,0):null;
  return '<div class="emu-sum" data-emu-sum>'+rows.map(r=>'<div class="emu-sum-row"><span>'+r[0]+'</span><b class="'+(r[1]&&r[1].state==="error"?"emu-sum-err":"")+'">'+emuSumValue(r[1])+'</b></div>').join("")
    +(all?'<div class="emu-sum-row emu-sum-total"><span>合計</span><b>'+total.toLocaleString("ja-JP")+' EMUER</b></div>':"")
    +(anyErr?'<div class="emu-sum-err">読み込めなかったところは、0 ではなく「まだ分からない」です。</div><button type="button" class="emu-sum-reload" data-emu-sum-reload>もう一度読み込む</button>':"")
    +'</div>';
};
window.emuEmuerSummaryTotal=function(s){return["chain","shop","cheer"].every(k=>s[k]&&s[k].state==="ok")?s.chain.value+s.shop.value+s.cheer.value:null;};
/* 1つの箱にうちわけを描く。「もう一度読み込む」で読み直す。 */
window.emuRenderEmuerBreakdown=async function(box,force,after){
  if(!box)return null;
  box.innerHTML='<div class="emu-sum">EMUERのうちわけを読み込んでいます…</div>';
  const s=await window.emuEmuerSummary(force);
  if(!box.isConnected)return s;
  box.innerHTML=window.emuEmuerBreakdownHtml(s);
  const b=box.querySelector("[data-emu-sum-reload]");
  if(b)b.onclick=()=>window.emuRenderEmuerBreakdown(box,true,after);
  if(typeof after==="function")try{after(s);}catch(_){}
  return s;
};
function wsRenderBreakdown(force){return window.emuRenderEmuerBreakdown(document.getElementById("wsBreakdown"),force);}
window.addEventListener("load",async()=>{try{const c=await window.emuerV2ConfigOnce();if(!c||!c.enabled||Number(c.chainId)!==137)return;emuerV2Config=c;wsAddWalletButton();}catch(_){}});
/* 毎日のぶんは、受け取りの modal を開いたときに wsDaily() が読む。
   ここで先に読むと、開いていない人のぶんまで毎回サーバーに聞くことになる。 */
/* Good・Change を受け取った投稿者への報酬（1件 1 EMUER）を、サーバーに記録してもらう。

   前は、JSON の印（Content-Type）を付けずに送っていたので、サーバーは中身を読めずに断っていた。
   しかも失敗を黙って捨て、設定（/config）を読み終える前に押されたときは送りもしなかった。
   だから Good・Change の報酬は、記録されていなかった（10/29 に分かった）。

   いまは設定を待って送り、届かなかったものは端末に残して、次に開いたときに送り直す。
   サーバーは同じ反応を1つとしか数えないので、何度送っても二重にはならない。 */
const WS_REACTION_QUEUE="emuReactionRewardQueue";
function wsReactionQueue(){try{const v=JSON.parse(localStorage.getItem(WS_REACTION_QUEUE)||"[]");return Array.isArray(v)?v:[];}catch(_){return[];}}
function wsSaveReactionQueue(q){try{q.length?localStorage.setItem(WS_REACTION_QUEUE,JSON.stringify(q.slice(-50))):localStorage.removeItem(WS_REACTION_QUEUE);}catch(_){}}
/* 1件送る。"done"（記録できた／送っても意味がない）か "later"（あとで送り直す）を返す。 */
async function wsSendReaction(item){
  let c=null;
  try{c=await window.emuerV2ConfigOnce();}catch(_){return "later";}
  if(!c)return "later";
  if(!c.enabled)return "done";
  const address=wsAccount();
  if(!address)return "later";
  try{
    // 裏で送るので、ログインの確かめで MetaMask などを開かせない（interactive:false）
    if(typeof window.emuAuthHeaders!=="function")return "later";
    const headers=await window.emuAuthHeaders(true,{interactive:false});
    const r=await fetch(EMUER_V2_API+"/activity/reaction",{method:"POST",headers,
      body:JSON.stringify({postId:item.postId,action:item.action,address})});
    if(r.ok)return "done";
    // 送り方が悪い・投稿が無い・反応がまだ見えない（409）は、送り直しても同じなので捨てる。
    // サーバーの不調（5xx）や、ログインが切れていた（401）は、あとで送り直す。
    return r.status>=500||r.status===401?"later":"done";
  }catch(_){return "later";}
}
let wsFlushing=false,wsFlushAgain=false;
const wsReactionKey=x=>x.postId+":"+x.action+":"+x.at;
async function wsFlushReactions(){
  if(wsFlushing){wsFlushAgain=true;return;}
  wsFlushing=true;
  try{
    do{
      wsFlushAgain=false;
      const done=new Set();
      for(const item of wsReactionQueue()){
        // 1週間たっても届かないものは捨てる（端末に溜め続けない）
        if(Date.now()-Number(item.at||0)>7*24*60*60*1000||await wsSendReaction(item)==="done")done.add(wsReactionKey(item));
      }
      // 送っているあいだに足されたものは残す
      wsSaveReactionQueue(wsReactionQueue().filter(x=>!done.has(wsReactionKey(x))));
    }while(wsFlushAgain);
  }finally{wsFlushing=false;}
}
window.addEventListener("emu-reaction-result",e=>{
  const d=e?.detail;
  if(!d?.ok||!d.postId||!["good","change"].includes(d.action))return;
  const q=wsReactionQueue().filter(x=>!(x.postId===String(d.postId)&&x.action===d.action));
  q.push({postId:String(d.postId),action:d.action,at:Date.now()});
  wsSaveReactionQueue(q);
  wsFlushReactions();
});
/* 前に届かなかったぶんを、開いたときに送り直す（ログインの確かめが済むのを少し待つ）。 */
window.addEventListener("load",()=>{setTimeout(wsFlushReactions,3000);});

/* 初投稿キャンペーン（2026/10/29〜11/28、日本時間）。初めて知識を公開したら、その場で
   100 EMUER が「受け取る前のEMUER」に入る。公式ショップでそのまま使える。パスポートごとに1回。
   本当に初めての投稿か・期間内か・1回目かは、サーバーが投稿を読み直して決める。
   ここは、新しく公開した投稿を知らせるだけ。届かなかったら端末に残して、次に開いたときに送り直す。
   決着がついた（受け取れた／対象外だった）名義には、もう送らない。 */
const WS_FIRST_POST_QUEUE="emuFirstPostCampaign";
const WS_FIRST_POST_END=Date.parse("2026-11-29T00:00:00+09:00");
function wsFirstPostState(){try{const v=JSON.parse(localStorage.getItem(WS_FIRST_POST_QUEUE)||"{}");return v&&typeof v==="object"?v:{};}catch(_){return{};}}
function wsSaveFirstPostState(s){try{localStorage.setItem(WS_FIRST_POST_QUEUE,JSON.stringify(s));}catch(_){}}
function wsFirstPostNotice(text,withShop){
  document.getElementById("wsFirstPostNotice")?.remove();
  const box=document.createElement("div");
  box.id="wsFirstPostNotice";box.setAttribute("role","status");
  box.style.cssText="position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:10050;width:min(92vw,420px);"+
    "background:#fff;color:#1f2a24;border:2px solid #1a8a5a;border-radius:14px;padding:14px 16px;box-shadow:0 8px 24px rgba(0,0,0,.18);font-size:14px;line-height:1.6";
  const p=document.createElement("div");p.textContent=text;box.appendChild(p);
  const row=document.createElement("div");row.style.cssText="display:flex;gap:8px;justify-content:flex-end;margin-top:10px";
  const btn=(label,primary,fn)=>{const b=document.createElement("button");b.type="button";b.textContent=label;
    b.style.cssText="border-radius:999px;padding:8px 14px;font-weight:700;cursor:pointer;"+(primary?"background:#1a8a5a;color:#fff;border:0":"background:#fff;color:#1a8a5a;border:1px solid #1a8a5a");
    b.onclick=()=>{box.remove();fn&&fn();};row.appendChild(b);};
  if(withShop)btn("公式ショップで使う",true,()=>{if(typeof window.openEmuShopping==="function")window.openEmuShopping("commerce");});
  btn("閉じる",!withShop,null);
  box.appendChild(row);document.body.appendChild(box);
}
/* 1件送る。"done"（決着がついた）か "later"（あとで送り直す）を返す。 */
async function wsSendFirstPost(item){
  let c=null;
  try{c=await window.emuerV2ConfigOnce();}catch(_){return "later";}
  if(!c)return "later";
  if(!c.enabled)return "done";
  if(typeof window.emuAuthHeaders!=="function")return "later";
  try{
    const headers=await window.emuAuthHeaders(true,{interactive:false});
    const r=await fetch(EMUER_V2_API+"/activity/first-post",{method:"POST",headers,body:JSON.stringify({postId:item.postId})});   // 名義はサーバーがログインから決める
    const d=await r.json().catch(()=>({}));
    if(r.ok){
      if(!d.alreadyRecorded)wsFirstPostNotice(`🎉 初投稿キャンペーン：${Number(d.amount||100).toLocaleString("ja-JP")} EMUER を受け取りました。「受け取る前のEMUER」に入っています。SchoolPark City の公式ショップで、そのまま使えます。`,true);
      return "done";
    }
    // パスポートがまだ無い人は、作ったあとに送り直せば受け取れる。一度だけ知らせる
    if(d.error==="PASSPORT_REQUIRED"){
      if(!item.toldPassport){item.toldPassport=true;wsFirstPostNotice("初投稿キャンペーンの 100 EMUER は、パスポート（SchoolPark ID）を作ると受け取れます。作ったあと、Emu を開き直してください。",false);}
      return "later";
    }
    return r.status>=500||r.status===401?"later":"done";
  }catch(_){return "later";}
}
let wsFirstPostBusy=false;
async function wsFlushFirstPost(){
  if(wsFirstPostBusy)return;
  wsFirstPostBusy=true;
  try{
    const s=wsFirstPostState();
    const item=s.pending;
    if(!item||!item.postId||!item.address)return;
    // 期間が終わって1週間たっても届かないものは捨てる（端末に溜め続けない）
    const result=Date.now()-WS_FIRST_POST_END>7*24*60*60*1000?"done":await wsSendFirstPost(item);
    const now=wsFirstPostState();
    if(result==="done"){now.settled={...(now.settled||{}),[item.address]:Date.now()};delete now.pending;}
    else now.pending=item;   // toldPassport を残す
    wsSaveFirstPostState(now);
  }finally{wsFirstPostBusy=false;}
}
window.addEventListener("emu-post-published",e=>{
  const d=e?.detail;
  const address=String(d?.address||"").toLowerCase();
  if(!d?.postId||!address||Date.now()>=WS_FIRST_POST_END)return;
  const s=wsFirstPostState();
  if(s.settled&&s.settled[address])return;
  // 送り直し待ちがあれば、そちらが先の投稿。新しい投稿で置き換えない
  if(!s.pending||s.pending.address!==address)s.pending={postId:String(d.postId),address,at:Date.now()};
  wsSaveFirstPostState(s);
  wsFlushFirstPost();
});
window.addEventListener("load",()=>{setTimeout(wsFlushFirstPost,3500);});
