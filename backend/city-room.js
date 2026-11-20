"use strict";
const express = require("express");
const crypto = require("node:crypto");
const { isSchoolParkId } = require("./identity");
const { decideSchoolParkAccess } = require("./schoolpark-access");
const CATALOG = require("./city-room-items.json");
const ITEMS = new Map(CATALOG.items.map(i => [i.id, i]));
const PAID = CATALOG.items.filter(i => !i.starter).map(i => i.id);
const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{16,80}$/;
const ORDER_ID = /^[a-f0-9]{24,40}$/;
const REASONS = ["spam", "harass", "personal", "other"];
const ORDER_LIMIT = 64, REQUEST_DAYS = 7, HIDE_AT_REPORTS = 3;
const DEFAULT = Object.freeze({floor:null,wall:null,window:null,placements:[
  {id:"start-desk",itemId:"starter-desk-v1",surface:"floor",x:2,y:2,rotation:0},
  {id:"start-chair",itemId:"starter-chair-v1",surface:"floor",x:2,y:4,rotation:0},
  {id:"start-reizo",itemId:"starter-reizo-v1",surface:"floor",x:5,y:2,rotation:0}
]});
const clone = v => JSON.parse(JSON.stringify(v));
const hash = v => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
function fail(code,status=400) { throw Object.assign(new Error(code),{roomCode:code,status}); }
function keys(v,allowed) { if(!v || typeof v!=="object" || Array.isArray(v) || Object.keys(v).some(k=>!allowed.includes(k))) fail("INVALID_ROOM"); }
function units(layout) {return [...layout.placements.map(p=>({key:p.id,itemId:p.itemId})),...[["floor",layout.floor],["wall",layout.wall],["window",layout.window]].filter(x=>x[1]).map(([key,itemId])=>({key,itemId}))];}
function cleanLayout(input,counts) {
  keys(input,["placements","floor","wall","window"]);
  if(!Array.isArray(input.placements)||input.placements.length>CATALOG.maxPlacements)fail("ROOM_LIMIT");
  const out={floor:input.floor??null,wall:input.wall??null,window:input.window??null,placements:[]},ids=new Set(),occupied=new Set();
  for(const [slot,kind]of [["floor","flooring"],["wall","wallpaper"],["window","window"]])if(out[slot]!==null&&ITEMS.get(out[slot])?.surface!==kind)fail("INVALID_ROOM_ITEM");
  for(const p of input.placements){
    keys(p,["id","itemId","surface","x","y","rotation"]);
    if(typeof p.id!=="string"||!/^[A-Za-z0-9_-]{1,48}$/.test(p.id)||ids.has(p.id)||["floor","wall","window"].includes(p.id))fail("INVALID_PLACEMENT");
    ids.add(p.id);const i=ITEMS.get(p.itemId);
    if(!i||![0,90,180,270].includes(p.rotation)||!Number.isInteger(p.x)||!Number.isInteger(p.y))fail("INVALID_PLACEMENT");
    const floor=i.surface==="floor";
    if(floor?p.surface!=="floor":i.surface!=="wall"||!["left_wall","right_wall"].includes(p.surface)||p.rotation!==0)fail("INVALID_SURFACE");
    const turn=floor&&p.rotation%180!==0,w=turn?i.depth:i.width,d=turn?i.width:i.depth,maxX=floor?CATALOG.columns:p.surface==="left_wall"?CATALOG.rows:CATALOG.columns,maxY=floor?CATALOG.rows:3;
    if(p.x<0||p.y<0||p.x+w>maxX||p.y+d>maxY)fail("OUTSIDE_ROOM");
    for(let x=p.x;x<p.x+w;x++)for(let y=p.y;y<p.y+d;y++){const cell=p.surface+":"+x+":"+y;if(occupied.has(cell))fail("ROOM_OVERLAP");occupied.add(cell);}
    out.placements.push({id:p.id,itemId:p.itemId,surface:p.surface,x:p.x,y:p.y,rotation:p.rotation});
  }
  const use=units(out);if(use.length>CATALOG.maxPlacements)fail("ROOM_LIMIT");
  const used={};for(const u of use){used[u.itemId]=(used[u.itemId]||0)+1;if(used[u.itemId]>(counts[u.itemId]||0))fail("ROOM_ITEM_NOT_OWNED",403);}
  return out;
}
function qualifies(o,spid) {return o&&o.passportId===spid&&o.shopId==="schoolpark-official"&&o.storeType==="schoolpark_virtual"&&o.status==="fulfilled"&&PAID.includes(o.digitalAssetId);}
function selectFields(q,fields) {return typeof q.select==="function"?q.select(...fields):q;}
function createCityRoomRouter({db,identity,entitlement,requireFirebaseUser,requireOwner,rateLimit,ownerAddresses=[],now=Date.now,publicId=()=>crypto.randomBytes(16).toString("base64url")}={}) {
  const router=express.Router(),root=spid=>db.collection("city_rooms").doc(spid),pub=id=>root("_public").collection("ids").doc(id);
  const limited=(key,max)=>rateLimit?rateLimit({key,max,windowMs:60000}):(_q,_s,n)=>n();
  router.use((_q,res,next)=>{res.set("Cache-Control","private, no-store");next();});
  const handle=fn=>async(req,res)=>{try{res.json({ok:true,...await fn(req)});}catch(e){const quota=e.code===8||e.code==="resource-exhausted"||/RESOURCE_EXHAUSTED|quota exceeded/i.test(e.message||"");res.status(e.roomCode?e.status:quota?429:503).json({error:e.roomCode||(quota?"ROOM_QUOTA_EXHAUSTED":"ROOM_UNAVAILABLE")});}};
  async function actor(req,res,next){try{
    if(!db||!identity||!entitlement)fail("ROOM_UNAVAILABLE",503);
    const uid=req.identity?.uid;if(!uid)fail("AUTH_REQUIRED",401);
    const a=(await db.collection("ches_accounts").doc(uid).get()).data();if(!a)fail("ACCOUNT_NOT_FOUND",403);
    const isOwner=[a.walletAddress,a.chesAddress].some(x=>ownerAddresses.includes(String(x||"").toLowerCase()));
    const hasOfficialPass=await entitlement.holdsOfficialPass(uid,a);
    if(!decideSchoolParkAccess(now(),{isOwner,hasOfficialPass}).allowed)fail("SCHOOLPARK_ACCESS_DENIED",403);
    const spid=await identity.findByUid(uid),person=isSchoolParkId(spid)&&await identity.readIdentity(spid);
    if(!person||person.status!=="active")fail("PASSPORT_INACTIVE",403);
    req.roomActor={uid,spid,isOwner};next();
  }catch(e){handle(async()=>{throw e;})(req,res);}}
  function inventoryFrom(rows,spid){const counts=Object.fromEntries(CATALOG.items.map(i=>[i.id,i.starter||0])),orders={};
    for(const d of rows){const o=d.data();if(qualifies(o,spid)&&ORDER_ID.test(d.id)){counts[o.digitalAssetId]++;(orders[o.digitalAssetId]||=[]).push(d.id);}}
    for(const v of Object.values(orders))v.sort();return{counts,orders};}
  async function inventory(a){
    const q=db.collection("mitemiru_orders").where("passportId","==",a.spid).where("status","==","fulfilled").where("digitalAssetId","in",PAID);
    const snap=await selectFields(q,["passportId","status","digitalAssetId","shopId","storeType"]).limit(ORDER_LIMIT+1).get();
    if(snap.docs.length>ORDER_LIMIT)fail("ROOM_INVENTORY_LIMIT",409);
    return inventoryFrom(snap.docs,a.spid);
  }
  function filtered(layout,counts){const out=clone(layout),left={...counts},lost=[];
    const consume=(key,id)=>{if(!id)return true;if((left[id]||0)>0){left[id]--;return true;}lost.push(key);return false;};
    for(const key of ["floor","wall","window"])if(!consume(key,out[key]))out[key]=null;
    out.placements=out.placements.filter(p=>consume(p.id,p.itemId));return{layout:out,lost};}
  function ownView(d,inv,a){const checked=filtered(d?.layout||DEFAULT,inv.counts);return{room:{revision:d?.revision||0,visibility:d?.visibility||"private",publicId:d?.publicId||null,hidden:d?.hidden===true,layout:checked.layout,unavailableInstances:checked.lost,updatedAt:d?.updatedAtMs||null},inventory:CATALOG.items.map(i=>({itemId:i.id,count:inv.counts[i.id]||0,source:i.starter?"starter":"shop"})),catalog:CATALOG,isOwner:a.isOwner};}
  async function publicRecord(id){if(!PUBLIC_ID.test(id||""))fail("ROOM_NOT_FOUND",404);
    const mapping=(await pub(id).get()).data();if(!mapping?.active||!isSchoolParkId(mapping.spid))fail("ROOM_NOT_FOUND",404);
    const r=root(mapping.spid),d=(await r.get()).data();if(!d||d.publicId!==id||d.visibility!=="public"||d.hidden)fail("ROOM_NOT_FOUND",404);return{r,d,spid:mapping.spid};}
  router.get("/me",requireFirebaseUser,limited("city-room-own",30),actor,handle(async req=>{
    const [s,inv]=await Promise.all([root(req.roomActor.spid).get(),inventory(req.roomActor)]);return ownView(s.data(),inv,req.roomActor);
  }));
  router.put("/me",requireFirebaseUser,limited("city-room-save",12),actor,handle(async req=>{
    const a=req.roomActor,b=req.body;keys(b,["requestId","expectedRevision","visibility","layout"]);
    if(!REQUEST_ID.test(b.requestId||"")||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0||!["public","private"].includes(b.visibility)||JSON.stringify(b).length>24000)fail("INVALID_ROOM");
    const inv=await inventory(a),layout=cleanLayout(b.layout,inv.counts),fingerprint=hash([b.expectedRevision,b.visibility,layout]),r=root(a.spid),rr=r.collection("city_room_requests").doc(b.requestId),nextId=publicId();if(!PUBLIC_ID.test(nextId))fail("ROOM_UNAVAILABLE",503);
    const proofOrders=[];const usage={};for(const u of units(layout))if(!ITEMS.get(u.itemId).starter){const n=usage[u.itemId]||0;usage[u.itemId]=n+1;proofOrders.push({id:inv.orders[u.itemId][n],itemId:u.itemId});}
    const result=await db.runTransaction(async tx=>{
      const [rs,prior,newMapping,...proofs]=await Promise.all([tx.get(r),tx.get(rr),tx.get(pub(nextId)),...proofOrders.map(o=>tx.get(db.collection("mitemiru_orders").doc(o.id)))]);
      const d=rs.data();if(prior.exists){if(prior.data().fingerprint!==fingerprint)fail("ROOM_REQUEST_CONFLICT",409);return{d,replayed:true};}
      if((d?.revision||0)!==b.expectedRevision)fail("ROOM_REVISION_CONFLICT",409);
      proofs.forEach((p,i)=>{if(!qualifies(p.data(),a.spid)||p.data().digitalAssetId!==proofOrders[i].itemId)fail("ROOM_ITEM_NOT_OWNED",403);});
      const publishing=b.visibility==="public"&&d?.visibility!=="public";if(publishing&&newMapping.exists)fail("ROOM_RETRY_REQUIRED",409);
      const id=b.visibility==="private"?null:publishing?nextId:d.publicId;if(b.visibility==="public"&&!PUBLIC_ID.test(id||""))fail("ROOM_UNAVAILABLE",503);
      const data={schemaVersion:1,ownerUid:d?.ownerUid||a.uid,schoolParkId:a.spid,revision:(d?.revision||0)+1,visibility:b.visibility,publicId:id,layout,proofOrders,hidden:d?.hidden===true,hiddenByReports:d?.hiddenByReports===true,moderatedBy:d?.moderatedBy||null,moderatedAtMs:d?.moderatedAtMs||null,likeCount:d?.likeCount||0,reportCount:publishing?0:d?.reportCount||0,reviewedAtMs:!publishing&&d&&hash(d.layout)===hash(layout)?d.reviewedAtMs||null:null,createdAtMs:d?.createdAtMs||now(),updatedAtMs:now()};
      if(d?.publicId&&d.publicId!==id)tx.set(pub(d.publicId),{active:false},{merge:true});
      if(publishing)tx.create(pub(id),{spid:a.spid,active:true,createdAtMs:now()});
      tx.set(r,data);tx.create(rr,{fingerprint,revision:data.revision,createdAtMs:now(),deleteAfterMs:now()+REQUEST_DAYS*86400000});return{d:data,replayed:false};
    });
    // Only an explicit save cleans a bounded number of expired acknowledgement records.
    // No timers, global scan, reads on open, or order/history deletion.
    if(!result.replayed){try{const old=await r.collection("city_room_requests").where("deleteAfterMs","<=",now()).limit(4).get();for(const d of old.docs)await d.ref.delete();}catch(_){/* Saved layout stays valid; retry cleanup on a later explicit save. */}}
    return{...ownView(result.d,inv,a),replayed:result.replayed};
  }));
  // Kept ahead of /:publicId; these routes always use the existing owner guard.
  router.get("/admin/reports",requireOwner,limited("city-room-admin",20),actor,handle(async req=>{
    if(!req.roomActor.isOwner)fail("OWNER_ONLY",403);
    const ref=db.collectionGroup?db.collectionGroup("city_room_reports"):null;if(!ref)fail("ROOM_UNAVAILABLE",503);
    let q=ref.where("open","==",true).orderBy("createdAtMs","desc");const cursor=req.query.before;
    if(cursor!==undefined){const n=Number(cursor);if(!Number.isSafeInteger(n)||n<0)fail("INVALID_ROOM");q=q.where("createdAtMs","<",n);}
    const s=await q.limit(20).get();return{reports:s.docs.map(d=>{const v=d.data();return{publicId:v.publicId,reason:v.reason,createdAt:v.createdAtMs};}),nextBefore:s.docs.length===20?s.docs.at(-1).data().createdAtMs:null};
  }));
  router.post("/admin/moderation",requireOwner,limited("city-room-moderate",12),actor,handle(async req=>{
    if(!req.roomActor.isOwner)fail("OWNER_ONLY",403);keys(req.body,["publicId","hidden"]);if(typeof req.body.hidden!=="boolean"||!PUBLIC_ID.test(req.body.publicId||""))fail("INVALID_ROOM");
    const m=pub(req.body.publicId),initial=(await m.get()).data();if(!initial?.active||!isSchoolParkId(initial.spid))fail("ROOM_NOT_FOUND",404);const reportRows=await root(initial.spid).collection("city_room_reports").where("publicId","==",req.body.publicId).where("open","==",true).limit(20).get();await db.runTransaction(async tx=>{const mapping=(await tx.get(m)).data();if(!mapping?.active||!isSchoolParkId(mapping.spid))fail("ROOM_NOT_FOUND",404);const r=root(mapping.spid),d=(await tx.get(r)).data();if(!d||d.publicId!==req.body.publicId)fail("ROOM_NOT_FOUND",404);const reports=await Promise.all(reportRows.docs.map(d=>tx.get(d.ref)));tx.set(r,{hidden:req.body.hidden,hiddenByReports:false,reviewedAtMs:now(),moderatedAtMs:now(),moderatedBy:req.roomActor.uid},{merge:true});for(const report of reports)tx.set(report.ref,{open:false,reviewedAtMs:now()},{merge:true});});return{hidden:req.body.hidden};
  }));
  router.get("/:publicId",limited("city-room-public",30),handle(async req=>{
    const {d,spid}=await publicRecord(req.params.publicId),proof=d.proofOrders||[];
    if(proof.length>CATALOG.maxPlacements||proof.some(o=>!ORDER_ID.test(o.id)))fail("ROOM_UNAVAILABLE",503);
    const rows=await Promise.all(proof.map(o=>db.collection("mitemiru_orders").doc(o.id).get())),inv=inventoryFrom(rows,spid),checked=filtered(d.layout,inv.counts),ids=new Set(units(checked.layout).map(x=>x.itemId));
    return{room:{publicId:d.publicId,revision:d.revision,layout:checked.layout,likeCount:d.likeCount||0,updatedAt:d.updatedAtMs},catalog:{...CATALOG,items:CATALOG.items.filter(i=>ids.has(i.id))}};
  }));
  for(const action of ["like","report"])router.post("/:publicId/"+action,requireFirebaseUser,limited("city-room-"+action,10),actor,handle(async req=>{
    const id=req.params.publicId,a=req.roomActor;if(!PUBLIC_ID.test(id||""))fail("ROOM_NOT_FOUND",404);
    keys(req.body||{},action==="report"?["reason"]:[]);if(action==="report"&&!REASONS.includes(req.body?.reason))fail("INVALID_ROOM");
    const result=await db.runTransaction(async tx=>{
      const mapping=(await tx.get(pub(id))).data();if(!mapping?.active||!isSchoolParkId(mapping.spid))fail("ROOM_NOT_FOUND",404);
      if(mapping.spid===a.spid)fail("ROOM_SELF_ACTION",403);
      const r=root(mapping.spid),key=action==="like"?hash(a.spid):hash([id,a.spid]),entry=r.collection(action==="like"?"likes":"city_room_reports").doc(key),[rs,old]=await Promise.all([tx.get(r),tx.get(entry)]),d=rs.data();
      if(!d||d.visibility!=="public"||d.publicId!==id||d.hidden)fail("ROOM_NOT_FOUND",404);if(old.exists)return{already:true,count:action==="like"?d.likeCount||0:d.reportCount||0};
      tx.create(entry,{publicId:id,actorKey:hash(a.spid),createdAtMs:now(),...(action==="report"?{reason:req.body.reason,open:true}:{} )});
      const n=Number(action==="like"?d.likeCount||0:d.reportCount||0)+1,patch=action==="like"?{likeCount:n}:{reportCount:n,...(n>=HIDE_AT_REPORTS&&!d.reviewedAtMs?{hidden:true,hiddenByReports:true}:{})};tx.set(r,patch,{merge:true});return{already:false,count:n};
    });return action==="like"?{already:result.already,likeCount:result.count}:{already:result.already};
  }));
  return router;
}
module.exports={createCityRoomRouter,cleanLayout,qualifies,CATALOG,DEFAULT,PUBLIC_ID,HIDE_AT_REPORTS,ORDER_LIMIT};
