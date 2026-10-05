/* Additional fault/boundary probes, independent of the broad happy-path suite.
 * All CDN responses are fixtures. Fault injection is intentional, not real disk exhaustion.
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.URL || 'http://localhost:8000/index.html';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let failures = 0;
  async function test(name, fn, viewport = { width: 1440, height: 900 }) {
    const context = await browser.newContext({ viewport });
    await context.route('**/connect.json', r => r.fulfill({ path: path.join(__dirname, '../snapshot.json'), contentType: 'application/json' }));
    await context.route('https://fonts.googleapis.com/**', r => r.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await fn(context, page);
      assert.deepEqual(errors, [], 'no uncaught page errors');
      console.log('PASS ' + name);
    } catch (e) { failures++; console.error('FAIL ' + name + '\n' + e.stack); }
    finally { await context.close(); }
  }
  async function ready(page, query = '') {
    await page.goto(base + query, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('#courseSearch').disabled, null, { timeout: 4500 });
  }
  async function generate(page) {
    await page.fill('#courseSearch', 'CSE221');
    await page.locator('#courseList .option').first().click();
    await page.click('#genBtn'); await page.waitForSelector('.routine');
  }
  try {
    for (const mode of ['open', 'read']) await test('stalled IndexedDB ' + mode + ' cannot block planning', async (context, page) => {
      await context.addInitScript(mode => {
        if (mode === 'open') indexedDB.open = () => ({});
        else IDBObjectStore.prototype.get = () => ({});
      }, mode);
      await ready(page); await generate(page);
    });
    await test('quota errors in both stores permit in-memory generation and reset', async (context, page) => {
      await context.addInitScript(() => {
        Storage.prototype.setItem = () => { throw new DOMException('test quota', 'QuotaExceededError'); };
        IDBObjectStore.prototype.put = () => { throw new DOMException('test quota', 'QuotaExceededError'); };
      });
      await ready(page); await generate(page);
      await page.click('#resetBtn'); await page.click('#resetConfirm');
      await page.waitForFunction(() => document.querySelectorAll('#courses .course').length === 0);
      await generate(page);
    });
    await test('malformed share constraints cannot escape valid ranges or execute markup', async (context, page) => {
      const q = new URLSearchParams({ c: 'CSE221,CSE221,<img src=x onerror=alert(1)>', pv: '2', rank: '999', seats: 'bogus', exams: 'bogus', d: '1-999', t: '-1.99.0', y: '-1.7.2' });
      await ready(page, '?' + q);
      assert.equal(await page.locator('#courses .course').count(), 1);
      const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('prohor.state')).prefs);
      assert.equal(prefs.dayMax, 6);
      assert.equal(prefs.onlyOpen, false);
      assert.equal(prefs.examClash, true);
      assert.deepEqual(prefs.avoidTime, [0]); assert.deepEqual(prefs.avoidDay, [2]);
      assert.equal(await page.locator('#courses img').count(), 0);
    });
    await test('large bounded share link caps selected courses and stays usable', async (context, page) => {
      await ready(page, '?c=' + Array(200).fill('CSE221').join(',') + '&pv=2');
      assert.equal(await page.locator('#courses .course').count(), 1);
      await page.click('#genBtn'); await page.waitForSelector('.routine');
    });
    await test('six-course main-thread search stays operable with 4x CPU throttling', async (context, page) => {
      await context.addInitScript(() => { window.Worker = undefined; });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await ready(page);
      for (const code of ['CSE221', 'CSE250', 'CSE320', 'MAT216', 'CSE101', 'PHY111']) {
        await page.fill('#courseSearch', code); await page.locator('#courseList .option').first().click();
      }
      await page.click('#genBtn');
      await page.waitForSelector('.routine', { timeout: 15000 });
      const before = await page.locator('html').getAttribute('data-theme');
      await page.click('#themeBtn', { timeout: 3000 });
      assert.notEqual(await page.locator('html').getAttribute('data-theme'), before);
      await page.click('#resetBtn', { timeout: 3000 }); await page.click('#resetConfirm');
      await page.waitForFunction(() => document.querySelectorAll('#courses .course').length === 0);
      await generate(page);
    });
    await test('clipboard fallback returns keyboard focus to its button', async (context, page) => {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
        document.execCommand = () => false;
      });
      await ready(page); await generate(page);
      const button = page.locator('.routine [data-ra="copy"]').first();
      await button.focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => /Could not copy/.test(document.querySelector('#toasts').textContent));
      assert.equal(await button.evaluate(el => document.activeElement === el), true, 'focus must not be lost to body after temporary textarea removal');
    });
    for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }, { width: 1024, height: 600 }]) {
      await test(`preferences and generated results remain reachable at ${viewport.width}x${viewport.height}`, async (context, page) => {
        await ready(page);
        if (await page.locator('#step2').evaluate(el => el.classList.contains('collapsed'))) await page.click('#prefsToggle');
        for (const selector of ['#dayMax', '#seatPreference', '#rankingPreference']) {
          const el = page.locator(selector); await el.scrollIntoViewIfNeeded();
          assert.ok(await el.evaluate(el => {
            const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return r.left >= 0 && r.right <= innerWidth && (hit === el || el.contains(hit));
          }), selector + ' must be reachable');
        }
        await generate(page);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page-wide horizontal overflow');
        const copy = page.locator('.routine [data-ra="copy"]').first();
        await copy.click();
        await page.click('#seatsBtn');
        await page.locator('#seatNow').click();
        assert.ok(await page.locator('#seatsBtn').isVisible());
        await page.click('#seatsBtn');
        assert.equal(await page.locator('#seatsLayer').isVisible(), false, 'can return to full planner');
      }, viewport);
    }
  } finally { await browser.close(); }
  if (failures) process.exitCode = 1;
  else console.log('ALL EXTREME ACCEPTANCE CHECKS PASSED');
})().catch(e => { console.error(e); process.exitCode = 1; });
