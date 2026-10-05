/* UI contract checks in Chromium; no pixel-perfect or WCAG-wide claim. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.URL || 'http://localhost:8000/index.html';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let failures = 0;
  async function run(name, fn, viewport = { width: 1440, height: 900 }) {
    const context = await browser.newContext({ viewport });
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
  } finally { await browser.close(); }
  if (failures) process.exitCode = 1;
  else console.log('ALL UI CONTRACT CHECKS PASSED');
})().catch(e => { console.error(e); process.exitCode = 1; });
