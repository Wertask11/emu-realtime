'use strict';
function ageOfJst(birth, now=new Date()) {
  if(typeof birth!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(birth))return null;
  const parsed=new Date(birth+'T00:00:00Z');
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==birth)return null;
  const p=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));
  const today=p.year+'-'+p.month+'-'+p.day;
  if(birth>today)return null;
  return Number(p.year)-Number(birth.slice(0,4))-(today.slice(5)<birth.slice(5)?1:0);
}
module.exports={ageOfJst};
