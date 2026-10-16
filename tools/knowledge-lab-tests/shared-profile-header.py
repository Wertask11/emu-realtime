"""Native UI with actual isolated Firebase Auth/Firestore, no production writes."""
import json,pathlib,urllib.parse
from playwright.sync_api import sync_playwright

OUT=pathlib.Path('/workspace/outputs/shared-profile-header');OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:4208'
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    c=b.new_context(viewport={'width':1366,'height':950},reduced_motion='reduce')
    c.add_init_script("localStorage.setItem('rk-tour-v1',JSON.stringify({version:1,tours:Object.fromEntries(['sp-home','sp-passport','emu-feed'].map(x=>[x,{state:'skipped',index:0}]))}))")
    def isolate(route):
        u=urllib.parse.urlparse(route.request.url)
        if u.hostname in ['127.0.0.1','localhost'] or route.request.resource_type in ['script','stylesheet','font','image'] and u.hostname in ['cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com']:route.continue_()
        else:route.abort()
    c.route('**/*',isolate)
    g=c.new_page();g.set_default_timeout(25000);errors=[]
    g.on('pageerror',lambda e:errors.append(str(e)))
    def login():
        g.goto(BASE+'/test/native.html',wait_until='domcontentloaded')
        g.wait_for_function('typeof __localEmulatorLogin==="function"');g.locator('#localEmulatorLogin').click();g.evaluate('window.__localLoginResult')
        g.wait_for_function('auth?.currentUser?.uid==="lab-alice" && window._chesEntered===true')
        g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000)
        g.evaluate('showEmuFeed()')
    login()
    def profile():
        g.locator('#emuHeaderProfile').click();g.locator('#emuAccountMenu.open').wait_for();assert not g.locator('#spPassport').is_visible()
    def settings():
        g.locator('#emuAccountMenu').get_by_role('menuitem',name='設定',exact=True).click()
        g.locator('#spSettingsPanel.open').wait_for()
        g.wait_for_function('document.getElementById("spSettingsPanel").getBoundingClientRect().right <= innerWidth + 1')
        assert not g.locator('#spPassport').is_visible()
    profile();settings()
    for text in ['招待リンク','SchoolPark ID','キャッシュをクリア','ログアウト','名前と写真を編集する']:
        assert text.casefold() in g.locator('#spSettingsPanel').inner_text().casefold(),(text,g.locator('#spSettingsPanel').inner_text())
    radio=g.locator('#spSettingsPanel input[value="avatar"]')
    # Real authenticated production handler, persisted only to local Firestore.
    g.evaluate('window.__originalAuthHeaders=emuAuthHeaders;window.emuAuthHeaders=async(...args)=>new Headers(await __originalAuthHeaders(...args))')
    with g.expect_response(lambda r:urllib.parse.urlparse(r.url).path=='/api/user/settings') as response:radio.check()
    assert response.value.status==200
    g.wait_for_function('document.querySelector("#emuSettingsMsg").textContent.includes("保存しました")')
    assert g.locator('#spSettingsPanel').is_visible()
    g.evaluate('closeSettingsSheet()');profile()
    assert g.locator('#walletAddressButton img').is_visible();assert g.locator('#emuHeaderProfile img').is_visible()
    g.evaluate('closeAccountMenu()')
    login();profile()
    g.locator('#walletAddressButton img').wait_for(state='visible');g.locator('#emuHeaderProfile img').wait_for(state='visible')
    settings();assert g.locator('#spSettingsPanel input[value="avatar"]').is_checked()
    # A failed save keeps the previous value and gives a retryable error.
    def reject(route):route.fulfill(status=503,content_type='application/json',body='{"error":"LOCAL_FAILURE"}')
    g.route('**/api/user/settings',reject);g.locator('#spSettingsPanel input[value="name"]').check()
    g.wait_for_function('document.querySelector("#emuSettingsMsg").textContent.includes("保存できません")')
    assert radio.is_checked();g.unroute('**/api/user/settings',reject)
    with g.expect_response(lambda r:urllib.parse.urlparse(r.url).path=='/api/user/settings') as response:g.locator('#spSettingsPanel input[value="name"]').check()
    assert response.value.status==200
    g.wait_for_function('document.querySelector("#emuSettingsMsg").textContent.includes("保存しました")')
    g.evaluate('closeSettingsSheet()');profile()
    assert not g.locator('#walletAddressButton img').count();assert not g.locator('#emuHeaderProfile img').count();assert g.locator('#emuHeaderProfile').inner_text()!='👤'
    g.locator('#emuAccountMenu').get_by_role('menuitem',name='プラン・お支払い',exact=True).click()
    m=g.frame_locator('#chesLegalFrame');m.locator('#main').wait_for(state='visible')
    assert 'plus' in m.locator('#entitlementNotice').inner_text()
    assert not g.locator('#spPassport').is_visible();g.evaluate('closeLegal()')
    # The existing Passport remains accessible from the Emu menu.
    profile();g.locator('#emuAccountMenu').get_by_role('menuitem',name='SchoolParkパスポート',exact=True).click()
    g.locator('#spPassport').wait_for(state='visible');g.evaluate('closeSpPassport()')
    # Avatar appears on SchoolPark too and survives its screen rerender.
    profile();settings()
    with g.expect_response(lambda r:urllib.parse.urlparse(r.url).path=='/api/user/settings') as response:radio.check()
    assert response.value.status==200
    g.wait_for_function('document.querySelector("#emuSettingsMsg").textContent.includes("保存しました")')
    g.evaluate('closeSettingsSheet();openSpDao()');dao=g.frame_locator('#spDaoFrame')
    dao.locator('[data-sp-head] .service-profile img').wait_for()
    dao.locator('[data-sp-head] .service-profile').click();settings()
    with g.expect_response(lambda r:urllib.parse.urlparse(r.url).path=='/api/user/settings') as response:g.locator('#spSettingsPanel input[value="name"]').check()
    assert response.value.status==200
    g.wait_for_function('document.querySelector("#emuSettingsMsg").textContent.includes("保存しました")')
    assert not dao.locator('[data-sp-head] .service-profile img').count()
    g.evaluate('closeSettingsSheet();showEmuFeed()')
    results=[]
    for width in [375,390,412,768,1024,1366]:
        g.set_viewport_size({'width':width,'height':950});g.evaluate('showEmuFeed()')
        controls=g.locator('#mainApp > .header .service-tools .service-tool')
        assert controls.count()==2
        assert controls.first.get_attribute('aria-label')=='プロフィール'
        emu=[x.bounding_box() for x in controls.all()]
        assert all(x['width']==44 and x['height']==44 for x in emu)
        assert g.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        g.screenshot(path=str(OUT/f'LOCAL-Emu-{width}.png'))
        profile();g.screenshot(path=str(OUT/f'LOCAL-profile-{width}.png'));settings();assert g.locator('#spSettingsPanel input[value="name"]').is_checked()
        g.screenshot(path=str(OUT/f'LOCAL-settings-{width}.png'));g.evaluate('closeSettingsSheet()')
        g.evaluate('openSpDao()');d=g.frame_locator('#spDaoFrame')
        d.locator('[data-sp-head] .service-tool').first.wait_for()
        assert d.locator('[data-sp-head] .service-tool').count()==2
        school=[x.bounding_box() for x in d.locator('[data-sp-head] .service-tool').all()]
        assert all(x['width']==44 and x['height']==44 for x in school)
        assert d.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1')
        g.screenshot(path=str(OUT/f'LOCAL-SchoolPark-{width}.png'))
        assert d.locator('[data-sp-head] .service-profile').inner_text()==g.locator('#emuHeaderProfile').inner_text()
        d.locator('[data-sp-head]').get_by_role('button',name='プロフィール',exact=True).click();g.locator('#emuAccountMenu.open').wait_for();assert not g.locator('#spPassport').is_visible()
        settings();assert g.locator('#spSettingsPanel input[value="name"]').is_checked();g.evaluate('closeSettingsSheet()')
        d.locator('[data-sp-head]').get_by_role('button',name='冷蔵庫くんに聞く・使い方案内').click()
        g.locator('#rk-tour .rk-panel:not([hidden])').wait_for();g.locator('#rk-tour .rk-close').click()
        g.evaluate('showEmuFeed()');g.locator('#emuHeaderReizo').click()
        g.locator('#rk-tour .rk-panel:not([hidden])').wait_for();g.locator('#rk-tour .rk-close').click()
        results.append({'width':width,'twoCommonControls44px':True,'sameEmuProfileAndSettings':True,'fridgeBothServices':True})
        print('PASS width',width,flush=True)
    assert not errors,errors
    report={'environment':'LOCAL native app + real Auth/Firestore emulators','results':results,'settingsPersistedAfterReload':True,'failedSaveRetainsPreviousValue':True,'existingSettingsPreserved':True,'profilePlanLoadsAuthenticated':True,'pageErrors':errors,'productionWrites':False}
    (OUT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({'result':'PASS','widths':len(results),'errors':errors}))
    b.close()
