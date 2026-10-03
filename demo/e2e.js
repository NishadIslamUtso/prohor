/*
 * End-to-end drive of the mock demo: fetches /demo from the running demo server
 * (node demo/server.js), boots it in jsdom with fetch pointed at that same server,
 * and asserts the things the demo exists to show:
 *   - the page boots cleanly off the mock feed and the seat rail fills;
 *   - a stale-tab poll pulls new numbers and flashes the changed rows;
 *   - the panel's live rollover makes the app archive the semester it was reading
 *     and rebuild around the new session (saved semesters, exactly as in production);
 *   - switching back restores the first semester, still on file.
 * Run: node demo/server.js &  then  node demo/e2e.js
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = "http://localhost:8000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function get(p) {
  return new Promise((resolve, reject) => {
    http.get(BASE + p, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => resolve(b));
    }).on("error", reject);
  });
}

function fetchShim() {
  return (u) => new Promise((resolve, reject) => {
    const full = u.startsWith("http") ? u : BASE + "/" + String(u).replace(/^.\//, "");
    http.get(full, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => resolve({ ok: r.statusCode < 400, status: r.statusCode, headers: { get: () => null }, json: async () => JSON.parse(b) }));
    }).on("error", (e) => reject(new TypeError("Failed to fetch")));
  });
}

let fail = 0;
function ok(cond, label, extra) {
  console.log((cond ? "pass  " : "FAIL  ") + label + (extra !== undefined ? "  -> " + extra : ""));
  if (!cond) fail++;
}

(async function main() {
  const html = await get("/demo");
  ok(/demo-shim\.js/.test(html) && /demo-panel\.js/.test(html), "/demo serves the app with the demo scripts injected");

  const coreSrc = fs.readFileSync(path.join(__dirname, "..", "core.js"), "utf8");
  const shimSrc = fs.readFileSync(path.join(__dirname, "demo-shim.js"), "utf8");
  const panelSrc = fs.readFileSync(path.join(__dirname, "demo-panel.js"), "utf8");
  const pageHtml = html
    .replace('<script src="./core.js"></script>', "<script>" + coreSrc + "</scr" + "ipt>")
    .replace('<script src="./demo-shim.js"></script>', "<script>" + shimSrc + "</scr" + "ipt>")
    .replace('<script src="./demo-panel.js"></script>', "<script>" + panelSrc + "</scr" + "ipt>");

  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => { const m = String((e && e.message) || e); if (!/Not implemented/.test(m)) errors.push(m); });
  vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

  const dom = new JSDOM(pageHtml, {
    url: BASE + "/demo",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.fetch = fetchShim();
      w.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      if (w.HTMLDialogElement) {
        w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); this.open = true; };
        w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.open = false; };
      }
    },
  });
  const d = dom.window.document, W = dom.window;
  const txt = (sel) => { const e = d.querySelector(sel); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; };
  const click = (sel) => d.querySelector(sel).dispatchEvent(new W.MouseEvent("click", { bubbles: true, cancelable: true }));
  const waitFor = async (pred, ms, label) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (pred()) return true; } catch (e) { } await wait(60); }
    ok(false, "timeout waiting for " + label);
    return false;
  };

  // 1. boots off the mock
  await waitFor(() => txt("#livePill") && /Live|Offline/.test(txt("#livePill")), 15000, "first mock adoption");
  ok(/Live/.test(txt("#livePill")), "the demo page adopts the mock feed as live data", txt("#livePill"));
  ok(/Fall 2026/.test(txt("#semLabel")), "the semester is named from the mock session", txt("#semLabel"));
  ok(!!d.querySelector("#demoPanel"), "the demo panel is on the page");

  // 2. add a course and generate against the mock
  const set = (sel, v) => { const e = d.querySelector(sel); e.value = v; e.dispatchEvent(new W.Event("input", { bubbles: true })); };
  set("#courseSearch", "CSE221");
  await waitFor(() => d.querySelector("#courseList .option"), 5000, "course list");
  const opt = [...d.querySelectorAll("#courseList .option")].find((o) => o.dataset.code === "CSE221");
  opt.dispatchEvent(new W.MouseEvent("mousedown", { bubbles: true }));
  await wait(150);
  ok(d.querySelectorAll("#courses .course").length === 1, "a course adds from the mock catalogue");
  click("#genBtn");
  await waitFor(() => d.querySelector("#genBtn").disabled === false, 30000, "generate on the mock");
  ok(d.querySelectorAll("#resultsBody .routine").length > 0, "routines generate from the mock feed");

  // 3. the seats rail fills from the mock
  click("#seatsBtn");
  await waitFor(() => d.querySelectorAll("#railBody .srow .seat").length > 0, 6000, "seat pills");
  const seatCount = d.querySelectorAll("#railBody .srow").length;
  ok(seatCount > 20, "the seats rail is populated from the mock", seatCount + " rows");
  ok(/updated \d+ s ago/.test(txt("#seatAgo")), "the rail clock runs", txt("#seatAgo"));

  // 4. stale-tab polls: the mock mutates every request, so numbers move and rows flash.
  // Only ~1.7% of sections move per poll and the rail shows a slice of them, so give it
  // a few polls to catch a visible change (this loop is the demo's whole point).
  const pillsNow = () => [...d.querySelectorAll("#railBody .srow .seat")].map((x) => x.textContent).join("|");
  const seatPillsBefore = pillsNow();
  let moved = false;
  for (let i = 0; i < 6 && !moved; i++) {
    const realNow = Date.now;
    W.Date.now = () => realNow() + 20000 * (i + 1);
    d.dispatchEvent(new W.Event("visibilitychange"));
    await wait(60);
    W.Date.now = realNow;
    await waitFor(() => d.querySelectorAll("#railBody .srow.seat-changed").length > 0 || pillsNow() !== seatPillsBefore, 8000, "poll landing");
    await wait(250);
    moved = pillsNow() !== seatPillsBefore || d.querySelectorAll("#railBody .srow.seat-changed").length > 0;
  }
  ok(/updated \d+ s ago/.test(txt("#seatAgo")), "the polls landed and the clock runs", txt("#seatAgo"));
  ok(moved, "mock mutation is visible: seat numbers moved across polls");

  // 5. live rollover: the panel flips the CDN to Spring 2027; the app must file Autumn away
  click('[data-sem="spring27"]');
  await waitFor(() => /Spring 2027/.test(txt("#semLabel")), 15000, "rollover adoption");
  ok(/Spring 2027/.test(txt("#semLabel")), "the live rollover rebuilds the feed around the new session", txt("#semLabel"));
  const sems = JSON.parse(W.localStorage.getItem("prohor.semesters") || "{}").list || {};
  ok(sems["20263"] && sems["20263"].rows && Object.keys(sems["20263"].rows).length > 1000,
    "the previous semester was filed away automatically, with its seat counts", sems["20263"] ? Object.keys(sems["20263"].rows).length + " sections" : "missing");
  ok(/^20271$/.test(txt("#dataKv") ? (d.querySelector("#dataKv").textContent.match(/20271/) || [""])[0] : ""), "the popover names the new session");

  // the new sections only Spring carries are browsable
  set("#seatSearch", "CSE221 [61]");
  await wait(250);
  ok(d.querySelector("#railBody").textContent.includes("[61]"), "a section that only exists in the new semester is browsable", "CSE221[61]");
  set("#seatSearch", "");
  await wait(120);

  // 6. and back again: the first semester comes back from the feed, both stay on file
  click('[data-sem="autumn26"]');
  await waitFor(() => /Fall 2026/.test(txt("#semLabel")), 15000, "switch back");
  ok(/Fall 2026/.test(txt("#semLabel")), "switching back restores the first semester");
  const sems2 = JSON.parse(W.localStorage.getItem("prohor.semesters") || "{}").list || {};
  ok(sems2["20263"] && sems2["20271"], "both semesters are now on file", Object.keys(sems2).join(", "));

  ok(errors.length === 0, "no page errors through the whole demo drive", errors.slice(0, 3).join(" | "));
  try { dom.close(); } catch (e) { }
  console.log("\n" + (fail ? fail + " CHECK(S) FAILED" : "DEMO E2E PASSED"));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("E2E ERROR:", (e && e.stack) || e); process.exit(2); });
