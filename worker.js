/*
 * Search worker: runs the routine enumeration off the main thread so the page
 * stays interactive. It only ever handles slim candidates (numbers + strings),
 * and answers with compact {ci, score} descriptors — the main thread renders.
 */
(function () {
  "use strict";
  // In a real worker core.js is loaded relatively; the Node harness pre-loads it on self.
  if (typeof importScripts === "function") importScripts("./core.js");
  var C = self.RGCore || (typeof require === "function" ? require("./core.js") : null);
  var en = null;

  function post(msg, transfer) {
    if (transfer) self.postMessage(msg, transfer); else self.postMessage(msg);
  }

  self.onmessage = async function (ev) {
    var m = ev.data || {};
    try {
      if (m.type === "init") {
        en = C.createEnumerator(m.rows, m.prefs || {});
        post({ type: "ready", space: en.space, rowCodes: en.rowCodes, stats: en.stats, N: en.N });
        return;
      }
      if (m.type === "more") {
        if (!en) { post({ type: "error", message: "not initialised" }); return; }
        var t0 = Date.now();
        var r = en.next({ want: m.want || 50, budgetMs: m.budgetMs || 0, sort: m.sort !== false });
        var transfer = [];
        var items = r.items.map(function (it) {
          // ci is transferable-ish: copy into a fresh Int32Array per item
          var ci = new Int32Array(it.ci);
          transfer.push(ci.buffer);
          return {
            ci: ci, days: it.days, gaps: it.gaps, span: it.span, early: it.early,
            alt: it.alt, score: it.score
          };
        });
        post({
          type: "batch", items: items, done: r.done, scanned: r.scanned, tried: r.tried,
          valid: r.valid, space: r.space, stats: en.stats, ms: Date.now() - t0
        }, transfer);
        return;
      }
      if (m.type === "ping") { post({ type: "pong" }); return; }
      // Seat rail: this worker instance only fetches + trims, so seat polling can never
      // queue behind (or interleave with) an enumeration running in the search worker.
      if (m.type === "fetch-seats") {
        try {
          var res = await fetch(m.url || C.DATA_URL, { cache: "no-cache" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          var raw = await res.json();
          post({ type: "seats", at: Date.now(), rows: C.seatRows(raw) });
        } catch (seatErr) {
          // the page's seat worker instance listens for "seats-error": a plain "error" is a
          // search-protocol message its handler ignores, so without this a dead CDN would
          // never surface, never back off, and the panel would keep claiming stale is fresh
          post({ type: "seats-error", message: String((seatErr && seatErr.message) || seatErr) });
        }
        return;
      }
    } catch (e) {
      post({ type: "error", message: String((e && e.message) || e) });
    }
  };
})();
