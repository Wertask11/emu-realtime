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
  document.body.insertAdjacentHTML("beforeend",'<div id="walletSuccessOverlay"><section id="walletSuccessCard"><h2>ウォレット接続完了</h2><p id="wsAddress" class="ws-sub"></p><p class="ws-sub">EMUER残高</p><p id="wsBalance" class="ws-balance">---</p><p id="wsStatus" class="ws-sub"></p><button id="wsLogin" class="ws-btn" hidden></button><button id="wsClaim" class="ws-btn" hidden></button><button class="ws-btn ws-close" onclick="closeWalletSuccessAndStart()">SchoolParkを始める</button></section></div>');
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
function wsClaimLabel(text,fn,disabled){const b=wsBtn();if(!b)return;b.hidden=false;b.textContent=text;b.disabled=!!disabled;b.onclick=fn;}
/* 受け取るものが無い・読めないときは、黙らずに理由を出す。
   お金の画面で何も出ないのは、壊れているのと見分けがつかない。 */
function wsHideClaim(why){const b=wsBtn();if(b)b.hidden=true;const s=document.getElementById("wsStatus");if(s&&why)s.textContent=why;}
async function wsBalance(account){
  if(!wsCanSign()){document.getElementById("wsBalance").textContent="—";document.getElementById("wsStatus").textContent="ウォレットの残高は、MetaMask の入ったブラウザで出ます。";return;}
  try{const p=new ethers.providers.Web3Provider(window.ethereum);const addr=emuerV2Config?.enabled?emuerV2Config.contract:window.EMUER_CONTRACT_ADDRESS;const abi=emuerV2Config?.enabled?["function balanceOf(address) view returns (uint256)"]:window.EMUER_CONTRACT_ABI;const x=await new ethers.Contract(addr,abi,p).balanceOf(account);document.getElementById("wsBalance").textContent=Number(ethers.utils.formatUnits(x,18)).toLocaleString("ja-JP");document.getElementById("wsStatus").textContent="残高を確認しました";}catch(_){document.getElementById("wsStatus").textContent="残高を取得できませんでした";}
}
async function showWalletSuccessModal(account){document.getElementById("walletSuccessOverlay").classList.add("active");document.getElementById("wsAddress").textContent=account.slice(0,6)+"…"+account.slice(-4);await wsBalance(account);if(emuerV2Config?.enabled){await wsDaily();await wsRewards();}}
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
    /* サーバーが返すのは claimedToday。claimed を見ていたので、
       受け取り済みでも「受け取れます」と出ていた。 */
    if(d.claimedToday){b.disabled=true;b.textContent="今日のぶんは受け取り済み";b.onclick=null;}
    else{b.disabled=false;b.textContent="今日のぶん +1 EMUER を受け取る";b.onclick=claimEmuV2LoginReward;}
  }catch(_){b.hidden=true;}
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
    const label=a.length>1
      ? `未請求の報酬 ${total.toLocaleString("ja-JP")} EMUER（${a.length}件）をまとめて受け取る`
      : `未請求の報酬 ${total.toLocaleString("ja-JP")} EMUER を受け取る`;
    wsClaimLabel(label,a.length>1?()=>wsClaimAll(a):()=>wsClaim(a[0]),false);
  }catch(e){wsHideClaim(String(e&&e.message||"報酬を読めませんでした"));}
}
async function wsClaim(row){
  if(!wsCanSign()){alert(WS_NO_WALLET);return;}
  try{wsClaimLabel("署名を準備中…",null,true);const r=await fetch(EMUER_V2_API+"/rewards/"+encodeURIComponent(row.claimId)+"/authorization",{method:"POST",headers:await wsHeaders(true),body:JSON.stringify({address:wsAccount()})}),d=await r.json();if(!r.ok)throw new Error(d.error||"報酬を準備できませんでした");const p=new ethers.providers.Web3Provider(window.ethereum);if(Number((await p.getNetwork()).chainId)!==137)throw new Error("Polygon Mainnetに切り替えてください");const x=d.reward,c=new ethers.Contract(emuerV2Config.contract,EMUER_V2_ABI,p.getSigner());wsClaimLabel("MetaMaskで確認…",null,true);await(await c.claimReward(x.claimId,x.totalAmount,x.deadline,x.authorization)).wait();
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
    await wsBalance(wsAccount());await wsRewards();}catch(e){wsClaimLabel("報酬を受け取る",wsRewards,false);alert(e.message||"報酬の受取に失敗しました");}
}
/* まとめて受け取る。サーバーが未請求のぶんを1枚の札（合計額）にまとめて署名する。
   まとめた元の報酬はサーバー側で「まとめ済み」になり、一覧にもう出てこない。
   月の上限やトレジャリーで一部しか払われなかったときは、まとめた札が一覧に残り、
   次にその札のまま残りを受け取れる。 */
async function wsClaimAll(rows){
  if(!wsCanSign()){alert(WS_NO_WALLET);return;}
  try{
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
    await wsBalance(wsAccount());await wsRewards();
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
  const st=document.getElementById("wsStatus");
  if(st)st.textContent="1 EMUER を受け取りました。ウォレットに移す前のEMUERとしてたまり、City の公式ショップでそのまま使えます。";
  try{if(typeof window.emuerV2RefreshBalance==="function")await window.emuerV2RefreshBalance();}catch(_){}
}
async function claimEmuV2LoginReward(){
  try{
    const b=wsLoginBtn();
    if(!wsCanSign())return await wsRecordLoginReward(b);
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
    const b=wsLoginBtn();
    if(b){b.disabled=false;b.textContent="今日のぶん +1 EMUER を受け取る";b.onclick=claimEmuV2LoginReward;}
    alert(e.message||"ログイン報酬の受取に失敗しました");
  }
}
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