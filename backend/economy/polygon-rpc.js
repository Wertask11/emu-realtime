"use strict";
const ethers = require("ethers");
const { fail } = require("./config");
const { CHAIN_ID, TOKEN, TREASURY, AMOUNT } = require("./polygon-config");
function createPolygonRPC({ provider, profile = {}, signer, codeHash }) {
  const chainId = profile.chainId || CHAIN_ID,
    token = ethers.utils.getAddress(profile.tokenAddress || TOKEN),
    treasury = ethers.utils.getAddress(profile.treasury || TREASURY);
  const confirmations = profile.confirmations || 64;
  if (confirmations < 64 && !profile.localTest)
    throw Error("POLYGON_FINALITY_POLICY_INVALID");
  const abi = require("../../contracts-v2/artifacts/EMUERv2.json").abi;
  const iface = new ethers.utils.Interface(abi),
    contract = new ethers.Contract(token, abi, provider);
  const same = (x, y) => String(x).toLowerCase() === String(y).toLowerCase();
  const zero = (x) => /^0x0{40}$/i.test(String(x));
  async function network() {
    if ((await provider.getNetwork()).chainId !== chainId)
      fail("POLYGON_WRONG_CHAIN", 503);
  }
  async function assertContract() {
    await network();
    const code = await provider.getCode(token);
    if (!code || code === "0x" || !same(ethers.utils.keccak256(code), codeHash))
      fail("POLYGON_CODE_UNVERIFIED", 503);
    if (
      Number(await contract.decimals()) !== 18 ||
      (await contract.totalSupply()).toString() !==
        "10000000000000000000000000" ||
      !same(await contract.treasury(), treasury)
    )
      fail("POLYGON_CONTRACT_MISMATCH", 503);
  }
  async function ready(operator) {
    await assertContract();
    if (await contract.paused()) fail("POLYGON_PAUSED", 503);
    if (
      !signer ||
      !(await contract.hasRole(
        ethers.utils.id("AUTHORIZER_ROLE"),
        signer.address,
      ))
    )
      fail("POLYGON_AUTHORIZER_NOT_READY", 503);
    if (
      !operator ||
      !(await contract.hasRole(ethers.utils.id("REFUND_ROLE"), operator))
    )
      fail("POLYGON_REFUND_NOT_READY", 503);
    if ((await provider.getBalance(operator)).isZero())
      fail("POLYGON_OPERATOR_GAS_UNAVAILABLE", 503);
    await finalized();
    return true;
  }
  async function finalized() {
    const b = await provider.getBlock("finalized");
    if (!b || !Number.isSafeInteger(b.number) || !b.hash)
      fail("POLYGON_FINALITY_UNAVAILABLE", 503);
    return b;
  }
  async function mature(receipt) {
    if (!receipt) return false;
    const b = await provider.getBlock(receipt.blockNumber);
    if (!b || !same(b.hash, receipt.blockHash)) fail("POLYGON_REORG", 409);
    const f = await finalized(),
      head = await provider.getBlockNumber();
    return (
      head - receipt.blockNumber + 1 >= confirmations &&
      f.number >= receipt.blockNumber
    );
  }
  async function order(id, blockTag) {
    const o = await contract.orders(
      id,
      ...(blockTag === undefined ? [] : [{ blockTag }]),
    );
    return {
      buyer: o.buyer.toLowerCase(),
      productId: o.productId.toLowerCase(),
      paid: o.paid.toString(),
      fulfilled: o.fulfilled,
      refunded: o.refunded,
    };
  }
  function matches(o, q) {
    return (
      same(o.buyer, q.wallet) &&
      same(o.productId, q.chainProductId) &&
      o.paid === AMOUNT
    );
  }
  async function verifyPayment(q, hint) {
    await assertContract();
    const live = await order(q.chainOrderId);
    if (zero(live.buyer)) {
      const f = await finalized();
      // Only canonical, finalized time past the signed deadline proves it can no longer be paid.
      if (
        f.timestamp > q.deadline &&
        zero((await order(q.chainOrderId, f.number)).buyer)
      )
        return { state: "expired" };
      return { state: "pending" };
    }
    if (!matches(live, q)) fail("POLYGON_PAYMENT_MISMATCH", 409);
    let receipt = hint ? await provider.getTransactionReceipt(hint) : null;
    if (
      !receipt ||
      !receipt.logs.some(
        (l) =>
          same(l.address, token) &&
          l.topics[0] === iface.getEventTopic("Exchanged") &&
          same(l.topics[1], q.chainOrderId),
      )
    ) {
      const head = await provider.getBlockNumber();
      let logs = [];
      const end = Math.min(head, q.createdBlock + 4096);
      for (let from = q.createdBlock; from <= end && !logs.length; from += 512)
        logs = await provider.getLogs({
          address: token,
          topics: [iface.getEventTopic("Exchanged"), q.chainOrderId],
          fromBlock: from,
          toBlock: Math.min(end, from + 511),
        });
      if (logs.length !== 1) fail("POLYGON_PAYMENT_UNRESOLVED", 503);
      receipt = await provider.getTransactionReceipt(logs[0].transactionHash);
    }
    if (!receipt || receipt.status !== 1) fail("POLYGON_TX_FAILED", 409);
    if (!(await mature(receipt)))
      return { state: "confirming", transactionHash: receipt.transactionHash };
    const tx = await provider.getTransaction(receipt.transactionHash);
    if (
      !tx ||
      !same(tx.to, token) ||
      !same(tx.from, q.wallet) ||
      !tx.value.isZero() ||
      tx.chainId !== chainId
    )
      fail("POLYGON_TX_MISMATCH", 409);
    const call = iface.parseTransaction({ data: tx.data });
    if (
      call.name !== "exchange" ||
      !same(call.args.orderId, q.chainOrderId) ||
      !same(call.args.productId, q.chainProductId) ||
      call.args.price.toString() !== AMOUNT ||
      call.args.deadline.toNumber() !== q.deadline
    )
      fail("POLYGON_TX_MISMATCH", 409);
    const logs = receipt.logs
      .filter((l) => same(l.address, token))
      .map((l) => {
        try {
          return iface.parseLog(l);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
    const exchanges = logs.filter(
      (l) =>
        l.name === "Exchanged" &&
        same(l.args.orderId, q.chainOrderId) &&
        same(l.args.productId, q.chainProductId) &&
        same(l.args.buyer, q.wallet) &&
        l.args.price.toString() === AMOUNT,
    );
    const movements = logs.filter(
      (l) =>
        l.name === "Transfer" &&
        same(l.args.from, q.wallet) &&
        same(l.args.to, treasury) &&
        l.args.value.toString() === AMOUNT,
    );
    if (
      exchanges.length !== 1 ||
      movements.length !== 1 ||
      !matches(await order(q.chainOrderId, receipt.blockNumber), q)
    )
      fail("POLYGON_EVENT_MISMATCH", 409);
    return {
      state: "paid",
      transactionHash: receipt.transactionHash.toLowerCase(),
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      confirmationStatus: "finalized",
      live,
    };
  }
  async function authorization(q) {
    const domain = {
      name: "Emuer",
      version: "2",
      chainId,
      verifyingContract: token,
    };
    const types = {
      Order: [
        { name: "orderId", type: "bytes32" },
        { name: "productId", type: "bytes32" },
        { name: "buyer", type: "address" },
        { name: "price", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const signature = await signer._signTypedData(domain, types, {
      orderId: q.chainOrderId,
      productId: q.chainProductId,
      buyer: q.wallet,
      price: AMOUNT,
      deadline: q.deadline,
    });
    return {
      chainId,
      tokenAddress: token,
      amountWei: AMOUNT,
      to: token,
      value: "0x0",
      data: iface.encodeFunctionData("exchange", [
        q.chainOrderId,
        q.chainProductId,
        AMOUNT,
        q.deadline,
        signature,
      ]),
      method: "exchange",
      approvalRequired: false,
    };
  }
  async function verifyOperation(q, method, hint) {
    await assertContract();
    const name =
      method === "refundExchange" ? "ExchangeRefunded" : "ExchangeFulfilled";
    let receipt = hint ? await provider.getTransactionReceipt(hint) : null;
    if (!receipt && hint) return null;
    if (!receipt) {
      const head = await provider.getBlockNumber(),
        end = Math.min(head, q.createdBlock + 4096);
      // A known operation hash is persisted before broadcast; external/manual actions need review if outside this bound.
      let logs = [];
      for (let from = q.createdBlock; from <= end && !logs.length; from += 512)
        logs = await provider.getLogs({
          address: token,
          topics: [iface.getEventTopic(name), q.chainOrderId],
          fromBlock: from,
          toBlock: Math.min(end, from + 511),
        });
      if (logs.length !== 1) return null;
      receipt = await provider.getTransactionReceipt(logs[0].transactionHash);
    }
    if (!receipt || receipt.status !== 1 || !(await mature(receipt)))
      return null;
    const hits = receipt.logs
      .filter((l) => same(l.address, token))
      .map((l) => {
        try {
          return iface.parseLog(l);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
    const hit = hits.find(
      (l) => l.name === name && same(l.args.orderId, q.chainOrderId),
    );
    const live = await order(q.chainOrderId);
    if (!hit || !matches(live, q)) fail("POLYGON_OPERATION_MISMATCH", 409);
    if (
      method === "refundExchange" &&
      (!live.refunded ||
        live.fulfilled ||
        !same(hit.args.buyer, q.wallet) ||
        hit.args.amount.toString() !== AMOUNT ||
        !hits.some(
          (l) =>
            l.name === "Transfer" &&
            same(l.args.from, treasury) &&
            same(l.args.to, q.wallet) &&
            l.args.value.toString() === AMOUNT,
        ))
    )
      fail("POLYGON_REFUND_MISMATCH", 409);
    if (
      method === "markExchangeFulfilled" &&
      (!live.fulfilled || live.refunded)
    )
      fail("POLYGON_FULFILL_MISMATCH", 409);
    const transaction = await provider.getTransaction(receipt.transactionHash);
    const block = await provider.getBlock(receipt.blockNumber);
    if (!transaction || !block || !receipt.effectiveGasPrice)
      fail("POLYGON_GAS_RECEIPT_UNAVAILABLE", 503);
    return {
      transactionHash: receipt.transactionHash.toLowerCase(),
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      confirmationStatus: "finalized",
      gasPayer: transaction.from.toLowerCase(),
      gasCostWei: receipt.gasUsed.mul(receipt.effectiveGasPrice).toString(),
      minedAtMs: block.timestamp * 1000,
    };
  }
  return {
    provider,
    token,
    treasury,
    chainId,
    iface,
    contract,
    ready,
    assertContract,
    mature,
    order,
    verifyPayment,
    verifyOperation,
    authorization,
    finalized,
    matches,
  };
}
module.exports = { createPolygonRPC };
