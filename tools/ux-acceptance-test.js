/* UI contract checks in Chromium; no pixel-perfect or WCAG-wide claim. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.URL || 'http://localhost:8000/index.html';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let failures = 0;
  async function run(name, fn, viewport = { width: 1440, height: 900 }, contextOptions = {}) {
    const context = await browser.newContext({ viewport, ...contextOptions });
    await context.route('**/connect.json', r => r.fulfill({ path: path.join(__dirname, '../snapshot.json'), contentType: 'application/json' }));
    await context.route('https://fonts.googleapis.com/**', r => r.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try { await fn(page); assert.deepEqual(errors, []); console.log('PASS ' + name); }
    catch (e) { failures++; console.error('FAIL ' + name + '\n' + e.stack); }
    finally { await context.close(); }
  }
  async function ready(page, query = '') {
    await page.goto(base + query, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('#courseSearch').disabled);
  }
  try {
    await run('help dialog has an accessible name and restores focus on Escape', async page => {
      await ready(page);
      await page.locator('#howBtn').focus(); await page.keyboard.press('Enter');
      assert.equal(await page.getByRole('dialog', { name: 'How Prohor works' }).count(), 1);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#howBtn').evaluate(el => el === document.activeElement), true);
    });
    await run('reset copy describes local data only; repository collection survives reset', async page => {
      await ready(page);
      await page.waitForSelector('#semPop [data-sem="20263"]', { state: 'attached' });
      await page.click('#resetBtn');
      const message = await page.locator('#resetDlg').textContent();
      assert.match(message, /repository.*(not|unaffected)|not.*repository/i);
      assert.doesNotMatch(message, /pinned seats, saved semesters/);
      await page.click('#resetConfirm');
      await page.waitForFunction(() => /saved item/.test(document.querySelector('#toasts').textContent));
      assert.equal(await page.locator('#semPop [data-sem="20263"]').count(), 1);
    });
    await run('full-course error points to the existing seat preference control', async page => {
      const fixture = require('../snapshot.json');
      await page.context().route('**/connect.json', r => r.fulfill({ json: { ...fixture, sections: fixture.sections.map(s => ({ ...s, cap: 1, used: 1 })) } }));
      await ready(page);
      await page.fill('#courseSearch', 'CSE221'); await page.locator('#courseList .option').first().click();
      await page.selectOption('#seatPreference', 'require'); await page.click('#genBtn');
      await page.waitForFunction(() => /every section is full/.test(document.querySelector('#resultsBody').textContent));
      assert.match(await page.locator('#resultsBody').textContent(), /Ignore seat availability/);
      assert.doesNotMatch(await page.locator('#resultsBody').textContent(), /Only sections with seats/);
    });
    await run('long invalid-link warning fits a 320px screen', async page => {
      await ready(page, '?c=' + encodeURIComponent('invalid-' + 'X'.repeat(240)));
      await page.waitForSelector('.toast');
      assert.ok(await page.locator('.toast').last().evaluate(el => {
        const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth;
      }), 'toast stays inside viewport');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'warning does not create horizontal page overflow');
    }, { width: 320, height: 568 });
    await run('picker Escape restores its trigger; help remains reachable at 200% CSS zoom', async page => {
      await ready(page);
      await page.fill('#courseSearch', 'CSE221'); await page.locator('#courseList .option').first().click();
      const trigger = page.locator('[data-act="open-sec"]').first();
      await trigger.focus(); await page.keyboard.press('Enter');
      await page.waitForSelector('.ms'); await page.keyboard.press('Escape');
      assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
      // CSS zoom is a reflow stress probe, not a claim of testing browser toolbar zoom.
      await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
      await page.click('#howBtn'); await page.locator('#howClose').click();
      assert.equal(await page.locator('#howDlg').isVisible(), false);
    });
    // The footer About link is the only route to about.html from the planner. Clicks are real navigations,
    // so these checks would fail if the link were covered, mis-pointed, or made inert.
    async function generatePair(page) {
      await page.fill('#courseSearch', 'CSE221'); await page.locator('#courseList .option').first().click();
      await page.fill('#courseSearch', 'MAT216'); await page.locator('#courseList .option').first().click();
      await page.click('#genBtn');
      await page.waitForSelector('#resultsBody .routine', { timeout: 15000 });
    }
    async function aboutLinkCoveredBy(page) {
      return page.locator('footer a[href="./about.html"]').evaluate(a => {
        const r = a.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el && (el === a || a.contains(el)) ? null : (el ? el.tagName : 'off-screen');
      });
    }
    await run('footer About link opens about.html by mouse click and by keyboard Enter', async page => {
      await ready(page);
      await page.locator('footer a[href="./about.html"]').click();
      await page.waitForURL(/\/about\.html$/, { timeout: 8000 });
      assert.match(await page.locator('h1').textContent(), /BRACU routine planner/);
      await page.goBack();
      await page.waitForFunction(() => !document.querySelector('#courseSearch').disabled);
      await page.locator('footer a[href="./about.html"]').focus();
      await page.keyboard.press('Enter');
      await page.waitForURL(/\/about\.html$/, { timeout: 8000 });
    });
    await run('footer About link is the element under the pointer after routines are generated (desktop)', async page => {
      await ready(page);
      await generatePair(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      assert.equal(await aboutLinkCoveredBy(page), null, 'nothing covers the About link at the bottom of the page');
      await page.locator('footer a[href="./about.html"]').click();
      await page.waitForURL(/\/about\.html$/, { timeout: 8000 });
    });
    await run('footer About link is tappable on a phone after routines are generated', async page => {
      await ready(page);
      await generatePair(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      assert.equal(await aboutLinkCoveredBy(page), null, 'the fixed action bar does not cover the About link at the bottom of the page');
      await page.locator('footer a[href="./about.html"]').tap();
      await page.waitForURL(/\/about\.html$/, { timeout: 8000 });
    }, { width: 360, height: 800 }, { hasTouch: true, isMobile: true });
    await run('About page links back to the planner', async page => {
      await page.goto(new URL('about.html', base).href, { waitUntil: 'domcontentloaded' });
      await page.locator('main a[href="./"]').first().click();
      await page.waitForURL(url => !/\/about\.html$/.test(url.pathname), { timeout: 8000 });
      await page.waitForFunction(() => !document.querySelector('#courseSearch').disabled);
    });
  } finally { await browser.close(); }
  if (failures) process.exitCode = 1;
  else console.log('ALL UI CONTRACT CHECKS PASSED');
})().catch(e => { console.error(e); process.exitCode = 1; });
