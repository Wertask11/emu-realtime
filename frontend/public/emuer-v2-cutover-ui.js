/* Final v2 cutover bridge.  It leaves the old UI in place but prevents the
   legacy token contract from being used once v2 is explicitly enabled. */
(function () {
  const API = "https://emu-realtime.onrender.com/api/emuer/v2";
  const ABI = ["function claimReward(bytes32,uint256,uint256,bytes) returns (uint256)"];
  async function headers(interactive) {
    if (typeof window.emuAuthHeaders !== "function") throw new Error("ログインし直してください。");
    return window.emuAuthHeaders(!!interactive);
  }
  async function config() {
    const response = await fetch(API + "/config");
    const value = await response.json();
    return response.ok ? value : null;
  }
  async function request(path, options) {
    const response = await fetch(API + path, Object.assign({ headers: await headers(true) }, options || {}));
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.error || "処理できませんでした。");
    return value;
  }
  async function claim(configValue, row) {
    if (!window.ethereum || typeof ethers === "undefined") throw new Error("Polygonウォレットを接続してください。");
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    if (Number((await provider.getNetwork()).chainId) !== 137) throw new Error("Polygon Mainnetに切り替えてください。");
    const authorization = await request("/rewards/" + encodeURIComponent(row.rewardId) + "/authorization", { method:"POST", body:JSON.stringify({ address:String(window.connectedAccount || "") }) });
    const reward = authorization.reward;
    const contract = new ethers.Contract(configValue.contract, ABI, provider.getSigner());
    await (await contract.claimReward(reward.claimId, reward.totalAmount, reward.deadline, reward.authorization)).wait();
  }
  async function convertV2() {
    const value = await config();
    if (!value || !value.enabled) { alert("EMUER v2はまだ開始前です。"); return; }
    if (Date.now() < Date.parse(value.startsAt)) { alert("EMUER v2は10月1日から開始します。"); return; }
    const button = document.getElementById("convertButton");
    if (button) { button.disabled = true; button.textContent = "変換を準備中…"; }
    try {
      const converted = await request("/legacy/convert", { method:"POST", body:JSON.stringify({ address:String(window.connectedAccount || "") }) });
      await claim(value, converted);
      alert("EMUERへの変換が完了しました。");
    } catch (error) {
      const code = String(error.message || "");
      const message = code === "PLAN_REQUIRED" ? "EMUERに変換できるのはEmu Light以上かつウォレットを持つ方です。"
        : code === "PERIOD_LIMIT_REACHED" ? "この期間の変換回数を使っています。Lightは月1回、Plusは週1回です。"
        : code === "NO_VERIFIED_LEGACY_BALANCE" ? "変換できる過去Good・届いた改善案はまだありません。"
        : code === "LEGACY_BALANCE_ALREADY_CONVERTED" ? "この過去分はすでに変換済みです。"
        : (error.message || "変換できませんでした。");
      alert(message);
    } finally {
      if (button) { button.disabled = false; button.textContent = "EMUERに変換"; }
    }
  }
  window.addEventListener("load", async function () {
    const value = await config();
    if (!value || !value.enabled) return;
    window.handleConversion = convertV2;
    window.emuWalletConvert = convertV2;
    window.spWalletConvert = convertV2;
    const button = document.getElementById("convertButton");
    if (button) button.onclick = convertV2;
    /* Product conditions have not been published yet.  Members may inspect the
       marketplace, but the old buyNFT call is never allowed to move v1 tokens. */
    window._emuExchangeBuyBtn = function () {
      const button = document.createElement("button");
      button.textContent = "準備中";
      button.onclick = function () { alert("新しいEMUER交換は、商品ごとの価格・提供条件・返金条件を公開してから開始します。"); };
      return button;
    };
    const originalShopping = window.openEmuShopping;
    window.openEmuShopping = async function () {
      try {
        const access = await request("/access/exchange", { method:"GET" });
        if (!access.ok) throw new Error(access.error || "PLAN_REQUIRED");
      } catch (error) {
        const message = String(error.message || "") === "PLAN_REQUIRED"
          ? "みてみるはEmu Light以上かつウォレットを持つ方の機能です。"
          : String(error.message || "みてみるを開けませんでした。");
        alert(message); return;
      }
      if (typeof originalShopping === "function") return originalShopping();
    };
  });
})();