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
    const row = byId("emuLoginBonusRow");
    if (row) { const title = row.querySelector("strong"); if (title) { title.textContent = waitingForStart() ? "EMUER v2 開始待ち" : "今日のログイン報酬"; title.removeAttribute("data-i18n"); } }
    setText("emuLoginBonusNote", waitingForStart() ? START_MESSAGE + " 開始後は1日1回 +1 EMUERです。" : "1日1回 +1 EMUER");
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
  async function refreshBalance() {
    if (!config || !account() || !window.ethereum || !window.ethers) return;
    try { const provider = new ethers.providers.Web3Provider(window.ethereum); const value = await new ethers.Contract(config.contract, ABI, provider).balanceOf(account()); const formatted = Number(ethers.utils.formatUnits(value, 18)).toLocaleString("ja-JP"); ["emuTodayBalance", "emuWalletBalance", "pp-emuer-num", "pp-emuer-balance-main"].forEach((id) => setText(id, formatted)); } catch (_) {}
  }
  async function refreshLoginButton() {
    const button = byId("emuLoginBonusBtn"); if (!button || !config) return; button.onclick = claimLogin;
    if (!config.enabled || Date.now() < Date.parse(config.startsAt)) { button.disabled = true; button.textContent = "2026年10月1日開始"; return; }
    try { const response = await fetch(API + "/daily/login/status?address=" + encodeURIComponent(account()), { headers: await headers(false) }); const data = await response.json(); if (response.ok && data.claimed) { button.disabled = true; button.textContent = "本日は受取済み"; } else { button.disabled = false; button.textContent = "+1 EMUER 受取"; } } catch (_) { button.disabled = false; button.textContent = "+1 EMUER 受取"; }
  }
  async function claimLogin() {
    const button = byId("emuLoginBonusBtn");
    try { if (!config?.enabled || waitingForStart()) throw new Error(START_MESSAGE); button.disabled = true; button.textContent = "署名を準備中…"; const response = await fetch(API + "/daily/login", { method: "POST", headers: await headers(true), body: JSON.stringify({ address: account() }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "ログイン報酬を準備できませんでした"); const provider = new ethers.providers.Web3Provider(window.ethereum); if (Number((await provider.getNetwork()).chainId) !== 137) throw new Error("Polygon Mainnetに切り替えてください"); const reward = data.reward; const contract = new ethers.Contract(config.contract, ABI, provider.getSigner()); button.textContent = "MetaMaskで確認…"; await (await contract.claimReward(reward.claimId, reward.totalAmount, reward.deadline, reward.authorization)).wait(); await refreshBalance(); await refreshLoginButton(); } catch (error) { await refreshLoginButton(); alert(error.message || "ログイン報酬の受取に失敗しました"); }
  }
  function wrapLegacyRender() {
    const original = window.updateEmuTodayHome; if (typeof original !== "function" || original.__emuerV2PublicCopy) return;
    const wrapped = async function () { const result = await original.apply(this, arguments); applyCopy(); await refreshBalance(); await refreshLoginButton(); return result; };
    wrapped.__emuerV2PublicCopy = true; window.updateEmuTodayHome = wrapped;
  }
  function observeLegacyWrites() {
    const root = byId("emuLoginBonusRow");
    if (!root || root.dataset.emuerV2Observer) return;
    root.dataset.emuerV2Observer = "true";
    let enforcing = false;
    new MutationObserver(() => {
      if (!config || enforcing) return;
      enforcing = true;
      applyCopy();
      refreshLoginButton().finally(() => { setTimeout(() => { enforcing = false; }, 0); });
    }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
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
    try { const response = await fetch(API + "/config"); const next = await response.json(); if (!response.ok || Number(next.chainId) !== 137) return; config = next; window.claimEmuLoginBonus = claimLogin; window.handleLoginBonus = claimLogin; applyCopy(); wrapLegacyRender(); observeLegacyWrites(); await refreshBalance(); await refreshLoginButton(); } catch (_) {}
  }
  window.addEventListener("load", () => { start(); setTimeout(() => { wrapLegacyRender(); applyCopy(); }, 1200); });
})();
