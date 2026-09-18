'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('./policy');
const t = Date.parse;
test('release activates at exactly 2026-10-01 JST',()=>{
 assert.equal(p.isActive(p.START_MS-1),false); assert.equal(p.isActive(p.START_MS),true);
});
test('JST day/month boundary and December rollover',()=>{
 assert.equal(p.dayKey(t('2026-09-30T14:59:59.999Z')),'2026-09-30');
 assert.equal(p.monthKey(p.START_MS),'2026-10');
 assert.equal(p.monthKey(t('2026-12-31T15:00:00Z')),'2027-01');
});
test('week resets Monday 00:00 JST including year boundary',()=>{
 assert.equal(p.weekKey(t('2026-10-04T14:59:59.999Z')),'2026-09-28');
 assert.equal(p.weekKey(t('2026-10-04T15:00:00Z')),'2026-10-05');
 assert.equal(p.weekKey(t('2027-01-01T00:00:00Z')),'2026-12-28');
});
test('leap day handled without fixed 30 day months',()=>{
 assert.equal(p.dayKey(t('2028-02-28T15:00:00Z')),'2028-02-29');
 assert.equal(p.monthKey(t('2028-02-29T15:00:00Z')),'2028-03');
});
test('plan limits are independent for conversion and exchange',()=>{
 const convert=p.period('plus','convert',p.START_MS), exchange=p.period('plus','exchange',p.START_MS);
 assert.equal(convert.limit,1); assert.equal(exchange.limit,1); assert.notEqual(convert.action,exchange.action);
 assert.equal(p.period('light','convert',p.START_MS).key,'2026-10');
 assert.equal(p.period('pro','convert',p.START_MS).limit,null);
 assert.throws(()=>p.period('guest','convert',p.START_MS));
 assert.throws(()=>p.period('plus','unknown',p.START_MS));
});
test('reward key is Passport-based, stable on retries and changes daily',()=>{
 const a=p.dailyRewardKey('passport-1','login',p.START_MS);
 assert.equal(a,p.dailyRewardKey('passport-1','login',p.START_MS+1000));
 assert.notEqual(a,p.dailyRewardKey('passport-1','login',p.START_MS+86400000));
 assert.notEqual(a,p.dailyRewardKey('passport-1','public-reflection',p.START_MS));
});
test('partial payout is bounded by actual monthly residual',()=>{
 assert.equal(p.claimable({remaining:300n*p.UNIT,allocated:300n*p.UNIT,availableTreasury:1000n*p.UNIT,paidThisMonth:p.MONTHLY_CAP-100n*p.UNIT}),100n*p.UNIT);
});
test('zero budget or treasury preserves unpaid amount for caller',()=>{
 assert.equal(p.claimable({remaining:10n,allocated:10n,availableTreasury:0n,paidThisMonth:0n}),0n);
 assert.equal(p.claimable({remaining:10n,allocated:10n,availableTreasury:10n,paidThisMonth:p.MONTHLY_CAP}),0n);
});
test('cannot spend beyond allocated or remaining amount',()=>{
 assert.equal(p.claimable({remaining:10n,allocated:3n,availableTreasury:100n,paidThisMonth:0n}),3n);
 assert.equal(p.claimable({remaining:2n,allocated:3n,availableTreasury:100n,paidThisMonth:0n}),2n);
});
test('reject imprecise numbers, negative amounts and invalid dates',()=>{
 assert.throws(()=>p.claimable({remaining:1,allocated:1n,availableTreasury:1n,paidThisMonth:0n}));
 assert.throws(()=>p.claimable({remaining:-1n,allocated:1n,availableTreasury:1n,paidThisMonth:0n}));
 assert.throws(()=>p.claimable({remaining:1n,allocated:1n,availableTreasury:1n,paidThisMonth:p.MONTHLY_CAP+1n}));
 assert.throws(()=>p.monthKey(NaN));
});
