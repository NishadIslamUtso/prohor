const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

/*
 * Browser harness for Prohor: boots index.html in jsdom against the real feed shape, drives the
 * UI the way a person would (combobox → course cards → popovers → generate → paging → swap → PNG)
 * and asserts on the rendered DOM.
 *   npm i jsdom
 *   node tools/browser-test.js
 */

const root = path.resolve(__dirname, "..");
const livePath = [path.resolve(root, "..", "connect.json"), path.join(root, "connect.json")].find((p) => fs.existsSync(p));
const liveRaw = process.env.SNAPSHOT_ONLY || !livePath ? null : JSON.parse(fs.readFileSync(livePath, "utf8"));
const snapshotFull = JSON.parse(fs.readFileSync(path.join(root, "snapshot.json"), "utf8"));
// A trimmed but faithful fixture: every section of the courses the UI is tested against, plus one
// section of every other course so the catalogue breadth (534 courses, alphabetical order, the
// 120-row cap) is still exercised — jsdom spends its time parsing, not the app.
const KEEP = new Set(["CSE221", "MAT216", "CSE320", "CSE250", "CSE101", "ACT201", "CHN101", "PHY111", "ENG102", "ANT101", "CSE230", "CSE420"]);
const seenCode = new Set();
const trimmed = (snapshotFull.sections || []).filter((x) => KEEP.has(x.c) ? true : (seenCode.has(x.c) ? false : (seenCode.add(x.c), true)));
const snapshotRaw = Object.assign({}, snapshotFull, { sections: trimmed, meta: Object.assign({}, snapshotFull.meta, { count: trimmed.length }) });
console.log("fixture sections:", trimmed.length, "of", (snapshotFull.sections || []).length, "· courses:", seenCode.size + KEEP.size);
const namesRaw = JSON.parse(fs.readFileSync(path.join(root, "faculty-names.json"), "utf8"));
const htmlSrc = fs.readFileSync(path.join(root, "index.html"), "utf8");
const cssSrc = htmlSrc.slice(htmlSrc.indexOf("<style>"), htmlSrc.indexOf("</style>"));
// derive every count from the fixture itself so a refreshed feed never breaks the suite
const Core0 = require(path.join(root, "core.js"));
const fixture = Core0.buildIndex(liveRaw ? Core0.fromApi(liveRaw) : snapshotRaw.sections);
const F = {
  sections: fixture.count, courses: fixture.codes.length, patterns: fixture.groupCount, exams: fixture.examsKnown,
  CSE221: (() => { const K = fixture.courses.CSE221; return { sections: K.sections.length, patterns: K.groups.length, faculties: K.faculties.length }; })(),
  MAT216: (() => { const K = fixture.courses.MAT216; return { sections: K.sections.length, patterns: K.groups.length }; })()
};
console.log(`fixture: ${F.sections} sections · ${F.courses} courses · ${F.patterns} patterns · ${F.exams} with exam slots`);
const coreSrc = fs.readFileSync(path.join(root, "core.js"), "utf8");
console.log(liveRaw ? "feed under test: " + livePath : "feed under test: snapshot.json only");

const virtualConsole = new VirtualConsole();
const errors = [];
const IGNORED = /not implemented: window'?s?[\s.]*scrollto|could not parse css/i;   // jsdom gaps, not app faults
virtualConsole.on("jsdomError", (e) => { const m = "jsdomError: " + String((e && (e.detail || e.message)) || e); if (!IGNORED.test(m)) errors.push(m); });
virtualConsole.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

let fail = 0;
const DEADLINE = Date.now() + Number(process.env.BT_DEADLINE || 420) * 1000;
// clamp every internal wait to the remaining budget so a slow machine yields a clean report
// instead of being killed mid-run with no summary
function budget(ms) { return Math.max(1500, Math.min(ms || 8000, DEADLINE - Date.now() - 4000)); }
function log(line) { try { fs.writeSync(1, line + "\n"); } catch (e) { console.log(line); } }
function ok(cond, label, extra) {
  if (!cond) { fail++; log("FAIL  " + label + (extra !== undefined ? "  -> " + extra : "")); }
  else log("pass  " + label + (extra !== undefined ? "  -> " + extra : ""));
  if (Date.now() > DEADLINE) { log("\nDEADLINE EXCEEDED just after: " + label); process.exit(3); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = (d, sel) => { const e = typeof sel === "string" ? d.querySelector(sel) : sel; return e ? e.textContent.replace(/\s+/g, " ").trim() : null; };

function ankPatCount() { return 0; }
const liveWindows = [];
function reapWindows(keep) {
  while (liveWindows.length > keep) {
    const old = liveWindows.shift();
    try { if (old && old.window) old.window.close(); } catch (e) { }
  }
}
function boot(opts) {
  opts = opts || {};
  reapWindows(3);
  const calls = { live: 0, snapshot: 0, names: 0 };
  const paint = { texts: [], rects: 0, strokes: 0, arcs: 0, fills: [], strokes2: [] };
  const dom = new JSDOM(htmlSrc.replace('<script src="./core.js"></script>', "<script>" + coreSrc + "</scr" + "ipt>"), {
    url: opts.url || "https://routine.test/", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      if (opts.deviceMemory !== undefined) Object.defineProperty(window.navigator, "deviceMemory", { value: opts.deviceMemory, configurable: true });
      if (opts.cores) Object.defineProperty(window.navigator, "hardwareConcurrency", { value: opts.cores, configurable: true });
      window.matchMedia = (q) => ({ matches: !!opts.mobile && /max-width:\s*700px/.test(String(q)), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      try { Object.defineProperty(window, "innerWidth", { value: opts.width || 1280, configurable: true, writable: true }); } catch (e) { }
      try { Object.defineProperty(window, "innerHeight", { value: 900, configurable: true, writable: true }); } catch (e) { }
      window.Element.prototype.scrollIntoView = function () {};
      window.print = function () { window.__printed = (window.__printed || 0) + 1; };
      window.HTMLAnchorElement.prototype.click = function () { (window.__downloads = window.__downloads || []).push({ href: this.href, name: this.download }); };
      window.document.execCommand = function () { const t = window.document.querySelector("textarea"); if (t) window.__copied = t.value; return true; };
      window.HTMLCanvasElement.prototype.getContext = function () {
        return {
          canvas: this, scale() {}, fillRect() { paint.rects++; }, strokeRect() { paint.strokes++; },
          beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, fill() {},
          arc() { paint.arcs++; }, stroke() { paint.strokes++; }, line() {},
          fillText(t) { paint.texts.push(String(t)); }, measureText(s) { return { width: String(s).length * 6 }; },
          set fillStyle(v) { paint.fills.push(v); }, get fillStyle() { return "#000"; },
          set strokeStyle(v) { paint.strokes2.push(v); }, set lineWidth(v) {}, set font(v) {}, set textBaseline(v) {}
        };
      };
      window.HTMLCanvasElement.prototype.toDataURL = function () { return "data:image/png;base64,AAAA"; };
      window.fetch = async function (u) {
        const url = String(u);
        if (url.includes("connect.json")) {
          calls.live++;
          if (opts.liveFails) throw new TypeError("Failed to fetch (offline)");
          if (opts.tinyLive) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ sections: snapshotRaw.sections.slice(0, 3) }) };
          if (opts.slowLive) await wait(opts.slowLive);
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => (liveRaw || snapshotRaw) };
        }
        if (url.includes("snapshot.json")) { calls.snapshot++; if (opts.snapshotFails) throw new Error("offline"); return { ok: true, status: 200, headers: { get: () => null }, json: async () => snapshotRaw }; }
        if (url.includes("faculty-names.json")) { calls.names++; return { ok: true, status: 200, headers: { get: () => null }, json: async () => namesRaw }; }
        return { ok: false, status: 404, json: async () => { throw new Error("404"); }, headers: { get: () => null } };
      };
      if (opts.seedCache) window.localStorage.setItem("prohor-cache:feed", JSON.stringify({ at: Date.now() - (opts.cacheAge || 60000), sections: snapshotRaw.sections }));
      if (opts.seedState) window.localStorage.setItem("prohor.state", JSON.stringify(opts.seedState));
      if (opts.seedResults) window.localStorage.setItem("prohor-cache:results", JSON.stringify(opts.seedResults));
      if (opts.seedSemesters) window.localStorage.setItem("prohor.semesters", JSON.stringify({ list: opts.seedSemesters }));
    }
  });
  const d = dom.window.document, W = dom.window;
  const A = {
    dom, d, W, calls, paint,
    mouse(elOrSel, type, xy) {
      const e = typeof elOrSel === "string" ? d.querySelector(elOrSel) : elOrSel;
      if (!e) throw new Error("no element for " + elOrSel);
      e.dispatchEvent(new W.MouseEvent(type || "click", Object.assign({ bubbles: true, cancelable: true }, xy || {})));
      return e;
    },
    click(s) { return A.mouse(s, "click"); },
    down(s) { return A.mouse(s, "mousedown"); },
    key(el, k, init) {
      const e = typeof el === "string" ? d.querySelector(el) : el;
      e.dispatchEvent(new W.KeyboardEvent("keydown", Object.assign({ key: k, bubbles: true, cancelable: true }, init || {})));
    },
    set(sel, value, type) {
      const e = typeof sel === "string" ? d.querySelector(sel) : sel;
      if (!e) throw new Error("no element for " + sel);
      e.value = value;
      e.dispatchEvent(new W.Event(type || "input", { bubbles: true }));
      return e;
    },
    txt(sel) { return txt(d, sel); },
    q(sel) { return d.querySelector(sel); },
    qa(sel) { return Array.prototype.slice.call(d.querySelectorAll(sel)); },
    card(i) { return d.querySelectorAll("#courses .course")[i]; },
    cards() { return A.qa("#resultsBody .routine"); },
    async ready(ms) {
      const t0 = Date.now();
      const cap = budget(ms || 12000);
      while (Date.now() - t0 < cap) { if (A.q("#livePill").getAttribute("data-state") !== "busy") return true; await wait(50); }
      return false;
    },
    async waitFor(pred, ms, label) {
      const t0 = Date.now();
      const cap = budget(ms);
      while (Date.now() - t0 < cap) { try { if (pred()) return true; } catch (e) { } await wait(60); }
      if (label) ok(false, "timeout waiting for " + label);
      return false;
    },
    async add(code) {
      A.set("#courseSearch", code);
      await A.waitFor(() => A.q("#courseList .option"), 4000, "course list for " + code);
      const o = A.qa("#courseList .option").find((x) => x.dataset.code === code);
      if (!o) throw new Error("no option for " + code);
      A.down(o);
      await wait(60);
    },
    async openMs(i, kind) {
      const card = A.card(i);
      if (!card) throw new Error("no course card " + i);
      A.click(card.querySelector('[data-act="open-' + kind + '"]'));
      await A.waitFor(() => card.querySelector(".ms"), 3000, "ms popover");
      return card.querySelector(".ms");
    },
    async check(scope, idx) {
      const box = scope.querySelectorAll(".ms-row input")[idx || 0];
      box.checked = !(box.checked);
      box.dispatchEvent(new W.Event("change", { bubbles: true }));
      await wait(40);
      return box;
    },
    async done(scope) { A.click(scope.querySelector('[data-ms="done"]')); await wait(60); },
    async gen(ms) {
      A.click("#genBtn");
      await A.waitFor(() => A.q("#genBtn").disabled === false, budget(ms || 30000), "search to settle");
      await wait(120);
    },
    wait: (ms) => wait(ms),
    parse(sel) { const m = /Showing ([\d,]+)–([\d,]+) of ([\d,]+)/.exec(A.txt(sel ? "#pager" : "#pager") || ""); return m ? m.map(x => +x.replace(/,/g, "")) : null; }
  };
  liveWindows.push(dom);
  return A;
}


(async () => {
  const A = boot({});
  await A.ready();
  await A.add("CSE221"); await A.add("MAT216"); await A.add("CSE320"); await A.add("CSE250");
  await A.gen();
  const before = A.cards().length;
  console.log("pager:", A.txt("#pager").replace(/\s+/g, " ").trim());
  A.click('[data-pg="more"]');
  await A.wait(3000);
  console.log("after +more: cards", before, "->", A.cards().length, "| pager:", A.txt("#pager").replace(/\s+/g," ").trim());
  console.log("--- EXAM TABLE (order) ---");
  [...A.qa("#resultsBody .routine")[0].querySelectorAll("table.exam tbody tr")].forEach((r) => {
    console.log("  " + [...r.querySelectorAll("td")].map((x) => x.textContent.replace(/\s+/g," ").trim()).join(" | "));
  });
  console.log("caption:", A.q("table.exam caption").className, "|", A.q("table.exam caption").textContent);
  console.log("--- STEP1 step-desc count:", A.qa("#step1 .step-desc").length);
  console.log("--- HOW DLG ---");
  console.log(A.q("#howDlg").textContent.replace(/\s+/g, " ").trim().slice(0, 400));
  try { A.dom.window.close(); } catch (e) {}
})();
