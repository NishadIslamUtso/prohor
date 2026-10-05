/* Real Chromium export acceptance. Feed is a controlled fixture; clipboard/download/canvas
 * are native in the happy path. Only the failure case deliberately denies clipboard APIs.
 * Requires the static server (URL override) and Chromium (CHROMIUM_PATH override).
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.URL || 'http://localhost:8000/index.html';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let failed = 0;
  async function scenario(name, run) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      await context.route('**/connect.json', route => route.fulfill({ path: path.join(__dirname, '../snapshot.json'), contentType: 'application/json' }));
      await context.route('https://fonts.googleapis.com/**', route => route.abort());
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await run(context, page);
      assert.deepEqual(errors, [], 'no uncaught page errors');
      console.log('PASS ' + name);
    } catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  async function boot(page) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('#courseSearch').disabled);
  }
  async function generate(page) {
    await boot(page);
    // Use actual keyboard events, rather than DOM event dispatch or direct add helpers.
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('/');
    assert.equal(await page.locator('#courseSearch').evaluate(el => document.activeElement === el), true);
    await page.fill('#courseSearch', 'CSE221');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#courses .course[data-code="CSE221"]');
    await page.click('#genBtn');
    await page.waitForSelector('.routine');
  }
  try {
    await scenario('native clipboard, isolated share round trip, real PNG download and PDF rendering', async (context, page) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
      await generate(page);
      await page.locator('.routine [data-ra="copy"]').first().click();
      await page.waitForFunction(async () => /CSE221 \[\d+\]/.test(await navigator.clipboard.readText()));
      const downloadPromise = page.waitForEvent('download');
      await page.locator('.routine [data-ra="png"]').first().click();
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /^prohor-CSE221\.png$/);
      const png = fs.readFileSync(await download.path());
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.ok(png.readUInt32BE(16) >= 1000 && png.readUInt32BE(20) >= 500, 'real raster dimensions');
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      assert.ok(pdf.length > 10000, 'nonempty browser print rendering (not visual approval)');
      await page.click('#copyLink');
      await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('?c=CSE221'));
      const link = await page.evaluate(() => navigator.clipboard.readText());
      const recipient = await browser.newContext();
      try {
        await recipient.route('**/connect.json', route => route.fulfill({ path: path.join(__dirname, '../snapshot.json'), contentType: 'application/json' }));
        const other = await recipient.newPage();
        await other.goto(link, { waitUntil: 'domcontentloaded' });
        await other.waitForSelector('#courses .course[data-code="CSE221"]');
        assert.equal(await other.locator('#courses .course').count(), 1);
        await other.click('#genBtn');
        await other.waitForSelector('.routine');
      } finally { await recipient.close(); }
      console.log(JSON.stringify({ pngBytes: png.length, pngWidth: png.readUInt32BE(16), pngHeight: png.readUInt32BE(20), pdfBytes: pdf.length }));
    });
    await scenario('blocked clipboard never reports successful copy', async (context, page) => {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Permission denied')) } });
        document.execCommand = () => false;
      });
      await generate(page);
      await page.locator('.routine [data-ra="copy"]').first().click();
      await page.waitForFunction(() => /copied|could not copy/i.test(document.querySelector('#toasts').textContent));
      const message = await page.locator('#toasts').textContent();
      assert.match(message, /could not copy/i);
      assert.doesNotMatch(message, /sections copied/i);
      assert.equal(await page.locator('textarea').count(), 0, 'fallback does not leak a textarea');
    });
    await scenario('canvas failure explains failure and restores the export button', async (context, page) => {
      await generate(page);
      await page.evaluate(() => { HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('test: canvas unavailable'); }; });
      const button = page.locator('.routine [data-ra="png"]').first();
      const before = await button.innerHTML();
      await button.click();
      await page.waitForFunction(() => /Could not render the image/.test(document.querySelector('#toasts').textContent));
      assert.equal(await button.innerHTML(), before);
      assert.equal(await button.isEnabled(), true);
    });
  } finally { await browser.close(); }
  if (failed) process.exitCode = 1;
  else console.log('ALL EXPORT ACCEPTANCE CHECKS PASSED');
})().catch(error => { console.error(error); process.exitCode = 1; });
