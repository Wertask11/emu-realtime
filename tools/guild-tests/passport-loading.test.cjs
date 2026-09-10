const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../../frontend/public/index.html'), 'utf8');
const passport = html.slice(html.indexOf('async function spPassportLoad(force)'), html.indexOf('/* プランの答えが返ってきたら'));
const start = html.indexOf('let _spVoteBusy = false;');
const end = html.lastIndexOf('/* ═', html.indexOf('   自分の宿題', start));

function setup() {
  const founder = { id: 'founder-quest-000', kind: 'founder', questNumber: 0,
    title: 'SchoolPark Quest #000', budget: '0', need: 1, closesAt: null,
    founderSections: [{title:'原点',body:'全文'}] };
  let resolveBilling;
  const billing = new Promise(r => { resolveBilling = r; });
  const ctx = vm.createContext({ console, setTimeout, clearTimeout,
    localStorage: {getItem:()=>null},
    emuMyIdentity: async()=>({uid:'owner',wallet:'0xowner',ches:'0xowner'}),
    emuEnsureEntitlement: ()=>billing,
    _spShortAddr: a=>a, _spIsOwnerAddr: ()=>true,
    SpGuildStore: require('../../frontend/public/schoolpark/guild-store.js'),
    SpQuestStore: require('../../frontend/public/schoolpark/quest-store.js'),
    SP_CURRENCIES: ['JPY','JPYC','EMUER'],
    db: {},
    fbLib: {
      collection: (_, ...p)=>p.join('/'), doc: (_, ...p)=>p.join('/'),
      query: c=>c, orderBy:()=>null, limit:()=>null, where:()=>null,
      getDoc: async p=>({exists:()=>p==='ches_accounts/owner'||p==='sp_quests/'+founder.id,
        id:founder.id, data:()=>p==='ches_accounts/owner'?{displayName:'Founder'}:founder}),
      getDocs: async p=>({forEach: f=>{if(p==='sp_quests')f({id:founder.id,data:()=>founder});}})
    }
  });
  ctx.window = ctx;
  vm.runInContext('let _spPassportBusy = null;\n'+passport+'\n'+html.slice(start,end), ctx);
  return {ctx, resolveBilling};
}

test('billing response pending: Founder Quest and five guilds still load', async()=>{
  const {ctx,resolveBilling}=setup();
  const app={state:{},setState(s){Object.assign(this.state,s);}};
  try {
    const result=await Promise.race([
      Promise.all([ctx.spDaoLoadQuests(app),ctx.spDaoLoadVotes(app)]).then(()=>true),
      new Promise(r=>setTimeout(()=>r(false),100))
    ]);
    assert.equal(result,true,'Public lists are blocked on billing');
    assert.equal(app.state.guilds.length,5);
    assert.equal(app.state.quests.length,1);
    assert.equal(app.state.quests[0].isFounder,true);
    assert.equal(app.state.quests[0].founderSections[0].body,'全文');
  } finally { resolveBilling(); }
});
