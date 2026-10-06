const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');

(async () => {
  const rules = fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8');
  const env = await initializeTestEnvironment({ projectId: 'demo-schoolpark-passkey', firestore: { rules } });
  try {
    const admin = require('firebase-admin');
    const adminApp = admin.initializeApp({ projectId: 'demo-schoolpark-passkey' }, 'rules-emulator-admin');
    const adminDb = admin.firestore(adminApp);
    await adminDb.doc('sp_passkeys/known-credential').set({ spid: 'SP-ALICE' });
    await adminDb.doc('sp_passkey_challenges/known-challenge').set({ challenge: 'known', type: 'authentication' });
    await adminDb.doc('ches_accounts/user-alice').set({ walletAddress: '0xabc' });
    await adminDb.doc('posts/public-knowledge').set({ body: 'fixture' });

    const clients = [
      ['unauthenticated', env.unauthenticatedContext().firestore()],
      ['ordinary user', env.authenticatedContext('user-alice').firestore()],
      ['different user', env.authenticatedContext('user-bob').firestore()],
    ];
    for (const [label, db] of clients) {
      for (const collectionName of ['sp_passkeys', 'sp_passkey_challenges']) {
        const id = collectionName === 'sp_passkeys' ? 'known-credential' : 'known-challenge';
        await assertFails(getDoc(doc(db, collectionName, id)), `${label} reads ${collectionName}`);
        await assertFails(setDoc(doc(db, collectionName, `new-${label.replaceAll(' ', '-')}`), { value: 1 }), `${label} writes ${collectionName}`);
      }
    }

    const alice = env.authenticatedContext('user-alice').firestore();
    await assertFails(getDoc(doc(alice, 'sp_passkeys', 'known-credential')), 'knowing a credential ID does not permit direct lookup');
    await assertFails(getDoc(doc(alice, 'sp_passkey_challenges', 'known-challenge')), 'knowing a challenge ID does not permit direct lookup');
    await assertFails(setDoc(doc(alice, 'sp_passkey_challenges', 'client-challenge'), { challenge: 'forged', type: 'authentication' }), 'client cannot create challenges');
    await assertFails(setDoc(doc(alice, 'sp_passkeys', 'client-credential'), { spid: 'SP-ALICE' }), 'client cannot create credentials');

    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'posts', 'public-knowledge')),
      'existing public knowledge read remains permitted');
    await assertSucceeds(getDoc(doc(alice, 'ches_accounts', 'user-alice')),
      'signed-in user can still read own SchoolPark account');

    await adminDb.doc('sp_passkeys/backend-credential').set({ spid: 'SP-ALICE' });
    assert.equal((await adminDb.doc('sp_passkeys/backend-credential').get()).data().spid, 'SP-ALICE');
    await adminDb.doc('sp_passkey_challenges/backend-challenge').set({ challenge: 'server', type: 'registration' });
    console.log('Firestore Rules Emulator: PASS (unauth/signed-in/other user credential+challenge denied; known IDs denied; actual Firebase Admin SDK allowed; public posts and own account read retained)');
    await adminApp.delete();
  } finally {
    await env.cleanup();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
