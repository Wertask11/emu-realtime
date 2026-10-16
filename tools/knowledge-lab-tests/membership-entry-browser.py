"""Real native app + isolated Firebase emulators. No real payments or AI calls."""
import json,pathlib,urllib.parse
from playwright.sync_api import sync_playwright

BASE='http://127.0.0.1:4207'
OUT=pathlib.Path('/workspace/outputs/membership-entry');OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    c=b.new_context(viewport={'width':1366,'height':950},reduced_motion='reduce')
    c.add_init_script("localStorage.setItem('rk-tour-v1',JSON.stringify({version:1,tours:Object.fromEntries(['sp-home','sp-passport','emu-feed','emu-lab-welcome','emu-lab-research'].map(x=>[x,{state:'skipped',index:0}]))}))")
    def isolate(route):
        u=urllib.parse.urlparse(route.request.url)
        if u.hostname in ['127.0.0.1','localhost'] or route.request.resource_type in ['script','stylesheet','font','image'] and u.hostname in ['cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com']:route.continue_()
        else:route.abort()
    c.route('**/*',isolate)
    g=c.new_page();g.set_default_timeout(25000);errors=[];billing=[]
    def open_plan():
        g.locator('#emuHeaderProfile').click()
        g.locator('#emuAccountMenu').get_by_role('menuitem',name='プラン・お支払い',exact=True).click()
    g.on('pageerror',lambda e:errors.append(str(e)))
    g.on('response',lambda r:billing.append({'path':urllib.parse.urlparse(r.url).path,'status':r.status}) if '/api/billing/' in r.url else None)
    g.goto(BASE+'/test/native.html',wait_until='domcontentloaded')
    g.wait_for_function('typeof __localEmulatorLogin==="function"')
    g.locator('#localEmulatorLogin').click()
    g.wait_for_function('window._chesEntered===true && window.auth?.currentUser?.uid==="lab-alice"')
    g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000)
    print('Authenticated app ready',flush=True)
    g.evaluate('openSpPassport()')
    g.locator('#sppNext').wait_for(state='visible');g.locator('#sppNext').click()
    g.locator('#sppPage2').wait_for(state='visible');g.wait_for_function('!_sppTurning')
    g.locator('#sppNext').click();g.locator('#sppPage3').wait_for(state='visible');g.wait_for_function('!_sppTurning')
    g.locator('#spPassport .spp-value').click()
    g.locator('#emuMemberPageCta').wait_for(state='visible');g.locator('#emuMemberPageCta').click()
    m=g.frame_locator('#chesLegalFrame');m.locator('#main').wait_for(state='visible')
    assert 'plus' in m.locator('#entitlementNotice').inner_text()
    assert not m.locator('#sec-guarantee').is_visible()
    print('Legacy Passport/value-profile entrance PASS',flush=True)
    g.evaluate('closeLegal(); showEmuFeed()')
    # A valid Headers instance must retain Authorization, including across frames.
    g.evaluate('window.__headers=emuAuthHeaders;window.emuAuthHeaders=async(...args)=>new Headers(await window.__headers(...args))')
    open_plan();m.locator('#main').wait_for(state='visible')
    assert 'plus' in m.locator('#entitlementNotice').inner_text()
    g.evaluate('chesLandAfterLogin()');assert m.locator('#main').is_visible()
    g.evaluate('closeLegal()')
    # An expired/rejected token refreshes once; the retry uses the real API.
    rejected={'count':0}
    def expire_once(route):
        rejected['count']+=1
        if rejected['count']==1:route.fulfill(status=401,content_type='application/json',body='{"error":"INVALID_AUTH_TOKEN"}')
        else:route.continue_()
    g.route('**/api/billing/status',expire_once)
    open_plan();m.locator('#main').wait_for(state='visible')
    assert rejected['count']==2
    g.unroute('**/api/billing/status',expire_once);g.evaluate('closeLegal()')
    # Even a repeated auth failure offers a recovery action, never a blank modal.
    def expired(route):route.fulfill(status=401,content_type='application/json',body='{"error":"INVALID_AUTH_TOKEN"}')
    g.route('**/api/billing/status',expired);open_plan()
    m.locator('#retryLoad').wait_for(state='visible');assert 'ログイン' in m.locator('#gate').inner_text()
    g.unroute('**/api/billing/status',expired);m.locator('#retryLoad').click();m.locator('#main').wait_for(state='visible');g.evaluate('closeLegal()')
    print('Headers, token refresh and recovery PASS',flush=True)
    g.evaluate('openSpDao()');d=g.frame_locator('#spDaoFrame');d.locator('[data-sp-head] [aria-label="プロフィール"]').wait_for()
    d.locator('[data-sp-head] [aria-label="プロフィール"]').click();g.locator('#emuAccountMenu').get_by_role('menuitem',name='プラン・お支払い',exact=True).click();m.locator('#main').wait_for(state='visible');g.evaluate('closeLegal();showEmuFeed()')
    # Login as the real local free account to exercise available plan choices.
    g.evaluate('async()=>{await auth.signOut();await window.__localEmulatorLogin("guest");}')
    g.wait_for_function('window.auth?.currentUser?.uid==="lab-guest" && window._chesEntered===true')
    g.locator('#spLoadingOverlay').wait_for(state='hidden');g.evaluate('showEmuFeed()')
    results=[]
    for width in [375,390,412,768,1024,1366]:
        g.set_viewport_size({'width':width,'height':950});open_plan();m.locator('#main').wait_for(state='visible')
        assert m.locator('.plan-choice').count()==3
        assert m.locator('#planList input:checked').input_value()=='light'
        assert '500円' in m.locator('#subscribeBtn').inner_text()
        assert m.locator('#subscribeBtn').is_disabled()
        assert not m.locator('#sec-guarantee').is_visible()
        assert m.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1')
        assert g.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1')
        m.locator('input[value="plus"]').check();assert '3,000円' in m.locator('#subscribeBtn').inner_text()
        m.locator('#adultCheck').check();assert m.locator('#subscribeBtn').is_enabled()
        g.screenshot(path=str(OUT/f'LOCAL-membership-entry-{width}.png'))
        g.evaluate('closeLegal();openSpDao()');assert d.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1');d.locator('[data-sp-head] [aria-label="プロフィール"]').click();g.locator('#emuAccountMenu').get_by_role('menuitem',name='プラン・お支払い',exact=True).click();m.locator('#main').wait_for(state='visible');g.evaluate('closeLegal();showEmuFeed()');results.append({'width':width,'entryVisible':True,'threeEligiblePlans':True,'priceUpdates':True,'noOverflow':True})
    # A comparison link opened without auth preserves the selected plan at login.
    v=c.new_page();v.on('pageerror',lambda e:errors.append(str(e)));v.goto(BASE+'/membership.html?plan=plus#plan',wait_until='domcontentloaded')
    v.locator('#main').wait_for(state='visible');assert v.locator('input[value="plus"]').is_checked()
    fresh=b.new_context(viewport={'width':390,'height':950},reduced_motion='reduce');fresh.add_init_script("localStorage.setItem('rk-tour-v1',JSON.stringify({version:1,tours:{'sp-home':{state:'skipped',index:0}}}))")
    fresh.route('**/*',isolate);new=fresh.new_page();new.on('pageerror',lambda e:errors.append(str(e)))
    new.goto(BASE+'/membership.html?plan=plus#plan',wait_until='domcontentloaded');new.locator('#loginToContinue').wait_for()
    assert 'membershipPlan=plus' in new.locator('#loginToContinue').get_attribute('href')
    new.locator('#loginToContinue').click();new.wait_for_function('typeof __localEmulatorLogin==="function"')
    new.evaluate('window.__localEmulatorLogin("guest")');nm=new.frame_locator('#chesLegalFrame');nm.locator('#main').wait_for(state='visible')
    assert nm.locator('input[value="plus"]').is_checked()
    # The fixture uses an explicit local Stripe mock; no external request/charge.
    new.route('https://checkout.stripe.com/local-only',lambda r:r.fulfill(status=200,content_type='text/html',body='<h1>LOCAL CHECKOUT ONLY</h1>'))
    nm.locator('#adultCheck').check();nm.locator('#subscribeBtn').click();new.get_by_role('heading',name='LOCAL CHECKOUT ONLY').wait_for()
    assert not errors,errors
    report={'environment':'LOCAL native app, real isolated Auth/Firestore; explicit Stripe mock','legacyEntrance':True,'emuAndSchoolParkDirectEntry':True,'headersInstance':True,'one401Refresh':True,'authFailureRetry':True,'standaloneSelectedPlan':True,'loginPreservesSelectedPlan':True,'mockCheckoutNavigation':True,'results':results,'pageErrors':errors,'billingResponses':billing,'actualStripeCalls':0,'actualCharges':0}
    (OUT/'browser-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({'result':'PASS','widths':len(results),'errors':errors}));b.close()
