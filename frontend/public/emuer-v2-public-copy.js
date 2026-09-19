/* Public-facing EMUER v2 wording and balance adapter. Active only after cutover. */
(function () {
  const API = "https://emu-realtime.onrender.com/api/emuer/v2";
  const ABI = ["function balanceOf(address) view returns (uint256)", "function claimReward(bytes32,uint256,uint256,bytes) returns (uint256)"];
  let config = null;
  const account = () => String(window.connectedAccount || "").toLowerCase();
  const byId = (id) => document.getElementById(id);
  async function headers(interactive) { if (typeof window.emuAuthHeaders !== "function") throw new Error("再ログインしてください。"); return window.emuAuthHeaders(!!interactive); }
  function setText(id, value) { const node = byId(id); if (!node) return; node.textContent = value; node.removeAttribute("data-i18n"); }
  function hide(node) { if (node) node.style.display = "none"; }
  function applyCopy() {
    if (!config) return;
    hide(byId("emuBalanceHint")); hide(byId("emuOffchainNote"));
    const head = byId("emuNextRewardLabel"); hide(head && head.parentElement);
    const progress = byId("emuTodayProgress"); hide(progress && progress.parentElement);
    setText("emuNextRewardNote", "新しいEMUERの交換は、商品ごとの価格・提供条件・返金条件を公開してから開始します。");
    const row = byId("emuLoginBonusRow");
    if (row) { const title = row.querySelector("strong"); if (title) { title.textContent = "今日のログイン報酬"; title.removeAttribute("data-i18n"); } }
    setText("emuLoginBonusNote", "1日1回 +1 EMUER");
    const request = byId("emuRequestSheet");
    if (request) {
      const labels = request.querySelectorAll(".emu-field > label");
      if (labels[2]) labels[2].textContent = "採用・確認済みの回答へのEMUER報酬";
      const amount = request.querySelector(".emu-field > div[style]");
      if (amount) amount.textContent = "確認済みの回答に 1 EMUER";
      const description = request.querySelector(".emu-sheet-actions").previousElementSibling;
      if (description && description.tagName === "P") description.textContent = "募集者の残高は減りません。採用後、基準確認を通った回答者へ運営トレジャリーから1 EMUERが付与されます。";
    }
    hide(byId("pp-campaign-section"));
    const uses = byId("emuUsesPanel");
    if (uses) { const title = uses.querySelector("h3"); if (title) title.textContent = "EMUERの交換・利用"; const note = uses.querySelector(".eth-uses-note"); if (note) note.textContent = "SchoolPark内のイベント・教材・教具・NFTなどに使えます。商品ごとの条件は公開後に確認できます。"; }
  }
  async function refreshBalance() {
    if (!config || !account() || !window.ethereum || !window.ethers) return;
    try { const provider = new ethers.providers.Web3Provider(window.ethereum); const value = await new ethers.Contract(config.contract, ABI, provider).balanceOf(account()); const formatted = Number(ethers.utils.formatUnits(value, 18)).toLocaleString("ja-JP"); ["emuTodayBalance", "emuWalletBalance", "pp-emuer-num", "pp-emuer-balance-main"].forEach((id) => setText(id, formatted)); } catch (_) {}
  }
  async function refreshLoginButton() {
    const button = byId("emuLoginBonusBtn"); if (!button || !config) return; button.onclick = claimLogin;
    if (!config.enabled || Date.now() < Date.parse(config.startsAt)) { button.disabled = true; button.textContent = "10月1日開始"; return; }
    try { const response = await fetch(API + "/daily/login/status?address=" + encodeURIComponent(account()), { headers: await headers(false) }); const data = await response.json(); if (response.ok && data.claimed) { button.disabled = true; button.textContent = "本日は受取済み"; } else { button.disabled = false; button.textContent = "+1 EMUER 受取"; } } catch (_) { button.disabled = false; button.textContent = "+1 EMUER 受取"; }
  }
  async function claimLogin() {
    const button = byId("emuLoginBonusBtn");
    try { if (!config?.enabled) throw new Error("EMUER v2 はまだ開始していません。"); button.disabled = true; button.textContent = "署名を準備中…"; const response = await fetch(API + "/daily/login", { method: "POST", headers: await headers(true), body: JSON.stringify({ address: account() }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "ログイン報酬を準備できませんでした"); const provider = new ethers.providers.Web3Provider(window.ethereum); if (Number((await provider.getNetwork()).chainId) !== 137) throw new Error("Polygon Mainnetに切り替えてください"); const reward = data.reward; const contract = new ethers.Contract(config.contract, ABI, provider.getSigner()); button.textContent = "MetaMaskで確認…"; await (await contract.claimReward(reward.claimId, reward.totalAmount, reward.deadline, reward.authorization)).wait(); await refreshBalance(); await refreshLoginButton(); } catch (error) { button.disabled = false; button.textContent = "+1 EMUER 受取"; alert(error.message || "ログイン報酬の受取に失敗しました"); }
  }
  function wrapLegacyRender() {
    const original = window.updateEmuTodayHome; if (typeof original !== "function" || original.__emuerV2PublicCopy) return;
    const wrapped = async function () { const result = await original.apply(this, arguments); applyCopy(); await refreshBalance(); await refreshLoginButton(); return result; };
    wrapped.__emuerV2PublicCopy = true; window.updateEmuTodayHome = wrapped;
  }
  async function start() {
    try { const response = await fetch(API + "/config"); const next = await response.json(); if (!response.ok || Number(next.chainId) !== 137) return; config = next; window.claimEmuLoginBonus = claimLogin; window.handleLoginBonus = claimLogin; applyCopy(); wrapLegacyRender(); await refreshBalance(); await refreshLoginButton(); } catch (_) {}
  }
  window.addEventListener("load", () => { start(); setTimeout(() => { wrapLegacyRender(); applyCopy(); }, 1200); });
})();
