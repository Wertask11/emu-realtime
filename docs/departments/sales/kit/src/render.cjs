const { chromium } = require('playwright');
const fs = require('fs');
const D = process.argv[2];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const files = fs.readdirSync(D).filter(f => /^\d\d_.*\.html$/.test(f)).sort();
  for (const f of files) {
    const p = await b.newPage({ viewport: { width: 900, height: 1200 } });
    await p.goto('file://' + D + '/' + f, { waitUntil: 'networkidle' });
    const ok = await p.evaluate(async () => {
      const t = document.body.innerText;
      for (const w of ['400','500','700','900']) await document.fonts.load(w + ' 16px "Zen Kaku Gothic New"', t);
      await document.fonts.ready;
      return document.fonts.check('700 16px "Zen Kaku Gothic New"', '学んで');
    });
    await p.waitForTimeout(300);
    const sel = (await p.$('.sheet')) ? '.sheet' : '.page';
    const over = await p.$$eval(sel, ps => ps.map(pg => { const r = pg.getBoundingClientRect(); return Math.round(Math.max(...[...pg.querySelectorAll('*')].map(e => e.getBoundingClientRect().bottom - r.top)) - r.height); }));
    const cardOver = await p.$$eval('.card', cs => cs.slice(0, 30).filter((c, i) => i % 10 === 0).map(c => { const t = c.querySelector('.t'); return Math.round(t.scrollHeight - t.clientHeight); }));
    console.log(f, 'font', ok, 'overflow(px)', over.join(','), cardOver.length ? 'cardText' + cardOver.join(',') : '');
    await p.emulateMedia({ media: 'print' });
    await p.pdf({ path: D + '/' + f.replace('.html', '.pdf'), preferCSSPageSize: true, printBackground: true });
    await p.emulateMedia({ media: 'screen' });
    const pages = await p.$$(sel);
    for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: D + '/prev_' + f.replace('.html', '') + '_' + (i + 1) + '.png' });
    await p.close();
  }
  await b.close();
})();
