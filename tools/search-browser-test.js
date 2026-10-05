/* Real worker -> main-thread fallback -> reload -> repeated restored pagination. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/connect.json', route => route.fulfill({ path: path.join(__dirname, '../snapshot.json'), contentType: 'application/json' }));
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    await context.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        postMessage(message, ...args) {
          if (message.type === 'init') this.isSearch = true;
          if (this.isSearch && message.type === 'more') {
            this.batches = (this.batches || 0) + 1;
            if (this.batches === 2) {
              this.terminate();
              queueMicrotask(() => this.dispatchEvent(new ErrorEvent('error', { message: 'test interruption' })));
              return;
            }
          }
          return super.postMessage(message, ...args);
        }
      };
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.URL || 'http://localhost:8000/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('#courseSearch').disabled);
    for (const code of ['CSE221', 'MAT216']) {
      await page.fill('#courseSearch', code);
      await page.locator('#courseList .option').first().click();
    }
    const saved = () => page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('prohor-cache', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const req = db.transaction('kv').objectStore('kv').get('results');
        req.onerror = () => { db.close(); reject(req.error); };
        req.onsuccess = () => { db.close(); resolve(req.result); };
      };
    }));
    const waitTotal = async total => {
      await page.waitForFunction(n => {
        const pager = document.querySelector('#pager .txt');
        return pager && new RegExp('of ' + n + '$').test(pager.textContent.trim());
      }, total);
      // The render precedes the asynchronous IndexedDB transaction.
      await page.waitForFunction(async n => new Promise(resolve => {
        const open = indexedDB.open('prohor-cache', 1);
        open.onsuccess = () => {
          const db = open.result, r = db.transaction('kv').objectStore('kv').get('results');
          r.onsuccess = () => { db.close(); resolve(r.result && r.result.items.length === n); };
        };
      }), total);
    };
    await page.click('#genBtn'); await waitTotal(50);
    const first = await saved();
    await page.click('[data-pg="more"]'); await waitTotal(100);
    const recovered = await saved();
    assert.deepEqual(recovered.items.slice(0, 50).map(it => it.ci), first.items.map(it => it.ci));
    assert.equal(new Set(recovered.items.map(it => it.ci.join(','))).size, 100);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitTotal(100);
    assert.match(await page.textContent('#resultsDesc'), /kept on this device/);
    for (const total of [150, 200]) {
      await page.click('[data-pg="more"]'); await waitTotal(total);
      const result = await saved();
      assert.equal(new Set(result.items.map(it => it.ci.join(','))).size, total);
      assert.deepEqual(result.items.slice(0, 100).map(it => it.ci), recovered.items.map(it => it.ci));
    }
    assert.deepEqual(errors, []);
    console.log('SEARCH RECOVERY BROWSER CHECKS PASSED (real worker, failure, reload, repeated pagination)');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
