"""Real emulator auth/persistence; model-list mock only. Never Production/real AI proof."""
import json, pathlib, urllib.parse
from playwright.sync_api import sync_playwright

OUT = pathlib.Path('/workspace/outputs/knowledge-lab-admin-feedback')
OUT.mkdir(parents=True, exist_ok=True)
results = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 390, 'height': 844})
    c.route('**/*', lambda r: r.continue_() if urllib.parse.urlparse(r.request.url).hostname in ['127.0.0.1', 'localhost'] else r.abort())
    g = c.new_page()
    errors = []
    g.on('pageerror', lambda e: errors.append(str(e)))
    g.goto('http://127.0.0.1:4202/test/lab-shell.html')
    def login(role):
        g.locator('#role').select_option(role)
        with g.expect_response(lambda r: urllib.parse.urlparse(r.url).path == '/api/knowledge-lab/me'):
            g.locator('#signin').click()
        f = g.frame_locator('#lab')
        f.locator('html[data-lab-ready="true"]').wait_for()
        g.wait_for_function("!document.querySelector('#lab').contentWindow.document.querySelector('#loginBox').hidden === false")
        return f
    f = login('owner')
    f.locator('#adminTab').click()
    f.locator('#aiLoadModels').click()
    f.locator('#aiModel option[value="gemini-test-flash"]').wait_for(state='attached')
    f.locator('#aiModel').select_option('gemini-test-flash')
    f.locator('#aiEmbeddingModel').select_option('gemini-embedding-001')
    f.locator('#aiFreeConfirmed').check()
    # Delay real PUT to verify visible progress and protection against duplicate submission.
    def delay(route):
        if route.request.method == 'PUT':
            import time
            time.sleep(0.6)
        route.continue_()
    g.route('**/api/knowledge-lab/admin/ai', delay)
    with g.expect_response(lambda r: '/admin/ai' in r.url and r.request.method == 'PUT') as response:
        f.locator('#aiSettingsForm button[type=submit]').click()
        assert f.locator('#aiSettingsForm').get_attribute('aria-busy') == 'true'
        assert f.locator('#aiStop').is_disabled()
        assert '保存しています' in f.locator('#aiSettingsFeedback').inner_text()
    assert response.value.status == 200
    f.locator('#aiSettingsFeedback').filter(has_text='保存しました').wait_for()
    assert '分析：有効／意味検索：有効' in f.locator('#aiSettingsFeedback').inner_text()
    assert f.locator('#aiOpenResearch').is_visible()
    f.locator('#aiLoadModels').click()
    f.locator('#aiSettingsFeedback').filter(has_text='一覧を取得しました').wait_for()
    assert f.locator('#aiModel').input_value() == 'gemini-test-flash'
    assert f.locator('#aiEmbeddingModel').input_value() == 'gemini-embedding-001'
    results.append('real settings save / visible progress and success / duplicate-action buttons disabled / selected models retained')
    # Error injection tests only presentation, and must not claim a real server failure.
    g.unroute('**/api/knowledge-lab/admin/ai', delay)
    def failure(route):
        route.fulfill(status=503, content_type='application/json', body='{"error":"SERVICE_UNAVAILABLE"}')
    g.route('**/api/knowledge-lab/admin/ai', failure)
    f.locator('#aiSettingsForm button[type=submit]').click()
    f.locator('#aiSettingsFeedback.error').wait_for()
    assert f.locator('#aiSettingsForm button[type=submit]').is_enabled()
    g.unroute('**/api/knowledge-lab/admin/ai', failure)
    f.locator('#aiStop').click()
    f.locator('#aiSettingsFeedback').filter(has_text='停止しました').wait_for()
    assert f.locator('#aiOpenResearch').is_hidden()
    results.append('injected failure visible and retry enabled / real Owner stop persisted')
    f.locator('#adminSaveMetrics').click()
    f.locator('#saveMetricsFeedback').filter(has_text='完了しました').wait_for()
    f.locator('[data-view="library"]').click()
    f.locator('#sort').select_option('saved')
    with g.expect_response(lambda r: '/search?' in r.url and 'sort=saved' in r.url) as search:
        f.locator('#searchForm button[type=submit]').click()
    assert search.value.status == 200
    results.append('real Owner migration to READY / saved-sorted library HTTP200')
    f.locator('#adminTab').click()
    for width in [375, 390, 412, 768, 1024, 1366]:
        g.set_viewport_size({'width': width, 'height': 900})
        assert f.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1')
        f.locator('#aiSettingsFeedback').scroll_into_view_if_needed()
        g.screenshot(path=str(OUT / f'LOCAL-admin-feedback-{width}.png'))
    f = login('alice')
    assert f.locator('#adminTab').is_hidden()
    denial = g.evaluate("async()=>{const h=await emuAuthHeaders();return (await fetch('/api/knowledge-lab/admin/save-metrics',{method:'POST',headers:h,body:'{}'})).status}")
    assert denial == 403
    results.append('six widths without horizontal overflow / genuine non-Owner login hidden admin and denied migration')
    assert not errors, errors
    report = {'environment': 'separate LOCAL Auth/Firestore emulator project', 'modelListing': 'MOCK', 'generationCalls': 0, 'productionWrites': False, 'pageErrors': errors, 'pass': results}
    (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    b.close()
