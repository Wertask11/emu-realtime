"use strict";
// Browser UX only: explicitly simulated API/EIP1193. Real contract tests live in contracts-v2/test/economy-payment.cjs.
const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict"),
  http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "../../frontend/public"),
  TOKEN = "0x9c102cC3016C70767082b60196565878D9314864",
  WALLET = "0x" + "1".repeat(40);
let server, browser, base;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/shell") {
      res.setHeader("Content-Type", "text/html");
      return res.end(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/economy/index.html"></iframe><script>window.auth={currentUser:{uid:"isolated-alice"}};window.emuAuthHeaders=async()=>({Authorization:"Bearer isolated"});window.rpcCalls=[];window.ethereum={request:async q=>{rpcCalls.push(q);return ({eth_accounts:["' +
          WALLET +
          '"],eth_requestAccounts:["' +
          WALLET +
          '"],eth_chainId:"0x89",personal_sign:"0x' +
          "1".repeat(130) +
          '",eth_estimateGas:"0x5208",eth_gasPrice:"0x3b9aca00",eth_getBalance:"0xde0b6b3a7640000",eth_call:"0x56bc75e2d63100000",eth_sendTransaction:"0x' +
          "a".repeat(64) +
          '"})[q.method];}};</script>',
      );
    }
    const file = path.join(ROOT, new URL(req.url, "http://local").pathname);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
});
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise((r) => server.close(r));
});
for (const width of [375, 390, 412, 768, 1280, 1440, 1920])
  test(
    "explicit wallet fee confirmation, one broadcast, no approve at " +
      width +
      "px",
    async () => {
      const c = await browser.newContext({ viewport: { width, height: 950 } }),
        page = await c.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      let created = false,
        attached = false,
        posts = 0;
      const job = () => ({
        id: "local-wallet-job",
        state: attached ? "queued" : "awaiting_wallet_payment",
        price: 5,
        paymentSource: "polygon_wallet",
        createdAtMs: Date.now(),
        payment: {
          method: "emuer_chain",
          status: attached ? "paid" : "pending_payment",
        },
      });
      await c.route("**/api/economy/**", async (r) => {
        const req = r.request(),
          p = new URL(req.url()).pathname.slice("/api/economy".length);
        let data;
        if (p === "/me")
          data = {
            service: { enabled: true },
            walletPayment: { enabled: true },
            eligibility: { eligible: true },
            balances: {
              spendable: "100",
              wallet: "100",
              pending: "100",
              held: "0",
              processing: "0",
            },
          };
        else if (p === "/jobs" && req.method() === "GET")
          data = { jobs: created ? [job()] : [] };
        else if (p === "/quotes")
          data = {
            quote: {
              id: "quote",
              price: 5,
              method: "emuer_chain",
              termsVersion: "base",
              paymentTermsVersion: "wallet-terms",
              scope: "公開情報で準備する",
              refund: "元ウォレットに返却",
              notice: "ガス別",
            },
          };
        else if (p === "/wallet/challenge")
          data = {
            challenge: {
              nonce: "local-nonce",
              message: "local-only one purpose nonce",
              walletAddress: WALLET,
              chainId: 137,
            },
          };
        else if (p === "/jobs" && req.method() === "POST") {
          const b = req.postDataJSON();
          assert.equal(b.method, "emuer_chain");
          assert.equal(b.paymentTermsVersion, "wallet-terms");
          assert(b.walletSignature);
          created = true;
          posts++;
          data = { job: job() };
        } else if (
          p === "/jobs/local-wallet-job/wallet-payment" &&
          req.method() === "GET"
        )
          data = {
            payment: {
              jobId: "local-wallet-job",
              chainId: 137,
              tokenAddress: TOKEN,
              to: TOKEN,
              amountWei: "5000000000000000000",
              value: "0x0",
              data: "0x53c13aa1",
              method: "exchange",
              approvalRequired: false,
              walletAddress: WALLET,
              deadline: Math.floor(Date.now() / 1000) + 600,
            },
          };
        else if (p === "/jobs/local-wallet-job/wallet-payment") {
          assert.match(req.postDataJSON().transactionHash, /^0x[a-f0-9]{64}$/);
          attached = true;
          data = { job: job() };
        } else if (p === "/jobs/local-wallet-job") data = { job: job() };
        else throw Error("Unexpected local API " + p);
        await r.fulfill({ json: { ok: true, ...data } });
      });
      try {
        await page.goto(base + "/shell");
        const f = page.frameLocator("iframe");
        await f
          .locator("#walletMethodOption:not([disabled])")
          .waitFor({ state: "attached" });
        await f.locator("#paymentMethod").selectOption("emuer_chain");
        await f.locator("#goal").fill("クエストの計画を作る");
        await f.locator("#quoteButton").click();
        await f.locator("#paymentConsent").check();
        await f.locator("#aiConsent").check();
        await f.locator("#pay").click();
        await f
          .locator("#polygonGas")
          .filter({ hasText: "0.000021 POL" })
          .waitFor();
        assert.equal(await f.locator("#polygonSend").isDisabled(), true);
        assert.equal(
          await page.evaluate(
            () =>
              rpcCalls.filter((x) => x.method === "eth_sendTransaction").length,
          ),
          0,
        );
        assert.equal(
          await f
            .locator("body")
            .evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
          false,
        );
        await f.locator("#polygonConsent").check();
        await f.locator("#polygonSend").click();
        await f.locator("#polygonDialog").waitFor({ state: "hidden" });
        assert.equal(posts, 1);
        assert(attached);
        const calls = await page.evaluate(() => rpcCalls);
        assert.equal(
          calls.filter((x) => x.method === "eth_sendTransaction").length,
          1,
        );
        assert.equal(
          calls.some((x) => /approve|transferFrom/.test(JSON.stringify(x))),
          false,
        );
        assert.deepEqual(errors, []);
      } finally {
        await c.close();
      }
    },
  );
