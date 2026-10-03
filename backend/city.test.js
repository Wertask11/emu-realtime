"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createCityRouter, SPOTS, checkinPath } = require("./city");
const { createIdentity } = require("./identity");
const { makeFirestore } = require("./fake-firestore");
const A = "SP-AAAA-AAAA-AAAA-AAAA", B = "SP-BBBB-BBBB-BBBB-BBBB";
const owner = "0x" + "a".repeat(40);
const startAt = Date.parse("2026-09-28T12:00:00Z");

async function fixture() {
  let clock = startAt;
  const db = makeFirestore({
    ches_accounts: {
      alice: { spid:A, walletAddress:"alice", chesAddress:"alice", pass:true },
      linked: { spid:A, walletAddress:"linked", chesAddress:"linked", pass:true },
      bob: { spid:B, walletAddress:"bob", chesAddress:"bob", pass:true },
      nonpass: { spid:B, walletAddress:"nonpass" },
      owner: { spid:A, walletAddress:owner },
      unlinked: { walletAddress:"unlinked", pass:true }
    },
    sp_auth_links: {
      "fb:alice":{spid:A}, "fb:linked":{spid:A}, "fb:bob":{spid:B},
      "fb:nonpass":{spid:B}, "fb:owner":{spid:A}
    },
    sp_identities:{ [A]:{spid:A,status:"active"}, [B]:{spid:B,status:"active"} }
  });
  // Keep the existing optimistic transaction fake; add only the bounded query
  // used by City. No live Firebase credentials or production collections.
  const collection = db.collection;
  db.collection = path => {
    const col = collection(path);
    col.orderBy = (field, direction) => ({ limit: limit => ({ get: async () => {
      const snap = await col.get();
      const docs = snap.docs.sort((a,b) => (a.data()[field] - b.data()[field]) * (direction === "desc" ? -1 : 1)).slice(0,limit);
      return { docs };
    } }) });
    return col;
  };
  const limits = new Map();
  const app = express();
  app.use(express.json());
  app.use("/city", createCityRouter({ db, identity:createIdentity({db}),
    entitlement:{ holdsOfficialPass:async (_uid, account) => account.pass === true },
    ownerAddresses:[owner], now:() => clock,
    requireFirebaseUser(req,res,next) {
      if (!req.headers["x-test-uid"]) return res.status(401).json({error:"AUTH_REQUIRED"});
      req.identity = { uid:req.headers["x-test-uid"] }; next();
    },
    rateLimit:({key,max}) => (req,res,next) => {
      const k = key + req.identity.uid, count = (limits.get(k) || 0) + 1;
      limits.set(k,count);
      if(count > max) return res.status(429).json({error:"RATE_LIMITED"});
      next();
    }
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  async function call(method, path, uid="alice", body) {
    const r = await fetch("http://127.0.0.1:" + server.address().port + "/city" + path,
      { method, headers:{"Content-Type":"application/json",...(uid ? {"x-test-uid":uid} : {})}, body:body === undefined ? undefined : JSON.stringify(body) });
    return {status:r.status, body:await r.json().catch(()=>null), cache:r.headers.get("cache-control")};
  }
  return { db, call, setClock:ms => {clock=ms;}, close:() => new Promise(resolve=>server.close(resolve)) };
}
async function using(fn) { const f = await fixture(); try { await fn(f); } finally { await f.close(); } }
const checkin = {spotId:"schoolpark-lab",checkInType:"virtual-entry"};

test("City: all catalogue fields, explicit demo state, no invented Quest IDs", () => {
  for (const spot of SPOTS) {
    for (const key of ["spotId","name","description","type","category","locationType","image","questId","guildId","checkInType","status"]) assert.ok(key in spot,key);
    assert.equal(spot.status,"demo"); assert.equal(spot.questId,null);
  }
});
test("City: anonymous requests to every data/write endpoint fail", () => using(async f => {
  for (const path of ["/spots","/me","/shops"]) assert.equal((await f.call("GET",path,"")).status,401);
  assert.equal((await f.call("POST","/shops/checkout","",{shopId:"field-store",productId:"field-note"})).status,401);
  assert.equal((await f.call("POST","/checkins","",checkin)).status,401);
  assert.equal(f.db._count(checkinPath(A)),0);
}));
test("City: preview denies a non-pass user even with supplied owner flag", () => using(async f => {
  assert.equal((await f.call("GET","/spots?isOwner=true","nonpass")).status,403);
  assert.equal((await f.call("POST","/checkins","nonpass",{...checkin,isOwner:true})).status,403);
}));
test("City: owner and official pass follow the existing preview policy", () => using(async f => {
  assert.equal((await f.call("GET","/spots","owner")).status,200);
  const r = await f.call("GET","/spots"); assert.equal(r.status,200);
  assert.equal(r.body.spots.length,3); assert.match(r.cache,/no-store/);
}));
test("City: October 1 JST opens to authenticated users, not anonymous checkins", () => using(async f => {
  f.setClock(Date.parse("2026-09-30T14:59:59Z"));
  assert.equal((await f.call("GET","/spots","nonpass")).status,403);
  f.setClock(Date.parse("2026-09-30T15:00:00Z"));
  assert.equal((await f.call("GET","/spots","nonpass")).status,200);
  assert.equal((await f.call("POST","/checkins","",checkin)).status,401);
}));
test("City: no independent identity is issued for an unlinked login", () => using(async f => {
  const r = await f.call("GET","/me","unlinked"); assert.equal(r.status,409);
  assert.equal(r.body.error,"PASSPORT_LINK_REQUIRED"); assert.equal(f.db._count("sp_identities"),2);
}));
test("City: inactive or missing Passport fails closed", () => using(async f => {
  await f.db.collection("sp_identities").doc(A).set({status:"suspended"});
  assert.equal((await f.call("POST","/checkins","alice",checkin)).status,403);
}));
test("City: body/query impersonation, forged reward and unsupported methods rejected", () => using(async f => {
  for(const key of ["passportId","uid","agentId","reward","approved"]) {
    assert.equal((await f.call("POST","/checkins","alice",{...checkin,[key]:B})).status,400);
  }
  assert.equal((await f.call("GET","/me?passportId="+B)).status,400);
  assert.equal((await f.call("POST","/checkins?spotId=schoolpark-lab","alice",checkin)).status,400);
  assert.equal((await f.call("GET","/checkins?spotId=schoolpark-lab")).status,404);
  assert.equal(f.db._count(checkinPath(A)),0);
}));
test("City: repeated and simultaneous checkins are one record across linked logins", () => using(async f => {
  const replies = await Promise.all(Array.from({length:6},(_,i)=>f.call("POST","/checkins",i%2 ? "alice" : "linked",checkin)));
  assert.ok(replies.every(r=>r.status===200));
  assert.equal(replies.filter(r=>!r.body.alreadyRecorded).length,1);
  assert.equal(f.db._count(checkinPath(A)),1);
  assert.equal((await f.call("GET","/me","linked")).body.checkins.length,1);
  assert.equal((await f.call("GET","/me","bob")).body.checkins.length,0);
  const first = await f.call("GET","/me","alice");
  // A later authenticated request (logout/login) reads the persistent record, no client cache.
  assert.deepEqual((await f.call("GET","/me","alice")).body,first.body);
}));
test("City: day boundary is server JST and cannot be client overridden", () => using(async f => {
  f.setClock(Date.parse("2026-09-28T14:59:59Z"));
  const first = await f.call("POST","/checkins","alice",checkin);
  f.setClock(Date.parse("2026-09-28T15:00:00Z"));
  const next = await f.call("POST","/checkins","alice",checkin);
  assert.equal(first.body.checkin.day,"2026-09-28"); assert.equal(next.body.checkin.day,"2026-09-29");
  assert.equal(f.db._count(checkinPath(A)),2);
}));
test("City: REAL is demo-only, no QR or GPS proof accepted", () => using(async f => {
  assert.equal((await f.call("POST","/checkins","alice",{spotId:"demo-book",checkInType:"qr"})).status,400);
  const r=await f.call("POST","/checkins","alice",{spotId:"demo-book",checkInType:"demo"});
  assert.equal(r.body.checkin.verification,"demo-only"); assert.equal(r.body.checkin.isDemo,true);
  assert.equal((await f.call("POST","/checkins","alice",{spotId:"../other",checkInType:"demo"})).status,404);
}));
test("City: errors are not empty success; private fields never enter projections", () => using(async f => {
  await f.call("POST","/checkins","alice",checkin);
  const r=await f.call("GET","/me"); const text=JSON.stringify(r.body);
  assert.doesNotMatch(text,/alice|linked|uid|wallet|primaryUid|kyc/i);
  assert.equal(r.body.passportId,A);
  f.db._breakAll("RESOURCE_EXHAUSTED");
  assert.equal((await f.call("GET","/me")).status,503);
  assert.equal((await f.call("POST","/checkins","alice",checkin)).status,503);
}));
test("City: bounded history query reports truncation honestly", () => using(async f => {
  for(let i=0;i<55;i++) await f.db.collection(checkinPath(A)).doc("record-"+i).set({spotId:"demo-book",occurredAt:i,uid:"private"});
  const r=await f.call("GET","/me"); assert.equal(r.body.checkins.length,50);
  assert.equal(r.body.hasMore,true); assert.equal(r.body.checkins[0].occurredAt,54);
  assert.doesNotMatch(JSON.stringify(r.body),/private/);
}));
test("City: write rate limit and catalogue mutation are closed", () => using(async f => {
  for(let i=0;i<10;i++) assert.equal((await f.call("POST","/checkins","alice",checkin)).status,200);
  assert.equal((await f.call("POST","/checkins","alice",checkin)).status,429);
  assert.equal((await f.call("POST","/spots","alice",{name:"Fake partner"})).status,404);
  assert.equal(f.db._count(checkinPath(A)),1);
}));
test("City: recording never changes existing balances, quests, stars or Identity", () => using(async f => {
  const before=JSON.stringify(f.db._dump("sp_identities"));
  await f.call("POST","/checkins","alice",checkin);
  for(const col of ["sp_quests","sp_stars","sp_quest_certificates","emuer_v2_rewards","emuer_offchain","sp_auth_links"]) {
    assert.equal(f.db._count(col),col === "sp_auth_links" ? 5 : 0);
  }
  // The two top-level Identity documents, not the new child records, remain unchanged.
  const after=f.db._dump("sp_identities");
  assert.deepEqual({[A]:after[A],[B]:after[B]},JSON.parse(before));
}));
