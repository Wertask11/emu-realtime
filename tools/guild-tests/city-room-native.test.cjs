"use strict";
// Dedicated local Auth + Firestore only. Browser signs in through the real Firebase SDK.
// No production credentials, injected browser tokens/storage, purchases, or ledger writes.
const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { chromium } = require("playwright"),
  express = require("../../backend/node_modules/express");
const PROJECT = "demo-city-room",
  AUTH = "127.0.0.1:9199",
  STORE = "127.0.0.1:8787";
for (const [name, value] of Object.entries({
  FIRESTORE_EMULATOR_HOST: STORE,
  FIREBASE_AUTH_EMULATOR_HOST: AUTH,
  GCLOUD_PROJECT: PROJECT,
})) {
  if (process.env[name] && process.env[name] !== value)
    throw Error("LOCAL_EMULATOR_ONLY");
  process.env[name] = value;
}
const admin = require("../../backend/node_modules/firebase-admin"),
  {
    deriveAddress,
    ensureVerifiedAccount,
  } = require("../../backend/verified-platform");
const ROOT = path.resolve(__dirname, "../.."),
  PUBLIC = path.join(ROOT, "frontend/public"),
  A = "SP-AAAA-AAAA-AAAA-AAAA",
  B = "SP-BBBB-BBBB-BBBB-BBBB";
let firebase, db, browser, server, base, identity, entitlement;
const qa =
  process.env.CITY_QA_DIR ||
  fs.mkdtempSync(path.join(require("node:os").tmpdir(), "city-room-native-"));
before(async () => {
  const reset = await fetch(
    `http://${STORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.ok(reset.ok);
  firebase = admin.initializeApp({ projectId: PROJECT }, "room-native");
  db = firebase.firestore();
  for (const [uid, spid] of [
    ["room-alice", A],
    ["room-bob", B],
    ["room-owner", "SP-CCCC-CCCC-CCCC-CCCC"],
  ]) {
    try {
      await firebase.auth().deleteUser(uid);
    } catch {}
    await firebase.auth().createUser({
      uid,
      email: uid + "@example.invalid",
      password: "Emulator-only-password-123",
    });
    await db
      .collection("ches_accounts")
      .doc(uid)
      .set({ spid, walletAddress: deriveAddress(uid) });
    await db
      .collection("sp_auth_links")
      .doc("fb:" + uid)
      .set({ spid });
    await db
      .collection("sp_identities")
      .doc(spid)
      .set({ spid, status: "active" });
  }
  identity = require("../../backend/identity").createIdentity({ db });
  entitlement = require("../../backend/entitlement").createEntitlement({
    db,
    identity,
  });
  const source = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8"),
    grab = (a, b) =>
      source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
  const c = {
    firebaseAdmin: { auth: () => firebase.auth() },
    db,
    ensureVerifiedAccount,
    identityAccountCache: new Map(),
    IDENTITY_CACHE_MS: 300000,
    SP_OWNER_ADDRESSES: [deriveAddress("room-owner").toLowerCase()],
    rateBuckets: new Map(),
    Date,
    Map,
    String,
    console,
  };
  vm.createContext(c);
  vm.runInContext(
    grab("async function requireFirebaseUser(", 'app.use("/api/auth"') +
      grab("function requireOwner(", "/* Room1") +
      grab("function rateLimit(", "const uploadRateLimit"),
    c,
  );
  const app = express();
  app.use(express.json());
  app.use(
    "/api/schoolpark/city/room",
    require("../../backend/city-room").createCityRoomRouter({
      db,
      identity,
      entitlement,
      requireFirebaseUser: c.requireFirebaseUser,
      requireOwner: c.requireOwner,
      rateLimit: c.rateLimit,
      ownerAddresses: c.SP_OWNER_ADDRESSES,
    }),
  );
  app.get("/test/firebase/:name", (q, s) => {
    if (!/^firebase-(app|auth)\.js$/.test(q.params.name))
      return s.sendStatus(404);
    s.type("js").send(
      fs
        .readFileSync(
          path.join(
            ROOT,
            "tools/quest-tests/node_modules/firebase",
            q.params.name,
          ),
          "utf8",
        )
        .replaceAll(
          "https://www.gstatic.com/firebasejs/10.8.0",
          "/test/firebase",
        ),
    );
  });
  app.get("/test/room.html", (_q, s) =>
    s.type("html")
      .send(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔離環境・部屋の操作確認</title><body style="margin:0"><header><label>テスト利用者 <select id="role"><option>room-alice</option><option>room-bob</option><option>room-owner</option></select></label><button id="login">ログイン</button><button id="logout">ログアウト</button></header><main id="editor"></main><script type="module">
 import {initializeApp} from '/test/firebase/firebase-app.js';import {getAuth,connectAuthEmulator,signInWithEmailAndPassword,signOut,onAuthStateChanged} from '/test/firebase/firebase-auth.js';import {createRoomUI} from '/schoolpark/city-room.js';
 const a=initializeApp({projectId:'${PROJECT}',apiKey:'emulator-only',authDomain:'localhost'});window.auth=getAuth(a);connectAuthEmulator(auth,'http://${AUTH}',{disableWarnings:true});window.emuAuthHeaders=async json=>{const user=auth.currentUser;if(!user)throw Error('AUTH_REQUIRED');return{Authorization:'Bearer '+await user.getIdToken(),...(json?{'Content-Type':'application/json'}:{})};};let ui;document.querySelector('#login').onclick=()=>signInWithEmailAndPassword(auth,document.querySelector('#role').value+'@example.invalid','Emulator-only-password-123');document.querySelector('#logout').onclick=()=>signOut(auth);onAuthStateChanged(auth,user=>{ui?.destroy();window._spIdentity=user?{schoolParkId:user.uid==='room-alice'?'${A}':user.uid==='room-bob'?'${B}':'SP-CCCC-CCCC-CCCC-CCCC'}:null;if(user)ui=createRoomUI(document.querySelector('#editor'),{parent:window});});
 </script></body></html>`),
  );
  app.get("/__/firebase/init.json", (_q, res) =>
    res.json({
      projectId: PROJECT,
      apiKey: "emulator-only",
      authDomain: "localhost",
    }),
  );
  app.get("/schoolpark/city-room-bridge.js", (_q, s) =>
    s
      .type("js")
      .send(
        fs
          .readFileSync(
            path.join(PUBLIC, "schoolpark/city-room-bridge.js"),
            "utf8",
          )
          .replace("https://emu-realtime.onrender.com", "")
          .replaceAll(
            "https://www.gstatic.com/firebasejs/10.8.0",
            "/test/firebase",
          )
          .replace(
            "session = auth.getAuth(a);",
            `session = auth.getAuth(a);auth.connectAuthEmulator(session,'http://${AUTH}',{disableWarnings:true});`,
          ),
      ),
  );
  app.use(express.static(PUBLIC));
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({
    executablePath: process.env.CITY_CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  fs.mkdirSync(qa, { recursive: true });
});
after(async () => {
  await browser?.close();
  await new Promise((r) => (server ? server.close(r) : r()));
  await firebase?.delete();
});
async function login(page, role = "room-alice") {
  await page.selectOption("#role", role);
  await page.click("#login");
  await page
    .getByText("保存済みの部屋を開きました。", { exact: true })
    .waitFor();
}
for (const width of [390, 1440])
  test(`Native Auth/Firestore ${width}px: place/save/publish/share/private, account switch and financial isolation`, async () => {
    await db.recursiveDelete(db.collection("city_rooms").doc(A));
    const ctx = await browser.newContext({
        viewport: { width, height: 1050 },
        hasTouch: width < 700,
      }),
      page = await ctx.newPage(),
      network = [],
      errors = [];
    page.setDefaultTimeout(12000);
    page.on("pageerror", (e) => errors.push(e.message));
    await ctx.route("**/*", (r) => {
      network.push(r.request().url());
      const u = new URL(r.request().url());
      return ["127.0.0.1", "localhost"].includes(u.hostname)
        ? r.continue()
        : r.abort();
    });
    try {
      await page.goto(base + "/test/room.html");
      await login(page);
      assert.equal(await page.locator("[data-room-instance]").count(), 3);
      await page.screenshot({ path: path.join(qa, `room-${width}.png`) });
      // Dragging uses real pointer events; it must commit a concrete grid change before saving.
      await page
        .locator('[data-room-instance="start-chair"] rect')
        .scrollIntoViewIfNeeded();
      const box = await page
          .locator('[data-room-instance="start-chair"] rect')
          .boundingBox(),
        scale = await page
          .locator("[data-room-scene]")
          .evaluate((svg) => svg.getScreenCTM().a);
      if (width < 700) {
        const cdp = await ctx.newCDPSession(page),
          x = box.x + box.width / 2,
          y = box.y + box.height / 2;
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y }],
        });
        for (let i = 1; i <= 5; i++)
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
              { x: x + (32 * scale * i) / 5, y: y + (16 * scale * i) / 5 },
            ],
          });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await cdp.detach();
      } else {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(
          box.x + box.width / 2 + 32 * scale,
          box.y + box.height / 2 + 16 * scale,
          { steps: 5 },
        );
        await page.mouse.up();
      }
      await page
        .getByText("配置を変更しました。保存すると反映されます。", {
          exact: true,
        })
        .waitFor();
      await page.locator('[data-room-instance="start-reizo"]').click();
      await page.locator('[data-room-action="x+"]').click();
      await page.locator('[data-room-action="save"]').click();
      await page
        .getByText("保存しました。 自分だけに見えます。", { exact: true })
        .waitFor();
      let original = (await db.collection("city_rooms").doc(A).get()).data();
      assert.equal(
        original.layout.placements.find((p) => p.id === "start-reizo").x,
        6,
      );
      assert.equal(original.visibility, "private");
      assert.equal(
        original.layout.placements.find((p) => p.id === "start-chair").x,
        3,
        "pointer drag updates the grid, not only selection",
      );
      await page.screenshot({ path: path.join(qa, `placed-${width}.png`) });
      await page.locator('[data-room-action="publication"]').click();
      assert.equal(
        (await db.collection("city_rooms").doc(A).get()).data().visibility,
        "private",
      );
      await page.locator("[data-room-confirm]").check();
      await page.locator('[data-room-action="publish"]').click();
      await page
        .getByText("保存しました。 部屋を公開しています。", { exact: true })
        .waitFor();
      original = (await db.collection("city_rooms").doc(A).get()).data();
      assert.match(original.publicId, /^[A-Za-z0-9_-]{22}$/);
      const publicPage = await ctx.newPage();
      await publicPage.goto(
        base + "/schoolpark/room.html?room=" + original.publicId,
      );
      await publicPage.locator("[data-like]").waitFor();
      assert.doesNotMatch(
        await publicPage.locator("main").innerText(),
        /SP-AAAA|room-alice|walletAddress/,
      );
      await publicPage.screenshot({
        path: path.join(qa, `public-${width}.png`),
      });
      await publicPage.locator("[data-like]").click();
      await publicPage
        .getByText("自分の部屋にはこの操作を行えません。", { exact: true })
        .waitFor();
      await publicPage.close();
      await page.locator('[data-room-action="share"]').click();
      await page.locator(".room-share img").waitFor();
      assert.ok(
        await page
          .locator(".room-share img")
          .evaluate((n) => n.complete && n.naturalWidth === 1200),
      );
      await page.locator(".room-share").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(qa, `share-${width}.png`) });
      const url = await page.locator(".room-share input").inputValue();
      assert.equal(new URL(url).searchParams.get("room"), original.publicId);
      await page.locator('[data-room-action="close-share"]').click();
      // Actual SDK account switch destroys private DOM and rereads the new canonical room.
      await page.click("#logout");
      await page.waitForFunction(
        () =>
          !auth.currentUser && !document.querySelector("[data-room-instance]"),
      );
      assert.equal(await page.locator("[data-room-instance]").count(), 0);
      await login(page, "room-bob");
      const visitor = await ctx.newPage();
      await visitor.goto(
        base + "/schoolpark/room.html?room=" + original.publicId,
      );
      await visitor.locator("[data-like]").click();
      await visitor
        .getByText("「いいね」を記録しました。", { exact: true })
        .waitFor();
      await visitor.locator("[data-like]").click();
      await visitor
        .getByText("すでに「いいね」しています。", { exact: true })
        .waitFor();
      await visitor.close();

      assert.equal(await page.locator("[data-room-instance]").count(), 3);
      await page.click("#logout");
      await login(page);
      assert.equal(
        await page.locator('[data-room-instance="start-reizo"]').count(),
        1,
      );
      page.once("dialog", (d) => d.accept());
      await page.locator('[data-room-action="publication"]').click();
      await page
        .getByText("保存しました。 自分だけに見えます。", { exact: true })
        .waitFor();
      assert.equal(
        (await fetch(base + "/api/schoolpark/city/room/" + original.publicId))
          .status,
        404,
      );
      assert.equal((await db.collection("mitemiru_orders").get()).size, 0);
      assert.equal((await db.collection("emuer_v2_agent_jobs").get()).size, 0);
      assert.ok(!network.some((u) => /economy|emuer\/v2|posthog/.test(u)));
      assert.deepEqual(errors, []);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    } finally {
      await ctx.close();
    }
  });
test("Native Admin SDK: replay, conflict, forged auth, public likes/reports and owner moderation", async () => {
  const {
      initializeApp,
      deleteApp,
    } = require("../quest-tests/node_modules/firebase/app"),
    {
      getAuth,
      connectAuthEmulator,
      signInWithEmailAndPassword,
    } = require("../quest-tests/node_modules/firebase/auth");
  const clients = [];
  async function session(uid) {
    const app = initializeApp(
        { apiKey: "emulator-only", projectId: PROJECT },
        uid,
      ),
      auth = getAuth(app);
    connectAuthEmulator(auth, "http://" + AUTH, { disableWarnings: true });
    clients.push(app);
    const { user } = await signInWithEmailAndPassword(
      auth,
      uid + "@example.invalid",
      "Emulator-only-password-123",
    );
    return {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (await user.getIdToken()),
    };
  }
  const alice = await session("room-alice"),
    bob = await session("room-bob"),
    owner = await session("room-owner");
  async function api(route, headers, method = "GET", body) {
    const r = await fetch(base + "/api/schoolpark/city/room" + route, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, d: await r.json() };
  }
  try {
    assert.equal(
      (await api("/me", { Authorization: "Bearer forged" })).status,
      401,
    );
    const me = (await api("/me", alice)).d,
      body = {
        requestId: "native-request-00001",
        expectedRevision: me.room.revision,
        visibility: "public",
        layout: me.room.layout,
      };
    const saved = await api("/me", alice, "PUT", body);
    assert.equal(saved.status, 200);
    const id = saved.d.room.publicId;
    assert.equal((await api("/me", alice, "PUT", body)).d.replayed, true);
    assert.equal(
      (await api("/me", alice, "PUT", { ...body, visibility: "private" }))
        .status,
      409,
    );
    assert.equal(
      (await api("/" + id + "/like", bob, "POST", {})).d.likeCount,
      1,
    );
    assert.equal(
      (await api("/" + id + "/like", bob, "POST", {})).d.likeCount,
      1,
    );
    assert.equal(
      (await api("/" + id + "/report", bob, "POST", { reason: "personal" }))
        .status,
      200,
    );
    assert.equal((await api("/admin/reports", bob)).status, 403);
    const reports = await api("/admin/reports", owner);
    assert.equal(reports.status, 200);
    assert.ok(reports.d.reports.some((r) => r.publicId === id));
    assert.equal(
      (
        await api("/admin/moderation", owner, "POST", {
          publicId: id,
          hidden: true,
        })
      ).status,
      200,
    );
    assert.equal((await api("/" + id)).status, 404);
    assert.equal(
      (
        await api("/admin/moderation", owner, "POST", {
          publicId: id,
          hidden: false,
        })
      ).status,
      200,
    );
    assert.equal((await api("/" + id)).status, 200);
    // Stable pagination must not drop reports sharing the same millisecond.
    for (let i = 0; i < 21; i++)
      await db
        .collection("city_rooms")
        .doc(A)
        .collection("city_room_reports")
        .doc(i.toString(16).padStart(64, "0"))
        .set({ publicId: id, reason: "spam", open: true, createdAtMs: 1 });
    const first = await api("/admin/reports", owner),
      second = await api("/admin/reports?before=" + first.d.nextBefore, owner);
    assert.equal(first.d.reports.length, 20);
    assert.equal(second.d.reports.length, 1);
    assert.equal(
      (await api("/admin/reports?before=invalid", owner)).status,
      400,
    );
  } finally {
    for (const a of clients) await deleteApp(a);
  }
});
