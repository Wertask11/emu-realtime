"""Native animated Passport pages and canceling an unfinished library read."""
import json
from playwright.sync_api import sync_playwright,expect
origin='http://127.0.0.1:4180'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,height in [(1280,900),(375,667)]:
  c=b.new_context(viewport={'width':width,'height':height},reduced_motion='no-preference');writes=[]
  def network(r):
   if r.request.url.startswith(origin+'/'):return r.continue_()
   if '/api/' in r.request.url:
    if r.request.method not in ['GET','HEAD']:writes.append(r.request.url)
    return r.fulfill(status=200,content_type='application/json',body='{"stars":[]}')
   r.abort()
  c.route('**/*',network);g=c.new_page();g.goto(origin+'/__tour-fixture.html?brand=schoolpark&holdLibrary=1');g.wait_for_function('Boolean(window.ReizoTour)')
  assert g.evaluate("ReizoTour.restart('sp-passport')");expect(g.locator('#rk-tour-title')).to_have_text('SchoolPark ID');expect(g.locator('.rk-panel')).to_be_visible();g.evaluate('ReizoTour.next();ReizoTour.next()');g.locator('#sppNext').click();expect(g.locator('#rk-tour-title')).to_have_text('星空を見る');expect(g.locator('.rk-panel')).to_be_visible()
  # Move faster than the remaining native 800 ms page-turn animation.
  g.evaluate('ReizoTour.next();ReizoTour.next();ReizoTour.next()');expect(g.locator('#sppPage3')).to_be_visible();expect(g.locator('#rk-tour-title')).to_have_text('価値プロフィール');expect(g.locator('.rk-panel')).to_be_visible();assert g.evaluate("ReizoTour.progress('sp-passport').index")==6;g.evaluate('ReizoTour.later();closeSpPassport()')
  assert g.evaluate("ReizoTour.restart('emu-feed')");expect(g.locator('.rk-panel')).to_be_visible();g.evaluate('for(let i=0;i<7;i++)ReizoTour.next()');expect(g.frame_locator('#emuKnowledgeFrame').locator('#panel')).to_have_class('overlay open');g.wait_for_timeout(2800);expect(g.locator('.rk-panel')).to_be_hidden();assert g.evaluate("ReizoTour.running().index")==7
  g.frame_locator('#emuKnowledgeFrame').locator('[data-panel-close]').click();expect(g.locator('#rk-tour-title')).to_have_text('タブ');expect(g.locator('.rk-panel')).to_be_visible();assert g.evaluate("ReizoTour.progress('emu-feed').index")==8;assert not g.frame_locator('#emuKnowledgeFrame').locator('#panel').evaluate('(e)=>e.classList.contains("open")');g.evaluate('ReizoTour.later()')
  # Viewing the composer through the guide must not clear an existing draft.
  g.evaluate('showEmuRequests()');expect(g.locator('[data-tour~=emu-req-btn]')).to_be_visible();g.locator('[data-tour~=emu-req-btn]').click();g.locator('#emuRequestQuestion').fill('PRIVATE EXISTING DRAFT');g.locator('#emuRequestSheet .emu-sheet-actions').get_by_role('button',name='やめる',exact=True).click()
  assert g.evaluate("ReizoTour.restart('emu-requests')");expect(g.locator('.rk-panel')).to_be_visible();g.evaluate('ReizoTour.next();ReizoTour.next();ReizoTour.next()');expect(g.locator('#emuRequestSheet')).to_have_class('emu-sheet open');assert g.locator('#emuRequestQuestion').input_value()=='PRIVATE EXISTING DRAFT';assert 'PRIVATE' not in g.evaluate("localStorage.getItem('rk-tour-v1')");assert not writes,writes
  print(width,'animated page turns, unfinished-library cancel, existing draft: PASS',flush=True);c.close()
 b.close()
