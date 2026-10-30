"use strict";

/* ウォレットの署名（personal_sign / EIP-191）で、そのアドレスの持ち主かを確かめる。

   MetaMask のようなふつうのウォレットは、署名から持ち主のアドレスがそのまま出る。
   WalletConnect でつなぐスマホのウォレットには、スマートコントラクト型のもの
   （中の鍵とアドレスが別）がある。その署名からはアドレスが出ないので、
   Polygon 上のそのアドレスのコントラクトに「この署名は有効か」を聞く（EIP-1271）。

   まだコントラクトが置かれていない（一度も使っていない）スマートコントラクト型の
   ウォレットは、署名の末尾に ERC-6492 の印を付けてくる。いまは受け付けず、
   理由が分かるように SMART_WALLET_NOT_DEPLOYED を返す。

   返すのは { ok: true, kind: "eoa" | "contract" } か { ok: false, code }。 */
const EIP1271_MAGIC = "0x1626ba7e";
const ERC6492_SUFFIX = "6492".repeat(16);
const EIP1271_ABI = ["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"];

function createWalletSignatureVerifier({ ethers, provider }) {
  return async function verifyWalletSignature(address, message, signature) {
    let checksummed;
    try { checksummed = ethers.utils.getAddress(String(address).trim()); }
    catch (_) { return { ok: false, code: "INVALID_ADDRESS" }; }
    const sig = String(signature || "");
    if (!/^0x[0-9a-fA-F]*$/.test(sig) || sig.length < 4) return { ok: false, code: "INVALID_SIGNATURE" };
    try {
      if (ethers.utils.verifyMessage(message, sig) === checksummed) return { ok: true, kind: "eoa" };
    } catch (_) { /* 65バイトでない署名（コントラクトの署名）はここで弾かれる。下で確かめる */ }
    if (!provider) return { ok: false, code: "INVALID_SIGNATURE" };
    let code;
    try { code = await provider.getCode(checksummed); }
    catch (_) { return { ok: false, code: "SIGNATURE_CHECK_UNAVAILABLE" }; }
    if (!code || code === "0x") {
      return { ok: false, code: sig.toLowerCase().endsWith(ERC6492_SUFFIX) ? "SMART_WALLET_NOT_DEPLOYED" : "INVALID_SIGNATURE" };
    }
    try {
      const wallet = new ethers.Contract(checksummed, EIP1271_ABI, provider);
      const result = await wallet.isValidSignature(ethers.utils.hashMessage(message), sig);
      return String(result).toLowerCase() === EIP1271_MAGIC ? { ok: true, kind: "contract" } : { ok: false, code: "INVALID_SIGNATURE" };
    } catch (_) {
      return { ok: false, code: "INVALID_SIGNATURE" };
    }
  };
}

module.exports = { createWalletSignatureVerifier, EIP1271_MAGIC, ERC6492_SUFFIX };
