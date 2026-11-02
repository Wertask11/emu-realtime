'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const express=require('express');const {ichinichiRetired}=require('./retired-features');
test('retired one-day endpoints cannot read, write or delete historical data',async()=>{
 const app=express();app.use('/api/ichinichi',ichinichiRetired);let downstream=false;app.use((_req,res)=>{downstream=true;res.sendStatus(500)});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const [method,path] of [['GET','history'],['GET','day'],['POST','save'],['POST','share'],['POST','delete-day']]){const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/ichinichi/'+path,{method});assert.equal(r.status,410);const data=await r.json();assert.equal(data.dataRetained,true);assert.equal(data.error,'FEATURE_RETIRED');}assert.equal(downstream,false);}finally{await new Promise(r=>server.close(r));}
});
