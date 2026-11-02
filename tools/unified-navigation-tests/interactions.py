"""Interaction regression in the isolated native fixture; no production calls or payments."""
from playwright.sync_api import sync_playwright
import json,pathlib,urllib.parse,urllib.request,os
BASE=os.environ.get('UNIFIED_BASE','http://127.0.0.1:4220');OUT=pathlib.Path(os.environ.get('UNIFIED_OUTPUT','/workspace/outputs/unified-emu-20261102'))
assert urllib.parse.urlparse(BASE).hostname in ['127.0.0.1','localhost'], 'Local emulator only'
with urllib.request.urlopen(urllib.request.Request(BASE+'/test/unified-scenario',method='POST')) as r: scenario=json.load(r)
Q=scenario['questId'];W=scenario['wisdomId']
RESULTS=[];errors=[];dialogs=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);c=b.new_context(viewport={'width':1280,'height':950})
 tours=['sp-guilds','sp-quests','sp-wisdom','sp-city','sp-passport','emu-feed','emu-requests','emu-practice','sp-guild','sp-quest-detail','sp-tasks','sp-year-goals']
 c.add_init_script("localStorage.setItem('emu.analytics.consent.v1','no');localStorage.setItem('rk-tour-v1',JSON.stringify("+json.dumps({k:'done' for k in tours})+"));")
 c.route('**/*',lambda r:r.continue_() if urllib.parse.urlparse(r.request.url).hostname in ['127.0.0.1','localhost'] else r.abort())
 g=c.new_page();g.set_default_timeout(20000);g.on('pageerror',lambda e:errors.append(str(e)))
 def dialog(d):dialogs.append(d.message);d.accept()
 g.on('dialog',dialog)
 try:
  g.goto(BASE+'/test/native.html');g.wait_for_function('typeof __localEmulatorLogin==="function"');g.locator('#localEmulatorLogin').click();g.evaluate('window.__localLoginResult');g.wait_for_function('_chesEntered===true');g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000)
  g.locator('#esnCity').click();f=g.frame_locator('#spDaoFrame');f.locator('.city-play-card').nth(3).wait_for()
  g.evaluate("localStorage.setItem('sp_elev_badges',JSON.stringify(['1F']));localStorage.setItem('sp_elev_secret_unlocked','1')")
  # Every card opens its original implementation through the unchanged plan gate.
  for kind,frameid,path in [('echo','room2Frame','/Emu_room2/echo-field.html'),('ringo','ringoFrame','/ringo-game.html'),('gods','spRoomFrame','/daily-gods/index.html'),('elevator','spRoomFrame','/schoolpark/south-elevator.html')]:
   f.locator('[data-action="'+('elevator' if kind=='elevator' else 'play')+'"][data-value="'+kind+'"]').click()
   g.locator('#'+frameid).wait_for(state='visible');g.wait_for_function('(args)=>{const f=document.getElementById(args.id);return f.contentDocument?.readyState==="complete"&&new URL(f.src).pathname===args.path}',arg={'id':frameid,'path':path})
   frame=g.frame_locator('#'+frameid);assert frame.locator('body').inner_text().strip(),kind
   if kind=='elevator':
    assert frame.locator('#btn-B1').is_visible();assert g.evaluate("localStorage.getItem('sp_elev_badges')")=='["1F"]'
    assert g.evaluate("localStorage.getItem('sp_elev_secret_unlocked')")=='1'
   g.screenshot(path=str(OUT/f'INTERACTION-{kind}.png'))
   if kind=='echo':g.locator('#room2CloseBtn').click()
   elif kind=='ringo':g.locator('#ringoOverlay [onclick="closeRingoGame()"]',).click()
   else:g.evaluate('closeSpRoom()')
   assert g.locator('#spDaoFrame').is_visible()
  RESULTS.append({'games':'all four original URLs opened via City','elevator_storage':'existing badge/secret keys retained'})
  # Same tour storage: no reset of completed guides when moving between the new routes.
  saved=json.loads(g.evaluate("localStorage.getItem('rk-tour-v1')"));assert saved.get('emu-feed')=='done'
  g.locator('#emuHeaderProfile').click();g.locator('#emuAccountMenu').wait_for(state='visible')
  assert g.locator('#emuAccountMenu').get_by_role('menuitem',name='設定',exact=True).is_visible()
  g.locator('#emuAccountMenu').get_by_role('menuitem',name='SchoolParkパスポート',exact=True).click();g.locator('#spPassport').wait_for(state='visible');g.locator('#sppNext').wait_for(state='visible');g.evaluate('closeSpPassport()')
  g.locator('#emuHeaderReizo').click();g.wait_for_timeout(150);g.screenshot(path=str(OUT/'INTERACTION-reizo.png'))
  # Close the existing guide chooser/chat through its established API; do not change progress.
  g.evaluate('window.ReizoTour?.close?.();window.spReizoClose?.()');g.locator('#esnRequests').click()
  g.locator('#emuRequestsPage [data-tour="emu-lab-entry"] button').click();lab=g.frame_locator('#spRoomFrame');lab.locator('html[data-lab-ready="true"]').wait_for(timeout=30000)
  lab.locator('#searchForm input[name="q"], #searchQ').first.wait_for() if lab.locator('#searchForm input[name="q"], #searchQ').count() else None
  assert lab.locator('#library').is_visible()
  g.screenshot(path=str(OUT/'INTERACTION-lab.png'));g.evaluate('closeSpRoom()')
  g.locator('#emuRequestsPage .emu-text-entry').click();text=g.frame_locator('#spRoomFrame');text.locator('#headerTitle').wait_for();text.get_by_text('マネーリテラシー',exact=True).first.click();assert '増やし方' in text.locator('#list').inner_text();g.evaluate('closeSpRoom()')
  RESULTS.append({'account':'shared profile/settings entry and real Passport open','reizo':'existing chooser opens','tutorial_progress':'done retained','lab_text':'both search cards open actual existing implementations'})
  # Existing join → reports → server-created wisdom. Writes stay inside the demo project.
  g.locator('#esnPractice').click();g.locator('#emuPracticePage').get_by_role('button',name='クエストの内容を見る →').click();f.get_by_text('LOCAL 知識を試すクエスト',exact=False).first.wait_for()
  joined=g.evaluate('(id)=>document.getElementById("spDaoFrame").contentWindow.app.state.quests.find(q=>q.id===id).iTook',Q)
  if not joined:g.evaluate('(id)=>spQuestToggle(id,document.getElementById("spDaoFrame").contentWindow.app)',Q)
  g.wait_for_function('(id)=>document.getElementById("spDaoFrame").contentWindow.app.state.quests.find(q=>q.id===id).iTook===true',arg=Q)
  for kind in ['やってみた','つまずいた','気づいた']:
   g.evaluate('([id,kind])=>spQuestLog(id,kind,document.getElementById("spDaoFrame").contentWindow.app)',[Q,kind])
   g.locator('#slBody').fill('LOCAL 導線検証。'+kind+' の記録です。現実の活動ではありません。');g.locator('#slSubmit').click();g.wait_for_function('!document.body.classList.contains("sp-log-open")')
  g.evaluate('(id)=>spQuestWisdom(id,document.getElementById("spDaoFrame").contentWindow.app)',Q);g.locator('#swInsight').wait_for(state='visible');g.locator('#swKnowledge').fill('LOCAL 元の知識');g.locator('#swExperiment').fill('LOCAL 隔離した環境で新導線を操作した');g.locator('#swInsight').fill('LOCAL 新導線から既存の報告と知恵カードを保存できた。')
  with g.expect_response(lambda r:'/quest-completions/'+Q+'/wisdom' in r.url) as saved:g.locator('#spWisdomSheet .spp-cta').click()
  assert saved.value.status==200,saved.value.text();g.locator('#esnWisdom').click();f.get_by_text('LOCAL 新導線から既存の報告と知恵カードを保存できた。',exact=True).first.wait_for();g.screenshot(path=str(OUT/'INTERACTION-saved-wisdom.png'))
  # Citation uses the previous owner's existing stored card, not the just-created own card.
  g.evaluate('(id)=>spWisdomCite(id,document.getElementById("spDaoFrame").contentWindow.app)',W)
  assert g.evaluate('(async(id)=>{const p=await spPassportLoad();return (await fbLib.getDoc(fbLib.doc(db,"sp_wisdom",id,"cites",p.addr))).exists()})',W)
  RESULTS.append({'quest':'joined, 3 real reports saved, wisdom endpoint returned 200, new card shown','citation':'original shared function persisted existing card citation','payments_rewards':'chain and approval intentionally disabled in fixture; covered separately by backend tests'})
  assert not errors,errors
  print(json.dumps(RESULTS,ensure_ascii=False,indent=2),flush=True)
 except Exception:
  g.screenshot(path=str(OUT/'INTERACTION-FAIL.png'));print('DIAGNOSTIC',errors,dialogs,flush=True);raise
 finally:
  (OUT/'interaction-results.json').write_text(json.dumps({'results':RESULTS,'page_errors':errors,'dialogs':dialogs,'production_writes':False},ensure_ascii=False,indent=2));b.close()
