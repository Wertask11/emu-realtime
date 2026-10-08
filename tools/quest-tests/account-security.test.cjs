const { test, before, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fb = require('firebase/firestore');

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-account-security',
    firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('../../firestore.rules', 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const name of ['entitlements', 'plan_counts', 'plan_usage', 'sp_invite_codes']) {
      await fb.setDoc(fb.doc(db, name, 'victim'), { drafts: 1, post: 1 });
    }
    await fb.setDoc(fb.doc(db, 'ches_accounts', 'victim'), { walletAddress: '0x123', email: 'private@example.test' });
    await fb.setDoc(fb.doc(db, 'ches_accounts', 'operator'), { walletAddress: '0xdcc687c05f130e57597a8525771299a4efb6edf7' });
    await fb.setDoc(fb.doc(db, 'sp_invite_codes', 'victim', 'invited', 'person'), { spid: 'SP-TEST' });
  });
});

test('unauthenticated visitors cannot read or mutate protected entitlement, usage and invitation records', async () => {
  const db = env.unauthenticatedContext().firestore();
  for (const name of ['entitlements', 'plan_counts', 'plan_usage', 'sp_invite_codes']) {
    await assertFails(fb.getDoc(fb.doc(db, name, 'victim')));
    await assertFails(fb.getDocs(fb.collection(db, name)));
    await assertFails(fb.setDoc(fb.doc(db, name, 'forged'), { drafts: 0, plan: 'pro' }));
    await assertFails(fb.updateDoc(fb.doc(db, name, 'victim'), { drafts: 0 }));
    await assertFails(fb.deleteDoc(fb.doc(db, name, 'victim')));
  }
});

test('authenticated attackers cannot forge grants, reset another account usage or alter invites', async () => {
  const db = env.authenticatedContext('attacker').firestore();
  for (const name of ['entitlements', 'plan_counts', 'plan_usage', 'sp_invite_codes']) {
    await assertFails(fb.setDoc(fb.doc(db, name, 'victim'), { drafts: 0, post: 0, plan: 'pro' }));
    await assertFails(fb.deleteDoc(fb.doc(db, name, 'victim')));
  }
  await assertFails(fb.setDoc(fb.doc(db, 'entitlements', 'attacker'), { plan: 'pro' }));
  await assertFails(fb.setDoc(fb.doc(db, 'sp_invite_codes', 'victim', 'invited', 'forged'), { spid: 'SP-FORGED' }));
});

test('account information is readable by self and operator, but not strangers or anonymous accounts', async () => {
  for (const uid of ['victim', 'operator']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertSucceeds(fb.getDoc(fb.doc(db, 'ches_accounts', 'victim')));
  }
  for (const context of [env.unauthenticatedContext(), env.authenticatedContext('stranger'), env.authenticatedContext('guest', { firebase: { sign_in_provider: 'anonymous' } })]) {
    const db = context.firestore();
    await assertFails(fb.getDoc(fb.doc(db, 'ches_accounts', 'victim')));
    await assertFails(fb.getDocs(fb.collection(db, 'ches_accounts')));
  }
});

test('legitimate own reads, bounded usage updates and operator invite reads still work', async () => {
  const db = env.authenticatedContext('victim').firestore();
  await assertSucceeds(fb.getDoc(fb.doc(db, 'entitlements', 'victim')));
  await assertSucceeds(fb.getDoc(fb.doc(db, 'plan_counts', 'victim')));
  await assertSucceeds(fb.updateDoc(fb.doc(db, 'plan_counts', 'victim'), { drafts: 0 }));
  await assertFails(fb.updateDoc(fb.doc(db, 'plan_counts', 'victim'), { drafts: 100 }));
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const usage = fb.doc(db, 'plan_usage', `victim_r_m${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`);
  await assertSucceeds(fb.setDoc(usage, { post: 1, request: 0, answer: 0 }));
  await assertSucceeds(fb.updateDoc(usage, { post: 2 }));
  await assertFails(fb.updateDoc(usage, { post: 0 }));
  await assertFails(fb.updateDoc(usage, { post: 100 }));
  const operatorDb = env.authenticatedContext('operator').firestore();
  await assertSucceeds(fb.getDoc(fb.doc(operatorDb, 'sp_invite_codes', 'victim')));
  await assertSucceeds(fb.getDoc(fb.doc(operatorDb, 'sp_invite_codes', 'victim', 'invited', 'person')));
});
