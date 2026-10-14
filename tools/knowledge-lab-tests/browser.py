"""Actual local browser + actual Auth/Firestore emulators. No production writes."""
import json, pathlib
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:4200'
OUT=pathlib.Path('/workspace/outputs/knowledge-lab-browser');OUT.mkdir(parents=True,exist_ok=True)
results=[]
def close_guide(frame):
    button=frame.locator('#rk-tour .rk-close')
    if button.count() and button.is_visible():button.click()
def ready(frame):
    frame.locator('html[data-lab-ready="true"]').wait_for(timeout=30000);close_guide(frame)
def login(page,role='alice'):
    page.goto(BASE+'/test/lab-shell.html',wait_until='domcontentloaded');page.locator('#role').select_option(role)
    with page.expect_response(lambda r: r.url.endswith('/api/knowledge-lab/me') and r.status==200):page.locator('#signin').click()
    frame=page.frame_locator('#lab');ready(frame);return frame
def click_view(frame,name):
    frame.locator(f'[data-view="{name}"]').click()
def no_overflow(frame):return frame.locator('html').evaluate('(el)=>({width:innerWidth,scroll:document.documentElement.scrollWidth})')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':390,'height':844});page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    f=login(page)
    click_view(f,'writer');f.locator('#writerName').fill('エミュレーター検証書き手');f.locator('#writerBio').fill('検証用の自己紹介です。本番の利用者情報ではありません。');f.locator('#writerFacets-field').select_option(['field-education','field-it']);f.locator('#writerPublished').check();f.locator('#writerConsent').check();f.locator('#writerForm button[type="submit"]').click();f.locator('#writers h3').filter(has_text='エミュレーター検証書き手').wait_for();
    f.locator('#writer [data-compose]').click();f.locator('#postTitle').fill('検証：教える前に小さく試す');f.locator('#postBody').fill('検証用の経験知です。小さな教材を先に試して、分かりにくい部分を確かめました。');f.locator('#postFacets-field').select_option(['field-education']);f.locator('#postFacets-job').select_option(['job-teacher']);f.locator('#postVisibility').select_option('draft');f.locator('#postForm button[type="submit"]').click();f.locator('#editorDialog').wait_for(state='hidden');
    click_view(f,'mine');f.locator('[data-mine="posts"]').click();f.locator('#mineItems [data-edit]').first.click();f.locator('#postBody').fill('検証用の経験知です。小さな教材を先に試して、分かりにくい部分を確かめました。編集を保存しました。');f.locator('#postVisibility').select_option('public');f.locator('#postForm button[type="submit"]').click();f.locator('#editorDialog').wait_for(state='hidden');
    click_view(f,'library');f.locator('#library [data-compose]').click();f.locator('#postTitle').fill('検証：技術も小さく試して比較する');f.locator('#postBody').fill('検証用の経験知です。自動化を一度に広げず、小さな作業で条件と注意点を確かめました。');f.locator('#postFacets-field').select_option(['field-it']);f.locator('#postVisibility').select_option('public');f.locator('#postForm button[type="submit"]').click();f.locator('#editorDialog').wait_for(state='hidden');f.locator('#results .card').filter(has_text='技術も小さく').locator('[data-post]').click();f.locator('#saveKnowledge').click();f.locator('#detailDialog [data-close]').click();
    # Search and empty state are performed through the real API.
    f.locator('#query').fill('見つからない検証キーワード');f.locator('#searchForm button[type="submit"]').click();f.locator('#results').get_by_text('この条件の知識はまだありません。').wait_for();f.locator('#resetFilters').click();f.locator('#results [data-source]').nth(0).click();f.locator('#results [data-source]').nth(1).click();
    click_view(f,'research');f.locator('#researchFields input[value="field-education"]').check();f.locator('#researchFields input[value="field-it"]').check();f.locator('#researchFind button').click();f.locator('#researchCandidates .card').first.wait_for();f.locator('#compareSources').click();f.locator('#comparison').wait_for(state='visible');f.locator('#noteTitle').fill('検証：教育とITを小さく試す研究');f.locator('#noteQuestion').fill('試す単位を小さくしたら、条件の違いが見えるだろうか？');f.locator('#noteHypothesis').fill('これは検証用の未検証の仮説です。');f.locator('#notePlan').fill('検証用ノートとして、条件を記録する。');f.locator('#noteVisibility').select_option('public');f.locator('#noteForm button[type="submit"]').click();f.locator('#publicNotes h3').filter(has_text='検証：教育とIT').wait_for();
    click_view(f,'mine');f.locator('[data-mine="notes"]').click();f.locator('#mineItems [data-note]').first.click();f.locator('#continueNote').click();f.locator('#noteResult').fill('検証環境で保存と再表示を確認しました。実生活の検証結果ではありません。');f.locator('#noteForm button[type="submit"]').click();f.locator('#status').get_by_text('研究ノートを保存しました。',exact=False).wait_for();
    click_view(f,'requests');f.locator('#requestQuestion').fill('検証用の知識募集');f.locator('#requestContext').fill('エミュレーター内だけの募集の保存確認です。');f.locator('#requestFacets-field').select_option(['field-education']);f.locator('#requestForm button').click();f.locator('#requestItems h3').filter(has_text='検証用の知識募集').wait_for();
    results.append({'scenario':'writer/draft/edit/publish/save/search/empty/compare/note/update/request','result':'PASS','pageErrors':errors})
    context.close()
    c=browser.new_context(viewport={'width':375,'height':844});g=c.new_page();errs=[];g.on('pageerror',lambda e:errs.append(str(e)));f=login(g)
    for width in [375,390,412,768,1024,1366]:
        g.set_viewport_size({'width':width,'height':900 if width>=768 else 844})
        for screen in ['library','research','mine','writer','requests']:
            click_view(f,screen);f.locator('#'+screen).wait_for(state='visible');g.wait_for_timeout(100);measure=no_overflow(f);assert measure['scroll']<=measure['width']+1,(width,screen,measure)
            if screen in ['library','research','writer']:g.screenshot(path=str(OUT/f'{width}-{screen}.png'),full_page=False)
        click_view(f,'library');f.locator('#library [data-compose]').click();measure=f.locator('#editorDialog').evaluate('(el)=>({width:el.clientWidth,scroll:el.scrollWidth})');assert measure['scroll']<=measure['width']+1,(width,'dialog',measure);g.screenshot(path=str(OUT/f'{width}-editor.png'));f.locator('#editorDialog [data-close]').click()
        results.append({'width':width,'screens':['library','research','mine','writer','requests','editor'],'horizontalOverflow':False,'pageErrors':errs,'result':'PASS'})
    c.close()
    # Owner UI reaches live aggregation, report list and classification tools.
    c=browser.new_context(viewport={'width':1366,'height':900});g=c.new_page();f=login(g,'owner');f.locator('#adminTab').wait_for(state='visible');click_view(f,'admin');f.locator('#adminSummary .metrics').wait_for();f.locator('[data-admin-list="posts"]').click();f.locator('#adminItems .card').first.wait_for();g.screenshot(path=str(OUT/'owner-admin.png'));results.append({'scenario':'Owner dashboard/real Firestore counts/list','result':'PASS'});c.close()
    browser.close()
OUT.joinpath('results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(json.dumps(results,ensure_ascii=False,indent=2))
