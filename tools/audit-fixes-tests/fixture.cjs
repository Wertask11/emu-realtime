'use strict';
// Reuse real local Auth/Firestore, production handlers and the existing regression scenario.
const {start}=require('../unified-navigation-tests/fixture.cjs');
async function main(){
 const f=await start({port:4221});
 for(const role of ['alice','bob']){
  try{await f.db.collection('dialogue_sessions').doc('audit-'+role+'-booking').create({
   uid:'lab-'+role,venue:'zoom',meetingUrl:'https://zoom.example.invalid/'+role,
   outcome:'scheduled',scheduledAt:new Date('2026-12-01T12:00:00Z'),createdAt:new Date()
  });}catch(e){if(e.code!==6&&e.code!=='already-exists')throw e;}
 }
 console.log('LOCAL AUDIT FIXES ready '+f.base);
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
