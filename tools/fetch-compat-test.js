/* Fetch regression coverage across cached/deployed script versions.
 * Requires the static server used by test:layout. All feed responses are controlled fixtures.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const old = file => execFileSync('git', ['show', `76cbbf697cdfe56176297b0c7d3a9651374a1025:${file}`], { cwd: root });
const cases = [
  { name: 'current scripts, live feed' },
  { name: 'old core with current page/worker', oldCore: true },
  { name: 'old worker with current page/core', oldWorker: true },
  { name: 'old core and worker with current page', oldCore: true, oldWorker: true },
  { name: 'old core, failed live feed, snapshot recovery', oldCore: true, offline: true }
];
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let failed = 0;
  try {
    for (const test of cases) {
      const context = await browser.newContext();
      const errors = [], requests = { live: 0, snapshot: 0 };
      try {
        await context.route('https://fonts.googleapis.com/**', route => route.abort());
        if (test.oldCore) await context.route(/\/core\.js(?:\?.*)?$/, route => route.fulfill({ body: old('core.js'), contentType: 'text/javascript' }));
        if (test.oldWorker) await context.route(/\/worker\.js(?:\?.*)?$/, route => route.fulfill({ body: old('worker.js'), contentType: 'text/javascript' }));
        await context.route('**/connect.json', route => {
          requests.live++;
          return test.offline ? route.abort('failed') : route.fulfill({ path: path.join(root, 'snapshot.json'), contentType: 'application/json' });
        });
        const page = await context.newPage();
        page.on('pageerror', e => errors.push(e.message));
        page.on('request', r => { if (r.url().includes('snapshot.json')) requests.snapshot++; });
        await page.goto(process.env.URL || 'http://localhost:8000/index.html', { waitUntil: 'domcontentloaded' });
        let ready = false;
        try {
          await page.waitForFunction(offline => {
            const enabled = !document.querySelector('#courseSearch').disabled;
            const seat = document.querySelector('#seatAgo').textContent;
            return enabled && (offline ? /retry/.test(seat) : /updated/.test(seat));
          }, !!test.offline, { timeout: 3500 });
          ready = true;
        } catch (_) {}
        const badge = await page.textContent('#livePill');
        const seat = await page.textContent('#seatAgo');
        const correctSource = test.offline ? /Offline copy/.test(badge) && requests.snapshot > 0 : /Live/.test(badge) && !/Offline/.test(badge);
        const pass = ready && correctSource && requests.live > 0 && errors.length === 0;
        if (!pass) failed++;
        console.log(JSON.stringify({ test: test.name, pass, requests, badge, seat, errors }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  if (failed) { console.error(`${failed} FETCH COMPATIBILITY CHECK(S) FAILED`); process.exitCode = 1; }
  else console.log('ALL FETCH COMPATIBILITY CHECKS PASSED');
})().catch(error => { console.error(error); process.exitCode = 1; });
