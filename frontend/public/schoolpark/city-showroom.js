import {openShopWorld} from './city-shop.js';
let viewer;
function open(){
 if(viewer)return;
 viewer=openShopWorld({preview:true,spots:[],bridge:{async getShops(){
   const res=await fetch('./city-showroom-catalog.json',{cache:'no-cache'});
   if(!res.ok)throw Error('CATALOG_UNAVAILABLE');
   const data=await res.json();
   for(const shop of data.shops){shop.status='demo';for(const product of shop.products){product.checkoutEnabled=false;product.paymentMethods=[];}}
   return data;
 }},onClose:()=>{viewer=null;document.getElementById('preview-open').focus();}});
}
document.getElementById('preview-open').addEventListener('click',open);
open();
