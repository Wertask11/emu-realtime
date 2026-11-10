"""Actual local Auth/Firestore + production UI. Provider is the explicit isolated test double.
No access to production, no production EMUER, no change to Knowledge Lab.
Run the dedicated fixture with ECONOMY_TEST_{CROSS,PHASE3,PHASE4}=true first.
"""
import asyncio, json, os, re
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path(os.environ.get('PRACTICE_BROWSER_OUTPUT', '/tmp/reizo-phase4-browser'))
OUT.mkdir(parents=True, exist_ok=True)
LEGACY=os.environ.get('PRACTICE_LEGACY')=='true'

async def main():
 async with async_playwright() as p:
  browser = await p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
  results=[]
  for width in [375,390,412,768,1280,1440,1920]:
   print('Checking practice width',width,flush=True)
   context=await browser.new_context(viewport={'width':width,'height':950})
   await context.grant_permissions(['clipboard-read','clipboard-write'])
   blocked=[]
   async def guard(route):
    if any(route.request.url.startswith('http://127.0.0.1:'+str(port)+'/') for port in [4257,9292,8892]): await route.continue_()
    else: blocked.append(route.request.url.split('?')[0]); await route.abort()
   await context.route('**/*',guard)
   page=await context.new_page(); errors=[]; calls=[]
   page.on('pageerror', lambda e: errors.append(str(e)))
   page.on('dialog',lambda d:d.accept())
   page.on('request',lambda r: calls.append(r.url.split('?')[0]) if '/api/economy/practice' in r.url else None)
   await page.goto('http://127.0.0.1:4257/test/shell'); f=page.frame_locator('iframe')
   await f.locator('#practiceSection').wait_for(state='visible')
   await page.wait_for_function('window.auth?.currentUser?.uid')
   await f.locator('#notice').filter(has_text='残高と履歴を更新しました').wait_for()
   if width==375:
    await f.locator('#taskType').select_option('guild_plan'); await f.locator('#goal').fill('Web3を学びギルドで実践する計画を作りたい')
    await f.locator('#quoteButton').click(); await f.locator('#approval').wait_for(state='visible')
    await f.locator('#paymentConsent').check(); await f.locator('#aiConsent').check(); await f.locator('#pay').click()
    await f.locator('#history article').first.get_by_role('button',name='保存した下書き・計画を開く').wait_for(timeout=20000)
    if LEGACY:
     r=await context.request.post('http://127.0.0.1:4257/test/legacy-artifact',data={'role':'alice'}); assert r.ok
    await f.locator('#history article').first.get_by_role('button',name='保存した下書き・計画を開く').click()
   else:
    await f.locator('#loadArtifacts').click(); await f.get_by_role('button',name='ギルド活動の準備を開く').first.click()
   await f.locator('#artifactDialog').wait_for(state='visible')
   assert await f.locator('#artifactPlanName').inner_text()
   assert '計画の保存' in await f.locator('#artifactSavedAt').inner_text()
   assert await f.locator('#artifactEditor').get_attribute('open') is None
   if LEGACY:
    assert await f.locator('#legacyPracticeSetup').is_visible()
    assert '以前の形式' in await f.locator('#artifactFormatNotice').inner_text()
    assert 'WEB3 Guild' in await f.locator('#legacyPracticeItems').input_value()
   else: assert await f.locator('#legacyPracticeSetup').is_hidden()
   assert await page.frames[1].evaluate('document.querySelectorAll("dialog[open]").length')==1
   if LEGACY and width in [390,1280]: await page.screenshot(path=str(OUT/f'legacy-plan-{width}.png'),full_page=True)
   await f.locator('#startPractice').click(); await f.locator('#practiceDialog').wait_for(state='visible')
   assert await page.frames[1].evaluate('document.querySelectorAll("dialog[open]").length')==1
   assert await f.locator('#practiceDialog').evaluate('(e)=>e.scrollTop')==0
   assert await f.locator('#artifactDialog').is_hidden()
   await f.locator('#practiceState-0').select_option('in_progress')
   await f.locator('#practiceNote-0').fill('本人が記入した準備メモ '+str(width))
   await f.locator('#practiceObservation-actions').fill('公式の活動案内を読み、試す内容をノートに整理した')
   await f.locator('#practiceObservation-method').fill('候補を二つ並べて目的と条件を比較した')
   await f.locator('#practiceObservation-result').fill('次に試す内容を一つ選んだ')
   await f.locator('#practiceReflection-goal').fill('学んだことを実際の活動で試す')
   await f.locator('#practiceReflection-learning').fill('参加条件を先に整理すると動きやすい')
   await f.locator('#practicePostTitle').fill('試す活動を選んだ記録')
   await f.locator('#practiceAdvice').fill('自分が試せる範囲を先に決める')
   for check in await f.locator('#practicePostingChecks input').all(): await check.check()
   if width==375:
    # Lose the HTTP acknowledgement AFTER the server committed. Re-send must not add a revision.
    once={'lost':False}
    async def lose_ack(route):
     if route.request.method=='POST' and not once['lost']:
      once['lost']=True; response=await route.fetch(); assert response.status==200; await route.abort()
     else: await route.continue_()
    await context.route('**/api/economy/practice/*',lose_ack)
    await f.locator('#savePractice').click(); await f.locator('#practiceNotice').filter(has_text='保存を確認できません').wait_for()
    await context.unroute('**/api/economy/practice/*',lose_ack)
   await f.locator('#savePractice').click(); await f.locator('#practiceNotice').filter(has_text='本人専用に保存しました').wait_for()
   assert await f.locator('#practiceSaveStatus').is_visible()
   assert '本人専用に保存しました' in await f.locator('#practiceSaveStatus').inner_text()
   for section in ['practiceRecordHeading','practiceReflectionHeading','practicePostingHeading']:
    await f.locator('[data-practice-section="'+section+'"]').click(); await f.locator('#'+section).wait_for(state='visible')
   await f.locator('#pausePractice').click(); await f.locator('#practiceStatus').filter(has_text='一時中断').wait_for()
   await f.locator('#resumePractice').click(); await f.locator('#practiceStatus').filter(has_text='実践中').wait_for()
   await f.locator('#practiceNotes').fill('通信が戻るまでの途中入力 '+str(width))
   async def delayed_login(route):
    await asyncio.sleep(1.5); await route.continue_()
   if width==375: await context.route('**/test/login?role=alice', delayed_login)
   await page.reload(); await f.locator('#practiceSection').wait_for(state='visible')
   await page.wait_for_function('window.auth?.currentUser?.uid')
   await f.locator('#notice').filter(has_text='残高と履歴を更新しました').wait_for()
   await f.locator('#loadPractice').click()
   if width==375: await context.unroute('**/test/login?role=alice', delayed_login)
   await f.get_by_role('button',name='ギルド活動の準備の実践記録を開く').click()
   assert await f.locator('#practiceNotes').input_value()=='通信が戻るまでの途中入力 '+str(width)
   await f.locator('#savePractice').click(); await f.locator('#practiceNotice').filter(has_text='本人専用に保存しました').wait_for()
   await f.locator('#copyPractice').click(); await f.locator('#practiceNotice').filter(has_text='投稿用の文章をコピーしました').wait_for()
   assert '公式の活動案内を読み' in await f.locator('#practicePreview').input_value()
   assert '［未記入］' in await f.locator('#practicePreview').input_value()
   await page.evaluate("window.openEmuKnowledgeLab=(view,options)=>{window.postingArgs={view,options}}")
   await f.locator('#practicePosting').click(); assert await page.evaluate('window.postingArgs')=={'view':'library','options':{'compose':True}}
   assert not await f.locator('body').evaluate('(e)=>e.scrollWidth>innerWidth')
   assert not await f.locator('#practiceDialog').evaluate('(e)=>e.scrollWidth>e.clientWidth+2')
   n=len(calls); await page.wait_for_timeout(1100); assert len(calls)==n,'unexpected practice polling'
   if width in [390,1280]:
    await f.locator('#practiceDialog').evaluate('(e)=>e.scrollTop=0'); await page.screenshot(path=str(OUT/f'practice-{width}.png'),full_page=True)
   if width==1920:
    await f.locator('#completePractice').click(); await f.locator('#practiceStatus').filter(has_text=re.compile('^完了')).wait_for()
    await context.request.post('http://127.0.0.1:4257/test/membership',data={'role':'alice','plan':'light'})
    await f.locator('#savePractice').click(); await f.locator('#practiceDialog').wait_for(state='hidden')
    assert await f.locator('#practiceFields').inner_text()==''
    await context.request.post('http://127.0.0.1:4257/test/membership',data={'role':'alice','plan':'plus'})
    await f.locator('#loadPractice').click(); await f.get_by_role('button',name='ギルド活動の準備の実践記録を開く').click()
    # A different editor's revision must not be overwritten; preserve and then clear recovery on account switch.
    login=await (await context.request.get('http://127.0.0.1:4257/test/login?role=alice')).json()
    headers={'Authorization':'Bearer '+login['token']}
    listing=await (await context.request.get('http://127.0.0.1:4257/api/economy/practice',headers=headers)).json()
    sid=listing['sessions'][0]['id']; saved=await (await context.request.get('http://127.0.0.1:4257/api/economy/practice/'+sid,headers=headers)).json()
    await context.request.post('http://127.0.0.1:4257/api/economy/practice/'+sid,headers=headers,data={'revision':saved['session']['revision'],'requestId':'other-editor-request-01','notes':'別の画面で保存した記録'})
    await f.locator('#practiceNotes').fill('競合前にこのタブで入力した記録')
    await f.locator('#savePractice').click(); await f.locator('#practiceNotice').filter(has_text='別の画面で更新されています').wait_for()
    await f.locator('#refreshPractice').click(); await f.locator('#practiceRecovery').wait_for(state='visible')
    assert '競合前にこのタブで入力した記録' in await f.locator('#practiceRecovery').input_value()
   await page.evaluate("window.testSignIn('bob')"); await f.locator('#practiceDialog').wait_for(state='hidden')
   assert await f.locator('#practiceFields').inner_text()==''
   assert await f.locator('#practicePreview').input_value()==''
   assert await f.locator('#practiceRecovery').input_value()==''
   assert await f.locator('#artifactPlanName').inner_text()==''
   assert await page.frames[1].evaluate("Object.keys(sessionStorage).filter(k=>k.startsWith('reizo-practice-v1:')).length")==0
   assert not blocked, blocked; assert not errors, errors
   results.append({'width':width,'legacyMode':LEGACY,'oneDialogOnly':True,'startPauseResume':True,'checklistAndRecordSaved':True,'draftReloadRecovered':True,'copyAndPostingEntry':True,'noPracticePolling':True,'accountSwitchCleared':True,'noOverflow':True,'pageErrors':errors})
   await context.close()
  await browser.close()
  (OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
asyncio.run(main())
