const test=require('node:test'),assert=require('node:assert/strict');
const {ageOfJst}=require('./camellia-admin-summary');
test('Camellia age uses actual JST birthday and rejects fabricated dates',()=>{
 assert.equal(ageOfJst('2008-10-07',new Date('2026-10-06T14:59:59Z')),17);
 assert.equal(ageOfJst('2008-10-07',new Date('2026-10-06T15:00:00Z')),18);
 assert.equal(ageOfJst('1980-10-07',new Date('2026-10-06T14:59:59Z')),45);
 assert.equal(ageOfJst('1980-10-07',new Date('2026-10-06T15:00:00Z')),46);
 for(const invalid of ['2026-02-30','2100-01-01','bad','2000-2-1',''])assert.equal(ageOfJst(invalid,new Date('2026-10-06T00:00:00Z')),null);
});
