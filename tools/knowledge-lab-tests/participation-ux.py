"""Actual UI/Auth/Rules in the dedicated ux19 emulator; never Production writes."""
import json,os,pathlib,urllib.request,urllib.parse,urllib.error
from playwright.sync_api import sync_playwright

PORT=int(os.environ.get('PARTICIPATION_UX_PORT','4210'))
assert 1024<=PORT<=65535
BASE='http://127.0.0.1:'+str(PORT)
OUT=pathlib.Path(os.environ.get('PARTICIPATION_UX_OUTPUT','/workspace/outputs/participation-ux'));OUT.mkdir(parents=True,exist_ok=True)
if (OUT/'local-results.json').exists():(OUT/'local-results.json').rename(OUT/'previous-local-results.json')
TOURS=['sp-home','sp-guilds','sp-quests','sp-passport','sp-guild','sp-quest-detail','emu-feed','emu-requests','emu-share','emu-discussion']
def state():
    with urllib.request.urlopen(BASE+'/test/ux-state',timeout=5) as r:return json.load(r)
def await_state(g,field,count):
    for _ in range(90):
        data=state()
        if len(data[field])==count:return data
        g.wait_for_timeout(100)
    raise AssertionError((field,count,data))

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    c=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
    c.add_init_script("localStorage.setItem('rk-tour-v1',JSON.stringify({version:1,tours:Object.fromEntries("+json.dumps(TOURS)+".map(x=>[x,{state:'done',index:99}]))}))")
    asset_cache={};transport_errors=[]
    def isolate(route):
        q=route.request;host=urllib.parse.urlparse(q.url).hostname
        if host in ['localhost','127.0.0.1']:route.continue_();return
        if q.method=='GET' and q.resource_type in ['script','stylesheet','font','image'] and host in ['cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com']:
            try:
                if q.url not in asset_cache:
                    try:r=urllib.request.urlopen(urllib.request.Request(q.url,headers={'Accept-Encoding':'identity'}),timeout=12)
                    except urllib.error.HTTPError as e:r=e
                    asset_cache[q.url]=(r.status,{k:v for k,v in r.headers.items() if k.lower() not in ['content-encoding','transfer-encoding','connection']},r.read())
                status,headers,body=asset_cache[q.url];route.fulfill(status=status,headers=headers,body=body)
            except Exception as e:transport_errors.append({'host':host,'error':str(e)});route.abort()
            return
        route.abort()
    c.route('**/*',isolate)
    g=c.new_page();g.set_default_timeout(25000);errors=[];console_errors=[];dialogs=[];failed_responses=[]
    g.on('pageerror',lambda e:errors.append(str(e)))
    g.on('response',lambda r:failed_responses.append({'status':r.status,'path':urllib.parse.urlparse(r.url).path}) if r.status>=400 else None)
    g.on('console',lambda m:console_errors.append(m.text) if m.type=='error' else None)
    def dialog(d):dialogs.append({'type':d.type,'message':d.message});d.accept()
    g.on('dialog',dialog)
    g.goto(BASE+'/test/native.html',wait_until='domcontentloaded')
    g.wait_for_function('typeof __localEmulatorLogin==="function"')
    g.locator('#localEmulatorLogin').click();g.evaluate('window.__localLoginResult')
    g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000)
    # This button belongs only to the local fixture and must not obscure screenshots.
    g.locator('#localEmulatorLogin').evaluate('el=>el.hidden=true')
    identity=g.evaluate('async()=>({uid:auth.currentUser.uid,spid:(await spPassportLoad()).spid})')
    baseline=state();assert not baseline['entryCommits'] and not baseline['guildJoins']
    d=g.frame_locator('#spDaoFrame')
    def hub():
        # 11/19：知識を試す は、すぐクエストの拠点を開く（上の見出しとサービスの切り替えは 11/19 になくなった）
        g.evaluate('showEmuPractice()')
        g.wait_for_function('document.getElementById("spDaoFrame").contentWindow.app?.tourRenderedScreen==="experiments"')
        g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000)
        d.get_by_role('tab',name='挑戦を探す',exact=False).wait_for()
    def overflow():
        assert g.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert d.locator('html').evaluate('el=>el.scrollWidth<=innerWidth+1')
    results=[]
    for width in [375,390,412,768,1280,1440,1920]:
        g.set_viewport_size({'width':width,'height':950});g.wait_for_timeout(200);hub()
        # The shared account menu replaces the retired header service switch (Passport and contact stay one tap away).
        g.locator('#emuHeaderProfile').click();menu=g.locator('#emuAccountMenu')
        menu.wait_for(state='visible')
        assert menu.get_by_role('menuitem',name='SchoolParkパスポート',exact=True).is_visible()
        assert menu.locator('[data-help=contact]').count()==1
        g.keyboard.press('Escape');menu.wait_for(state='hidden')
        assert g.evaluate('auth.currentUser.uid')==identity['uid']
        g.screenshot(path=str(OUT/f'LOCAL-hub-{width}.png'))
        # Browsing the hub, the guild hall and a guild cannot enroll the user.
        assert len(state()['guildJoins'])==0 and len(state()['entryCommits'])==0
        d.get_by_role('button',name='LEARN ギルドに入る',exact=True).click()
        d.locator('[data-tour="guild-before-join"]').first.wait_for()
        assert '学ぶ' in d.locator('[data-tour="guild-before-join"]').first.inner_text()
        join=d.locator('.sp-gs-join')
        join.wait_for();assert join.inner_text().strip()=='参加する';assert len(state()['guildJoins'])==0
        overflow();g.screenshot(path=str(OUT/f'LOCAL-guild-before-{width}.png'))
        join.click();joined=await_state(g,'guildJoins',1)
        assert set(joined['guildJoins'][0]['fields'])=={'name','at'}
        d.get_by_role('button',name='✓ 参加している',exact=True).wait_for()
        g.screenshot(path=str(OUT/f'LOCAL-guild-after-{width}.png'))
        # Wait for the existing busy flag before requesting the next actual action.
        g.wait_for_function('!_spGuildBusy')
        d.get_by_role('button',name='✓ 参加している',exact=True).click();await_state(g,'guildJoins',0)
        g.wait_for_function('!_spGuildBusy')
        # 応援は「詳細」の中（11/19 LEARN のかんたんな形）
        d.locator('.sp-gs-more').click()
        d.get_by_role('button',name='このギルドを応援する',exact=False).click();await_state(g,'guildSupports',1)
        g.wait_for_function('!_spGuildBusy')
        d.get_by_role('button',name='✓ 応援している',exact=False).click();await_state(g,'guildSupports',0)
        g.wait_for_function('!_spGuildBusy')
        d.locator('.sp-guild-rules-close').click()
        d.get_by_text('← ギルド',exact=True).click();d.locator('[data-tour="guild-list"]').wait_for()
        # Existing stages only; an unclassified quest must never become an entry quest.
        hub()
        d.locator('html').evaluate("()=>{app.setState({qTab:'find',qPick:'all',filter:'すべて',series:'general',entryOnly:false});app.toTop()}")
        d.get_by_role('button',name='入門だけ（未経験OK）',exact=True).click()
        d.locator('[data-tour="quest-card"]').first.wait_for()
        assert d.locator('[data-tour="quest-card"]').count()==1
        assert 'ux-entry' in d.locator('html').evaluate('()=>JSON.stringify(app.state.quests.filter(q=>q.stage==="入門").map(q=>q.id))')
        assert len(state()['entryCommits'])==0
        g.screenshot(path=str(OUT/f'LOCAL-quests-{width}.png'))
        d.get_by_role('button',name='内容を見る（参加しません） →',exact=True).click()
        d.locator('[data-tour="quest-before-join"]').wait_for()
        quest_value=d.locator('[data-ux-value="quest"]')
        assert quest_value.is_visible() and quest_value.locator('dt').count()==3
        assert '参加者一覧' in quest_value.inner_text() and '3種類の報告' in quest_value.inner_text()
        assert len(state()['entryCommits'])==0
        assert '報酬は確定しません' in d.locator('[data-tour="quest-before-join"]').inner_text()
        assert '要確認' in d.locator('[data-tour="quest-before-join"]').inner_text()
        overflow();g.screenshot(path=str(OUT/f'LOCAL-quest-before-{width}.png'))
        d.get_by_role('button',name='このクエストを受ける',exact=True).click()
        taken=await_state(g,'entryCommits',1)
        assert set(taken['entryCommits'][0]['fields'])=={'name','tookAt'}
        d.get_by_role('button',name='✓ 受けている',exact=True).wait_for()
        g.screenshot(path=str(OUT/f'LOCAL-quest-after-{width}.png'))
        g.wait_for_function('!_spQuestBusy')
        # 受けたクエストは、拠点の「自分の挑戦」に並ぶ。そこから詳細へ戻れる
        d.get_by_text('← クエスト一覧',exact=True).click()
        d.get_by_role('tab',name='自分の挑戦',exact=False).click()
        d.get_by_role('button',name='続きをする →',exact=True).first.wait_for()
        assert d.locator('.sp-qh-item').count()==1
        d.get_by_role('button',name='続きをする →',exact=True).first.click()
        # 11/24：「このクエストから降りますか？」はブラウザの確かめではなく、画面の中の窓（emuAsk）。利用者と同じく「降りる」を押す
        d.get_by_role('button',name='✓ 受けている',exact=True).click()
        g.locator('.emu-ask').get_by_role('button',name='降りる',exact=True).click();await_state(g,'entryCommits',0)
        g.wait_for_function('!_spQuestBusy')
        d.get_by_text('← クエスト一覧',exact=True).click()
        d.get_by_role('tab',name='挑戦を探す',exact=False).click();d.locator('[data-tour="quest-card"]').first.wait_for()
        after=state();assert after['counts']==baseline['counts'];assert after['approvedCommits']==baseline['approvedCommits']
        assert g.evaluate('auth.currentUser.uid')==identity['uid']
        assert g.evaluate('async()=>(await spPassportLoad()).spid')==identity['spid']
        results.append({'width':width,'accountMenuAndKeyboard':True,'questHub':True,'browseDoesNotJoin':True,'guildJoinSupportAndUndo':True,'questJoinAndLeave':True,'existingStageFilter':True,'backAndSession':True,'noNewRewardOrNotification':True})
        print('PASS width',width,flush=True)
    # Emu remains four tabs; reading never forces participation.
    g.evaluate('showEmuRequests()');g.locator('.emu-practice-entry').wait_for()
    assert '見るだけでは参加になりません' in g.locator('.emu-practice-entry').inner_text()
    g.locator('.emu-practice-entry button').click();g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000)
    g.wait_for_function('document.getElementById("spDaoFrame").contentWindow.app?.tourRenderedScreen==="experiments"')
    # 761px 以上の「知識を読む」では右上の冷蔵庫くんは出さない（左の列にある）。右上に出ている拠点の画面で開く
    # 冷蔵庫くんは、まず「聞く」の窓を1つだけ開く（reizo/mode-switch.js）。チュートリアルの進み具合は変えない
    g.locator('#emuHeaderReizo').click();g.locator('#spReizoPanel').wait_for(state='visible')
    assert g.locator('#spReizoPanel:visible').count()==1
    g.locator('#spReizoPanel .sp-reizo-close').first.click();g.locator('#spReizoPanel').wait_for(state='hidden')
    g.evaluate('showEmuFeed()')
    k=g.frame_locator('#emuKnowledgeFrame');k.get_by_role('button',name='新着',exact=True).first.click()
    progress=g.evaluate('JSON.parse(localStorage.getItem("rk-tour-v1"))')
    assert all(progress['tours'][key]['state']=='done' for key in TOURS)
    assert not errors,errors
    assert not transport_errors,transport_errors
    report={'environment':'LOCAL, actual isolated Firebase Auth and Security Rules; synthetic records only','baselineCommit':'f52dc21cbe20c7e09ea21bf7496a0f4e5487cd8a','results':results,'pageErrors':errors,'consoleErrors':console_errors,'failedResponses':failed_responses,'assetTransportErrors':transport_errors,'dialogs':dialogs,'tutorialCompletedStatesPreserved':True,'singleFridgePanel':True,'emuReadingAndPracticeLink':True,'beforeState':baseline,'afterState':state(),'productionWrites':False,'actualRewardClaims':0}
    (OUT/'local-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({'result':'PASS','widths':len(results),'pageErrors':errors,'consoleErrors':len(console_errors)}))
    c.unroute_all(behavior='ignoreErrors');browser.close()
