/* Search instances enumerate compact candidates; seat instances fetch counts independently.
 * Rendering and request scheduling belong to the page. */
(function () {
  "use strict";
  // In a real worker core.js is loaded relatively; the Node harness pre-loads it on self.
  if (typeof importScripts === "function") importScripts("./core.js?v=20261005-fetch-compat");
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
          // Transfer a copy; the enumerator retains ownership of its descriptor indices.
          var ci = new Int32Array(it.ci);
          transfer.push(ci.buffer);
          return {
            ci: ci, days: it.days, gaps: it.gaps, span: it.span, early: it.early, earliest: it.earliest, latest: it.latest,
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
      if (m.type === "fetch-seats") {
        try {
          var raw;
          if (typeof C.fetchJson === "function") raw = await C.fetchJson(m.url || C.DATA_URL, { cache: "no-cache" });
          else {
            // Match the page's native-fetch fallback during a mixed-version deployment.
            var response = await fetch(m.url || C.DATA_URL, { cache: "no-cache" });
            if (!response.ok) throw new Error("HTTP " + response.status);
            raw = await response.json();
          }
          post({ type: "seats", requestId: m.requestId, at: Date.now(), rows: C.seatRows(raw) });
        } catch (seatErr) {
          // Seat handlers require seats-error; error is reserved for the search protocol.
          post({ type: "seats-error", requestId: m.requestId, message: String((seatErr && seatErr.message) || seatErr) });
        }
        return;
      }
    } catch (e) {
      post({ type: "error", message: String((e && e.message) || e) });
    }
  };
})();
