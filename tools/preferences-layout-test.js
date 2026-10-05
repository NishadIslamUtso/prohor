/* Real-browser coverage for simplified preferences. Uses the bundled feed deterministically.
 * CHROMIUM_PATH=/path/to/chromium node tools/preferences-layout-test.js
 * URL defaults to http://localhost:8000/index.html; start a static server first.
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const URL = process.env.URL || 'http://localhost:8000/index.html';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const width of [360, 390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/connect.json', route => route.fulfill({ path: path.join(__dirname, '../snapshot.json'), contentType: 'application/json' }));
      await context.route('https://fonts.googleapis.com/**', route => route.abort());
      if (width === 1440) await context.addInitScript(() => {
        if (!localStorage.getItem('prohor.state')) localStorage.setItem('prohor.state', JSON.stringify({
          prefs: { dayMin: 4, dayMax: 5, moreChoices: true, fewerDays: true, lessTime: true, minGaps: true }
        }));
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(URL + (width === 1440 ? '?c=CSE221&d=4-5' : ''), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.querySelector('#courseSearch').disabled);
      const ensureOpen = async () => {
        if (await page.locator('#step2').evaluate(el => el.classList.contains('collapsed'))) await page.click('#prefsToggle');
      };
      await ensureOpen();
      assert.equal(await page.locator('#advancedPrefs').evaluate(el => el.open), false);
      for (const selector of ['#dayMax', '#seatPreference', '#rankingPreference']) {
        await page.locator(selector).scrollIntoViewIfNeeded();
        assert.ok(await page.locator(selector).evaluate(el => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return (hit === el || el.contains(hit)) && r.left >= 0 && r.right <= innerWidth;
        }), `${width}: ${selector} is visible and unobstructed`);
      }
      assert.equal(await page.inputValue('#seatPreference'), 'ignore');
      if (width === 1440) {
        assert.equal(await page.inputValue('#rankingPreference'), 'custom', 'legacy ranking remains visible');
        assert.equal(await page.textContent('#daysVal'), 'Up to 5 days', 'old URL minimum is ignored');
        await page.locator('#dayMax').focus();
        await page.keyboard.press('Home');
        assert.equal(await page.textContent('#daysVal'), 'Up to 1 day', 'old minimum cannot block the new maximum');
      }
      await page.selectOption('#rankingPreference', 'time');
      const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('prohor.state')).prefs);
      assert.ok(!('dayMin' in prefs) && !('moreChoices' in prefs), 'removed preferences cannot linger in saved state');
      await page.selectOption('#seatPreference', 'require');
      await page.locator('#advancedPrefs > summary').focus();
      await page.keyboard.press('Enter');
      assert.ok(await page.locator('#advancedPrefs').evaluate(el => el.open), 'Advanced opens from the keyboard');
      assert.equal(await page.locator('#dayMin, .pref-tuning, [data-pref="moreChoices"]').count(), 0);
      await page.click('[data-pref="examClash"]');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('#rankingPreference').value === 'time');
      await ensureOpen();
      assert.equal(await page.inputValue('#seatPreference'), 'require');
      assert.equal(await page.getAttribute('[data-pref="examClash"]', 'aria-checked'), 'false');
      assert.match(await page.textContent('#advancedActive'), /active/);
      await page.click('#resetPrefs');
      assert.equal(await page.inputValue('#rankingPreference'), 'balanced');
      assert.equal(await page.inputValue('#seatPreference'), 'ignore');
      assert.equal(await page.getAttribute('[data-pref="examClash"]', 'aria-checked'), 'true');
      assert.equal(await page.textContent('#advancedActive'), '');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow');
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`pass preferences at ${width}px: controls, keyboard, persistence, ranking, reset, overflow`);
    }
  } finally { await browser.close(); }
  console.log('ALL PREFERENCES LAYOUT CHECKS PASSED');
})().catch(e => { console.error(e); process.exitCode = 1; });
