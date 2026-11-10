(() => {
  "use strict";
  const TOKEN = "0x9c102cC3016C70767082b60196565878D9314864",
    AMOUNT = "5000000000000000000";
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const error = (c) => {
    throw Error(c);
  };
  function wallet() {
    const p = (window.parent !== window ? window.parent : window).ethereum;
    if (!p?.request) error("POLYGON_WALLET_UNAVAILABLE");
    return p;
  }
  async function account(p, expected) {
    const a = await p.request({ method: "eth_accounts" });
    if (!a?.[0] || !same(a[0], expected)) error("POLYGON_WALLET_CHANGED");
    if ((await p.request({ method: "eth_chainId" })) !== "0x89")
      error("POLYGON_WRONG_CHAIN");
    return a[0];
  }
  async function proof(api, assertCurrent) {
    const p = wallet();
    await p.request({ method: "eth_requestAccounts" });
    assertCurrent();
    if ((await p.request({ method: "eth_chainId" })) !== "0x89")
      await p.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x89" }],
      });
    assertCurrent();
    const { challenge: c } = await api("/wallet/challenge", {});
    assertCurrent();
    await account(p, c.walletAddress);
    const hex =
      "0x" +
      Array.from(new TextEncoder().encode(c.message))
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    const signature = await p.request({
      method: "personal_sign",
      params: [hex, c.walletAddress],
    });
    assertCurrent();
    await account(p, c.walletAddress);
    return { walletNonce: c.nonce, walletSignature: signature };
  }
  function validate(m) {
    if (
      m.chainId !== 137 ||
      !same(m.tokenAddress, TOKEN) ||
      !same(m.to, TOKEN) ||
      m.amountWei !== AMOUNT ||
      m.value !== "0x0" ||
      m.method !== "exchange" ||
      m.approvalRequired !== false ||
      !/^0x[0-9a-f]+$/i.test(m.data) ||
      !/^0x[0-9a-f]{40}$/i.test(m.walletAddress) ||
      m.deadline * 1000 <= Date.now()
    )
      error("POLYGON_PAYMENT_CLOSED");
  }
  function pol(n) {
    const b = BigInt(n),
      s = (b % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
    return (b / 10n ** 18n).toString() + (s ? "." + s : "");
  }
  async function estimate(m, assertCurrent) {
    validate(m);
    const p = wallet();
    await account(p, m.walletAddress);
    assertCurrent();
    const tx = { from: m.walletAddress, to: m.to, data: m.data, value: "0x0" };
    const [gas, gasPrice, balance, tokens] = await Promise.all([
      p.request({ method: "eth_estimateGas", params: [tx] }),
      p.request({ method: "eth_gasPrice" }),
      p.request({
        method: "eth_getBalance",
        params: [m.walletAddress, "pending"],
      }),
      p.request({
        method: "eth_call",
        params: [
          {
            to: TOKEN,
            data: "0x70a08231" + m.walletAddress.slice(2).padStart(64, "0"),
          },
          "latest",
        ],
      }),
    ]);
    assertCurrent();
    if (BigInt(tokens) < BigInt(AMOUNT)) error("POLYGON_INSUFFICIENT_EMUER");
    const cost = BigInt(gas) * BigInt(gasPrice);
    if (BigInt(balance) < cost) error("POLYGON_GAS_INSUFFICIENT");
    return { tx: { ...tx, gas, gasPrice }, gasPOL: pol(cost) };
  }
  async function broadcast(m, e, assertCurrent) {
    validate(m);
    if (
      !e?.tx ||
      !same(e.tx.from, m.walletAddress) ||
      !same(e.tx.to, m.to) ||
      e.tx.data !== m.data ||
      e.tx.value !== m.value ||
      !/^0x[0-9a-f]+$/i.test(e.tx.gas || "") ||
      !/^0x[0-9a-f]+$/i.test(e.tx.gasPrice || "")
    )
      error("POLYGON_PAYMENT_CLOSED");
    const p = wallet();
    await account(p, m.walletAddress);
    assertCurrent();
    const transactionHash = await p.request({
      method: "eth_sendTransaction",
      params: [e.tx],
    });
    assertCurrent();
    if (!/^0x[0-9a-f]{64}$/i.test(transactionHash))
      error("POLYGON_INVALID_TX_HASH");
    return transactionHash;
  }
  window.ReizoPolygon = { proof, estimate, broadcast };
})();
