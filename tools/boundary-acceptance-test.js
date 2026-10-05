/* Real-browser cap, archive rollover, and storage-failure acceptance with controlled data. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fixture = require('../snapshot.json');
const base = process.env.URL || 'http://localhost:8000/index.html';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let failed = 0;
  async function run(name, test) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let session = 20263;
    await context.route('**/connect.json', route => route.fulfill({ json: fixture.sections.map(s => ({ ...s, sid: session })) }));
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await test(context, page, sid => { session = sid; });
      assert.deepEqual(errors, []);
      console.log('PASS ' + name);
    } catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); }
    finally { await context.close(); }
  }
  async function ready(page) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('#courseSearch').disabled);
  }
  try {
    await run('49 → 50 pins; 51st refused; unpin then replace; reload preserves 50', async (context, page) => {
      const seen = new Set();
      const pins = fixture.sections.filter(s => s.c !== 'CSE221' && !seen.has(s.c + '|' + s.sec) && seen.add(s.c + '|' + s.sec)).slice(0, 49).map(s => ({ code: s.c, sec: s.sec }));
      await context.addInitScript(pins => {
        if (!localStorage.getItem('prohor.state')) localStorage.setItem('prohor.state', JSON.stringify({ pins, courses: [{ code: 'CSE221' }] }));
      }, pins);
      await ready(page);
      await page.click('#seatsBtn');
      const pin = sec => page.locator(`[data-pin="CSE221|${sec}"]`).first();
      await pin('01').click();
      const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('prohor.state')).pins);
      assert.equal((await saved()).length, 50);
      await pin('02').click();
      assert.equal((await saved()).length, 50);
      assert.ok(!(await saved()).some(p => p.code === 'CSE221' && p.sec === '02'));
      assert.match(await page.locator('#toasts').textContent(), /50 sections at most/);
      await pin('01').click();
      assert.equal((await saved()).length, 49);
      await pin('02').click();
      assert.equal((await saved()).length, 50);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#railBody .pinned .srow');
      assert.equal(await page.locator('#railBody .pinned .srow').count(), 50);
      assert.ok((await saved()).some(p => p.code === 'CSE221' && p.sec === '02'));
    });
    await run('eight repository semesters load without browser-owned history', async (context, page) => {
      const ids = ['20231', '20232', '20233', '20241', '20242', '20243', '20251', '20252'];
      await context.route('**/data/semesters/index.json', route => route.fulfill({ json: { schemaVersion: 1, semesters: ids } }));
      await context.route(/data\/semesters\/\d{5}\.json/, route => {
        const session = route.request().url().match(/(\d{5})\.json/)[1];
        return route.fulfill({ json: { session, label: session, at: 1, count: 1, courses: { CSE221: 'ALGORITHMS' }, rows: { 'CSE221|01': ['ANK', '', '', '', 30, 12, [], []] } } });
      });
      await ready(page);
      await page.click('#seatsBtn'); await page.click('#semBtn');
      await page.waitForFunction(() => document.querySelectorAll('#semPop [data-sem]').length === 9);
      assert.equal(await page.locator('#semPop [data-sem="20231"]').count(), 1);
      assert.equal(await page.evaluate(() => localStorage.getItem('prohor.semesters')), null);
      assert.equal(await page.evaluate(() => localStorage.getItem('prohor.facmem')), null);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelectorAll('#semPop [data-sem]').length === 9);
    });
    await run('unavailable repository history reports failure without blocking planning', async (context, page) => {
      await context.route('**/data/semesters/index.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
      await ready(page);
      await page.fill('#courseSearch', 'CSE221');
      await page.locator('#courseList .option').first().click();
      await page.click('#genBtn'); await page.waitForSelector('.routine');
      await page.click('#seatsBtn'); await page.click('#semBtn');
      assert.match(await page.locator('#semPop').textContent(), /Repository collection unavailable/);
    });
    await run('denied localStorage and IndexedDB still allow in-memory planning', async (context, page) => {
      await context.addInitScript(() => {
        for (const key of ['localStorage', 'indexedDB']) Object.defineProperty(window, key, { configurable: true, get() { throw new DOMException('Test: storage denied', 'SecurityError'); } });
      });
      await ready(page);
      await page.fill('#courseSearch', 'CSE221');
      await page.locator('#courseList .option').first().click();
      await page.click('#genBtn');
      await page.waitForSelector('.routine');
      assert.ok(await page.locator('.routine').count() > 0);
    });
  } finally { await browser.close(); }
  if (failed) process.exitCode = 1;
  else console.log('ALL BOUNDARY ACCEPTANCE CHECKS PASSED');
})().catch(e => { console.error(e); process.exitCode = 1; });
