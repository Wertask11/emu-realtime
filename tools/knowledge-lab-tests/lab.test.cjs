'use strict';
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');
const {createFixture}=require('./fixture.cjs');const m=require('../../backend/knowledge-lab/model');
let f,alice,bob,owner;
const actor=role=>({...f.users[role],walletAddress:f.users[role].account.walletAddress.toLowerCase(),owner:role==='owner'});
const post=(key,extra={})=>({key,title:'独立して学んだこと',body:'小さく試してから準備を整えました。条件の違いも確認することが大切でした。',facets:{field:['field-business'],job:['job-independent'],experience:['experience-failure'],purpose:['purpose-learn'],kind:['kind-story']},visibility:'public',...extra});
before(async()=>{f=await createFixture();alice=actor('alice');bob=actor('bob');owner=actor('owner');await f.api.service.rebuild(owner);await f.api.service.waitForRebuild();});after(async()=>{await f?.close();});
test('real emulator auth, Passport and Owner middleware; public read vs private write',async()=>{
  assert.equal((await f.call('GET','/config')).body.enabled,true);
  assert.equal((await f.call('PUT','/posts',null,post('anon'))).status,401);
  assert.equal((await f.call('GET','/admin/summary','alice')).status,403);
  const me=await f.call('GET','/me','alice');assert.equal(me.status,200);assert.equal(me.body.schoolParkId,alice.spid);assert.equal(me.body.owner,false);
  const result=await fetch(f.base+'/api/knowledge-lab/me',{headers:{Authorization:'Bearer forged-token'}});assert.equal(result.status,401);
});
test('canonical public post, shared quota and idempotent retry',async()=>{
  const input=post('once');const saved=await f.api.service.savePost(alice,input);const again=await f.api.service.savePost(alice,input);assert.deepEqual(again,saved);
  const s=await f.db.collection('posts').doc(saved.id).get();assert.equal(s.data().address,alice.walletAddress);assert.equal(s.data().authorSchoolParkId,alice.spid);assert.equal(s.data().quotaUid,undefined);
  const d=new Date(Date.now()+9*3600000),usage=await f.db.collection('plan_usage').doc(alice.uid+'_r_m'+d.getUTCFullYear()+'-'+(d.getUTCMonth()+1)).get();assert.equal(usage.data().post,1);
  await assert.rejects(f.api.service.savePost(alice,{...input,body:'changed'}),/IDEMPOTENCY_CONFLICT/);
});
test('draft privacy, attacker read/edit denial, publish and withdrawal preserve data',async()=>{
  const draft=await f.api.service.savePost(alice,post('private',{visibility:'draft'}));assert.equal((await f.db.collection('posts').doc(draft.id).get()).exists,false);
  await assert.rejects(f.api.service.post(draft.id),/NOT_FOUND/);await assert.rejects(f.api.service.post(draft.id,bob),/NOT_FOUND/);
  await assert.rejects(f.api.service.savePost(bob,post('steal',{id:draft.id,revision:1})),/NOT_OWNER|NOT_FOUND/);
  const published=await f.api.service.savePost(alice,post('publish',{id:draft.id,revision:1}));assert.equal(published.revision,2);assert.equal((await f.api.service.ref('private_posts',draft.id).get()).exists,false);
  assert.equal((await f.db.collection('plan_counts').doc(alice.uid).get()).data().drafts,0);
  const withdrawn=await f.api.service.removePost(alice,draft.id,2,'withdraw');assert.equal(withdrawn.visibility,'private');assert.equal((await f.db.collection('posts').doc(draft.id).get()).data().body,'');
  assert.equal((await f.api.service.post(draft.id,alice)).body,post('private').body);
  await assert.rejects(f.api.service.post(draft.id,bob),/NOT_FOUND/);
  assert.ok((await f.api.service.history(alice,draft.id)).items.length>=2);
});
test('concurrent editing allows one revision and preserves the other editor input',async()=>{
  const saved=await f.api.service.savePost(alice,post('race-start'));
  const results=await Promise.allSettled(['a','b'].map(key=>f.api.service.savePost(alice,post('race-'+key,{id:saved.id,revision:1,body:'本文 '+key}))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/REVISION_CONFLICT/);
});
test('guest cannot bypass existing paid-post quota; quota is transactional under concurrency',async()=>{
  await assert.rejects(f.api.service.savePost(actor('guest'),post('no-plan')),/PLAN_LIMIT_REACHED/);
  const d=new Date(Date.now()+9*3600000),r=f.db.collection('plan_usage').doc(bob.uid+'_r_m'+d.getUTCFullYear()+'-'+(d.getUTCMonth()+1));await r.set({post:29});
  const result=await Promise.allSettled(['limit-a','limit-b'].map(key=>f.api.service.savePost(bob,post(key))));assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await r.get()).data().post,30);
});
test('writer consent, partial nonpublic profile restore and public fields only',async()=>{
  await assert.rejects(f.api.service.profile(alice,{displayName:'検証書き手',facets:{},published:true,revision:0}),/PUBLIC_PROFILE_CONSENT_REQUIRED/);
  const value=await f.api.service.profile(alice,{displayName:'検証書き手',bio:'失敗から学びました。',facets:{field:['field-business']},published:false,revision:0});
  await assert.rejects(f.api.service.writer(alice.spid),/NOT_FOUND/);assert.equal((await f.api.service.me(alice)).writer.bio,value.bio);
  const live=await f.api.service.profile(alice,{...value,published:true,consent:true});assert.equal(live.revision,2);const pub=await f.api.service.writer(alice.spid);assert.equal(pub.email,undefined);assert.equal(pub.uid,undefined);assert.equal(pub.qualification,'self-reported');
});
test('manual comparison uses real sources and does not claim AI analysis',async()=>{
  const p1=await f.api.service.savePost(alice,post('source-a',{facets:{field:['field-business'],kind:['kind-story']}})),p2=await f.api.service.savePost(alice,post('source-b',{facets:{field:['field-it'],kind:['kind-story']}}));
  const compared=await f.api.service.comparison(alice,{sourceIds:[p1.id,p2.id]});assert.deepEqual(compared.common.kind,['kind-story']);assert.deepEqual(new Set(compared.differences.field),new Set(['field-business','field-it']));assert.equal(compared.aiAvailable,false);
  const note=await f.api.service.saveNote(alice,{key:'note-once',title:'ITと経営の実践',fields:['field-business','field-it'],sourceIds:[p1.id,p2.id],hypothesis:'小さな自動化で確認できるだろうか',visibility:'public'});
  assert.equal((await f.api.service.note(note.id)).origin,'human');await assert.rejects(f.api.service.saveNote(bob,{key:'attack-note',id:note.id,revision:1,title:'改ざん',fields:['field-business','field-it'],sourceIds:[p1.id,p2.id]}),/NOT_OWNER/);
  await f.api.service.removePost(alice,p1.id,1,'source-withdraw');await assert.rejects(f.api.service.note(note.id,bob),/SOURCE_WITHDRAWN/);assert.equal((await f.api.service.note(note.id,alice)).title,'ITと経営の実践');
  await assert.rejects(f.api.service.saveNote(alice,{key:'private-source',title:'公開できない',fields:['field-business','field-it'],sourceIds:[p1.id,p2.id],visibility:'public'}),/PRIVATE_SOURCE/);
  const priv=await f.api.service.saveNote(alice,{key:'own-private-note',title:'自分用',fields:['field-business','field-it'],sourceIds:[p1.id,p2.id],visibility:'private'});await assert.rejects(f.api.service.note(priv.id,bob),/NOT_FOUND/);
});
test('global keyword/facet/relevance search and cursor paging extend beyond the first 128 documents',async()=>{
  for(let start=0;start<260;start+=100){const batch=f.db.batch();for(let i=start;i<Math.min(260,start+100);i++){batch.set(f.db.collection('posts').doc('paging-'+String(i).padStart(3,'0')),{title:'検証検索 '+i,body:i===259?'特別な針 keyword':'共通 keyword',createdAt:new Date(i*1000),knowledgeLab:{facets:{field:['field-education'],job:['job-teacher']}}});}await batch.commit();}
  await f.api.service.rebuild(owner);await f.api.service.waitForRebuild();
  const needle=await f.api.service.search({q:'特別な針',field:'field-education',job:'job-teacher'});assert.equal(needle.items.length,1);assert.equal(needle.items[0].id,'paging-259');
  const first=await f.api.service.search({q:'KEYWORD',field:'field-education',sort:'new'},alice);assert.equal(first.items.length,20);assert.equal(first.items[0].id,'paging-259');assert.ok(first.next);
  const second=await f.api.service.search({q:'KEYWORD',field:'field-education',sort:'new',cursor:first.next},alice);assert.equal(second.items.length,20);assert.equal(first.items.some(p=>second.items.some(q=>q.id===p.id)),false);
  assert.equal((await f.api.service.search({q:'無い言葉'})).items.length,0);
  await assert.rejects(f.api.service.search({q:'違う条件',cursor:first.next}),/SEARCH_CHANGED/);
  await f.db.collection('posts').doc('paging-259').delete();const stale=await f.api.service.search({q:'特別な針'});assert.equal(stale.items.length,0);
});
test('taxonomy rename/merge, non-owner denial and saved knowledge persistence',async()=>{
  const t=(await f.api.service.taxonomy()).find(t=>t.id==='field-business');
  assert.equal((await f.call('PUT','/admin/taxonomy/'+t.id,'alice',{label:'変更',revision:t.revision})).status,403);
  const changed=await f.call('PUT','/admin/taxonomy/'+t.id,'owner',{label:'経営・事業',axis:'field',revision:t.revision});assert.equal(changed.status,200);
  const one=await f.api.service.savePost(alice,post('bookmark'));await f.api.service.saveBookmark(alice,one.id,true);assert.ok((await f.api.service.bookmarks(alice,{})).items.some(p=>p.id===one.id));assert.equal((await f.api.service.bookmarks(bob,{})).items.length,0);
});
test('requests reuse existing schema/quota and answer idempotency, no EMUER mint route',async()=>{
  const request=await f.call('POST','/requests','alice',{key:'request-1',question:'独立の備え',context:'初めて独立を考えています。',facets:{field:['field-business']}});assert.equal(request.status,200);
  const raw=(await f.db.collection('knowledge_requests').doc(request.body.id).get()).data();assert.equal(raw.rewardPolicy,'emuer-v2-treasury-1');assert.equal(raw.bounty,1);
  const answer={key:'answer-1',experience:'自分で独立したときの経験です。',knowledge:'固定費を小さくして試すことを学びました。',limits:'個別の条件によります。'};
  // Bob's monthly post limit must not prevent an answer, which has its own existing quota.
  const r=await f.call('POST','/requests/'+request.body.id+'/answer','bob',answer);assert.equal(r.status,200);assert.equal((await f.call('POST','/requests/'+request.body.id+'/answer','bob',answer)).status,200);
  assert.equal((await f.db.collection('knowledge_requests').doc(request.body.id).get()).data().answerCount,1);
  assert.equal((await f.db.collection('emuer_v2_rewards').get()).size,0);
});
test('report and Owner moderation hide/restore canonical post without losing original body',async()=>{
  const p=await f.api.service.savePost(alice,post('moderated'));assert.equal((await f.call('POST','/reports','bob',{kind:'post',targetId:p.id,reason:'内容を確認してください。'})).status,200);
  const denied=await f.call('POST','/admin/posts/'+p.id,'bob',{action:'hide',revision:1,reason:'不正操作'});assert.equal(denied.status,403);
  const hidden=await f.call('POST','/admin/posts/'+p.id,'owner',{action:'hide',revision:1,reason:'通報確認'});assert.equal(hidden.status,200);await assert.rejects(f.api.service.post(p.id),/NOT_FOUND/);
  const restored=await f.call('POST','/admin/posts/'+p.id,'owner',{action:'restore',revision:2,reason:'確認済み'});assert.equal(restored.status,200);assert.equal((await f.api.service.post(p.id)).body,post('moderated').body);
});
test('input validation rejects paths, oversized body and malformed classification',async()=>{
  assert.throws(()=>m.id('../private'),/INVALID_ID/);assert.throws(()=>m.id('security-probe'),/INVALID_ID/);
  await assert.rejects(f.api.service.savePost(alice,post('bad',{facets:{field:['not-real']}})),/INVALID_CLASSIFICATION/);
  await assert.rejects(f.api.service.savePost(alice,post('large',{body:'x'.repeat(5001)})),/INVALID_TEXT/);
});
test('delete/archive and restore release the private quota while retaining recoverable content',async()=>{
  const saved=await f.api.service.savePost(alice,post('archivable',{visibility:'draft'}));const before=(await f.db.collection('plan_counts').doc(alice.uid).get()).data().drafts;
  await f.api.service.archivePost(alice,saved.id,1);assert.equal((await f.api.service.ref('private_posts',saved.id).get()).exists,false);assert.equal((await f.db.collection('plan_counts').doc(alice.uid).get()).data().drafts,before-1);
  await assert.rejects(f.api.service.post(saved.id,bob),/NOT_FOUND/);await f.api.service.restorePost(alice,saved.id,2);assert.equal((await f.api.service.post(saved.id,alice)).body,post('archivable').body);assert.equal((await f.db.collection('plan_counts').doc(alice.uid).get()).data().drafts,before);
});
test('real Passport link ticket preserves ownership across another emulator login method',async()=>{
  const {ensureVerifiedAccount}=require('../../backend/verified-platform'),{signIn}=require('./fixture.cjs');
  try{await f.firebase.auth().createUser({uid:'lab-alice-linked',email:'alice-linked@knowledge-lab.example.invalid',password:'Emulator-only-password-123'});}catch(e){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(e.code))throw e;}
  const token=await signIn('alice-linked'),decoded=await f.firebase.auth().verifyIdToken(token);await ensureVerifiedAccount(f.db,decoded);
  const ticket=await f.identity.issueLinkTicket(alice.spid,alice.uid);await f.identity.completeLinkWithTicket(ticket.ticket,decoded.uid,{signInProvider:'password'});
  const account=await ensureVerifiedAccount(f.db,decoded);f.users['alice-linked']={uid:decoded.uid,token,account,spid:alice.spid};
  const me=await f.call('GET','/me','alice-linked');assert.equal(me.status,200);assert.equal(me.body.schoolParkId,alice.spid);
  const source=(await f.api.service.myPublicPosts(alice)).items[0];const read=await f.call('GET','/posts/'+source.id,'alice-linked');assert.equal(read.body.editable,true);
});
test('public writer contributions omit private notes; Owner can moderate notes and profiles',async()=>{
  const contribution=await f.call('GET','/writers/'+alice.spid+'/contributions','alice');assert.equal(contribution.status,200);assert.ok(contribution.body.posts.length>0);assert.ok(contribution.body.notes.every(n=>n.visibility==='public'));
  const w=(await f.api.service.me(alice)).writer;
  const hide=await f.call('POST','/admin/visibility/writer/'+alice.spid,'owner',{action:'hide',revision:w.revision,reason:'検証用の確認'});assert.equal(hide.status,200);await assert.rejects(f.api.service.writer(alice.spid),/NOT_FOUND/);
  const current=(await f.api.service.me(alice)).writer;await assert.rejects(f.api.service.profile(alice,{...current,published:true,consent:true}),/MODERATED_PROFILE/);
  assert.equal((await f.call('POST','/admin/visibility/writer/'+alice.spid,'owner',{action:'release',revision:current.revision,reason:'確認解除'})).status,200);
});

test('keyword search includes structured experience; verified legacy wallet aliases keep edit access',async()=>{
  const saved=await f.api.service.savePost(alice,post('structured-search',{learned:'構造化した発見キーワード'}));
  const data=await f.api.service.search({q:'構造化した発見キーワード'},alice);assert.ok(data.items.some(p=>p.id===saved.id));
  assert.equal(m.owner({address:'0xaabb'},{walletAddress:'0xccdd',account:{chesAddress:'0xAAbB'}}),true);
  await f.api.service.removePost(alice,saved.id,1,'structured-withdraw');
  assert.equal((await f.api.service.search({q:'構造化した発見キーワード'},alice)).items.length,0);
});
