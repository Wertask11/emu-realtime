'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const {grab}=require('../year-goals-tests/extract.cjs');
const root=path.resolve(__dirname,'../..');
const baseline='f52dc21cbe20c7e09ea21bf7496a0f4e5487cd8a';
const before=file=>cp.execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8',maxBuffer:10*1024*1024});

test('UX does not change enrollment writes, Passport resolution, reports or wisdom submission',()=>{
 const file='frontend/public/index.html',old=before(file),now=fs.readFileSync(path.join(root,file),'utf8');
 // spGuildToggle was changed on purpose on 2026-10-24 (offline fallback for
 // read and write); quest-order.test.cjs and guild-counts.test.cjs cover it.
 for(const name of ['spQuestToggle','spPassportLoad','spLogSubmit','spWisdomSubmit'])
  assert.equal(grab(now,name),grab(old,name),name+' must preserve the existing action and identity rules');
});

test('quest rules, reward/identity backend and original quest/guild definitions are unchanged',()=>{
 // firestore.rules has since changed on purpose (Good/Change on 10/24, answers and
 // adoption within the Rules budget on 10/24); its emulator suites
 // (tools/quest-tests, tools/knowledge-lab-tests) cover quests and guilds now.
 for(const file of ['firestore.indexes.json','backend/identity.js','frontend/public/schoolpark/quest-store.js','frontend/public/schoolpark/guild-store.js'])
  assert.equal(fs.readFileSync(path.join(root,file),'utf8'),before(file),file);
 // backend/quest-completion.js changed on purpose on 2026-10-28: the certificate
 // claim also answers where the NFT went, and GET /certificates/mine was added
 // (backend/quest-completion.test.js covers both). The approval that issues
 // rewards and certificates must still be exactly the baseline's.
 const approval=src=>src.slice(src.indexOf('router.post("/:questId/:address/approve"'),src.indexOf('router.get("/:questId/:address/rewards"'));
 const qc=fs.readFileSync(path.join(root,'backend/quest-completion.js'),'utf8');
 assert.ok(approval(qc).length>1000,'the approval route was not found');
 assert.equal(approval(qc),approval(before('backend/quest-completion.js')),'quest approval (rewards and certificates) must be unchanged');
 const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
 for(const block of ['match /sp_quests/{questId}','match /sp_guild_members/{guildId}'])
  assert.ok(rules.includes(block),block);
});
