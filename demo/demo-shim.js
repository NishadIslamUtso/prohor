/*
 * Demo shim — injected into /demo before the app script runs.
 * Retargets the app at the mock CDN and hands the seat worker the mock URL too
 * (the worker imports its own core.js, so the page-level override cannot reach it).
 * The chosen semester lives in localStorage under "demo.sem" — deliberately NOT a
 * "prohor" key, so the app's own reset never deletes the demo controls.
 */
(function () {
  "use strict";
  function curSem() {
    try { return localStorage.getItem("demo.sem") || "autumn26"; } catch (e) { return "autumn26"; }
  }
  function mockUrl() {
    return "./mock/connect.json?sem=" + encodeURIComponent(curSem()) + "&t=" + Date.now();
  }
  if (window.RGCore) {
    window.RGCore.DATA_URL = mockUrl();
  }
  var RealWorker = window.Worker;
  if (RealWorker) {
    window.Worker = function (url, opts) {
      var w = new RealWorker(url, opts);
      var post = w.postMessage.bind(w);
      w.postMessage = function (msg) {
        if (msg && msg.type === "fetch-seats" && !msg.url) {
          msg = Object.assign({}, msg, { url: mockUrl() });
        }
        return post(msg);
      };
      return w;
    };
    window.Worker.prototype = RealWorker.prototype;
  }
})();
