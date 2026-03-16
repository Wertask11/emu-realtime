/**
 * ================================================================
 * wallet-success-ui.js — Dプラン統合版
 * Emu: ウォレット接続完了UI + エアドロ自動登録
 * ================================================================
 */

const AIRDROP_SERVER_URL = "https://emu-realtime.onrender.com";
const AIRDROP_CAMPAIGN_ID = "EmuRelease2026";
const AIRDROP_AMOUNT_DISPLAY = 100;

(function injectStyles() {
  if (document.getElementById("ws-styles")) return;
  const style = document.createElement("style");
  style.id = "ws-styles";
  style.textContent = `
    #walletSuccessOverlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;justify-content:center;align-items:center}
    #walletSuccessOverlay.active{display:flex}
    #walletSuccessCard{background:#fff;border-radius:20px;padding:40px 36px 32px;width:100%;max-width:380px;text-align:center;position:relative;animation:wsCardIn 0.35s cubic-bezier(0.34,1.56,0.64,1)}
    @keyframes wsCardIn{from{transform:translateY(40px) scale(0.95);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}
    .ws-check{width:64px;height:64px;border-radius:50%;background:#e6f9f0;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;animation:wsCheckPop 0.4s 0.1s cubic-bezier(0.34,1.56,0.64,1) both}
    @keyframes wsCheckPop{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}
    .ws-check svg{width:32px;height:32px}
    .ws-title{font-size:20px;font-weight:bold;color:#111;margin:0 0 6px}
    .ws-address{font-size:13px;color:#888;font-family:monospace;margin:0 0 20px;word-break:break-all}
    .ws-balance-card{background:linear-gradient(135deg,#f0fff8 0%,#e8f5ff 100%);border:1px solid #c8f0e0;border-radius:14px;padding:20px;margin-bottom:12px;position:relative}
    .ws-balance-label{font-size:12px;color:#888;margin:0 0 4px}
    .ws-balance-amount{font-size:36px;font-weight:bold;color:#1a8a5a;margin:0;transition:all 0.4s ease;letter-spacing:-0.5px}
    .ws-balance-amount.updating{transform:scale(1.08);color:#0d6e45}
    .ws-balance-unit{font-size:14px;color:#888;margin:4px 0 0}
    .ws-receive-toast{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:22px;font-weight:bold;color:#1a8a5a;pointer-events:none;opacity:0;animation:wsToast 1.4s ease forwards}
    @keyframes wsToast{0%{opacity:0;transform:translate(-50%,-10px) scale(0.8)}20%{opacity:1;transform:translate(-50%,-30px) scale(1.1)}70%{opacity:1;transform:translate(-50%,-50px) scale(1)}100%{opacity:0;transform:translate(-50%,-70px) scale(0.9)}}
    #ws-airdrop-banner{margin-top:12px;padding:12px 16px;border-radius:10px;font-size:13px;display:flex;align-items:center;gap:8px;animation:wsCardIn 0.4s cubic-bezier(0.34,1.56,0.64,1)}
    .ws-status{font-size:12px;color:#aaa;margin:0 0 16px;min-height:18px}
    .ws-status.received{color:#1a8a5a;font-weight:bold}
    .ws-cta-btn{width:100%;padding:14px;background:#007bff;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:bold;cursor:pointer;transition:background 0.15s,transform 0.1s}
    .ws-cta-btn:hover{background:#0069d9}
    .ws-cta-btn:active{transform:scale(0.98)}
    .ws-share-btn{display:inline-flex;align-items:center;gap:6px;margin-top:12px;padding:8px 16px;border:1px solid #ddd;border-radius:8px;background:transparent;font-size:13px;color:#555;cursor:pointer;transition:background 0.15s}
    .ws-share-btn:hover{background:#f5f5f5}
  `;
  document.head.appendChild(style);
})();

(function injectModal() {
  if (document.getElementById("walletSuccessOverlay")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <div id="walletSuccessOverlay">
      <div id="walletSuccessCard">
        <div class="ws-check">
          <svg viewBox="0 0 24 24" fill="none" stroke="#1a8a5a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <p class="ws-title">ウォレット接続完了！</p>
        <p class="ws-address" id="wsAddressText">0x...</p>
        <div class="ws-balance-card" id="wsBalanceCard">
          <p class="ws-balance-label">現在のEmuer残高</p>
          <p class="ws-balance-amount" id="wsBalanceAmount">---</p>
          <p class="ws-balance-unit">EMUER</p>
        </div>
        <p class="ws-status" id="wsStatus">チェーンに接続中...</p>
        <button class="ws-cta-btn" onclick="closeWalletSuccessAndStart()">Emuを始める →</button>
        <br>
        <button class="ws-share-btn" onclick="shareWalletSuccess()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
          </svg>
          Xでシェアする
        </button>
      </div>
    </div>
  `);
})();

let _wsEventFilter = null;

async function showWalletSuccessModal(account) {
  const overlay  = document.getElementById("walletSuccessOverlay");
  const addrEl   = document.getElementById("wsAddressText");
  const amountEl = document.getElementById("wsBalanceAmount");
  const statusEl = document.getElementById("wsStatus");
  const balCard  = document.getElementById("wsBalanceCard");

  addrEl.textContent = account.substring(0, 6) + "..." + account.slice(-4);
  overlay.classList.add("active");

  // ① 現在のEmuer残高を即取得
  try {
    const contract = new ethers.Contract(EMUER_CONTRACT_ADDRESS, EMUER_CONTRACT_ABI, provider);
    const balBN = await contract.balanceOf(account);
    const bal = parseFloat(ethers.utils.formatUnits(balBN, 18));
    amountEl.textContent = bal % 1 === 0 ? bal.toFixed(0) : bal.toFixed(4);
    statusEl.textContent = "残高を確認しました";
    statusEl.className = "ws-status received";

    // ② Transferイベント監視
    const filter = contract.filters.Transfer(null, account);
    if (_wsEventFilter) { try { contract.removeAllListeners(filter); } catch(e) {} }
    _wsEventFilter = filter;

    contract.on(filter, async (from, to, value) => {
      const received = parseFloat(ethers.utils.formatUnits(value, 18));
      _showReceiveToast(balCard, "+" + (received % 1 === 0 ? received.toFixed(0) : received.toFixed(4)) + " EMUER");
      const newBalBN = await contract.balanceOf(account);
      const newBal = parseFloat(ethers.utils.formatUnits(newBalBN, 18));
      amountEl.classList.add("updating");
      amountEl.textContent = newBal % 1 === 0 ? newBal.toFixed(0) : newBal.toFixed(4);
      setTimeout(() => amountEl.classList.remove("updating"), 500);
      statusEl.textContent = "Emuerを受け取りました！";
      statusEl.className = "ws-status received";
    });
  } catch (err) {
    console.error("残高取得エラー:", err);
    amountEl.textContent = "---";
    statusEl.textContent = "残高の取得に失敗しました";
  }

  // ③ Dプラン: エアドロ登録（非同期・失敗しても体験を壊さない）
  _registerAirdrop(account).catch(e => console.error("エアドロ登録エラー:", e));
}

// ================================================================
// Dプラン: エアドロ登録
// ================================================================
async function _registerAirdrop(account) {
  const alreadyKey = `emu_airdrop_registered_${account.toLowerCase()}`;
  if (localStorage.getItem(alreadyKey)) { _showAirdropBanner("reserved"); return; }

  try {
    _showAirdropBanner("signing");
    const signer = provider.getSigner();
    const timestamp = Math.floor(Date.now() / 1000);

    const domain = { name: "Emu Airdrop", version: "1", chainId: 137 };
    const types = {
      AirdropClaim: [
        { name: "address", type: "address" },
        { name: "campaign", type: "string" },
        { name: "timestamp", type: "uint256" }
      ]
    };
    const value = { address: account, campaign: AIRDROP_CAMPAIGN_ID, timestamp };

    console.log("✍️ エアドロ登録署名中...");
    const signature = await signer._signTypedData(domain, types, value);

    const res = await fetch(`${AIRDROP_SERVER_URL}/airdrop/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: account, campaign: AIRDROP_CAMPAIGN_ID, timestamp, signature })
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.error === "ALREADY_REGISTERED") {
        localStorage.setItem(alreadyKey, "1");
        _showAirdropBanner("reserved");
        return;
      }
      throw new Error(data.error || "登録失敗");
    }

    localStorage.setItem(alreadyKey, "1");
    console.log("🎉 エアドロ登録完了:", account);
    _showAirdropBanner("new");

  } catch (err) {
    console.error("エアドロ登録エラー:", err.message);
    _showAirdropBanner("pending");
  }
}

function _showAirdropBanner(status) {
  let banner = document.getElementById("ws-airdrop-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "ws-airdrop-banner";
    const balCard = document.getElementById("wsBalanceCard");
    if (balCard) balCard.insertAdjacentElement("afterend", banner);
    else return;
  }
  const configs = {
    new:      { bg:"#e6f9f0", border:"1px solid #b2e8d0", icon:"🎁", text:`<strong>+${AIRDROP_AMOUNT_DISPLAY} EMUER</strong> の受取予約が完了！<br><span style="color:#888;font-size:11px">キャンペーン終了後に自動送金されます</span>` },
    reserved: { bg:"#f0f4ff", border:"1px solid #c0cfff", icon:"✅", text:`<strong>${AIRDROP_AMOUNT_DISPLAY} EMUER</strong> 受取予約済みです<br><span style="color:#888;font-size:11px">キャンペーン終了後に自動送金されます</span>` },
    signing:  { bg:"#fff8e6", border:"1px solid #ffe099", icon:"✍️", text:`エアドロ登録のために署名をお願いします<br><span style="color:#888;font-size:11px">MetaMaskで承認してください</span>` },
    pending:  { bg:"#fffbe6", border:"1px solid #ffe699", icon:"⏳", text:`エアドロ予約を受け付け中です<br><span style="color:#888;font-size:11px">しばらくお待ちください</span>` }
  };
  const c = configs[status] || configs.pending;
  banner.style.cssText = `margin-top:12px;padding:12px 16px;border-radius:10px;font-size:13px;display:flex;align-items:center;gap:8px;background:${c.bg};border:${c.border};`;
  banner.innerHTML = `<span style="font-size:20px;flex-shrink:0">${c.icon}</span><span style="line-height:1.5;text-align:left">${c.text}</span>`;
}

function _showReceiveToast(container, text) {
  const toast = document.createElement("div");
  toast.className = "ws-receive-toast";
  toast.textContent = text;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 1400);
}

function closeWalletSuccessAndStart() {
  document.getElementById("walletSuccessOverlay").classList.remove("active");
  try { if (_wsEventFilter && window.emuerContract) window.emuerContract.removeAllListeners(_wsEventFilter); } catch(e) {}
  goTomainapp();
}

function shareWalletSuccess() {
  const account = window.connectedAccount || "";
  const short = account ? account.substring(0, 6) + "..." + account.slice(-4) : "";
  const text = encodeURIComponent(`Emuのウォレット接続完了！🎉\nアドレス: ${short}\nエアドロも受取予約済み👍\n#EmuRelease #SchoolPark`);
  window.open("https://twitter.com/intent/tweet?text=" + text, "_blank");
}
