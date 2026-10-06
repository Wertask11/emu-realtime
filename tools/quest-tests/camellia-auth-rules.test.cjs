/* Camellia のログイン記録（camellia_auth_*）を、記録（Firestore Rules）の側から確かめる。

   ここにあるのは、LINE・SchoolPark Passport と Camellia アカウントの対応表と、
   Passport から Camellia へ渡す一回きりの引換券。読み書きするのはサーバー（Admin SDK）だけ。
   誰でも書けると、引換券を自作して他人の Camellia アカウントへ入れてしまう。

   成り立っていてほしいこと:
     ・ログインしていない人も、ログインした人も、camellia_auth_* を読めない・書けない
     ・camellia_users は本人だけ（この変更で弱めていないことの確認）               */
const { test, before, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fb = require('firebase/firestore');

let env;
const collections = ['camellia_auth_tickets', 'camellia_auth_identities', 'camellia_auth_users'];

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-camellia-auth-rules',
    firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('../../firestore.rules', 'utf8') }
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    await fb.setDoc(fb.doc(d, 'camellia_auth_tickets', 'existing'), { schoolParkId: 'SP-0001', expiresAt: Date.now() + 60000, used: false });
    await fb.setDoc(fb.doc(d, 'camellia_auth_identities', 'existing'), { provider: 'line', camelliaUid: 'camellia:victim' });
    await fb.setDoc(fb.doc(d, 'camellia_auth_users', 'existing'), { uid: 'camellia:victim', identities: { line: true } });
    await fb.setDoc(fb.doc(d, 'camellia_users', 'camellia:victim'), { birthDate: '1990-01-01' });
  });
});

for (const name of collections) {
  test(`${name}: ログインしていない人は読めない・書けない`, async () => {
    const d = env.unauthenticatedContext().firestore();
    await assertFails(fb.getDoc(fb.doc(d, name, 'existing')));
    await assertFails(fb.getDocs(fb.collection(d, name)));
    await assertFails(fb.setDoc(fb.doc(d, name, 'forged'), { schoolParkId: 'SP-0001', camelliaUid: 'camellia:victim', expiresAt: Date.now() + 60000, used: false }));
    await assertFails(fb.updateDoc(fb.doc(d, name, 'existing'), { used: false }));
    await assertFails(fb.deleteDoc(fb.doc(d, name, 'existing')));
  });
  test(`${name}: ログインした人（Camellia の本人を含む）も読めない・書けない`, async () => {
    for (const ctx of [env.authenticatedContext('camellia:attacker', { camellia: true }), env.authenticatedContext('camellia:victim', { camellia: true })]) {
      const d = ctx.firestore();
      await assertFails(fb.getDoc(fb.doc(d, name, 'existing')));
      await assertFails(fb.getDocs(fb.collection(d, name)));
      await assertFails(fb.setDoc(fb.doc(d, name, 'forged'), { schoolParkId: 'SP-0001', camelliaUid: 'camellia:attacker', expiresAt: Date.now() + 60000, used: false }));
      await assertFails(fb.deleteDoc(fb.doc(d, name, 'existing')));
    }
  });
}

test('camellia_users は本人だけ（弱めていない）', async () => {
  await assertSucceeds(fb.getDoc(fb.doc(env.authenticatedContext('camellia:victim', { camellia: true }).firestore(), 'camellia_users', 'camellia:victim')));
  await assertFails(fb.getDoc(fb.doc(env.authenticatedContext('camellia:attacker', { camellia: true }).firestore(), 'camellia_users', 'camellia:victim')));
  await assertFails(fb.getDoc(fb.doc(env.unauthenticatedContext().firestore(), 'camellia_users', 'camellia:victim')));
});
