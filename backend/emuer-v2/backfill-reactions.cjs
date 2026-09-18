#!/usr/bin/env node
'use strict';
// Default is read-only. --commit is allowed only on/after the 2026-10-01 JST cutoff.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {evaluatePost,summarize}=require('./backfill');
const cutoffMs=Date.parse('2026-09-30T15:00:00.000Z'), commit=process.argv.includes('--commit');
if(commit && Date.now()<cutoffMs) throw new Error('Refusing final backfill before 2026-10-01 00:00 JST');
const admin=require('firebase-admin');if(!admin.apps.length)admin.initializeApp();const db=admin.firestore();
(async()=>{
 const snap=await db.collection('posts').get(),rows=[];snap.forEach(d=>rows.push(evaluatePost(d.id,d.data()||{})));rows.sort((a,b)=>a.postId.localeCompare(b.postId));
 const report={schema:'emuer-v2-past-reactions-v1',cutoff:'2026-10-01T00:00:00+09:00',generatedAt:new Date().toISOString(),summary:summarize(rows),rows};
 const canonical=JSON.stringify(report);report.sha256=crypto.createHash('sha256').update(canonical).digest('hex');
 const out=path.resolve(process.cwd(),'emuer-v2-past-reactions.json');fs.writeFileSync(out,JSON.stringify(report,null,2));
 if(commit){
  for(const row of rows){
   if(row.status!=='ready'||row.rewardEmuer===0)continue;
   const ref=db.collection('emuer_v2_backfill').doc(row.postId), ledger=db.collection('emuer_v2_unconverted_legacy').doc(row.legacyAuthorAddress);
   await db.runTransaction(async tx=>{if((await tx.get(ref)).exists)return;tx.create(ref,{...row,snapshotHash:report.sha256,createdAt:admin.firestore.FieldValue.serverTimestamp()});tx.set(ledger,{legacyAddress:row.legacyAuthorAddress,status:'identity_pending',unconverted:admin.firestore.FieldValue.increment(row.rewardEmuer),updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true})});
  }
 }
 console.log(JSON.stringify({mode:commit?'commit':'dry-run',output:out,sha256:report.sha256,summary:report.summary},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
