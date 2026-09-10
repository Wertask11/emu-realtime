/* Run only after deploying the reviewed firestore.rules. No public HTTP route.
   Uses the operator's existing Application Default Credentials. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const admin = require('../backend/node_modules/firebase-admin');
const manifest = require('../docs/quest-000/source-manifest.json');
const { FOUNDER_ID } = require('../frontend/public/schoolpark/quest-store.js');
const PROJECT = 'emusch-2a111';
const OWNER = '0x8ab838ebb2e3bf160bc61b7182d348a8500b35f7';
const hash = value => createHash('sha256').update(value).digest('hex');

async function seed(db, payload, expectedHash = manifest.sha256) {
  const bodyHash = hash(JSON.stringify(payload));
  if (bodyHash !== expectedHash) throw new Error('Source hash differs from the reviewed source');
  if (payload.version !== 1 || payload.sections.length !== 6 || payload.sections.some(s => !s.title || !s.body)) throw new Error('Incomplete Founder source');
  if (Buffer.byteLength(JSON.stringify(payload)) > 800000) throw new Error('Founder source exceeds safe document size');
  const founder = db.collection('sp_quests').doc(FOUNDER_ID);
  const counter = db.collection('sp_quest_counters').doc('quests');
  const zero = db.collection('sp_quest_numbers').doc('0');
  const commit = founder.collection('commits').doc(OWNER);
  return db.runTransaction(async tx => {
    // Read the collection too: abort on pre-existing conflicting Founder records.
    const all = await tx.get(db.collection('sp_quests'));
    const c = await tx.get(counter), z = await tx.get(zero), member = await tx.get(commit);
    const existing = all.docs.find(d => d.id === FOUNDER_ID);
    const conflicts = all.docs.filter(d => d.id !== FOUNDER_ID && (d.data().questNumber === 0 || d.data().kind === 'founder' || /#0{3}(?:\D|$)/.test(d.data().title || '')));
    if (conflicts.length) throw new Error('Existing #000 conflict; review required, no changes made');
    if (existing) {
      const d = existing.data();
      if (d.founderHash !== bodyHash || !require('node:util').isDeepStrictEqual(d.founderSections, payload.sections)
        || d.questNumber !== 0 || d.kind !== 'founder' || d.budget !== '0' || d.budgetCurrency !== 'JPY'
        || d.need !== 1 || d.closesAt !== null || d.owner !== OWNER || d.status !== 'OPEN'
        || !c.exists || !Number.isSafeInteger(c.data().nextNumber) || c.data().nextNumber < 1
        || !z.exists || z.data().questId !== FOUNDER_ID || !member.exists) {
        throw new Error('Existing Founder differs; review required, no overwrites');
      }
      return { created:false, id:FOUNDER_ID, nextNumber:c.data().nextNumber, founderHash:bodyHash };
    }
    if (c.exists || z.exists || all.docs.some(d => Number.isInteger(d.data().questNumber))) throw new Error('Sequence already exists without Founder; review required');
    const now = Date.now();
    tx.create(founder, {
      title:'SchoolPark Quest #000', kind:'founder', questNumber:0,
      knowledge:'SchoolParkの原点',
      hypothesis:'SchoolParkは何のために存在するのか。どんな社会をつくりたいのか。何を大切にするのか。その原点を記録する。',
      action:'実際の活動・行動・検証は#001から開始します。',
      measure:'目印にしてスタート、ゴールにして原点、原点にして頂点',
      budget:'0', budgetCurrency:'JPY', need:1, owner:OWNER, ownerName:'Founder',
      status:'OPEN', createdAt:now, closesAt:null,
      founderVersion:payload.version, founderSections:payload.sections, founderHash:bodyHash
    });
    tx.create(zero,{questId:FOUNDER_ID});
    tx.create(counter,{nextNumber:1,lastQuestId:FOUNDER_ID});
    tx.create(commit,{name:'Founder',tookAt:now});
    return { created:true, id:FOUNDER_ID, nextNumber:1, founderHash:bodyHash };
  });
}

async function main() {
  if (process.argv[2] !== '--apply' || process.argv[3] !== '--source' || !process.argv[4]) throw new Error('Use --apply --source /secure/path/founder-quest-000.json after deploying reviewed firestore.rules');
  const payload = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  if (hash(JSON.stringify(payload)) !== manifest.sha256) throw new Error('Source hash differs; no writes made');
  const credential = admin.credential.applicationDefault();
  admin.initializeApp({credential,projectId:PROJECT});
  const token = (await credential.getAccessToken()).access_token;
  async function readRules(resource) {
    const res = await fetch('https://firebaserules.googleapis.com/v1/' + resource, {headers:{Authorization:'Bearer '+token}});
    if (!res.ok) throw new Error('Cannot verify deployed Rules: HTTP '+res.status);
    return res.json();
  }
  const release = await readRules('projects/'+PROJECT+'/releases/cloud.firestore');
  const ruleset = await readRules(release.rulesetName);
  const live = (ruleset.source?.files || []).find(f => f.name === 'firestore.rules');
  const expected = fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');
  if (!live || hash(live.content) !== hash(expected)) throw new Error('Deployed Rules do not match reviewed file; no writes made');
  console.log(JSON.stringify(await seed(admin.firestore(), payload)));
  const all = await admin.firestore().collection('sp_quests').where('questNumber','==',0).get();
  if (all.size !== 1 || all.docs[0].id !== FOUNDER_ID) throw new Error('Post-deploy singleton verification failed');
  console.log('Verified: exactly one #000; source hash and all six sections match.');
}
module.exports = { seed };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode=1; });
