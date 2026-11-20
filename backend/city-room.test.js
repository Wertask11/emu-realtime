"use strict";
// Isolated dependency tests; no production auth, credentials, database or financial writes.
const {test}=require("node:test"),assert=require("node:assert/strict"),express=require("express");
const {makeFirestore}=require("./fake-firestore"),{createCityRoomRouter,DEFAULT,CATALOG,cleanLayout,ORDER_LIMIT}=require("./city-room");
const clone=x=>JSON.parse(JSON.stringify(x)),A="SP-AAAA-AAAA-AAAA-AAAA",B="SP-BBBB-BBBB-BBBB-BBBB",C="SP-CCCC-CCCC-CCCC-CCCC",D="SP-DDDD-DDDD-DDDD-DDDD",owner="0x"+"a".repeat(40);
const actors={alice:A,linked:A,bob:B,bob2:B,charlie:C,dan:D,owner:A};
async function fixture(){
 const db=makeFirestore({ches_accounts:Object.fromEntries(Object.keys(actors).map(uid=>[uid,{walletAddress:uid==="owner"?owner:uid}])),sp_identities:Object.fromEntries([A,B,C,D].map(spid=>[spid,{status:"active"}]))});
 const auth=(req,res,next)=>{const uid=req.headers["x-unit-user"];if(!actors[uid])return res.status(401).json({error:"AUTH_REQUIRED"});req.identity={uid};next();};
 const guard=(req,res,next)=>auth(req,res,()=>req.identity.uid==="owner"?next():res.status(403).json({error:"OWNER_ONLY"}));
 const router=createCityRoomRouter({db,identity:{findByUid:async uid=>actors[uid],readIdentity:async id=>(await db.collection("sp_identities").doc(id).get()).data()},entitlement:{holdsOfficialPass:async()=>false},ownerAddresses:[owner],requireFirebaseUser:auth,requireOwner:guard,now:()=>Date.parse("2026-11-20T12:00:00Z")});
 const app=express();app.use(express.json());app.use("/room",router);const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.on("listening",r));
 async function call(method,path,uid="alice",body){const r=await fetch('http://127.0.0.1:'+server.address().port+'/room'+path,{method,headers:{"Content-Type":"application/json",...(uid?{"x-unit-user":uid}:{})},...(body&&!["GET","HEAD"].includes(method)?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json(),cache:r.headers.get("cache-control")};}
 const order=async(n,patch={})=>db.collection("mitemiru_orders").doc(n.toString(16).padStart(32,"0")).set({passportId:A,status:"fulfilled",digitalAssetId:"room-plant-v1",shopId:"schoolpark-official",storeType:"schoolpark_virtual",...patch});
 return{db,call,order,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
async function using(fn){const f=await fixture();try{await fn(f);}finally{await f.close();}}
const save=(layout=clone(DEFAULT),p={})=>({requestId:"unit-room-request-0001",expectedRevision:0,visibility:"private",layout,...p});
const extra=(id="plant",itemId="room-plant-v1",x=6,y=4)=>({id,itemId,surface:"floor",x,y,rotation:0});
test("room: initial GET has exactly three free items, makes no documents/orders and does not expose identifiers",()=>using(async f=>{
 const r=await f.call("GET","/me");assert.equal(r.status,200);assert.equal(r.body.inventory.filter(x=>x.count>0).length,3);assert.equal(r.body.room.layout.placements.length,3);assert.equal(f.db._count("city_rooms"),0);assert.equal(f.db._count("mitemiru_orders"),0);assert.match(r.cache,/no-store/);assert.ok(!JSON.stringify(r.body).includes(A));
}));
test("room: anonymous cannot read/edit own room, like/report or moderate",()=>using(async f=>{
 for(const [m,p]of [["GET","/me"],["PUT","/me"],["POST","/aaaaaaaaaaaaaaaaaaaaaa/like"],["POST","/aaaaaaaaaaaaaaaaaaaaaa/report"],["GET","/admin/reports"],["POST","/admin/moderation"]])assert.equal((await f.call(m,p,"",save())).status,401);
 assert.equal((await f.call("GET","/aaaaaaaaaaaaaaaaaaaaaa","")).status,404);
}));
test("room: private/public/save/reopen uses random publicId; public projection contains only the scene",()=>using(async f=>{
 const before=JSON.stringify(f.db._dump("mitemiru_orders"));const s=await f.call("PUT","/me","alice",save(undefined,{visibility:"public"}));assert.equal(s.status,200);assert.equal(s.body.room.revision,1);const id=s.body.room.publicId;assert.match(id,/^[A-Za-z0-9_-]{22}$/);assert.ok(!id.includes("SP-"));
 const p=await f.call("GET","/"+id,"");assert.equal(p.status,200);const text=JSON.stringify(p.body);for(const value of [A,"ownerUid","schoolParkId","passportId","proofOrders","requestId"])assert.ok(!text.includes(value),value);assert.equal(p.body.catalog.items.length,3);
 const hidden=await f.call("PUT","/me","alice",save(undefined,{requestId:"unit-room-request-0002",expectedRevision:1}));assert.equal(hidden.status,200);assert.equal((await f.call("GET","/"+id,"")).status,404);
 const again=await f.call("PUT","/me","alice",save(undefined,{requestId:"unit-room-request-0003",expectedRevision:2,visibility:"public"}));assert.notEqual(again.body.room.publicId,id);assert.equal((await f.call("GET","/"+id,"")).status,404);assert.equal(JSON.stringify(f.db._dump("mitemiru_orders")),before);
}));
test("room: only fulfilled own official catalogue orders add inventory, one order gives one item",()=>using(async f=>{
 for(const [i,p]of [{status:"paid"},{status:"refunded"},{status:"cancelled"},{passportId:B},{shopId:"partner"},{storeType:"real_partner"},{digitalAssetId:"room-unknown-v1"},{}].entries())await f.order(i+1,p);
 const r=await f.call("GET","/me");assert.equal(r.body.inventory.find(x=>x.itemId==="room-plant-v1").count,1);const l=clone(DEFAULT);l.placements.push(extra());assert.equal((await f.call("PUT","/me","alice",save(l))).status,200);
 l.placements.push(extra("second","room-plant-v1",7,4));const denied=await f.call("PUT","/me","alice",save(l,{requestId:"unit-room-request-0002",expectedRevision:1}));assert.equal(denied.status,403);assert.equal(denied.body.error,"ROOM_ITEM_NOT_OWNED");
}));
test("room: unknown/unowned items, unknown fields, out-of-range and overlapping placements reject without writes",()=>using(async f=>{
 for(const [p,code]of [[extra(),"ROOM_ITEM_NOT_OWNED"],[extra("bad","no-item"),"INVALID_PLACEMENT"],[{...DEFAULT.placements[0],x:8},"OUTSIDE_ROOM"],[{...DEFAULT.placements[0],x:7,rotation:90,y:5},"OUTSIDE_ROOM"]]){
  const l=clone(DEFAULT);if(p.itemId.startsWith("starter-"))l.placements[0]=p;else l.placements.push(p);const r=await f.call("PUT","/me","alice",save(l));assert.equal(r.body.error,code);
 }
 const l=clone(DEFAULT);l.placements[1].x=2;l.placements[1].y=2;assert.equal((await f.call("PUT","/me","alice",save(l))).body.error,"ROOM_OVERLAP");assert.equal((await f.call("PUT","/me","alice",{...save(),ownerUid:"bob"})).status,400);assert.equal(f.db._count("city_rooms"),0);
}));
test("room: style slots and wall locations are separate, rotated footprints stay in bounds",()=>{
 const counts=Object.fromEntries(CATALOG.items.map(i=>[i.id,1]));const l=clone(DEFAULT);l.floor="room-floor-wood-v1";l.wall="room-wallpaper-paper-v1";l.window="room-window-night-v1";l.placements.push({id:"poster",itemId:"room-poster-v1",surface:"left_wall",x:1,y:1,rotation:0});assert.equal(cleanLayout(l,counts).placements.length,4);
 assert.throws(()=>cleanLayout({...l,wall:"room-floor-wood-v1"},counts),/INVALID_ROOM_ITEM/);l.placements.at(-1).rotation=90;assert.throws(()=>cleanLayout(l,counts),/INVALID_SURFACE/);
 const m=clone(DEFAULT);m.placements[0]={...m.placements[0],x:7,y:3,rotation:90};assert.doesNotThrow(()=>cleanLayout(m,counts));
});
test("room: placement cap and bounded inventory never silently truncate paid belongings",()=>using(async f=>{
 assert.throws(()=>cleanLayout({...clone(DEFAULT),placements:Array(25).fill(DEFAULT.placements[0])},{}),/ROOM_LIMIT/);
 for(let i=1;i<=ORDER_LIMIT+1;i++)await f.order(i);const r=await f.call("GET","/me");assert.equal(r.status,409);assert.equal(r.body.error,"ROOM_INVENTORY_LIMIT");assert.equal(f.db._count("city_rooms"),0);
}));
test("room: same requestId concurrent retries save once; changed content and revision conflict reject",()=>using(async f=>{
 const b=save(),rs=await Promise.all([f.call("PUT","/me","alice",b),f.call("PUT","/me","alice",b)]);assert.ok(rs.every(x=>x.status===200));assert.ok(rs.every(x=>x.body.room.revision===1));assert.equal(f.db._dump("city_rooms")[A].revision,1);
 assert.equal((await f.call("PUT","/me","alice",{...b,visibility:"public"})).body.error,"ROOM_REQUEST_CONFLICT");assert.equal((await f.call("PUT","/me","alice",{...b,requestId:"another-room-request-001"})).body.error,"ROOM_REVISION_CONFLICT");
}));
test("room: concurrent independent saves cannot overwrite each other",()=>using(async f=>{
 const rs=await Promise.all([f.call("PUT","/me","alice",save()),f.call("PUT","/me","alice",save(undefined,{requestId:"unit-other-request-0001"}))]);assert.deepEqual(rs.map(x=>x.status).sort(),[200,409]);assert.equal(f.db._dump("city_rooms")[A].revision,1);
}));
test("room: login-method switch shares the same room, another person never receives it",()=>using(async f=>{
 await f.call("PUT","/me","alice",save());const linked=await f.call("GET","/me","linked"),other=await f.call("GET","/me","bob");assert.equal(linked.body.room.revision,1);assert.equal(other.body.room.revision,0);assert.equal(other.body.room.publicId,null);assert.equal((await f.call("PUT","/me","bob",save())).status,200);assert.equal(f.db._dump("city_rooms")[A].revision,1);
}));
test("room: duplicate likes across linked logins count once; self-like rejects",()=>using(async f=>{
 const s=await f.call("PUT","/me","alice",save(undefined,{visibility:"public"})),id=s.body.room.publicId;assert.equal((await f.call("POST","/"+id+"/like","alice",{})).status,403);
 const rs=await Promise.all([f.call("POST","/"+id+"/like","bob",{}),f.call("POST","/"+id+"/like","bob2",{})]);assert.ok(rs.every(x=>x.status===200));assert.equal((await f.call("GET","/"+id,"")).body.room.likeCount,1);
}));
test("room: three different reports hide the room; owner cannot unhide via save; operator can review",()=>using(async f=>{
 const s=await f.call("PUT","/me","alice",save(undefined,{visibility:"public"})),id=s.body.room.publicId;
 for(const uid of ["bob","bob2","charlie"])assert.equal((await f.call("POST","/"+id+"/report",uid,{reason:"personal"})).status,200);assert.equal((await f.call("GET","/"+id,"")).status,200);
 assert.equal((await f.call("POST","/"+id+"/report","dan",{reason:"personal"})).status,200);assert.equal((await f.call("GET","/"+id,"")).status,404);
 const next=await f.call("PUT","/me","alice",save(undefined,{requestId:"unit-room-request-0002",expectedRevision:1,visibility:"public"}));assert.equal(next.body.room.hidden,true);
 assert.equal((await f.call("POST","/admin/moderation","alice",{publicId:id,hidden:false})).status,403);assert.equal((await f.call("POST","/admin/moderation","owner",{publicId:id,hidden:false})).status,200);assert.equal((await f.call("GET","/"+id,"")).status,200);
}));
test("room: refunded items vanish from public projection but original saved layout is retained",()=>using(async f=>{
 await f.order(1);const l=clone(DEFAULT);l.placements.push(extra());const s=await f.call("PUT","/me","alice",save(l,{visibility:"public"})),id=s.body.room.publicId;assert.equal((await f.call("GET","/"+id,"")).body.room.layout.placements.length,4);
 await f.order(1,{status:"refunded"});const p=await f.call("GET","/"+id,"");assert.equal(p.body.room.layout.placements.length,3);assert.equal(f.db._dump("city_rooms")[A].layout.placements.length,4);const own=await f.call("GET","/me");assert.deepEqual(own.body.room.unavailableInstances,["plant"]);
}));
test("room: quota outage is not interpreted as empty inventory and does not erase saved data",()=>using(async f=>{
 await f.call("PUT","/me","alice",save());const before=JSON.stringify(f.db._dump("city_rooms"));f.db._breakAll("RESOURCE_EXHAUSTED quota exceeded");assert.equal((await f.call("GET","/me")).status,429);assert.equal((await f.call("PUT","/me","alice",save(undefined,{expectedRevision:1,requestId:"unit-room-request-0002"}))).status,429);assert.equal(JSON.stringify(f.db._dump("city_rooms")),before);
}));
test("room: inactive Passport refuses editing before any room is created",()=>using(async f=>{
 await f.db.collection("sp_identities").doc(A).set({status:"disabled"});assert.equal((await f.call("PUT","/me","alice",save())).status,403);assert.equal(f.db._count("city_rooms"),0);
}));
