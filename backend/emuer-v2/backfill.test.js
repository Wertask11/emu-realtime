'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {evaluatePost,summarize}=require('./backfill');
const A='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',B='0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',C='0xcccccccccccccccccccccccccccccccccccccccc';
test('past Good and received Change each become one EMUER',()=>{const r=evaluatePost('p1',{address:A,goodCount:2,goodUsers:[B,C],changeCount:1,changeUsers:[B]});assert.equal(r.status,'ready');assert.equal(r.rewardEmuer,3)});
test('duplicate actor entries do not manufacture historical rewards',()=>{const r=evaluatePost('p',{address:A,goodCount:2,goodUsers:[B,B],changeCount:0,changeUsers:[]});assert.equal(r.status,'review');assert.equal(r.rewardEmuer,0)});
test('self reactions are excluded and mismatch goes to review',()=>{const r=evaluatePost('p',{address:A,goodCount:1,goodUsers:[A],changeCount:0,changeUsers:[]});assert.deepEqual(r.reasons,['good-count-actors-mismatch'])});
test('invalid author or fractional counters require review',()=>{assert.equal(evaluatePost('p',{address:'bad',goodCount:1.5,goodUsers:[],changeCount:0,changeUsers:[]}).status,'review')});
test('summary pays only verified posts',()=>{const rows=[evaluatePost('a',{address:A,goodCount:1,goodUsers:[B],changeCount:0,changeUsers:[]}),evaluatePost('b',{address:A,goodCount:2,goodUsers:[B],changeCount:0,changeUsers:[]})];assert.deepEqual(summarize(rows),{posts:2,ready:1,review:1,rewardEmuer:1})});
