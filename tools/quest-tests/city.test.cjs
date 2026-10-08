/* The existing sp_identities exclusion also covers all descendant paths.
 * City uses Admin SDK APIs exclusively; do not weaken Rules for direct clients. */
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs } = require('firebase/firestore');
const A='SP-AAAA-AAAA-AAAA-AAAA', B='SP-BBBB-BBBB-BBBB-BBBB';
let env;
before(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-schoolpark-city',firestore:{host:'127.0.0.1',port:8080,rules:fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8')}});
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    await setDoc(doc(db,'ches_accounts','alice'),{spid:A,walletAddress:'alice',chesAddress:'alice'});
    await setDoc(doc(db,'ches_verified_accounts','alice'),{spid:A,walletAddress:'alice',chesAddress:'alice'});
    await setDoc(doc(db,'ches_accounts','owner'),{spid:B,walletAddress:'0x8ab838ebb2e3bf160bc61b7182d348a8500b35f7'});
    await setDoc(doc(db,'ches_verified_accounts','owner'),{spid:B,walletAddress:'0x8ab838ebb2e3bf160bc61b7182d348a8500b35f7'});
    await setDoc(doc(db,'sp_identities',A),{spid:A,status:'active'});
    await setDoc(doc(db,'sp_identities',A,'city_checkins','saved'),{spotId:'demo-book',isDemo:true});
  });
});
after(async()=>{await env?.cleanup();});
for(const role of ['anonymous','alice','bob','owner']) {
  test(`City Rules: ${role} cannot directly read, create, alter or delete City records`,async()=>{
    const db=(role==='anonymous' ? env.unauthenticatedContext() : env.authenticatedContext(role)).firestore();
    const target=doc(db,'sp_identities',A,'city_checkins','saved');
    await assertFails(getDoc(target));
    await assertFails(getDocs(collection(db,'sp_identities',A,'city_checkins')));
    await assertFails(setDoc(doc(db,'sp_identities',A,'city_checkins','forged'),{passportId:A}));
    await assertFails(updateDoc(target,{isDemo:false}));
    await assertFails(deleteDoc(target));
  });
}
test('City Rules: a client cannot reassign its Passport to someone else',async()=>{
  await assertFails(updateDoc(doc(env.authenticatedContext('alice').firestore(),'ches_accounts','alice'),{spid:B}));
});
