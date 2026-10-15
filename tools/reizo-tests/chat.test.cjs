'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const express = require('../../backend/node_modules/express');
const { createReizoRouter, generate, contentsFor, redact, enabled, SYSTEM_PROMPT } = require('../../backend/reizo/chat');
const knowledge = require('../../backend/reizo/knowledge');
const faq = require('../../frontend/public/reizo/knowledge');
const env = { REIZO_GEMINI_ENABLED:'true', GEMINI_API_KEY:'TEST-NOT-A-REAL-KEY', GEMINI_FREE_TIER_CONFIRMED:'true' };
async function api(t, { generateReply = async () => 'ぼくと一緒に考えてみよう🧊', config = env } = {}) {
  const limiter = new Map();
  const router = createReizoRouter({ env:config, generateReply,
    requireFirebaseUser(req,res,next) { if(req.headers.authorization !== 'Bearer TEST') return res.sendStatus(401); req.identity = { uid:'PRIVATE_UID', walletAddress:'0x'+'a'.repeat(40), account:{ spid:'SP-PRIVATE-ID', name:'秘密の名前' } }; next(); },
    rateLimit: ({max}) => (req,res,next) => { const count=(limiter.get('user')||0)+1; limiter.set('user',count); return count>max ? res.sendStatus(429) : next(); }
  });
  // Exercise the real Express router without privileged listening sockets.
  return (body, token='TEST') => new Promise((resolve,reject) => {
    let status=200;
    const response={
      set(){return response;},
      status(value){status=value;return response;},
      sendStatus(value){status=value;return response.json({});},
      json(value){resolve({status,json:async()=>value,text:async()=>JSON.stringify(value)});return response;}
    };
    router.handle({method:'POST',url:'/chat',headers:{authorization:'Bearer '+token},body},response,error=>error?reject(error):reject(Error('UNHANDLED_ROUTE')));
  });
}
test('all existing FAQ data and exact matcher outputs are preserved', () => {
  const before=execFileSync('git',['show','63fd3ee:frontend/public/index.html'],{cwd:root,encoding:'utf8',maxBuffer:8e6});
  const slice=before.slice(before.indexOf('const SP_REIZO_KB = ['),before.indexOf('let _reizoAgentsStarted'));
  const ctx={}; vm.runInNewContext(slice+';this.kb=SP_REIZO_KB;this.answer=spReizoAnswer;',ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.kb)),faq.items);
  for(const item of faq.items) for(const keyword of item.k) assert.equal(faq.answer(keyword),ctx.answer(keyword));
  assert.match(faq.answer('Questって何？'),/クエスト/);
  assert.equal(faq.answer('月でラーメンを作りたい'), null);
});
test('guide grounding uses current pages, includes stars and ignores arbitrary client context',()=>{
  assert.match(knowledge.grounding('この画面では何ができる？','quest'), /クエスト/);
  assert.match(knowledge.grounding('何からやればいい？','home'), /ホーム/);
  assert.match(knowledge.grounding('星空を知りたい','passport'), /星空/);
  assert.equal(knowledge.pageContext('PRIVATE_SCREEN'), null);
  assert.ok(knowledge.grounding('hi','PRIVATE_SCREEN').length<9000);
  assert.match(SYSTEM_PROMPT,/根拠のない機能/);
  assert.match(SYSTEM_PROMPT,/操作する権限はなく/);
});
test('explicit feature flag and key are both required',()=>{
  assert.equal(enabled({GEMINI_API_KEY:'key'}),false);assert.equal(enabled({REIZO_GEMINI_ENABLED:'true'}),false);assert.equal(enabled(env),true);
  assert.equal(enabled({...env, GEMINI_FREE_TIER_CONFIRMED:undefined}), false);
  assert.equal(enabled({...env, GEMINI_CLIENT_ELIGIBILITY_CONFIRMED:undefined}), true);
});
test('private identifiers, wallet, contact and secrets are redacted with bounded history',()=>{
  const raw='秘密の名前 SP-PRIVATE-ID a@example.com 090-1234-5678 0x'+'a'.repeat(40)+' '+'a'.repeat(64)+' https://private.example/token';
  const text=redact(raw,['秘密の名前','SP-PRIVATE-ID']);
  for(const value of ['秘密の名前','SP-PRIVATE-ID','a@example.com','090-1234-5678','0x'+'a'.repeat(40),'a'.repeat(64),'https://private']) assert.ok(!text.includes(value));
  const turns=contentsFor({message:raw,history:Array.from({length:50},(_,i)=>({role:i%2?'assistant':'user',text:'x'.repeat(900)}))},[]);
  assert.equal(turns.length,7);assert.equal(turns[0].parts[0].text.length,500);
});
test('authenticated free conversation gets only safe page and conversation fields',async t=>{
  let captured;
  const post=await api(t,{generateReply:async args=>{captured=args;return '一緒に考えてみよう🧊';}});
  assert.equal((await post({message:'hi'},'bad')).status,401);
  const res=await post({message:'秘密の名前 PRIVATE_UID SP-PRIVATE-ID 今日は元気',currentPage:'quest',history:[],passport:{secret:'PRIVATE_RECORD'},context:'PRIVATE_RECORD'});
  assert.equal(res.status,200);assert.equal((await res.json()).provider,'gemini');
  const outbound=JSON.stringify({contents:captured.contents,prompt:captured.systemInstruction});
  for(const value of ['PRIVATE_UID','SP-PRIVATE-ID','秘密の名前','PRIVATE_RECORD'])assert.ok(!outbound.includes(value));
  assert.match(outbound,/クエスト/);
});
for(const [label,error,status] of [['quota',{status:429},429],['server',{status:503},502],['timeout',{name:'TimeoutError'},504],['network',new TypeError('PRIVATE_ERROR'),502],['empty',null,502]]) {
  test(`${label} failure is sanitized and opens no model retry loop`,async t=>{
    let calls=0;const post=await api(t,{generateReply:async()=>{calls++;if(error)throw error;return '';}});
    const res=await post({message:'hi'});assert.equal(res.status,status);assert.ok(!(await res.text()).includes('PRIVATE_ERROR'));
    assert.equal((await post({message:'again'})).status,429);assert.equal(calls,1);
  });
}
test('disabled and malformed requests never call Gemini',async t=>{
  let calls=0;const post=await api(t,{config:{},generateReply:async()=>{calls++;return 'bad';}});assert.equal((await post({message:'hi'})).status,503);assert.equal(calls,0);
  const normal=await api(t,{generateReply:async()=>{calls++;return 'bad';}});
  for(const body of [{message:''},{message:'x'.repeat(1001)},{message:'hi',extra:'x'.repeat(13000)}]) assert.equal((await normal(body)).status,400);
  assert.equal(calls,0);
});
test('per-user quota limits successful requests',async t=>{
  let calls=0;const post=await api(t,{generateReply:async()=>{calls++;return 'ぼくだよ';}});
  for(let i=0;i<10;i++)assert.equal((await post({message:'hi'})).status,200);
  assert.equal((await post({message:'hi'})).status,429);assert.equal(calls,10);
});
test('REST provider keeps key in header, no tools, short deadline, blocked/empty text is rejected',async()=>{
  let captured;
  const fetcher=async(url,options)=>{captured={url,...options};return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'INTERNAL'},{text:'ぼくだよ🧊'}]}}]}));};
  assert.equal(await generate({env,contents:[],systemInstruction:'prompt',fetcher}), 'ぼくだよ🧊');
  assert.ok(!captured.url.includes(env.GEMINI_API_KEY));assert.equal(captured.headers['x-goog-api-key'],env.GEMINI_API_KEY);assert.ok(captured.signal);
  const body=JSON.parse(captured.body);assert.equal(body.tools,undefined);assert.equal(body.generationConfig.maxOutputTokens,768);
  await assert.rejects(generate({env,contents:[],systemInstruction:'prompt',fetcher:async()=>new Response('{"candidates":[{"finishReason":"SAFETY"}]}')}));
});
