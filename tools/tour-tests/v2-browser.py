"""Actual native UI, synthetic data. All external requests intercepted locally."""
import json,pathlib,re,sys
from playwright.sync_api import sync_playwright,expect
origin='http://127.0.0.1:4180';out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/reizo-v2-evidence');out.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for width,height in [(1280,900),(768,1024),(412,915),(390,844),(375,667)]:
  c=b.new_context(viewport={'width':width,'height':height},reduced_motion='reduce');writes=[]
  def network(r):
   if r.request.url.startswith(origin+'/'):return r.continue_()
   if '/api/' in r.request.url:
    if r.request.method not in ['GET','HEAD']:writes.append(r.request.url)
    return r.fulfill(status=200,content_type='application/json',body=json.dumps({'day':None,'posts':[],'history':[],'stars':[],'stats':{'streak':0,'learningCount':0,'usefulCount':0,'completionRate':0},'ok':True}))
   r.abort()
  c.route('**/*',network);g=c.new_page();g.set_default_timeout(8000);errors=[];g.on('pageerror',lambda e:errors.append(str(e)));g.goto(origin+'/__tour-fixture.html?brand=schoolpark');expect(g.locator('#rk-tour-title')).to_have_text('THIS WEEK')
  panel=g.locator('.rk-panel')
  def expand():
   if 'rk-collapsed' in (panel.get_attribute('class') or ''):panel.locator('.rk-fold').click()
  def geometry():
   g.wait_for_timeout(120);expect(panel).to_be_visible();g.wait_for_timeout(80);rect=panel.bounding_box();assert rect and rect['x']>=-1 and rect['y']>=-1 and rect['x']+rect['width']<=width+1 and rect['y']+rect['height']<=height+1,(width,g.locator('#rk-tour-title').inner_text(),rect)
   for x in panel.locator('button:visible').all():assert x.bounding_box()['height']>=43.9
   spot=g.locator('.rk-spotlight');assert spot.is_visible(),(width,g.locator('#rk-tour-title').inner_text())
   assert spot.evaluate('(e)=>getComputedStyle(e).pointerEvents')=='none'
   sr=spot.bounding_box();overlap=min(rect['x']+rect['width'],sr['x']+sr['width']-6)>max(rect['x'],sr['x']+6)+1 and min(rect['y']+rect['height'],sr['y']+sr['height']-6)>max(rect['y'],sr['y']+6)+1
   assert not overlap,(width,g.locator('#rk-tour-title').inner_text(),rect,sr)
  def prog(id):return g.evaluate('(id)=>ReizoTour.progress(id)',id)
  def finish(id):
   seen=[]
   for _ in range(prog(id)['total']+1):
    if prog(id)['state']=='done':break
    expect(panel).to_be_visible();geometry();seen.append(g.locator('#rk-tour-title').inner_text());(panel.locator('.rk-mini-next') if 'rk-collapsed' in (panel.get_attribute('class') or '') else panel.locator('.rk-primary')).click()
   assert prog(id)['state']=='done',(id,prog(id));return seen
  geometry();g.screenshot(path=str(out/f'{width}-home.png'))
  panel.locator('.rk-primary').click();expand();panel.get_by_role('button',name='戻る',exact=True).click();assert prog('sp-home')['index']==0
  expand();panel.get_by_role('button',name='あとで続きを見る',exact=True).click();g.reload();g.wait_for_timeout(400);assert not panel.is_visible()
  assert g.evaluate("ReizoTour.resume('sp-home')");finish('sp-home');g.reload();g.wait_for_timeout(400);assert not panel.is_visible()
  # All eighteen guides, including preserved manual-only auxiliary screens.
  guides=g.evaluate('ReizoTour.list()');assert len(guides)==18
  steps=0
  for d in guides:
   if d['id']=='sp-passport':continue
   assert g.evaluate('(id)=>ReizoTour.restart(id)',d['id']),d['id']
   seen=finish(d['id']);steps+=len(seen)
  assert g.evaluate("ReizoTour.restart('sp-passport')");expect(g.locator('#sppPage1')).to_be_visible();seen=finish('sp-passport');steps+=len(seen);g.screenshot(path=str(out/f'{width}-passport.png'));g.evaluate('closeSpPassport()')
  # Actual clicks use native handlers once and preserve the next index across route changes.
  assert g.evaluate("ReizoTour.restart('sp-home')");expect(g.locator('#rk-tour-title')).to_have_text('THIS WEEK');expect(panel).to_be_visible();g.evaluate("ReizoTour.next();ReizoTour.next()");expect(g.locator('#rk-tour-title')).to_have_text('今週生まれた知恵');expand();g.frame_locator('#spDaoFrame').locator('[data-tour~=home-wisdom]').click();g.wait_for_timeout(150);assert prog('sp-home')['index']==3,prog('sp-home');assert g.evaluate("document.getElementById('spDaoFrame').contentWindow.app.state.screen")=='library'
  assert g.evaluate("ReizoTour.restart('sp-passport')");expect(g.locator('#rk-tour-title')).to_have_text('SchoolPark ID');expect(panel).to_be_visible();g.evaluate('ReizoTour.next();ReizoTour.next()');expand();g.locator('#sppNext').click();expect(g.locator('#rk-tour-title')).to_have_text('星空を見る');assert prog('sp-passport')['index']==3;g.evaluate('ReizoTour.later();closeSpPassport()')
  assert g.evaluate("ReizoTour.restart('emu-feed')");g.wait_for_function("ReizoTour.progress('emu-feed').state==='in_progress'");g.evaluate("for(let i=0;i<6;i++)ReizoTour.next()");expand();(g.locator('#emuAccountMenu [data-tour~=emu-library]') if width<=700 else g.frame_locator('#emuKnowledgeFrame').locator('[data-command=library]').first).click();expect(g.locator('#rk-tour-title')).to_have_text('自分の投稿');geometry();g.screenshot(path=str(out/f'{width}-library.png'));expand();panel.locator('.rk-primary').click();assert not g.frame_locator('#emuKnowledgeFrame').locator('#panel').evaluate('(e)=>e.classList.contains("open")');g.evaluate('ReizoTour.later()')
  assert g.evaluate("ReizoTour.restart('emu-requests')");g.evaluate('ReizoTour.next();ReizoTour.next()');expand();g.locator('[data-tour~=emu-req-btn]').click();expect(g.locator('#rk-tour-title')).to_have_text('募集の書き方');g.locator('#emuRequestQuestion').fill('PRIVATE DRAFT');g.locator('#emuRequestSheet .emu-sheet-actions').get_by_role('button',name='やめる',exact=True).click();expect(g.locator('#rk-tour-title')).to_have_text('Room1の入口');assert g.locator('#emuRequestQuestion').input_value()=='PRIVATE DRAFT';assert 'PRIVATE' not in g.evaluate("localStorage.getItem('rk-tour-v1')");g.evaluate('ReizoTour.later()')
  # Skip and contact catalog retain existing functionality and only synthetic contact send.
  assert g.evaluate("ReizoTour.restart('sp-guilds')");expand();panel.get_by_role('button',name='今回はスキップ',exact=True).click();assert prog('sp-guilds')['state']=='skipped'
  g.evaluate("toggleContactPanel();switchContactTab('tutorial')");assert g.locator('.rk-guide-row').count()>=18;g.locator('[data-rk-source=catalog-videos]').click();assert g.locator('.rk-video-row').count()==4;g.evaluate("switchContactTab('contact')");g.locator('.w-cat-btn[data-type=general]').click();g.locator('#w-next').click();g.locator('#wf-name').fill('LOCAL DUMMY');g.locator('#wf-email').fill('invalid');g.locator('#wf-message').fill('LOCAL DUMMY CONTACT');g.locator('#w-next').click();assert g.locator('#ws-2').get_attribute('class')=='w-step active';g.locator('#wf-email').fill('dummy@example.invalid');g.evaluate("switchContactTab('tutorial');switchContactTab('contact')");assert g.locator('#wf-message').input_value()=='LOCAL DUMMY CONTACT';g.locator('#w-next').click();g.locator('#w-next').click();expect(g.locator('#w-success')).to_have_class('show');g.evaluate('toggleContactPanel()');assert len(writes)==1 and writes[0].endswith('/api/contact');writes.clear()
  # Existing fridge choice and original chat still work.
  g.evaluate("document.getElementById('spDaoFrame').contentWindow.app.go('home')()");g.frame_locator('#spDaoFrame').locator('[data-tour~=fridge]').press('Enter');panel.get_by_role('button',name='冷蔵庫くんに聞く',exact=True).click();expect(g.locator('#spReizoPanel')).to_have_class(re.compile('open'));assert g.evaluate('fixtureChatOpens')==1;g.evaluate('spReizoClose()')
  assert not errors,errors;assert not writes,writes
  raw=json.loads(g.evaluate("localStorage.getItem('rk-tour-v1')"));assert 'version' not in raw and 'tours' not in raw and all(type(v)==int or v in ['done','skipped'] for v in raw.values())
  results.append({'width':width,'height':height,'guides':18,'steps':steps,'result':'PASS','appWrites':0});print(results[-1],flush=True);c.close()
 b.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
