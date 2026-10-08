"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {publicCatalog,checkoutFor,attachShopRoutes,DEFAULT_CATALOG}=require('./city-shops');
const express=require('express'),http=require('node:http');
function live(){const c=structuredClone(DEFAULT_CATALOG),s=c.shops[0];s.status='live';s.merchant={name:'Fixture merchant',fulfillment:'店舗受取',refundPolicy:'受取前はキャンセル可',contact:'店舗窓口'};s.checkoutHosts=['buy.stripe.com'];s.products[0].checkout={enabled:true,url:'https://buy.stripe.com/test_fixture',methods:['JPY']};return c;}
async function using(catalog,fn){
 const app=express();app.use(express.json());const router=express.Router();
 const limits=[];attachShopRoutes(router,{catalog,limited:(key,max)=>{limits.push({key,max});return(_q,_s,n)=>n();}});app.use(router);
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const call=async(body,query='')=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/shops/checkout'+query,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:r.status,data:await r.json().catch(()=>null)};};
 try{await fn(call,limits);}finally{await new Promise(r=>server.close(r));}
}
test('3D shops: initial catalogue is honest demo inventory with two partner slots, no enabled purchase',()=>{
 const c=publicCatalog();assert.equal(c.partnerSlots.length,2);assert.equal(c.shops[0].products.length,4);
 for(const s of c.shops){assert.equal(s.status,'demo');for(const p of s.products){assert.equal(p.checkoutEnabled,false);assert.deepEqual(p.paymentMethods,[]);assert.equal('checkout' in p,false);}}
});
test('3D shops: checkout requires published store, terms, enabled product and explicit host',()=>{
 const s=live().shops[0],p=s.products[0];assert.ok(checkoutFor(s,p));
 for(const key of ['name','fulfillment','refundPolicy','contact']){const modified=structuredClone(s);delete modified.merchant[key];assert.equal(checkoutFor(modified,p),null,key);}
 assert.equal(checkoutFor({...s,status:'demo'},p),null);assert.equal(checkoutFor({...s,checkoutHosts:[]},p),null);
 assert.equal(checkoutFor(s,{...p,checkout:{...p.checkout,enabled:false}}),null);
});
test('3D shops: no script/http/credential/unknown-host URLs or unsupported payment methods',()=>{
 const s=live().shops[0],p=s.products[0];
 for(const url of ['javascript:alert(1)','http://buy.stripe.com/test','https://buy.stripe.com.evil.test/pay','https://user:pass@buy.stripe.com/test','https://buy.stripe.com:444/pay','https://127.0.0.1/pay'])assert.equal(checkoutFor(s,{...p,checkout:{...p.checkout,url}}),null,url);
 assert.equal(checkoutFor(s,{...p,checkout:{...p.checkout,methods:['UNKNOWN']}}),null);
 assert.equal(checkoutFor(s,{...p,checkout:{...p.checkout,methods:['EMUER']}}),null,'real partner must not accept EMUER');
});
test('3D shops: demo checkout rejects without creating any order or pretending payment success',()=>using(DEFAULT_CATALOG,async call=>{
 const r=await call({shopId:'field-store',productId:'field-note'});assert.equal(r.status,409);assert.equal(r.data.error,'SHOP_CHECKOUT_NOT_READY');
}));
test('3D shops: shopper cannot supply price, merchant, URL, wallet or approval',()=>using(live(),async call=>{
 const b={shopId:'field-store',productId:'field-note'};
 for(const extra of [{priceJPY:1},{url:'https://evil.test'},{merchant:'attacker'},{wallet:'attacker'},{approved:true},{quantity:999},{passportId:'other'}])assert.equal((await call({...b,...extra})).status,400);
 for(const body of [null,[],{},'text',{...b,shopId:['field-store']},{...b,productId:'../../secret'}])assert.equal((await call(body)).status,400);
 assert.equal((await call(b,'?isOwner=true')).status,400);
}));
test('3D shops: reviewed external handoff returns terms and is never a paid order',()=>using(live(),async(call,limits)=>{
 const r=await call({shopId:'field-store',productId:'field-note'});assert.equal(r.status,200);assert.equal(r.data.status,'external_checkout');assert.equal(r.data.url,'https://buy.stripe.com/test_fixture');
 assert.equal(r.data.merchant.name,'Fixture merchant');assert.equal(r.data.paid,undefined);assert.equal(r.data.passportId,undefined);
 assert.deepEqual(limits,[{key:'schoolpark-city-checkout',max:5}]);
 assert.equal((await call({shopId:'field-store',productId:'missing'})).status,404);
}));
test('3D shops: public data excludes merchant destinations and arbitrary private fields',()=>{
 const c=live();c.shops[0].secret='never';c.shops[0].products[0].privateNotes='never';c.shops[0].products[0].priceJPY=-4;
 const s=publicCatalog(c).shops[0];assert.equal(s.secret,undefined);assert.equal(s.merchant,undefined);assert.equal(s.checkoutHosts,undefined);
 const p=s.products[0];assert.equal(p.privateNotes,undefined);assert.equal(p.checkout,undefined);assert.equal(p.priceJPY,null);assert.equal(p.checkoutEnabled,true);
});
