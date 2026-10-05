/* Regression: automatic archive expansion must not override a user's explicit collapse. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.URL || 'http://localhost:8000/index.html';
function archive(session) {
  const courses = {}, rows = {};
  for (let i = 0; i < 14; i++) {
    const code = 'CSE' + (101 + i); courses[code] = 'Archived course ' + i;
    for (const sec of ['01', '02']) rows[code + '|' + sec] = ['ANK', '', '', '', 30, 12, [2, 660, 740, 0], []];
  }
  return { schemaVersion: 1, session, label: session === '20261' ? 'Spring 2026' : 'Summer 2026', at: 1, count: 28, courses, rows };
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let failed = 0;
  try {
    for (const width of [360, 1440]) for (const standalone of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/connect.json', r => r.fulfill({ path: path.join(__dirname, '../snapshot.json'), contentType: 'application/json' }));
      await context.route('https://fonts.googleapis.com/**', r => r.abort());
      await context.route('**/data/semesters/index.json', r => r.fulfill({ json: { schemaVersion: 1, semesters: ['20261', '20262'] } }));
      await context.route(/data\/semesters\/\d{5}\.json/, r => r.fulfill({ json: archive(r.request().url().match(/(\d{5})\.json/)[1]) }));
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const label = `${width}px ${standalone ? 'seats page' : 'planner panel'}`;
      try {
        await page.goto(base + (standalone ? '?view=seats' : ''), { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !document.querySelector('#courseSearch').disabled);
        await page.waitForSelector('#semPop [data-sem="20261"]', { state: 'attached' });
        if (!standalone) await page.click('#seatsBtn');
        async function semester(sid) { await page.click('#semBtn'); await page.locator(`[data-sem="${sid}"]`).click(); }
        const header = code => page.locator(`[data-course="${code}"]`);
        async function expanded(code, value) {
          assert.equal(await header(code).getAttribute('aria-expanded'), String(value), code + ' aria-expanded');
          assert.equal(await header(code).evaluate(el => !!el.nextElementSibling?.classList.contains('sgroup')), value, code + ' actual section visibility');
        }
        await semester('20261');
        assert.equal(await page.locator('#railBody [data-course][aria-expanded="true"]').count(), 0, 'all saved courses default collapsed');
        assert.equal(await page.locator('#railBody .srow').count(), 0, 'no saved section rows rendered until requested');
        await expanded('CSE101', false);
        await expanded('CSE114', false);
        await header('CSE101').click(); await expanded('CSE101', true);
        await header('CSE101').click(); await expanded('CSE101', false);
        await header('CSE101').press('Enter'); await expanded('CSE101', true);
        assert.equal(await header('CSE101').evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Space'); await expanded('CSE101', false);
        await header('CSE114').click(); await expanded('CSE114', true);
        await header('CSE114').click(); await expanded('CSE114', false);
        await page.fill('#seatSearch', 'CSE101');
        await page.waitForFunction(() => document.querySelectorAll('#railBody [data-course]').length === 1);
        await expanded('CSE101', false);
        await page.fill('#seatSearch', '');
        await page.waitForFunction(() => document.querySelectorAll('#railBody [data-course]').length === 14);
        await expanded('CSE101', false);
        await semester('20262'); await expanded('CSE101', false);
        await page.fill('#seatSearch', 'ANK');
        await page.waitForFunction(() => /match/.test(document.querySelector('#railBody .seatbox:last-child h3').textContent));
        assert.equal(await page.locator('#railBody [data-course][aria-expanded="true"]').count(), 0, 'search does not auto-expand saved courses');
        await header('CSE101').click(); await expanded('CSE101', true);
        await page.fill('#seatSearch', '');
        await page.waitForFunction(() => !/match/.test(document.querySelector('#railBody .seatbox:last-child h3').textContent));
        await semester('20261'); await expanded('CSE101', false);
        await semester('live');
        // The live catalogue initially renders only 120 courses; CSE101 is beyond that cap.
        await page.fill('#seatSearch', 'CSE101');
        await page.waitForFunction(() => document.querySelectorAll('#railBody [data-course]').length === 1);
        await expanded('CSE101', false);
        await header('CSE101').click(); await expanded('CSE101', true);
        await header('CSE101').click(); await expanded('CSE101', false);
        await semester('20261'); await expanded('CSE101', false);
        assert.deepEqual(errors, []);
        console.log('PASS archive collapse, reopen, Enter/Space focus, collapsed defaults, filters, semester isolation and live control: ' + label);
      } catch (e) { failed++; console.error('FAIL ' + label + '\n' + e.stack); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  if (failed) process.exitCode = 1;
  else console.log('ALL ARCHIVE FOLD CHECKS PASSED');
})().catch(e => { console.error(e); process.exitCode = 1; });
