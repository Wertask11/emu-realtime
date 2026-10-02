/* Wallet UI.  Legacy airdrop signing has been removed. */
const EMUER_V2_API="https://emu-realtime.onrender.com/api/emuer/v2";
const EMUER_V2_ABI=["function claimReward(bytes32,uint256,uint256,bytes) returns (uint256)"];
let emuerV2Config=null;
const emuerReflectionScript=document.createElement("script");
emuerReflectionScript.src="/change-reflection-ui.js";
document.head.appendChild(emuerReflectionScript);
const emuerDiscussionRewardScript=document.createElement("script");
emuerDiscussionRewardScript.src="/discussion-reward-ui.js";
document.head.appendChild(emuerDiscussionRewardScript);
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
  s.textContent="#walletSuccessOverlay{display:none;position:fixed;inset:0;background:#000b;z-index:9999;align-items:center;justify-content:center}#walletSuccessOverlay.active{display:flex}#walletSuccessCard{background:#fff;border-radius:18px;padding:30px;max-width:360px;width:calc(100% - 44px);text-align:center;color:#172033}.ws-balance{font-size:32px;font-weight:700;color:#167653;margin:8px}.ws-sub{font-size:13px;color:#667085}.ws-btn{width:100%;border:0;border-radius:10px;padding:13px;margin-top:10px;background:#265dd7;color:#fff;font-weight:700;cursor:pointer}.ws-btn:disabled{background:#aab4c8}.ws-close{background:#eef2f8;color:#273047}";
  document.head.appendChild(s);
  document.body.insertAdjacentHTML("beforeend",'<div id="walletSuccessOverlay"><section id="walletSuccessCard"><h2>ウォレット接続完了</h2><p id="wsAddress" class="ws-sub"></p><p class="ws-sub">EMUER残高</p><p id="wsBalance" class="ws-balance">---</p><p id="wsStatus" class="ws-sub"></p><button id="wsClaim" class="ws-btn" hidden></button><button class="ws-btn ws-close" onclick="closeWalletSuccessAndStart()">SchoolParkを始める</button></section></div>');
})();
const wsAccount=()=>String(window.connectedAccount||"").toLowerCase();
const wsBtn=()=>document.getElementById("wsClaim");
const wsLoginBtn=()=>document.getElementById("emuLoginBonusBtn");
async function wsHeaders(interactive){if(typeof window.emuAuthHeaders!=="function")throw new Error("再ログインしてください。");return window.emuAuthHeaders(!!interactive);}
function wsClaimLabel(text,fn,disabled){const b=wsBtn();if(!b)return;b.hidden=false;b.textContent=text;b.disabled=!!disabled;b.onclick=fn;}
/* 受け取るものが無い・読めないときは、黙らずに理由を出す。
   お金の画面で何も出ないのは、壊れているのと見分けがつかない。 */
function wsHideClaim(why){const b=wsBtn();if(b)b.hidden=true;const s=document.getElementById("wsStatus");if(s&&why)s.textContent=why;}
async function wsBalance(account){
  try{const p=new ethers.providers.Web3Provider(window.ethereum);const addr=emuerV2Config?.enabled?emuerV2Config.contract:window.EMUER_CONTRACT_ADDRESS;const abi=emuerV2Config?.enabled?["function balanceOf(address) view returns (uint256)"]:window.EMUER_CONTRACT_ABI;const x=await new ethers.Contract(addr,abi,p).balanceOf(account);document.getElementById("wsBalance").textContent=Number(ethers.utils.formatUnits(x,18)).toLocaleString("ja-JP");document.getElementById("wsStatus").textContent="残高を確認しました";}catch(_){document.getElementById("wsStatus").textContent="残高を取得できませんでした";}
}
async function showWalletSuccessModal(account){document.getElementById("walletSuccessOverlay").classList.add("active");document.getElementById("wsAddress").textContent=account.slice(0,6)+"…"+account.slice(-4);await wsBalance(account);if(emuerV2Config?.enabled)await wsRewards();}
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
async function wsRewards(){
  try{
    const r=await fetch(EMUER_V2_API+"/rewards?address="+encodeURIComponent(wsAccount()),{headers:await wsHeaders(false)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){wsHideClaim("報酬を読めませんでした（"+(d.error||r.status)+"）");return;}
    const a=Array.isArray(d.rewards)?d.rewards:[];
    if(!a.length){wsHideClaim("受け取り待ちの報酬はありません。");return;}
    const total=a.reduce((n,x)=>n+(Number(x.amount)||0),0);
    const label=a.length>1
      ? `未請求の報酬 ${total.toLocaleString("ja-JP")} EMUER（${a.length}件）のうち1件を受け取る`
      : `未請求の報酬 ${total.toLocaleString("ja-JP")} EMUER を受け取る`;
    wsClaimLabel(label,()=>wsClaim(a[0]),false);
  }catch(e){wsHideClaim(String(e&&e.message||"報酬を読めませんでした"));}
}
async function wsClaim(row){
  try{wsClaimLabel("署名を準備中…",null,true);const r=await fetch(EMUER_V2_API+"/rewards/"+encodeURIComponent(row.claimId)+"/authorization",{method:"POST",headers:await wsHeaders(true),body:JSON.stringify({address:wsAccount()})}),d=await r.json();if(!r.ok)throw new Error(d.error||"報酬を準備できませんでした");const p=new ethers.providers.Web3Provider(window.ethereum);if(Number((await p.getNetwork()).chainId)!==137)throw new Error("Polygon Mainnetに切り替えてください");const x=d.reward,c=new ethers.Contract(emuerV2Config.contract,EMUER_V2_ABI,p.getSigner());wsClaimLabel("MetaMaskで確認…",null,true);await(await c.claimReward(x.claimId,x.totalAmount,x.deadline,x.authorization)).wait();
    /* 受け取れたことを、はっきり出す。お金が動いたのに画面が
       黙っていると、通ったのかどうか分からない。 */
    const got=Number(row&&row.amount)||0;
    document.getElementById("wsStatus").textContent=
      got?`${got.toLocaleString("ja-JP")} EMUER を受け取りました`:"受け取りました";
    await wsBalance(wsAccount());await wsRewards();}catch(e){wsClaimLabel("報酬を受け取る",wsRewards,false);alert(e.message||"報酬の受取に失敗しました");}
}
async function claimEmuV2LoginReward(){
  try{const b=wsLoginBtn();b.disabled=true;b.textContent="署名を準備中…";const r=await fetch(EMUER_V2_API+"/daily/login",{method:"POST",headers:await wsHeaders(true),body:JSON.stringify({address:wsAccount()})}),d=await r.json();if(!r.ok)throw new Error(d.error||"ログイン報酬を準備できませんでした");const p=new ethers.providers.Web3Provider(window.ethereum);if(Number((await p.getNetwork()).chainId)!==137)throw new Error("Polygon Mainnetに切り替えてください");const x=d.reward,c=new ethers.Contract(emuerV2Config.contract,EMUER_V2_ABI,p.getSigner());await(await c.claimReward(x.claimId,x.totalAmount,x.deadline,x.authorization)).wait();b.textContent="本日は受取済み";}catch(e){const b=wsLoginBtn();b.disabled=false;b.textContent="+1 EMUER 受取";alert(e.message||"ログイン報酬の受取に失敗しました");}
}
window.addEventListener("load",async()=>{try{const r=await fetch(EMUER_V2_API+"/config"),c=await r.json();if(!r.ok||!c.enabled||Number(c.chainId)!==137)return;emuerV2Config=c;wsAddWalletButton();const b=wsLoginBtn();if(!b)return;if(Date.now()<Date.parse(c.startsAt)){b.disabled=true;b.textContent="10月1日開始";}else{b.disabled=false;b.textContent="+1 EMUER 受取";b.onclick=claimEmuV2LoginReward;}}catch(_){}});
window.addEventListener("emu-reaction-result",async e=>{const d=e?.detail;if(!emuerV2Config?.enabled||!d?.ok||!["good","change"].includes(d.action))return;try{await fetch(EMUER_V2_API+"/activity/reaction",{method:"POST",headers:await wsHeaders(false),body:JSON.stringify({postId:d.postId,action:d.action,address:wsAccount()})});}catch(_){}});