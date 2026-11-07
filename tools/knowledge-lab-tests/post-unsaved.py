"""LAB-03（11/7）：経験知の入力画面で、保存していない内容を確認なしで失わない。
隔離エミュレーターの fixture（node tools/knowledge-lab-tests/fixture.cjs、port 4200）だけを使う。本番へは送らない。"""
from playwright.sync_api import sync_playwright
import os
BASE = 'http://127.0.0.1:4200'
CHROME = os.environ.get('LAB_CHROMIUM', '/usr/bin/chromium')

def login(page, role='alice'):
    page.goto(BASE + '/test/lab-shell.html', wait_until='domcontentloaded')
    page.locator('#role').select_option(role)
    with page.expect_response(lambda r: r.url.endswith('/api/knowledge-lab/me') and r.status == 200):
        page.locator('#signin').click()
    frame = page.frame_locator('#lab')
    frame.locator('html[data-lab-ready="true"]').wait_for(timeout=30000)
    close = frame.locator('#rk-tour .rk-close')
    if close.count() and close.is_visible():
        close.click()
    return frame

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    for width in (390, 1280):
        page = browser.new_page(viewport={'width': width, 'height': 844})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        prompts = []
        answer = {'accept': False}
        def on_dialog(d):
            prompts.append(d.message)
            d.accept() if answer['accept'] else d.dismiss()
        page.on('dialog', on_dialog)
        f = login(page)
        dlg = f.locator('#editorDialog')
        # 何も書いていなければ、確認なしで閉じる
        f.locator('#library [data-compose]').first.click()
        assert dlg.evaluate('d=>d.open')
        f.locator('#editorDialog [data-close]').click()
        assert not dlg.evaluate('d=>d.open') and prompts == [], (width, prompts)
        # P2-1：保存ボタンの文字が公開範囲に合わせて変わる（既定は下書き＝公開しない）
        f.locator('#library [data-compose]').first.click()
        assert f.locator('#postSubmit').inner_text() == '下書きに保存（公開しない）', f.locator('#postSubmit').inner_text()
        f.locator('#postVisibility').select_option('public')
        assert f.locator('#postSubmit').inner_text() == '公開する'
        f.locator('#postVisibility').select_option('private')
        assert f.locator('#postSubmit').inner_text() == '自分用として保存'
        f.locator('#postVisibility').select_option('draft')
        f.locator('#editorDialog [data-close]').click()
        assert prompts == [], ('公開範囲を戻しただけで確認が出た', prompts)
        # 書きかけで × → 確認が出る。「キャンセル」で戻ると、内容が残っている
        f.locator('#library [data-compose]').first.click()
        f.locator('#postTitle').fill('検証：書きかけの経験知')
        f.locator('#postBody').fill('閉じても消えないことを確かめる本文です。')
        f.locator('#editorDialog [data-close]').click()
        assert len(prompts) == 1 and '保存していない経験知' in prompts[0], prompts
        assert dlg.evaluate('d=>d.open'), 'キャンセルしたのに閉じた'
        assert f.locator('#postTitle').input_value() == '検証：書きかけの経験知'
        # Esc でも同じ確認
        f.locator('#postBody').press('Escape')
        assert len(prompts) == 2, prompts
        assert dlg.evaluate('d=>d.open'), 'Esc で確認なしに閉じた'
        # 「OK」で破棄すると閉じる
        answer['accept'] = True
        f.locator('#editorDialog [data-close]').click()
        assert not dlg.evaluate('d=>d.open')
        # アカウントが変わったときは、確認なしで前の人の入力を捨てる
        answer['accept'] = False
        f.locator('#library [data-compose]').first.click()
        f.locator('#postTitle').fill('前の人の書きかけ')
        n = len(prompts)
        page.frame_locator('#lab').locator('body').evaluate('()=>window.EmuLabUnsaved.discard()')
        assert len(prompts) == n and not dlg.evaluate('d=>d.open')
        f.locator('#library [data-compose]').first.click()
        assert f.locator('#postTitle').input_value() == '', '前の人の入力が残った'
        assert errors == [], errors
        print('PASS', width)
        page.close()
    browser.close()
