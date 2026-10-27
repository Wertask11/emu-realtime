"""Real existing markup/handlers, LOCAL DUMMY auth/data and simulated Gemini transport."""
import json,pathlib
from playwright.sync_api import sync_playwright,expect
origin='http://127.0.0.1:4180'
out=pathlib.Path('/workspace/work/reizo-evidence');out.mkdir(exist_ok=True)
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for width,height in [(1440,960),(375,667)]:
  c=b.new_context(viewport={'width':width,'height':height},reduced_motion='reduce')
  calls=[];mode={'value':'ok'};errors=[];held=[]
  def route(r):
   if '/api/reizo/chat' in r.request.url:
    body=r.request.post_data_json;calls.append(body)
    if mode['value']=='hold':held.append(r);return
    if mode['value']=='fail':return r.fulfill(status=502,content_type='application/json',body='{"category":"provider_error"}')
    if mode['value']=='busy':return r.fulfill(status=429,content_type='application/json',body='{"category":"rate_limited"}')
    if mode['value']=='slow':return r.fulfill(status=504,content_type='application/json',body='{"category":"timeout"}')
    reply='<img src=x onerror=alert(1)> ぼくと一緒に考えてみよう🧊' if mode['value']=='html' else 'ぼくと一緒に考えてみよう🧊'
    return r.fulfill(status=200,content_type='application/json',body=json.dumps({'reply':reply,'provider':'gemini'},ensure_ascii=False))
   if r.request.url.startswith(origin+'/'):return r.continue_()
   return r.abort()
  c.route('**/*',route);g=c.new_page();g.on('pageerror',lambda e:errors.append(str(e)))
  g.goto(origin+'/__tour-fixture.html?brand=schoolpark');g.wait_for_function('Boolean(window.ReizoTour) && Boolean(document.getElementById("spDaoFrame").contentWindow.app)')
  g.evaluate("window.auth.currentUser.uid='LOCAL-USER';ReizoTour.later();spReizoOpen()")
  panel=g.locator('#spReizoPanel');expect(panel).to_be_visible()
  rect=panel.bounding_box();assert rect['x']>=-1 and rect['x']+rect['width']<=width+1 and rect['y']>=0 and rect['y']+rect['height']<=height+1,rect
  field=g.locator('#spReizoInput')
  def send(q):field.fill(q);g.locator('.sp-reizo-send').click()
  send('Questって何？');expect(g.locator('#spReizoMessages')).to_contain_text('クエストは「仕事」');assert not calls
  send('月でラーメンを作りたい');expect(g.locator('#spReizoMessages')).to_contain_text('ぼくと一緒に');assert len(calls)==1;assert calls[-1]['currentPage']=='home';assert calls[-1]['history']==[]
  send('この画面では何ができる？');g.wait_for_function('document.querySelectorAll(".sp-reizo-typing").length===0');assert len(calls)==2;assert len(calls[-1]['history'])==2
  g.evaluate("document.getElementById('spDaoFrame').contentWindow.app.go('experiments')()")
  send('何からやればいい？');g.wait_for_function('document.querySelectorAll(".sp-reizo-typing").length===0');assert calls[-1]['currentPage']=='quest'
  mode['value']='fail';send('月面で麺をゆでたい');expect(g.locator('#spReizoMessages')).to_contain_text('いまはAIの会話を使えない');expect(g.locator('.sp-reizo-contact-btn').last).to_be_visible()
  count=len(calls);send('Questって何？');expect(g.locator('#spReizoMessages .sp-reizo-msg-bot').last).to_contain_text('クエストは「仕事」');assert len(calls)==count
  # A slow or busy moment says "send again", not "AI is unavailable".
  mode['value']='slow';send('子どもたちに会いたい');expect(g.locator('#spReizoMessages .sp-reizo-msg-bot').last).to_contain_text('もう一度送ってみてね');expect(g.locator('#spReizoMessages .sp-reizo-msg-bot').last).not_to_contain_text('使えない')
  mode['value']='busy';send('月の石を拾いたい');expect(g.locator('#spReizoMessages .sp-reizo-msg-bot').last).to_contain_text('少し混んでいる')
  mode['value']='html';send('宇宙で何を食べる？');expect(g.locator('#spReizoMessages .sp-reizo-msg-bot').last).to_contain_text('<img');assert g.locator('#spReizoMessages .sp-reizo-bubble img').count()==0
  # A pending AI request leaves local rules and the rest of the app usable.
  mode['value']='hold';send('月の景色を想像したい');expect(g.locator('[aria-label="考え中…"]')).to_be_visible()
  count=len(calls);send('Questって何？');expect(g.locator('#spReizoMessages .sp-reizo-msg-bot').last).to_contain_text('クエストは「仕事」');assert len(calls)==count
  g.evaluate("document.getElementById('spDaoFrame').contentWindow.app.go('home')()")
  held.pop().fulfill(status=200,content_type='application/json',body=json.dumps({'reply':'ぼくも想像してみたよ🧊','provider':'gemini'},ensure_ascii=False));g.wait_for_function('document.querySelectorAll(".sp-reizo-typing").length===0');mode['value']='ok'
  # IME Enter must not submit an incomplete Japanese composition.
  count=len(calls);field.fill('今日は元気');field.dispatch_event('keydown',{'key':'Enter','isComposing':True});assert len(calls)==count
  # Another signed-in identity never receives the previous history.
  g.evaluate("window.auth.currentUser={uid:'OTHER-USER',getIdToken:async()=> 'LOCAL-OTHER-TOKEN'}")
  send('今日は気持ちが弾む');g.wait_for_function('document.querySelectorAll(".sp-reizo-typing").length===0');assert calls[-1]['history']==[]
  # Local guides remain available after provider errors; native navigation still works.
  g.evaluate("spReizoClose();ReizoTour.restart('sp-home')");expect(g.locator('.rk-panel')).to_be_visible();g.evaluate('ReizoTour.later();showEmuFeed()');assert g.evaluate("document.body.classList.contains('emu-knowledge-open')")
  g.evaluate('spReizoOpen()');g.screenshot(path=str(out/f'chat-{width}.png'))
  assert not errors,errors
  results.append({'width':width,'status':'PASS','providerCalls':len(calls),'pageErrors':errors});print(width,'chat/rules/failure/page/history/IME/XSS/navigation/guide: PASS',flush=True);c.close()
 b.close()
(out/'browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
