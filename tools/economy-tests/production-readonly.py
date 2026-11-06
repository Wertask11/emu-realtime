"""Opt-in production read-only evidence. No login, transactions or Firebase writes."""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright
ORIGIN = os.environ.get('ECONOMY_PUBLIC_ORIGIN', 'https://schoolpark-emu.vercel.app')
if ORIGIN not in ['https://schoolpark-emu.vercel.app', 'https://emu-for-schoolpark.vercel.app']:
    raise RuntimeError('EXPLICIT_PRODUCTION_ORIGIN_ONLY')
OUT = Path(os.environ.get('ECONOMY_EVIDENCE', '/tmp/emuer-production-readonly'))
OUT.mkdir(parents=True, exist_ok=True)
async def main():
    async with async_playwright() as p:
        proxy = {'server': os.environ['HTTPS_PROXY']} if os.environ.get('HTTPS_PROXY') else None
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', proxy=proxy,
            args=['--no-sandbox', '--disable-dev-shm-usage'])
        records = []
        for width in [375, 390, 412, 768, 1280, 1440, 1920]:
            context = await browser.new_context(viewport={'width': width, 'height': 900})
            blocked, errors = [], []
            async def guard(route):
                r = route.request
                allowed = r.url.startswith(ORIGIN + '/economy/') or r.url == ORIGIN + '/api/economy/status'
                if r.method == 'GET' and allowed:
                    return await route.continue_()
                if r.url == ORIGIN + '/favicon.ico':
                    return await route.fulfill(status=204)
                blocked.append({'method': r.method, 'url': r.url.split('?')[0]})
                await route.abort()
            await context.route('**/*', guard)
            page = await context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            response = await page.goto(ORIGIN + '/economy/index.html')
            assert response.status == 200
            await page.locator('#availability').filter(has_text='有料受付は停止中').wait_for()
            assert await page.locator('#quoteButton').is_disabled()
            assert await page.locator('#spendable').inner_text() == '—'
            assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
            if width in [390, 1280]:
                await page.screenshot(path=str(OUT / f'production-{width}.png'), full_page=True)
            records.append({'width': width, 'paidIntake': False, 'balance': 'login_required',
                'overflow': False, 'consoleErrors': errors[:], 'blockedRequests': blocked[:]})
            assert not errors, errors
            assert not blocked, blocked
            await context.close()
        await browser.close()
        (OUT / 'production-browser.json').write_text(json.dumps({'origin': ORIGIN,
            'scope': 'logged-out common screen only; no production writes', 'matrix': records}, ensure_ascii=False, indent=2))
asyncio.run(main())
