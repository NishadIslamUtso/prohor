/* Deadline tests for the shared JSON fetcher; no external network requests. */
const assert = require('node:assert/strict');
const C = require('../core.js');
const originalFetch = global.fetch;
const originalAbort = global.AbortController;
(async () => {
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ ready: true }) });
    assert.deepEqual(await C.fetchJson('/ok', {}, 100), { ready: true });
    global.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(C.fetchJson('/http', {}, 100), /HTTP 503/);
    global.fetch = () => { throw new Error('synchronous fetch failure'); };
    await assert.rejects(C.fetchJson('/sync', {}, 100), /synchronous fetch failure/);
    global.fetch = async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } });
    await assert.rejects(C.fetchJson('/json', {}, 100), /invalid JSON/);

    let signal;
    global.fetch = (_, opts) => { signal = opts.signal; return new Promise(() => {}); };
    await assert.rejects(C.fetchJson('/stalled-headers', {}, 20), /timed out/);
    assert.ok(signal.aborted, 'timeout also cancels the underlying request');

    let finishBody;
    global.fetch = async () => ({ ok: true, json: () => new Promise(resolve => { finishBody = resolve; }) });
    await assert.rejects(C.fetchJson('/stalled-body', {}, 20), /timed out/);
    finishBody({ stale: true });
    global.fetch = async () => ({ ok: true, json: async () => ({ fresh: true }) });
    assert.deepEqual(await C.fetchJson('/retry', {}, 100), { fresh: true });

    global.AbortController = undefined;
    global.fetch = () => new Promise(() => {});
    await assert.rejects(C.fetchJson('/no-abort-support', {}, 20), /timed out/);
    console.log('ALL NETWORK DEADLINE CHECKS PASSED');
  } finally {
    global.fetch = originalFetch;
    global.AbortController = originalAbort;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
