"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./fixture');
const {SERVICE}=require('./config');
test('renamed request accepts its exact legacy product label without migrating IDs, prices or terms',async()=>{
 const f=fixture();await f.seed();const a=await f.actor();
 const product=f.economy.service.ref('products','agent_schoolpark-explorer-v1');
 await product.set({name:'SchoolPark Explorer'},{merge:true});
 assert.equal((await f.economy.service.status()).service.enabled,true);
 const q=await f.economy.service.quote(a,{goal:'コーヒーを学びたい'});
 assert.equal(q.price,5);assert.equal(SERVICE.name,'冷蔵庫くんに頼む');
 await product.set({name:'unrecognized service'},{merge:true});
 assert.equal((await f.economy.service.status()).service.enabled,false);
 await product.set({name:SERVICE.name,prices:{EMUER:4}},{merge:true});
 assert.equal((await f.economy.service.status()).service.enabled,false);
});
