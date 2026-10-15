"""Actual native UI + local Auth/Firestore, no production requests or mock API responses."""
from facet_controls import select_facets
import json, os, pathlib, urllib.parse
from playwright.sync_api import sync_playwright, expect

OUT = pathlib.Path(os.environ.get('LAB_TEST_OUTPUT', '/workspace/outputs/knowledge-lab-completion/platform'))
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:4201'
results, errors, blocked = [], [], []

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 390, 'height': 844})
    def isolate(route):
        u = urllib.parse.urlparse(route.request.url)
        if u.hostname in ['127.0.0.1', 'localhost']:
            route.continue_()
        elif route.request.resource_type in ['stylesheet', 'font', 'image'] and u.hostname in ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']:
            route.continue_()
        else:
            blocked.append({'host': u.hostname, 'method': route.request.method})
            route.abort()
    c.route('**/*', isolate)
    g = c.new_page()
    g.on('pageerror', lambda e: errors.append(str(e)))
    g.goto(BASE + '/test/native.html', wait_until='domcontentloaded')
    g.wait_for_function('typeof window.__localEmulatorLogin === "function"')
    g.evaluate('window.__localEmulatorLogin("alice")')
    g.locator('#spLoadingOverlay').wait_for(state='hidden', timeout=30000)
    def close_tours():
        for fr in g.frames:
            close = fr.locator('#rk-tour .rk-close')
            if close.count() and close.is_visible(): close.click()
    g.evaluate('openEmuKnowledgeLab()')
    lab = g.frame_locator('#spRoomFrame')
    lab.locator('html[data-lab-ready="true"]').wait_for(timeout=30000)
    close_tours()
    for i, field in enumerate(['field-education', 'field-it']):
        lab.locator('#library [data-compose]').click()
        lab.locator('#postTitle').fill('LOCAL 活動表示検証 ' + str(i))
        lab.locator('#postBody').fill('これはエミュレーター内の保存と活動表示の回帰検証です。')
        select_facets(lab, '#postFacets-field', field)
        lab.locator('#postVisibility').select_option('public')
        lab.locator('#postForm button[type=submit]').click()
        lab.locator('#editorDialog').wait_for(state='hidden')
        lab.locator('#results .card').filter(has_text='LOCAL 活動表示検証 ' + str(i)).wait_for()
    for i in range(2):
        button = lab.locator('#results .card').filter(has_text='LOCAL 活動表示検証 ' + str(i)).locator('[data-source]')
        button.click()
        expect(button).to_have_text('研究に選択済み')
    lab.locator('[data-view="research"]').click()
    for field in ['field-education', 'field-it']:
        lab.locator('#researchFields input[value="' + field + '"]').check()
    lab.locator('#noteTitle').fill('LOCAL 星空連携の研究')
    lab.locator('#noteQuestion').fill('保存した活動が本人の星空に反映されるか？')
    lab.locator('#noteHypothesis').fill('保存した実践結果の活動は本人の履歴へ表示されるか。')
    lab.locator('#notePlan').fill('保存後、本人の星空で件数を確認し、別ユーザーへの切り替えを確認する。')
    lab.locator('#noteResult').fill('ローカル検証の結果を記録する。現実の仮説検証を示すものではない。')
    lab.locator('#noteVisibility').select_option('private')
    with g.expect_response(lambda r: r.url.endswith('/api/knowledge-lab/notes') and r.request.method == 'PUT') as saved:
        lab.locator('#noteForm button[type=submit]').click()
    assert saved.value.status == 200, saved.value.json()
    g.evaluate('closeSpRoom();openRoom2()')
    sky = g.frame_locator('#room2Frame')
    sky.locator('#knowledgeLabActivity').wait_for(timeout=20000)
    sky.locator('#knowledgeLabActivity summary').click()
    panel = sky.locator('#knowledgeLabActivity')
    assert '経験知を届けた：2' in panel.inner_text()
    assert '研究ノートを作った：1' in panel.inner_text()
    assert '実践結果を報告した（自己申告）：1' in panel.inner_text()
    for width in [375, 390, 412, 768, 1024, 1366]:
        g.set_viewport_size({'width': width, 'height': 900 if width >= 768 else 844})
        assert panel.evaluate('(e)=>{const b=e.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1}')
        g.screenshot(path=str(OUT / f'local-{width}-own-activity.png'))
    results.append({'scenario': 'real UI posting/research/result → authenticated own activity in unchanged stars', 'result': 'PASS', 'widths': [375,390,412,768,1024,1366]})
    g.evaluate('window.__localEmulatorLogin("bob")')
    panel.wait_for(state='detached', timeout=20000)
    g.locator('#spLoadingOverlay').wait_for(state='hidden', timeout=30000)
    g.evaluate('openRoom2()')
    sky = g.frame_locator('#room2Frame')
    sky.locator('#knowledgeLabActivity').wait_for()
    sky.locator('#knowledgeLabActivity summary').click()
    assert '経験知を届けた：0' in sky.locator('#knowledgeLabActivity').inner_text()
    assert 'LOCAL 星空連携の研究' not in sky.locator('#knowledgeLabActivity').inner_text()
    g.screenshot(path=str(OUT / 'local-account-switch-activity.png'))
    results.append({'scenario': 'different real emulator login clears previous activity and shows only own counts', 'result': 'PASS'})
    g.evaluate('closePopup();openSpDao()')
    dao = g.frame_locator('#spDaoFrame')
    dao.locator('#dao-root').wait_for()
    g.wait_for_function('document.getElementById("spDaoFrame").contentWindow.app.state.quests.some(q=>q.id==="local-regression-quest")', timeout=30000)
    close_tours()
    for width in [375,390,412,768,1024,1366]:
        g.set_viewport_size({'width': width, 'height': 900 if width >= 768 else 844})
        for screen in ['home','experiments','logs','library','park']:
            g.locator('#spDaoFrame').evaluate('(e,s)=>e.contentWindow.app.go(s)()', screen)
            g.wait_for_function('(s)=>document.getElementById("spDaoFrame").contentWindow.app.tourRenderedScreen===s', arg=screen)
            dao.locator('#dao-root').wait_for()
            assert dao.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1'), (width, screen)
            g.screenshot(path=str(OUT / f'local-{width}-schoolpark-{screen}.png'))
    results.append({'scenario': 'existing SchoolPark home/Quest/Guild/library/park routes render real emulator data at six widths', 'result': 'PASS', 'navigation': 'existing screen navigation function; no mocked render'})
    g.evaluate('openSpRoom("/admin/room1/index.html", "Room1")')
    room = g.frame_locator('#spRoomFrame')
    room.locator('#headerTitle').wait_for()
    for label, first in [('マネーリテラシー','増やし方'),('ネットリテラシー','SNSとの付き合い方'),('ライフリテラシー','感情との向き合い方'),('ブルーファイル','リーダーシップ')]:
        room.get_by_text(label, exact=True).first.click()
        expect(room.locator('#list .card h2').first).to_have_text(first)
    assert g.locator('#spRoomFrame').evaluate('e=>e.contentWindow.room1Contents.length') == 4
    results.append({'scenario': 'Room1 retains four literacy areas using original contents route', 'result': 'PASS'})
    g.evaluate('closeSpRoom()')
    g.locator('#spDaoFrame').evaluate('e=>e.contentWindow.app.go("city")()')
    dao.locator('#sp-city').wait_for(timeout=20000)
    dao.locator('[data-action="page"][data-value="real"]').click()
    dao.locator('[data-action="spot"][data-value="demo-book"]').click()
    with g.expect_response(lambda r: '/api/schoolpark/city/checkins' in r.url and r.request.method == 'POST') as checkin:
        dao.locator('[data-action="checkin"]').click()
    assert checkin.value.status == 200
    dao.get_by_text('記録済み', exact=False).wait_for()
    g.screenshot(path=str(OUT / 'local-city-real-demo-checkin.png'))
    results.append({'scenario': 'City demo UI check-in persists through original Passport/City route; no payments/rewards', 'result': 'PASS'})
    assert not errors, errors
    OUT.joinpath('results.json').write_text(json.dumps({'environment':'local native UI + actual Auth/Firestore emulators', 'productionWrites':False,'providerMock':False,'results':results,'pageErrors':errors,'blockedExternalRequests':blocked}, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False, indent=2))
    b.close()
