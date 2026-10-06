const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const policy=require('../frontend/public/camellia-return-policy.js');
const html=fs.readFileSync(require.resolve('../frontend/public/camellia-connect.html'),'utf8');
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import\{[^;]+;/g,'');
async function run({user=null,destination='https://camellia-beta-git-feat-camellia-v1-release-audit-school-park.vercel.app/',switchAccount=false}={}) {
  const elements=Object.fromEntries(['status','retry','login'].map(id=>[id,{hidden:true,textContent:''}]));
  const auth={currentUser:user};let pending,calls=0,redirect;
  const context={URL,URLSearchParams,window:{CamelliaReturnPolicy:policy},document:{querySelector:id=>elements[id.slice(1)]},location:{search:'?return='+encodeURIComponent(destination),reload(){},replace:value=>{redirect=value;}},initializeApp:()=>({}),getAuth:()=>auth,onAuthStateChanged:(_,fn)=>{pending=fn(user);},fetch:async()=>{calls++;if(switchAccount)auth.currentUser={uid:'different'};return{ok:true,json:async()=>({ticket:'synthetic-one-time-ticket'})};}};
  vm.runInNewContext(script,context);await pending;return{elements,calls,redirect};
}
test('Passport handoff guides signed-out users and does not request tickets for anonymous/invalid destinations',async()=>{
  for(const user of [null,{uid:'anonymous',isAnonymous:true}]){
    const result=await run({user});assert.equal(result.calls,0);assert.equal(result.redirect,undefined);assert.equal(result.elements.login.hidden,false);assert.match(result.elements.status.textContent,/ログイン/);
  }
  const user={uid:'canonical',isAnonymous:false,getIdToken:async()=> 'synthetic-auth'};
  const invalid=await run({user,destination:'https://evil.example/'});assert.equal(invalid.calls,0);assert.equal(invalid.redirect,undefined);assert.match(invalid.elements.status.textContent,/戻り先/);
  const changed=await run({user,switchAccount:true});assert.equal(changed.redirect,undefined);assert.match(changed.elements.status.textContent,/アカウントが変わりました/);
  const valid=await run({user});assert.equal(valid.calls,1);assert.equal(new URL(valid.redirect).origin,'https://camellia-beta-git-feat-camellia-v1-release-audit-school-park.vercel.app');assert.equal(new URL(valid.redirect).searchParams.get('camellia_passport_ticket'),'synthetic-one-time-ticket');
});
