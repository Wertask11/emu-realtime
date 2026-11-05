"""Real unmodified walt.id Wallet API2 1.2.1, local test config only.
No credential/token/private key/body is logged. Requires isolated fixture on 4246.
"""
import urllib.request,urllib.parse,urllib.error,json,pathlib,time
B='http://127.0.0.1:4246';W='http://127.0.0.1:7280';OUT=pathlib.Path('/workspace/outputs/passport-completion-20261105');OUT.mkdir(parents=True,exist_ok=True)
def call(base,path,body=None,token=None):
 h={'Content-Type':'application/json'}
 if token:h['Authorization']='Bearer '+token
 try:
  with urllib.request.urlopen(urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=h),timeout=60) as r:return json.load(r)
 except urllib.error.HTTPError as e:
  try:d=json.loads(e.read())
  except Exception:d={}
  raise RuntimeError(json.dumps({'status':e.code,'exception':d.get('id'),'error':d.get('error'),'stage':d.get('failure',{}).get('stage')})) from None
for _ in range(30):
 try:
  if call(B,'/api/passport-v2/capabilities').get('enabled') and call(B,'/.well-known/openid-credential-issuer/api/passport-v2/sd'):break
 except Exception:pass
 time.sleep(.25)
result={'product':'walt.id Wallet API2','version':'1.2.1','image_digest':'sha256:7937cfe2450e5521e272615179baef66f805459df391f2321b2f20ad92468614','mode':'unmodified product binaries; loopback-only config; synthetic account; API-operated wallet consent','received':False,'request_resolved':False,'presentation_accepted':False}
try:
 wid=call(W,'/wallet',{})['walletId'];key=call(W,'/wallet/'+wid+'/keys/generate',{'backend':'jwk','keyType':'secp256r1'})['keyId']
 auth=call('http://127.0.0.1:9199','/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only',{'email':'bob@knowledge-lab.example.invalid','password':'Emulator-only-password-123','returnSecureToken':True})['idToken']
 o=call(B,'/api/passport-v2/offers',{'configurationId':'schoolpark_account_sd_v1'},auth)
 received=call(W,'/wallet/'+wid+'/credentials/receive',{'offerJson':o['credential_offer'],'keyId':key,'txCode':o['tx_code']});result['received']=len(received.get('credentialIds',[]))==1
 if not result['received']:raise RuntimeError('NO_CREDENTIAL_RECEIVED')
 cid=call(B,'/api/passport-v2/credentials',token=auth)['credentials'][-1]['id'];req=call(B,'/api/passport-v2/requests',{'credentialId':cid,'verifierId':'sandbox','selected':['accountAccess']},auth)
 params={k:json.dumps(v,separators=(',',':')) if isinstance(v,(dict,list)) else v for k,v in req['authorizationRequest'].items()};uri='openid4vp://?'+urllib.parse.urlencode(params)
 call(W,'/wallet/'+wid+'/credentials/present/resolve-request',{'requestUrl':uri});result['request_resolved']=True
 call(B,'/api/passport-v2/consent',{'requestId':req['id'],'approved':True},auth)
 presented=call(W,'/wallet/'+wid+'/credentials/present',{'requestUrl':uri,'keyId':key});result['wallet_response_fields']=list(presented)
 history=call(B,'/api/passport-v2/credentials',token=auth)['history'];result['presentation_accepted']=any(x.get('type')=='presented' and x.get('requestId')==req['id'] for x in history)
 try:
  replay=call(W,'/wallet/'+wid+'/credentials/present',{'requestUrl':uri,'keyId':key});result['replay_rejected']=replay.get('transmission_success') is False
 except RuntimeError:result['replay_rejected']=True
 pending=call(B,'/api/passport-v2/requests',{'credentialId':cid,'verifierId':'sandbox','selected':['accountAccess']},auth)
 call(B,'/api/passport-v2/consent',{'requestId':pending['id'],'approved':True},auth)
 params2={k:json.dumps(v,separators=(',',':')) if isinstance(v,(dict,list)) else v for k,v in pending['authorizationRequest'].items()};uri2='openid4vp://?'+urllib.parse.urlencode(params2)
 call(B,'/api/passport-v2/revoke',{'credentialId':cid},auth)
 try:
  rejected=call(W,'/wallet/'+wid+'/credentials/present',{'requestUrl':uri2,'keyId':key});result['revoked_rejected']=rejected.get('transmission_success') is False
 except RuntimeError:result['revoked_rejected']=True

except Exception as e:result['failure']=str(e)
(OUT/'external-wallet-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
if not all(result[x] for x in ['received','request_resolved','presentation_accepted','replay_rejected','revoked_rejected']):raise SystemExit(1)
