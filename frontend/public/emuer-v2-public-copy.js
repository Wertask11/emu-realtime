/* Public-facing EMUER v2 wording and balance adapter. */
(function () {
  const API = "https://emu-realtime.onrender.com/api/emuer/v2";
  const ABI = ["function balanceOf(address) view returns (uint256)", "function claimReward(bytes32,uint256,uint256,bytes) returns (uint256)"];
  const START_MESSAGE = "新しいEMUERの仕組みは2026年10月1日開始予定です。";
  let config = null;
  const account = () => String(window.connectedAccount || "").toLowerCase();
  const byId = (id) => document.getElementById(id);
  async function headers(interactive) { if (typeof window.emuAuthHeaders !== "function") throw new Error("再ログインしてください。"); return window.emuAuthHeaders(!!interactive); }
  function setText(id, value) { const node = byId(id); if (!node) return; if (node.textContent !== value) node.textContent = value; node.removeAttribute("data-i18n"); }
  function hide(node) { if (node && node.style.display !== "none") node.style.display = "none"; }
  function waitingForStart() { return !!config && Date.now() < Date.parse(config.startsAt); }
  function ensureNotice(container, id, text) {
    if (!container) return;
    let notice = byId(id);
    if (!notice) {
      notice = document.createElement("p");
      notice.id = id;
      notice.style.cssText = "margin:8px 0 0;font-size:12px;line-height:1.7;color:#8a5b18;";
      container.appendChild(notice);
    }
    if (notice.textContent !== text) notice.textContent = text;
    const shouldHide = !waitingForStart();
    if (notice.hidden !== shouldHide) notice.hidden = shouldHide;
  }
  function lockButton(button) {
    if (!button) return;
    if (!button.disabled) button.disabled = true;
    if (button.textContent !== "2026年10月1日開始") button.textContent = "2026年10月1日開始";
    button.removeAttribute("data-i18n");
  }
  function applyPrelaunchLocks() {
    if (!waitingForStart()) return;
    const uses = byId("emuUsesPanel");
    if (uses) {
      const heading = uses.querySelector(".eth-section-head > div");
      ensureNotice(heading, "emuUsesStartNotice", START_MESSAGE + " 商品ごとの条件公開後に利用できます。");
      uses.querySelectorAll(".eth-use-row button").forEach(lockButton);
    }
    const wallet = document.querySelector("#emuValueProfile .eth-wallet-card");
    if (wallet) {
      ensureNotice(wallet.querySelector(".eth-section-head > div"), "emuWalletStartNotice", START_MESSAGE + " 現在の残高は保持されます。");
      const membership = byId("emuMembershipDesc");
      if (membership && membership.textContent !== "開始までは旧変換を利用できません。") membership.textContent = "開始までは旧変換を利用できません。";
      wallet.querySelectorAll(".eth-wallet-actions button").forEach(lockButton);
    }
  }
  function applyCopy() {
    if (!config) return;
    hide(byId("emuBalanceHint")); hide(byId("emuOffchainNote"));
    const head = byId("emuNextRewardLabel"); hide(head && head.parentElement);
    const progress = byId("emuTodayProgress"); hide(progress && progress.parentElement);
    setText("emuNextRewardNote", waitingForStart()
      ? START_MESSAGE + " 交換は、商品ごとの価格・提供条件・返金条件の公開後に開始します。"
      : "EMUERの交換は、商品ごとの価格・提供条件・返金条件を確認して利用できます。");
    const request = byId("emuRequestSheet");
    if (request) {
      const labels = request.querySelectorAll(".emu-field > label");
      if (labels[2]) labels[2].textContent = "採用・確認済みの回答へのEMUER報酬";
      const amount = request.querySelector(".emu-field > div[style]");
      if (amount) amount.textContent = "確認済みの回答に 1 EMUER";
      const description = request.querySelector(".emu-sheet-actions").previousElementSibling;
      if (description && description.tagName === "P") description.textContent = "募集者の残高は減りません。採用後、基準確認を通った回答者へ運営トレジャリーから1 EMUERが付与されます。";
      if (waitingForStart()) {
        const submit = byId("emuRequestSubmit");
        if (submit) { submit.disabled = true; submit.textContent = "2026年10月1日開始"; }
        request.querySelectorAll("button").forEach((button) => {
          if (/採用|EMUERで採用/.test(button.textContent)) { button.disabled = true; button.textContent = "2026年10月1日開始"; }
        });
      }
    }
    hide(byId("pp-campaign-section"));
    ensureNotice(byId("pp-emuer-section"), "ppEmuerStartNotice", START_MESSAGE + " 現在の残高は保持されます。");
    const uses = byId("emuUsesPanel");
    if (uses) { const title = uses.querySelector("h3"); if (title) title.textContent = "EMUERの交換・利用"; }
    applyPrelaunchLocks();
  }
  /* 書けたかどうかを返す。書けていないのに「旧EMUER」の行を出すと、
     同じ数字が二度出る。 */
  async function refreshBalance() {
    if (!config || !account() || !window.ethereum || !window.ethers) return false;
    try { const provider = new ethers.providers.Web3Provider(window.ethereum); const value = await new ethers.Contract(config.contract, ABI, provider).balanceOf(account()); const formatted = Number(ethers.utils.formatUnits(value, 18)).toLocaleString("ja-JP"); ["emuTodayBalance", "emuWalletBalance", "pp-emuer-num", "pp-emuer-balance-main"].forEach((id) => setText(id, formatted)); return true; } catch (_) { return false; }
  }
  /* 「使えるEMUER」が、場所によって違う数字になっていた。

     今日のEmu は updateEmuTodayHome を包んであるので v2 の残高に
     書き替わる。ウォレットの札（loadEmuWalletCard）は包んでいない
     ので、旧コントラクト 0x4418d5… ＋ サーバー台帳の「150（8）」が
     そのまま残る。同じ名前の欄に、別の数字が出ていた。

     10/2 に見つかった。札も包んで、v2 の残高にそろえる。
     旧の数字は消さずに、別の行に名前を付けて出す。黙って消すと、
     持っていたものが無くなったように見える。 */
  function legacyLine(text) {
    const box = document.querySelector("#emuValueProfile .eth-wallet-balance");
    if (!box) return;
    let line = byId("emuLegacyBalanceLine");
    if (!text) { if (line) line.style.display = "none"; return; }
    if (!line) {
      line = document.createElement("p");
      line.id = "emuLegacyBalanceLine";
      line.className = "eth-wallet-pending";
      const before = byId("emuWalletPendingLine");
      if (before && before.parentNode === box) box.insertBefore(line, before);
      else box.appendChild(line);
    }
    line.style.display = "";
    line.textContent = "10月1日より前のEMUER：" + text + "（上の使えるEMUERとは別の記録です）";
  }
  function wrapWalletCard() {
    const original = window.loadEmuWalletCard;
    if (typeof original !== "function" || original.__emuerV2PublicCopy) return;
    const wrapped = async function () {
      const result = await original.apply(this, arguments);
      const node = byId("emuWalletBalance");
      const before = node ? node.textContent : "";
      const wrote = await refreshBalance();
      legacyLine(wrote ? before : "");
      return result;
    };
    wrapped.__emuerV2PublicCopy = true; window.loadEmuWalletCard = wrapped;
  }
  /* 毎日のぶん（+1 EMUER）の受け取りは、ここには無い。
     受け取りの modal の中（wallet-success-ui.js の wsDaily / #wsLogin）。
     ここにあった refreshLoginButton / claimLogin は、作られていない
     emuLoginBonusBtn を掴んでいて一度も動いていなかったので消した。 */
  function wrapLegacyRender() {
    const original = window.updateEmuTodayHome; if (typeof original !== "function" || original.__emuerV2PublicCopy) return;
    const wrapped = async function () { const result = await original.apply(this, arguments); applyCopy(); await refreshBalance(); return result; };
    wrapped.__emuerV2PublicCopy = true; window.updateEmuTodayHome = wrapped;
  }
  /* もとは旧ログボの行（emuLoginBonusRow）を見張るのが先頭にあった。
     その行は作られていないので root が null になり、関数はそこで抜けていた。
     そのため、下のウォレットの見張りも一度も動いていなかった。
     旧ログボごと消したので、ウォレットのほうだけが残る。 */
  function observeLegacyWrites() {
    const wallet = document.querySelector("#emuValueProfile .eth-wallet-card");
    if (wallet && !wallet.dataset.emuerV2Observer) {
      wallet.dataset.emuerV2Observer = "true";
      let walletEnforcing = false;
      new MutationObserver(() => {
        if (!config || walletEnforcing) return;
        walletEnforcing = true;
        applyPrelaunchLocks();
        setTimeout(() => { walletEnforcing = false; }, 0);
      }).observe(wallet, { subtree: true, childList: true, characterData: true, attributes: true });
    }
  }
  async function start() {
    try { const response = await fetch(API + "/config"); const next = await response.json(); if (!response.ok || Number(next.chainId) !== 137) return; config = next;
      /* 受け取ったあとに、ページの数字を書き替えるため外へ出す。
         札ごと描き直すより軽い（balanceOf 一度で四か所そろう）。 */
      window.emuerV2RefreshBalance = refreshBalance; applyCopy(); wrapLegacyRender(); wrapWalletCard(); observeLegacyWrites(); await refreshBalance(); } catch (_) {}
  }
  window.addEventListener("load", () => { start(); setTimeout(() => { wrapLegacyRender(); wrapWalletCard(); applyCopy(); }, 1200); });
})();
