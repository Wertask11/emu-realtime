"""Interaction regression in the isolated native fixture; no production calls or payments."""
from playwright.sync_api import sync_playwright
import re
import json,pathlib,urllib.parse,urllib.request,os
BASE=os.environ.get('UNIFIED_BASE','http://127.0.0.1:4220');OUT=pathlib.Path(os.environ.get('UNIFIED_OUTPUT','/workspace/outputs/unified-emu-20261102'))
assert urllib.parse.urlparse(BASE).hostname in ['127.0.0.1','localhost'], 'Local emulator only'
with urllib.request.urlopen(urllib.request.Request(BASE+'/test/unified-scenario',method='POST')) as r: scenario=json.load(r)
Q=scenario['questId'];W=scenario['wisdomId'];TQ=scenario['tryQuestId']
TRY_ROWS='''(async(id)=>{const p=await spPassportLoad();const fb=fbLib;
 const took=(await fb.getDoc(fb.doc(db,"sp_quests",id,"commits",p.addr))).exists();
 const logs=[];(await fb.getDocs(fb.collection(db,"sp_quests",id,"logs"))).forEach(d=>logs.push(d.data()));
 const w=[];(await fb.getDocs(fb.collection(db,"sp_wisdom"))).forEach(d=>{const x=d.data();if(x.questId===id)w.push(x)});
 return {took,logs:logs.map(l=>({kind:l.kind,body:l.body,from:l.fromPostId,author:l.author===p.addr})),wisdom:w.map(x=>({insight:x.insight,from:x.fromPostId,knowledge:x.knowledge,experiment:x.experiment}))}})'''
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
  g.locator('#esnCity').click();f=g.frame_locator('#spDaoFrame');f.locator('.city-hero [data-action="walk"]:not([disabled])').wait_for()
  # 11/21: the games live in the 3D City (top bar "遊ぶ"), not as cards on the City top page.
  assert f.locator('.city-play-card').count()==0
  f.locator('.city-hero [data-action="walk"]').click();f.locator('#city-explorer [data-shop="menu"]').click();f.locator('#city-explorer [data-shop="plays"]').click();f.locator('#city-explorer [data-shop="play"]').nth(3).wait_for()
  g.evaluate("localStorage.setItem('sp_elev_badges',JSON.stringify(['1F']));localStorage.setItem('sp_elev_secret_unlocked','1')")
  # Every card opens its original implementation through the unchanged plan gate.
  for kind,frameid,path in [('echo','room2Frame','/Emu_room2/echo-field.html'),('ringo','ringoFrame','/ringo-game.html'),('gods','spRoomFrame','/daily-gods/index.html'),('elevator','spRoomFrame','/schoolpark/south-elevator.html')]:
   f.locator('#city-explorer [data-shop="play"][data-value="'+kind+'"]').click()
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
  f.locator('#city-explorer [data-shop="close"]').click();f.locator('#city-explorer').wait_for(state='detached')
  RESULTS.append({'games':'all four original URLs opened via the 3D City','elevator_storage':'existing badge/secret keys retained'})
  # Same tour storage: no reset of completed guides when moving between the new routes.
  saved=json.loads(g.evaluate("localStorage.getItem('rk-tour-v1')"));assert saved.get('emu-feed')=='done'
  g.locator('#emuHeaderProfile').click();g.locator('#emuAccountMenu').wait_for(state='visible')
  assert g.locator('#emuAccountMenu').get_by_role('menuitem',name='設定',exact=True).is_visible()
  g.locator('#emuAccountMenu').get_by_role('menuitem',name='SchoolParkパスポート',exact=True).click();g.locator('#spPassport').wait_for(state='visible');g.locator('#sppNext').wait_for(state='visible');g.evaluate('closeSpPassport()')
  g.locator('#emuHeaderReizo').click();g.wait_for_timeout(150);g.screenshot(path=str(OUT/'INTERACTION-reizo.png'))
  # Close the existing guide chooser/chat through its established API; do not change progress.
  g.evaluate('window.ReizoTour?.close?.();window.spReizoClose?.()');g.locator('#esnRequests').click()
  g.locator('#emuRequestsPage [data-tour="emu-lab-entry"] button').click();lab=g.frame_locator('#spRoomFrame');lab.locator('html[data-lab-ready="true"]').wait_for(timeout=30000)
  # 11/18：知識図書館（#library・検索）は画面から外した。いまの Knowledge Lab は掛け合わせ（#mix）から始まる
  lab.locator('#mix[data-tour="lab-mix"]').wait_for(state='visible')
  assert not lab.locator('#library').is_visible()
  g.screenshot(path=str(OUT/'INTERACTION-lab.png'));g.evaluate('closeSpRoom()')
  g.locator('#emuRequestsPage .emu-text-entry').click();text=g.frame_locator('#spRoomFrame');text.locator('#headerTitle').wait_for(state='attached');text.get_by_text('マネーリテラシー',exact=True).first.click();assert '増やし方' in text.locator('#list').inner_text();g.evaluate('closeSpRoom()')
  RESULTS.append({'account':'shared profile/settings entry and real Passport open','reizo':'existing chooser opens','tutorial_progress':'done retained','lab_text':'both search cards open actual existing implementations'})
  # Existing join → reports → server-created wisdom. Writes stay inside the demo project.
  g.locator('#esnPractice').click();f.get_by_text('LOCAL 知識を試すクエスト',exact=False).first.wait_for()
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
  # 11/20 知識の投稿の「これを試す」→ やってみた記録（1枚）。受ける・3つの報告・知恵カードまでが1回で残る
  g.evaluate('closeSpWisdomCelebrate(false)');g.locator('#spWisdomCelebrate').wait_for(state='hidden')
  g.locator('#esnFeed').click();kf=g.frame_locator('#emuKnowledgeFrame')
  # 11/27 引用した投稿にも元の題名が出るので、題名（h3）で探す
  card=kf.locator('article.card',has=kf.locator('h3',has_text=re.compile(r'^LOCAL 導線検証の知識$'))).first;card.wait_for()
  card.locator('.try-btn').click();g.locator('#spTrySheet').wait_for(state='visible')
  assert 'LOCAL 導線検証の知識' in g.locator('#stPicked').inner_text(),g.locator('#stPicked').inner_text()
  assert 'やってみる' in g.locator('#stQuest').inner_text(),g.locator('#stQuest').inner_text()
  g.screenshot(path=str(OUT/'INTERACTION-try-open.png'))
  g.locator('#stDid').fill('LOCAL 試した。投稿の方法を1回だけやってみた。現実の活動ではありません。')
  g.locator('#stFound').fill('LOCAL 先に決めておくと迷わない。やる前より短い時間で終わった。')
  assert g.locator('#stInsight').input_value()=='LOCAL 先に決めておくと迷わない。',g.locator('#stInsight').input_value()
  assert g.locator('#stExperiment').input_value()=='LOCAL 試した。',g.locator('#stExperiment').input_value()
  g.locator('#stInsight').fill('LOCAL 1枚の記録から知恵カードまで残せた。')
  with g.expect_response(lambda r:'/quest-completions/'+TQ+'/wisdom' in r.url) as tried:g.locator('#stSubmit').click()
  assert tried.value.status==200,tried.value.text()
  g.wait_for_function('!document.body.classList.contains("sp-try-open")');g.locator('#spWisdomCelebrate').wait_for(state='visible')
  assert 'LOCAL 1枚の記録から知恵カードまで残せた。' in g.locator('#spWisdomCelebrateQuote').inner_text()
  rows=g.evaluate(TRY_ROWS,TQ)
  assert rows['took'],rows
  assert sorted(l['kind'] for l in rows['logs'])==sorted(['やってみた','つまずいた','気づいた']),rows
  assert all(l['from']=='unified-source' and l['author'] for l in rows['logs']),rows
  assert [l['body'] for l in rows['logs'] if l['kind']=='つまずいた']==['（特になし）'],rows
  assert rows['wisdom']==[{'insight':'LOCAL 1枚の記録から知恵カードまで残せた。','from':'unified-source','knowledge':'LOCAL 導線検証の知識','experiment':'LOCAL 試した。'}],rows
  g.screenshot(path=str(OUT/'INTERACTION-try-done.png'))
  RESULTS.append({'try':'post → これを試す → one sheet: joined #001, 3 reports (empty stuck saved as 特になし) and a wisdom card saved in one submit'})
  assert not errors,errors
  print(json.dumps(RESULTS,ensure_ascii=False,indent=2),flush=True)
 except Exception:
  g.screenshot(path=str(OUT/'INTERACTION-FAIL.png'));print('DIAGNOSTIC',errors,dialogs,flush=True);raise
 finally:
  (OUT/'interaction-results.json').write_text(json.dumps({'results':RESULTS,'page_errors':errors,'dialogs':dialogs,'production_writes':False},ensure_ascii=False,indent=2));b.close()
