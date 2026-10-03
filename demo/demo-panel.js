/*
 * Demo control panel — injected into /demo only. A small floating card that flips the
 * mock CDN between two semesters the way the real CDN flips between terms: the next
 * fetch simply serves a different session, and the app itself notices, archives the
 * semester it was reading (a saved semester appears in the seats panel's selector) and
 * rebuilds around the new one. No reload, no app changes — the panel only retargets
 * RGCore.DATA_URL and then wakes the app's own "user came back to a stale tab" refresh
 * (nudge the page's clock past the 10-minute window, fire visibilitychange).
 */
(function () {
  "use strict";
  var sem = "autumn26";
  try { sem = localStorage.getItem("demo.sem") || "autumn26"; } catch (e) { }

  var box = document.createElement("div");
  box.setAttribute("id", "demoPanel");
  box.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:9999;background:#111830;color:#EDEFFA;" +
    "border:1px solid #3A4266;border-radius:12px;padding:10px 12px;font:12.5px/1.45 system-ui,sans-serif;" +
    "max-width:300px;box-shadow:0 8px 30px rgba(0,0,0,.35)";
  box.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
    '<span style="background:#E8A317;color:#111830;font-weight:700;border-radius:5px;padding:1px 7px;font-size:11px">MOCK</span>' +
    '<b style="font-size:13px">Demo feed</b>' +
    '<button id="demoHide" title="Fold the demo panel away" style="margin-left:auto;background:none;border:0;color:#9AA3C7;cursor:pointer;font-size:14px">–</button></div>' +
    '<div id="demoBody">' +
    '<div style="margin-bottom:6px">Seat numbers drift and faculty names change <b>on every poll</b> (~30 s with the seats panel open, ~60 s in a background tab). Watch the rail flash and re-rank.</div>' +
    '<div style="display:flex;gap:6px;margin:8px 0">' +
    '<button data-sem="autumn26" style="flex:1;cursor:pointer;border-radius:8px;border:1px solid #3A4266;background:#1B2140;color:#EDEFFA;padding:6px 4px;font-size:12px">Autumn 2026<br><span style="opacity:.65;font-size:11px">in progress</span></button>' +
    '<button data-sem="spring27" style="flex:1;cursor:pointer;border-radius:8px;border:1px solid #3A4266;background:#1B2140;color:#EDEFFA;padding:6px 4px;font-size:12px">Spring 2027<br><span style="opacity:.65;font-size:11px">pre-advising</span></button></div>' +
    '<div style="opacity:.75;font-size:11.5px">Switching is a <b>live rollover</b>, like the real CDN changing terms: the current semester is filed away as a saved semester (see the selector in the seats panel) and the feed rebuilds around the new one.</div>' +
    "</div>";
  document.body.appendChild(box);

  function paint() {
    box.querySelectorAll("[data-sem]").forEach(function (b) {
      var on = b.getAttribute("data-sem") === sem;
      b.style.background = on ? "#E8A317" : "#1B2140";
      b.style.color = on ? "#111830" : "#EDEFFA";
      b.style.fontWeight = on ? "700" : "400";
    });
  }

  function mockUrl() {
    return "./mock/connect.json?sem=" + encodeURIComponent(sem) + "&t=" + Date.now();
  }

  // wake the app's own refresh: pretend the tab went stale while the user was away.
  // The planner refresh only fires once its data is older than the 10-minute window,
  // so borrow the page's clock for the duration of the synchronous dispatch.
  function wakeApp(ms) {
    var realNow = Date.now;
    Date.now = function () { return realNow() + ms; };
    try { document.dispatchEvent(new Event("visibilitychange")); } catch (e) { }
    Date.now = realNow;
  }

  box.addEventListener("click", function (e) {
    if (e.target && e.target.id === "demoHide") {
      var body = box.querySelector("#demoBody");
      body.style.display = body.style.display === "none" ? "" : "none";
      return;
    }
    var b = e.target.closest ? e.target.closest("[data-sem]") : null;
    if (!b) return;
    var next = b.getAttribute("data-sem");
    if (next === sem) return;
    sem = next;
    try { localStorage.setItem("demo.sem", sem); } catch (err) { }
    paint();
    if (window.RGCore) window.RGCore.DATA_URL = mockUrl();     // the next poll serves the new term
    wakeApp(11 * 60 * 1000 + 1000);                            // planner data is now "11 min old"
  });
  paint();
})();
