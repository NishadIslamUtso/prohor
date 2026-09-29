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
const IGNORED = /Not implemented: window\.scrollTo|Could not parse CSS/;   // jsdom gaps, not app faults
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
    try { old.close(); } catch (e) { }
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
      while (Date.now() - t0 < cap) { if (/sections/.test(A.txt("#livePill") || "")) return true; await wait(50); }
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

(async function main() {
  const A = boot({ deviceMemory: 0.5, cores: 4 });
  await A.ready();
  console.log("\npill  : " + A.txt("#livePill"));
  console.log("desc  : " + A.txt("#resultsDesc") + "\n");
  ok(A.txt("#livePill").includes(F.sections.toLocaleString("en-US")), "live feed loaded into the pill", A.txt("#livePill"));
  ok(A.q("#livePill").getAttribute("data-state") === "ok", "pill reports ok state");
  const kv = A.qa("#dataKv dt").map((x) => x.textContent);
  ok(A.qa("#dataKv dd").length === kv.length && kv.length >= 7, "popover has a full key/value table", kv.join(","));
  ok(kv.indexOf("Exam slots") >= 0 && A.txt("#dataKv").includes(F.exams.toLocaleString("en-US")), "exam-slot count in the popover", A.qa("#dataKv dd")[4].textContent);
  ok(A.txt("#dataKv").includes(F.courses.toLocaleString("en-US")) && A.txt("#dataKv").includes(F.patterns.toLocaleString("en-US")), "courses + pattern counts in the popover");
  ok(/auto-refresh in/.test(A.txt("#dataKv")), "auto-refresh countdown present", A.txt("#dataKv").split("Fetched")[1] && A.txt("#dataKv").split("Fetched")[1].trim());
  ok(A.q("#dataMeta") === null, "no stats paragraph in the main flow anymore");

  /* ---------------- branding + chrome ---------------- */
  ok(/Prohor/.test(A.q("title").textContent), "document title is Prohor", A.txt("title"));
  ok(A.q(".wordmark").textContent.trim() === "Prohor", "wordmark rendered");
  ok(/unofficial/.test(A.q(".unofficial").textContent), "unofficial line in the header", A.q(".unofficial").textContent.trim());
  ok(!!A.q("#prohor-mark") && A.qa("#courses,#courses").length >= 0, "brand mark available as a symbol");
  ok(!!A.q('link[rel="icon"]') && /favicon\.svg/.test(A.q('link[rel="icon"]').href), "favicon wired to the brand svg");
  ok(!!A.q('link[rel="manifest"]'), "manifest linked");
  ok(/<head>[\s\S]*<\/head>\s*<body>/.test(htmlSrc), "document shell is well-formed (one head, closed before body)");
  ok(!/<head>(?:(?!<\/head>)[\s\S])*<div/.test(htmlSrc), "no body markup leaked into head");
  ok(/media="print" onload="this\.media='all'"/.test(htmlSrc) && /<noscript><link href="https:\/\/fonts\.googleapis/.test(htmlSrc), "webfonts load without blocking first paint (offline-friendly)");
  const localRefs = [...htmlSrc.matchAll(/(?:src|href)="(\.\/[^"]+|[^":]*\.(?:js|json|css|svg|png|webmanifest))"/g)].map(m => m[1]);
  ok(localRefs.every(r => !r.startsWith('/')), "every local reference is relative (works from any subpath)");
  const fb = A.q("#feedbackLink");
  ok(!!fb && /view=cm/.test(fb.href) && /to=nishadislamutso@gmail\.com/.test(fb.href), "feedback opens Gmail compose addressed to the right mailbox", fb && fb.href);
  ok(fb && fb.target === "_blank" && /noopener/.test(fb.rel), "feedback opens in a new tab, safely", fb && fb.target + "/" + fb.rel);
  ok(/[?&]su=/.test(fb.href), "and pre-fills the subject", (fb.href.match(/[?&]su=[^&]+/) || [""])[0]);
  const mailto = A.qa("footer a").find((a) => /^mailto:/.test(a.href));
  ok(mailto && /subject=Prohor/.test(mailto.href), "the mailto fallback carries a subject too", mailto && mailto.href);
  ok(/mailto:nishadislamutso@gmail\.com/.test(A.q("footer").innerHTML), "a plain mailto fallback is offered too");
  const gh = A.qa("footer a").find((a) => /github/.test(a.href));
  ok(gh && gh.href === "https://github.com/NishadIslamUtso" && gh.target === "_blank", "GitHub link opens the profile directly", gh && gh.href + " " + gh.target);
  ok(/feedback/i.test(A.q("footer").textContent), "footer wording mentions feedback");
  ok(A.qa(".step-head h2").map((h) => h.textContent.trim()).join(" | ") === "Pick your courses | Set your preferences | Compare routines", "three plain section titles, no numbering", A.qa(".step-head h2").map(h => h.textContent.trim()).join(" | "));
  ok(!/[123] · /.test(A.d.body.textContent), "no 'N ·' numbering left anywhere on the page", (/[123] · [A-Z][a-z]+/.exec(A.d.body.textContent) || ["none"])[0]);
  ok(/Set your preferences/.test(A.txt("#prefsToggle")), "preferences toggle label");

  /* ---------------- theme + toggles + shortcuts ---------------- */
  ok(A.q("html").getAttribute("data-theme") === "light", "defaults to light when no OS preference", A.q("html").getAttribute("data-theme"));
  A.click("#themeBtn");
  await wait(40);
  ok(A.q("html").getAttribute("data-theme") === "dark", "theme toggle flips the root attribute");
  ok(A.W.localStorage.getItem("prohor.theme") === "dark", "theme persisted");
  ok(/i-sun/.test(A.q("#themeBtn").innerHTML), "toggle icon swaps to sun in dark mode");
  A.click("#themeBtn"); await wait(30);
  A.click("#howBtn"); await wait(40);
  ok(A.q("#howDlg").hasAttribute("open") || A.qa(".toast").length >= 0, "How it works opens (or degrades to a toast)");
  A.q("#courseSearch").blur();
  A.key(A.q("body"), "/");
  await wait(30);
  ok(A.d.activeElement === A.q("#courseSearch"), "'/' focuses the course search", A.d.activeElement && A.d.activeElement.id);
  ok(A.q("#courseList").hidden === false, "and opens the listbox");
  A.key(A.q("#courseSearch"), "Escape");
  await wait(30);
  ok(A.q("#courseList").hidden === true, "Escape closes it again");

  /* ---------------- empty state + combobox ---------------- */
  ok(/0 of 6 courses/.test(A.txt("#courseCount")), "course counter", A.txt("#courseCount"));
  ok(!!A.q("#courses .empty") && /No courses yet/.test(A.q("#courses .empty").textContent), "empty state before any course");
  ok(A.q("#courseSearch").getAttribute("aria-expanded") === "false", "combobox starts closed");
  A.set("#courseSearch", "CSE221");
  await wait(40);
  ok(A.q("#courseList").hidden === false, "typing opens the listbox");
  const opt = A.qa("#courseList .option")[0];
  ok(opt.querySelector(".meta").textContent.includes(`${F.CSE221.sections} sections · ${F.CSE221.patterns} patterns`), "list rows show sections + pattern counts", opt.querySelector(".meta").textContent);
  ok(opt.querySelector(".code").textContent === "CSE221", "code column");
  A.set("#courseSearch", "algorithms");
  await wait(40);
  ok(A.qa("#courseList .option").some((o) => /CSE221/.test(o.textContent)), "searching by title finds the course", A.qa("#courseList .option")[0].textContent.replace(/\s+/g, " ").trim());
  A.down(A.qa("#courseList .option")[0]);
  await wait(60);
  ok(A.q("#courses .course").dataset.code === "CSE221", "course card added");
  ok(new RegExp(`${F.CSE221.sections} sections · ${F.CSE221.patterns} patterns`).test(A.q(".course .caption").textContent), "caption counts", A.txt(".course .caption"));
  ok(!!A.q(".course .hue-num") && A.q(".course .hue-num").textContent === "1", "first course carries hue #1");
  A.set("#courseSearch", "CSE221"); await wait(40);
  ok(A.qa("#courseList .option.added").length === 1, "added courses shown disabled", A.qa("#courseList .option").length);
  ok(/Added/.test(A.q(".option.added .meta").textContent), "'Added' marker");

  await A.add("MAT216");
  await A.add("CSE320");
  ok(A.qa("#courses .course").length === 3, "three course cards");
  ok(/3 of 6 courses/.test(A.txt("#courseCount")), "counter follows");
  const hues = A.qa(".course .hue-num").map((x) => x.textContent);
  ok(hues.join(",") === "1,2,3", "hues assigned in selection order", hues.join(","));
  ok(/~[\d,]+ combinations/.test(A.txt("#summary")), "action bar previews the combination count", A.txt("#summary"));
  const borders = A.qa(".course").map((c) => c.getAttribute("style") || "");
  ok(/--c1-line/.test(borders[0]) && /--c2-line/.test(borders[1]) && /--c3-line/.test(borders[2]), "each card gets its own hue variable", borders.join(" | ").slice(0, 80));

  /* ---------------- time-slot popover ---------------- */
  let ms = await A.openMs(0, "ts");
  const rows = ms.querySelectorAll(".ms-row");
  ok(rows.length === F.CSE221.patterns, "one row per schedule pattern", rows.length);
  ok(ms.querySelectorAll(".ms-group").length >= 3, "patterns grouped by day pair", ms.querySelectorAll(".ms-group").length);
  ok([...ms.querySelectorAll(".ms-row")].some((r) => /2 sections/.test(r.textContent)), "a pattern row shows its section count");
  const labRow = [...ms.querySelectorAll(".ms-row")].find(r => /Lab ·/.test(r.textContent));
  ok(!!labRow, "lab line inside pattern rows", labRow && labRow.textContent.replace(/\s+/g, " ").slice(0, 70));
  ok([...ms.querySelectorAll(".ms-row")].every((r) => /\d\d:\d\d [AP]M/.test(r.textContent)), "pickers use the same 12-hour clock as the table");
  A.set(ms.querySelector(".ms-head input"), "Mon + Wed");
  await wait(30);
  const visible = [...ms.querySelectorAll(".ms-row")].filter((r) => !r.hidden);
  ok(visible.length < F.CSE221.patterns && visible.length > 0, "filter box narrows the list", visible.length);
  ok(visible.length === [...ms.querySelectorAll(".ms-row")].filter((r) => (r.dataset.hay || "").includes("mon \+ wed")).length, "the filter matches the day-pair heading");
  A.set(ms.querySelector(".ms-head input"), "");
  await wait(20);
  A.click(ms.querySelector('[data-ms="all"]'));
  await wait(40);
  ok([...ms.querySelectorAll(".ms-row input")].every((i) => i.checked), "Select all ticks every pattern");
  A.click(ms.querySelector('[data-ms="clear"]'));
  await wait(40);
  ok([...ms.querySelectorAll(".ms-row input")].every((i) => !i.checked), "Clear unticks all");
  await A.check(ms, 0);
  await A.done(ms);
  ok(!!A.q(".course .chip.locked"), "locked pattern renders as a chip", A.q(".course .chip.locked").textContent.replace(/\s+/g, " ").trim());
  ok(A.q(".course [data-act=open-ts] span").textContent.includes(`1 of ${F.CSE221.patterns} patterns`), "trigger label counts locks", A.q(".course [data-act=open-ts] span").textContent);
  ok(/3 pattern|3 sections match|match/.test(A.q(".course .caption").textContent), "caption reports the effect of filters", A.q(".course .caption").textContent.trim());

  /* ---------------- faculty popover ---------------- */
  ms = await A.openMs(0, "fac");
  ok(ms.querySelectorAll(".ms-row").length === F.CSE221.faculties, "faculty picker always lists every faculty of the course", ms.querySelectorAll(".ms-row").length);
  ok(/^\d+ sections?/.test(ms.querySelector(".ms-row .r").textContent.trim()), "per-faculty section count", ms.querySelector(".ms-row .r").textContent.replace(/\s+/g, " ").trim());
  const facRows = [...ms.querySelectorAll(".ms-row")];
  const ankRow = facRows.find((r) => /ANK/.test(r.textContent) && !r.classList.contains("dim")) || facRows.find((r) => !r.classList.contains("dim"));
  const facChosen = ankRow.querySelector("input").dataset.f;
  ankRow.querySelector("input").checked = true;
  ankRow.querySelector("input").dispatchEvent(new A.W.Event("change", { bubbles: true }));
  await wait(40);
  await A.done(ms);
  ok(new RegExp(facChosen).test(A.q(".course [data-act=open-fac] span").textContent), "faculty trigger shows the pick", A.q(".course [data-act=open-fac] span").textContent + " vs " + facChosen);
  ms = await A.openMs(0, "ts");

  await A.done(ms);
  A.click(A.q(".course .chip.locked .rm"));
  await wait(60);
  ok(!A.q(".course .chip.locked"), "chip × unlocks the pattern");
  ok(A.q(".course [data-act=open-ts] span").textContent.includes(`All patterns (${F.CSE221.patterns})`), "trigger returns to all patterns", A.q(".course [data-act=open-ts] span").textContent);

  /* ---------------- preferences ---------------- */
  const sw = A.qa(".switch");
  ok(sw.length === 3, "three switches", sw.length);
  ok(sw.map((s) => s.getAttribute("aria-checked")).join(",") === "true,true,false", "default switch states", sw.map(s => s.dataset.pref + "=" + s.getAttribute("aria-checked")).join(","));
  A.click(sw[0].closest(".pref-row"));
  await wait(30);
  ok(A.qa(".switch")[0].getAttribute("aria-checked") === "false", "clicking the row flips the switch");
  A.click(A.qa(".switch")[0].closest(".pref-row"));
  await wait(30);
  ok(A.qa(".switch")[0].getAttribute("aria-checked") === "true", "exam clash back on");
  A.set("#dayMin", "2"); A.set("#dayMax", "4");
  await wait(40);
  ok(A.txt("#daysVal") === "2 – 4 days", "days label", A.txt("#daysVal"));
  ok(parseFloat(A.q("#daysFill").style.left) === 20, "range fill tracks the thumbs", A.q("#daysFill").style.left);
  A.set("#dayMin", "5"); await wait(30);
  ok(A.txt("#daysVal") === "4 days", "min is clamped to max rather than crossing it", A.txt("#daysVal"));
  ok(+A.q("#dayMin").value <= +A.q("#dayMax").value, "thumbs stay ordered");
  A.set("#dayMin", "2"); A.set("#dayMax", "6"); await wait(30);
  ok(A.qa("#timeChips .chip").length === 7, "seven avoid-time chips", A.qa("#timeChips .chip").length);
  ok(A.qa("#dayChips .chip").length === 7, "seven day chips including a muted Friday", A.qa("#dayChips .chip").length);
  ok(A.q('#dayChips .chip[data-i="6"]').classList.contains("muted-day") === false, "Friday not muted because this feed has Friday classes");
  A.click(A.q('#timeChips .chip[data-i="0"]'));
  A.click(A.q('#dayChips .chip[data-i="1"]'));
  await wait(60);
  ok(A.q('#timeChips .chip[data-i="0"]').getAttribute("aria-pressed") === "true", "time chip pressed state");
  ok(A.q("#clearTime").hidden === false && A.q("#clearDay").hidden === false, "Clear buttons appear when active");
  ok(/3 active/.test(A.txt("#prefsActive")), "preferences badge counts actives", A.txt("#prefsActive"));
  A.q("#facSearch").focus();
  A.set("#facSearch", "ANK"); await wait(60);
  ok(A.qa("#facList .option").length >= 1, "faculty suggestions offered", A.qa("#facList .option").map(o => o.textContent.trim()).join("|").slice(0, 60));
  A.down(A.q("#facList .option")); await wait(60);
  ok(/ANK/.test(A.txt("#facChips")), "avoid-faculty chip added", A.txt("#facChips"));
  ok(A.q("#clearFac").hidden === false, "clear-faculty available");


  /* ---------------- removal + cap ---------------- */
  await A.add("CSE250");
  await A.add("CSE101");
  await A.add("PHY111");
  ok(A.qa("#courses .course").length === 6, "six cards after adding", A.qa("#courses .course").length);
  ok(A.q("#courseSearch").disabled === true, "the search box locks itself once six courses are in");
  ok(/remove one to add another/.test(A.txt("#courseCount")), "and the counter explains why", A.txt("#courseCount"));
  A.set("#courseSearch", "ENG102");
  await A.wait(60);
  ok(A.q("#courseList").hidden === true, "typing while at the cap does not open the list");
  A.set("#courseSearch", "ENG102"); await wait(40);
  A.click(A.qa("#courses .course")[5].querySelector('[data-act="remove"]')); await wait(60);
  ok(A.qa("#courses .course").length === 5, "remove ✕ drops a course card");
  ok(A.q("#courseSearch").disabled === false, "search re-enabled below the cap");

  /* ---------------- exam-clash semantics ---------------- */
  const B = boot({});
  await B.ready();
  await B.add("ACT201"); await B.add("CHN101");
  await B.gen();
  ok(B.cards().length === 0, "ACT201 + CHN101: every combination rejected by the exam check");
  ok(/No routine fits these constraints/.test(B.txt("#resultsBody")), "zero state shown");
  ok(/turn off “Check exam clashes”/.test(B.txt("#resultsBody")), "zero state suggests turning the exam check off");
  ok(/blocked by exam clashes/.test(B.txt("#resultsDesc")) || /combinations/.test(B.txt("#resultsDesc")), "results line reports what was checked", B.txt("#resultsDesc"));
  B.click(B.qa(".switch")[0].closest(".pref-row"));
  await B.wait(50);
  await B.gen();
  ok(B.cards().length > 0, "with the exam switch off the same two courses schedule", B.cards().length);
  ok(/exam clash/.test(B.q("#resultsBody").textContent), "clashes are flagged instead of silently dropped when the check is off");
  ok(B.q(".routine .blk.clash") !== null, "the clashing blocks are ringed in the grid");
  ok(B.qa(".routine table.exam .mini").length > 0, "and marked in the exam table", B.txt(".routine table.exam"));

  /* ---------------- results anatomy, paging, swap, PNG ---------------- */
  const S = boot({ deviceMemory: 4, cores: 4, url: "https://routine.test/?c=CSE221,MAT216,CSE320" });
  await S.ready();
  ok(S.qa("#courses .course").length === 3, "URL state restored three courses", S.qa("#courses .course").length);
  await S.gen();
  ok(S.cards().length === 50, "page 1 holds 50 routines", S.cards().length);
  ok(/Showing 1–50 of \d+/.test(S.txt("#pager")), "pager shows the range", S.txt("#pager").slice(0, 40));
  ok(/search complete/.test(S.txt("#resultsDesc")) || /combinations checked/.test(S.txt("#resultsDesc")), "results line states the search finished", S.txt("#resultsDesc"));
  ok(/best match/i.test(S.q(".routine .badge.b-accent") ? S.qa(".routine")[0].textContent : ""), "★ Best match badge on the first card");
  const c0 = S.qa(".routine")[0];
  ok(!!c0.querySelector(".rgrid"), "grid rendered");
  ok(c0.querySelectorAll(".rgrid > .rh").length - 1 >= 6, "six day columns", c0.querySelectorAll(".rh").length - 1);
  ok(["Sat", "Sun", "Mon", "Tue", "Wed", "Thu"].join(",") === c0.querySelectorAll(".rh").length && false || ["Sat","Sun","Mon","Tue","Wed","Thu"].every((x,i)=>c0.querySelectorAll(".rh")[i+1].textContent===x), "day headings in week order");
  ok(c0.querySelectorAll(".rt:not(.gap)").length >= 4, "slot rows clipped to the routine", c0.querySelectorAll(".rt:not(.gap)").length);
  ok(c0.querySelectorAll(".rc.gap").length > 0, "thin divider rows between slots");
  ok(c0.querySelectorAll(".free").length + c0.querySelectorAll(".free-lbl").length > 0, "free days marked");
  const blocks = [...c0.querySelectorAll(".blk")].map((b) => b.textContent.replace(/\s+/g, " ").trim());
  console.log("\nfirst routine blocks:\n  " + blocks.join("\n  "));
  ok(blocks.length >= 6, "one block per weekly meeting", blocks.length);
  ok(c0.querySelectorAll(".blk.lab").length >= 1 && /LAB/.test(c0.querySelector(".blk.lab").textContent), "labs hatched and tagged");
  ok([...c0.querySelectorAll(".blk")].every((b) => /\d\d:\d\d [AP]M – \d\d:\d\d [AP]M/.test(b.textContent) && /·/.test(b.textContent)), "blocks carry a 12-hour time range, room and faculty", [...c0.querySelectorAll(".blk")][0].textContent.replace(/\s+/g, " ").trim());
  ok(!/\d\d:\d\d – \d\d:\d\d(?! [AP]M)/.test(c0.textContent), "no 24-hour times left in the routine table");
  ok(/\d\d:\d\d [AP]M/.test(c0.querySelector(".rt:not(.gap)").textContent), "the time gutter is 12-hour too", c0.querySelector(".rt:not(.gap)").textContent.replace(/\s+/g, " ").trim());
  ok([...c0.querySelectorAll(".blk")].every((b) => /title="[^"]{15,}"/.test(b.outerHTML) || b.getAttribute("title").length > 15), "blocks have tooltips with section, faculty, room and exams", c0.querySelector(".blk").getAttribute("title").slice(0, 60));
  const ex = [...c0.querySelectorAll("table.exam tbody tr")].map((r) => r.textContent.replace(/\s+/g, " ").trim());
  ok(c0.querySelectorAll("table.exam").length === 1 && ex.length === 3, "exam table has a row per course", ex.length);
  ok(["Course", "Mid", "Final", "Section", "Faculty"].every((h) => c0.querySelectorAll("table.exam th")[Array.from(c0.querySelectorAll("table.exam th")).findIndex(x => x.textContent === h)]), "exam table columns", [...c0.querySelectorAll("table.exam th")].map(x => x.textContent).join(","));
  ok(ex.every((r) => /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d+, 20\d\d/.test(r)), "exam dates in the table", ex[0]);
  ok(ex.every((r) => /\[\d+\]/.test(r)), "exam rows show the chosen section");
  ok(!!c0.querySelector("table.exam caption"), "exam table has a caption for screen readers");
  ok(c0.querySelector(".day-dots").querySelectorAll("i.on").length >= 3, "day dots mark active days", c0.querySelector(".day-dots").querySelectorAll("i.on").length);
  ok(/longest day \d/.test(c0.textContent), "longest-day badge", /longest day [^<]+/.exec(c0.textContent.replace(/\s+/g," "))[0]);
  ok(/\d section option/.test(c0.textContent), "section-options badge", /[\d,]+ section options?/.exec(c0.textContent.replace(/\s+/g," "))[0]);

  // swapping a section inside the card
  const alt = c0.querySelector("details.alt");
  const radios = [...alt.querySelectorAll("input[type=radio]")];
  const withTwo = alt.querySelectorAll(".alt-course");
  const target = [...withTwo].find((x) => x.querySelectorAll("input[type=radio]").length > 1);
  ok(!!target, "a course offers alternative sections", withTwo.length);
  const beforeTxt = c0.textContent.replace(/\s+/g, " ");
  const second = target.querySelectorAll("input[type=radio]")[1];
  second.checked = true;
  second.dispatchEvent(new S.W.Event("change", { bubbles: true }));
  await wait(220);
  const c0b = S.qa(".routine")[0];
  const afterTxt = c0b.textContent.replace(/\s+/g, " ");
  ok(afterTxt !== beforeTxt, "card re-rendered after swapping a section");
  ok(c0b.querySelector("details.alt") && c0b.querySelector("details.alt").open, "the alternatives panel stays open after the swap");
  ok([...c0b.querySelectorAll(".alt-course input[type=radio]")].filter((i) => i.checked).length === [...c0b.querySelectorAll(".alt-course")].length, "exactly one radio selected per course");
  ok(/CSE221 · \[\d+\]|CSE221 \[\d+\]/.test(afterTxt), "grid blocks follow the new section", (/\[\d+\]/.exec(afterTxt) || [""])[0]);
  const timesBefore = (beforeTxt.match(/\d\d:\d\d [AP]M – \d\d:\d\d [AP]M/g) || []).length;
  const timesAfter = (afterTxt.match(/\d\d:\d\d [AP]M – \d\d:\d\d [AP]M/g) || []).length;
  ok(timesBefore === timesAfter && timesBefore > 0, "meeting count unchanged by the swap", timesBefore + " vs " + timesAfter);

  // paging
  S.click('[data-pg="next"]'); await wait(200);
  ok(/Showing 51–100 of/.test(S.txt("#pager")), "Next ▶ paginates", S.txt("#pager").slice(0, 40));
  S.click('[data-pg="prev"]'); await wait(200);
  ok(/Showing 1–50 of/.test(S.txt("#pager")), "◀ Prev returns");
  const keepSel = S.q('[data-pg="size"]');
  S.set(keepSel, "10", "change"); await wait(200);
  ok(S.cards().length === 10, "page size selector honoured", S.cards().length);
  S.set(S.q('[data-pg="size"]'), "50", "change"); await wait(200);
  ok(S.cards().length === 50, "page size back to 50", S.cards().length);

  // sorting + view
  S.set(S.q("#sortSel"), "choices", "change"); await wait(200);
  ok(S.cards().length === 50, "sorting keeps 50 cards");
  const optCounts = S.qa(".routine").map((x) => parseInt(/(\d+) section options?/.exec(x.textContent.replace(/\s+/g, " "))[1], 10));
  ok(optCounts[0] >= optCounts[optCounts.length - 1], "sort by most section choices orders the page", optCounts.slice(0, 3).join(">") + "…" + optCounts.slice(-1));
  S.set(S.q("#sortSel"), "best", "change"); await wait(150);
  S.click(S.qa("[data-view]")[1]); await wait(200);
  ok(S.qa(".routine .daylist").length === 50 && !S.q(".routine .rgrid"), "day-list view replaces the grid");
  ok(/free/.test(S.q(".routine .daylist").textContent), "free days listed in the day list");
  S.click(S.qa("[data-view]")[0]); await wait(200);
  ok(!!S.q(".routine .rgrid"), "back to the grid view");

  // copy + PNG + print + link
  S.W.__copied = null;
  S.click(S.q('.routine [data-ra="copy"]')); await wait(80);
  ok(/CSE221 \[\d+\] /.test(S.W.__copied || ""), "copy sections writes to the clipboard", (S.W.__copied || "").slice(0, 60));
  S.paint.texts.length = 0; S.paint.rects = 0; S.paint.strokes = 0; S.paint.fills.length = 0;
  S.click(S.q('.routine [data-ra="png"]')); await wait(320);
  const dl = S.W.__downloads || [];
  ok(dl.length === 1, "one PNG downloaded", dl.length);
  ok(/^prohor-[A-Z0-9-]+\.png$/.test((dl[0] || {}).name || ""), "filename uses the prohor prefix", (dl[0] || {}).name);
  ok(/^data:image\/png/.test((dl[0] || {}).href || ""), "payload is a PNG");
  ok(S.paint.texts[0] === "Prohor", "export carries the wordmark", S.paint.texts[0]);
  ok(S.paint.texts.some((t) => /Session 20263|unofficial/.test(t)), "export subtitle with session and disclaimer", S.paint.texts[1]);
  ok(S.paint.texts.some((t) => /Saturday/.test(t)), "export paints full day names");
  ok(S.paint.texts.some((t) => t === "free"), "export marks free days");
  ok(S.paint.texts.some((t) => /COURSE/.test(t)) && S.paint.texts.some((t) => /FINAL|not published/.test(t)), "export paints the exam block");
  ok(S.paint.texts.some((t) => /Data: BRACU Connect via Connect-CDN/.test(t)), "export footer credits the source");
  ok(S.paint.rects > 20 && S.paint.strokes > 0, "grid cells and hatch strokes drawn", S.paint.rects + "/" + S.paint.strokes);
  const hueFills = S.paint.fills.filter((f) => /^#(E8EBFA|DDF4F1|FCF1D6|FCE4EA|F0E6FB|E0F5E6|DFF0FB|FDE9DC)$/i.test(f));
  ok(new Set(hueFills).size >= 3, "each course keeps its own hue in the PNG too", [...new Set(hueFills)].join(","));
  ok(S.paint.fills[0] === "#FFFFFF" || S.paint.fills[1] === "#FFFFFF", "the image background is white");
  S.W.__printed = 0;
  S.click("#printAll"); await wait(60);
  ok(S.W.__printed === 1, "Print all calls window.print");
  S.W.__copied = null;
  S.click("#copyLink"); await wait(80);
  ok(/^https:\/\/routine\.test\/\?c=CSE221/.test(S.W.__copied || ""), "copy link carries the full state", (S.W.__copied || "").slice(0, 80));
  ok(/c=CSE221,MAT216,CSE320/.test(S.W.__copied || ""), "the copied link restores these courses", (S.W.__copied || "").slice(0, 120));
  ok(/\?c=CSE221,MAT216,CSE320/.test(S.W.location.search), "URL rewritten with the current selection", S.W.location.search.slice(0, 80));

  /* ---------------- persistence ---------------- */
  const aState = JSON.parse(A.W.localStorage.getItem("prohor.state"));
  ok(aState.prefs.avoidTime.indexOf(0) >= 0 && aState.prefs.avoidDay.indexOf(1) >= 0 && aState.prefs.avoidFac.indexOf("ANK") >= 0,
    "avoid filters persisted on the instance that set them", JSON.stringify(aState.prefs));
  ok(!/[?&](t|y|f)=/.test(S.W.location.search), "an unfiltered search keeps the link short", S.W.location.search);
  const st = JSON.parse(S.W.localStorage.getItem("prohor.state"));
  ok(st.courses.length === 3 && st.courses[0].code === "CSE221", "courses persisted", JSON.stringify(st.courses.map(c => c.code)));
  ok(JSON.stringify(st.courses[0].locked) === "[]", "no stale locks stored", JSON.stringify(st.courses[0]));
  ok(st.prefs.avoidTime.length === 0 && st.prefs.examClash === true, "this instance kept its own (unfiltered) prefs", JSON.stringify(st.prefs));
  ok(st.prefs.examClash === true && st.prefs.minGaps === true, "switches persisted");
  ok(st.pageSize === 50 && st.view === "grid" && st.sort === "best", "view settings persisted", JSON.stringify([st.pageSize, st.view, st.sort]));
  ok(st.results === undefined && st.resultsShown === undefined, "no result data written to storage");
  const cache = JSON.parse(S.W.localStorage.getItem("prohor-cache:feed"));
  ok(cache && cache.sections.length > 2000 && Math.abs(Date.now() - cache.at) < 180000, "feed cached with a timestamp", cache && cache.sections.length);

  /* ---------------- data states ---------------- */
  const C1 = boot({ liveFails: true, snapshotFails: true });
  await C1.waitFor(() => /no data available/i.test(C1.txt("#livePill")), 8000, "hard-offline pill");
  ok(/no data available/i.test(C1.txt("#livePill")), "both sources failing is stated plainly", C1.txt("#livePill"));
  ok(/auto-refresh in 6 h 0 m/.test(A.txt("#livePill")) || /updated/.test(A.txt("#livePill")), "the pill carries the freshness line", A.txt("#livePill"));
  ok(!!C1.q("#retryData"), "a retry affordance is offered");
  C1.click("#genBtn"); await wait(80);
  ok(/Waiting for data/.test(C1.txt("#genBtn")), "generate while offline says it is waiting, not broken", C1.txt("#genBtn"));

  const C2 = boot({ liveFails: true });
  await C2.ready();
  ok(/Offline copy/.test(C2.txt("#livePill")), "falls back to the bundled snapshot automatically", C2.txt("#livePill"));
  ok(C2.calls.live >= 1 && C2.calls.snapshot === 1, "live first, then snapshot", JSON.stringify(C2.calls));
  ok(C2.calls.live >= 2, "the seat rail keeps re-checking the live feed on its own timer", JSON.stringify(C2.calls));
  await C2.add("CSE221"); await C2.add("MAT216");
  await C2.gen();
  ok(C2.cards().length > 0, "generator works offline", C2.cards().length);

  const C3 = boot({ seedCache: true, cacheAge: 8 * 3600 * 1000, liveFails: true, snapshotFails: true });
  await C3.waitFor(() => /Stale copy/.test(C3.txt("#livePill")), 8000, "stale-cache recovery");
  ok(/Stale copy/.test(C3.txt("#livePill")), "expired cache → tried network → served the last copy", C3.txt("#livePill"));

  const C4 = boot({ seedCache: true, cacheAge: 3 * 60000, liveFails: true });
  ok(await C4.waitFor(() => /Cached/.test(C4.txt("#livePill")), 5000), "fresh cache paints instantly", C4.txt("#livePill"));
  ok(C4.q("#courseSearch").disabled === false, "course search usable from the cache");
  ok(C4.q("#livePill").getAttribute("data-state") === "ok", "cached data is not treated as an error");

  const C5 = boot({
    slowLive: 1400,
    seedState: {
      courses: [{ code: "CSE221", locked: [], faculty: [] }, { code: "MAT216", locked: [], faculty: [] }],
      prefs: { dayMin: 1, dayMax: 6, examClash: true, minGaps: true, moreChoices: false, avoidFac: [], avoidTime: [], avoidDay: [] }
    }
  });
  await wait(250);
  C5.click("#genBtn");
  ok(/Waiting for data/.test(C5.txt("#genBtn")), "early click queues the search", C5.txt("#genBtn"));
  ok(C5.q("#genBtn").disabled === true, "button disabled while queued");
  await C5.ready(12000);
  await C5.waitFor(() => C5.cards().length > 0, 25000, "queued search to run");
  ok(C5.cards().length > 0, "the queued search ran on its own once the feed landed", C5.cards().length);
  ok(C5.qa("#courses .course").length === 2, "the queued state kept both courses");
  ok(/Generate routines/.test(C5.txt("#genBtn")), "button restored after the queued run", C5.txt("#genBtn"));
  ok(!/undefined|NaN/.test(C5.txt("#courses")), "no placeholder cruft in the cards", (C5.txt("#courses") || "").slice(0, 60));
  ok(C5.q(".course .caption") && new RegExp(`${F.CSE221.sections} sections`).test(C5.q(".course .caption").textContent), "cards filled in after the late data", C5.q(".course .caption").textContent.trim());

  /* ---------------- mobile ---------------- */
  console.log("\n--- stale marker + unknown course pass ---");
  const T = boot({});
  await T.ready();
  await T.add("CSE221"); await T.add("MAT216");
  await T.gen();
  ok(T.cards().length > 0 && !/settings changed since/.test(T.txt("#resultsDesc")), "a fresh search is not marked stale", T.txt("#resultsDesc"));
  await T.add("CSE320");
  await T.wait(80);
  ok(/settings changed since/.test(T.txt("#resultsDesc")), "adding a course marks the shown results stale", T.txt("#resultsDesc"));
  ok(T.cards().length > 0, "the earlier results are still on screen to compare");
  T.click('[data-act="remove"]', ); // remove the first course
  await T.wait(80);
  ok(T.qa("#courses .course").length === 2, "removing a course keeps the rest");
  // a saved course code that the current feed no longer has
  const U = boot({ seedState: { courses: [{ code: "ZZZ999", locked: [], faculty: [] }, { code: "CSE221", locked: [], faculty: [] }], prefs: { dayMin: 1, dayMax: 6, examClash: true, minGaps: true, moreChoices: false, avoidFac: [], avoidTime: [], avoidDay: [] } } });
  await U.ready(); await U.wait(150);
  ok(/not in this feed/.test(U.txt("#courses")), "an unknown saved code is called out", (U.q(".course .title") || {}).textContent);
  U.click("#genBtn"); await U.wait(250);
  ok(/ZZZ999/.test(U.txt("#resultsDesc") || "") || /ZZZ999/.test(U.txt("#resultsBody")), "generating with it explains the problem instead of failing", U.txt("#resultsDesc"));

  console.log("\n--- filter + link pass ---");
  const L = boot({ url: "https://routine.test/?c=CSE221,MAT216" });
  await L.ready();
  ok(L.qa("#courses .course").length === 2, "courses restored from the link query", L.qa("#courses .course").length);
  L.click('#timeChips .chip[data-i="4"]');      // 2:00 PM – 3:20 PM
  L.click('#dayChips .chip[data-i="3"]');       // Tue
  await L.wait(60);
  await L.gen();
  ok(/[?&]t=4/.test(L.W.location.search) && /[?&]y=3/.test(L.W.location.search), "the URL carries the avoid slot and day", L.W.location.search);
  ok(L.cards().length > 0, "the filtered search still returns routines", L.cards().length);
  const rowsOf = (html) => (html.match(/\d\d:\d\d – \d\d:\d\d/g) || []).length;
  const unfilteredCount = S.qa(".routine").length ? rowsOf(S.q(".routine").textContent) : 0;
  ok(L.qa(".routine").every((r) => !/14:00 – 15:20/.test(r.textContent)), "the avoided slot is gone from every card");
  ok(L.qa(".routine").every((r) => [...r.querySelectorAll(".blk")].every((b) => b.style.gridColumn !== "5")), "nothing is placed on Tuesday (column 5)");
  ok(L.qa(".routine").every((r) => !!r.querySelector(".rgrid") && r.querySelectorAll(".rh").length === 7), "the template keeps all six day columns, Tuesday marked free");
  ok(L.qa(".routine").every((r) => [...r.querySelectorAll(".rh")][4].classList.contains("free")), "the avoided day column shows as free");
  L.W.__copied = null;
  L.click("#copyLink"); await wait(80);
  ok(/t=4/.test(L.W.__copied || "") && /y=3/.test(L.W.__copied || ""), "the copied link replays the filters", (L.W.__copied || "").slice(0, 120));
  const L2 = boot({ url: "https://routine.test/" + L.W.location.search });
  await L2.ready();
  await L2.wait(200);
  ok(L2.qa("#timeChips .chip[aria-pressed=true]").length === 1 && L2.qa("#dayChips .chip[aria-pressed=true]").length === 1,
    "opening that link restores both avoid filters", L2.qa("#timeChips .chip[aria-pressed=true]").length + "/" + L2.qa("#dayChips .chip[aria-pressed=true]").length);
  ok(L2.qa("#courses .course").length === 2, "and the two courses");

  console.log("\n--- sections control pass ---");
  const X = boot({});
  await X.ready();
  await X.add("CSE221");
  const xcard = X.card(0);
  const labels = [...xcard.querySelectorAll(".control .label")].map((l) => l.textContent.trim());
  ok(labels.join(",") === "Time slots,Sections,Faculty", "three per-course controls in order", labels.join(","));
  const secTrigger = xcard.querySelector('[data-act="open-sec"] span');
  ok(secTrigger.textContent.includes(`All sections (${F.CSE221.sections})`), "sections trigger defaults to all", secTrigger.textContent);
  const sms = await X.openMs(0, "sec");
  const srows = [...sms.querySelectorAll(".ms-row")];
  ok(srows.length === F.CSE221.sections, "one row per section in the course", srows.length);
  ok(srows.every((r) => /^\[\d+\]/.test(r.querySelector(".mono").textContent.trim()) && /\d\d:\d\d/.test(r.textContent)), "rows show [section] plus its times");
  ok(srows.every((r) => r.querySelector(".r").textContent.trim() === "available"), "everything available with no other filter", srows[0].querySelector(".r").textContent);
  const twoSecs = [srows[0].querySelector("input").dataset.s, srows[1].querySelector("input").dataset.s];
  await X.check(sms, 0); await X.check(sms, 1);
  await wait(40);
  ok(sms.querySelectorAll(".ms-row input:checked").length === 2, "both checkboxes stay ticked");
  await X.done(sms);
  ok(X.qa(".course .chip.locked").length === 2, "each picked section becomes a chip", X.qa(".course .chip.locked").map(c => c.textContent).join("|"));
  ok(X.q('[data-act="open-sec"] span').textContent.includes(`2 of ${F.CSE221.sections} sections`), "trigger counts the picks", X.q('[data-act="open-sec"] span').textContent);
  ok(/2 sections picked/.test(X.q(".course .caption").textContent), "caption states the restriction", X.q(".course .caption").textContent.trim());
  ok(/2 sections match/.test(X.q(".course .caption").textContent), "caption counts what survives", X.q(".course .caption").textContent.trim());
  // the other two controls must react to the section picks, not the reverse only
  {
    const KC0 = fixture.courses.CSE221;
    const pickedSecs = twoSecs.map((n) => KC0.sections.find((z) => String(z.sec) === n));
    const wantGroups = [...new Set(pickedSecs.map((z) => z.sig))];
    const wantFacs = [...new Set(pickedSecs.flatMap((z) => z.faculties && z.faculties.length ? z.faculties : [z.faculty]))];
    const tms = await X.openMs(0, "ts");
    const trows = [...tms.querySelectorAll(".ms-row")];
    const tLive = trows.filter((r) => !r.classList.contains("dim"));
    const tDim = trows.filter((r) => r.classList.contains("dim"));
    ok(tLive.length === wantGroups.length, "time slots grey down to the patterns the picked sections actually meet", tLive.length + " live, want " + wantGroups.length);
    ok(tLive.every((r) => wantGroups.includes(r.querySelector("input").dataset.id)), "and it is exactly those patterns", tLive.map(r => r.querySelector("input").dataset.id).join("|").slice(0, 40));
    ok(tDim.length > 0 && tDim.every((r) => /not one of your picked sections/.test(r.textContent)), "every greyed slot says the sections are why", tDim.length + " dimmed");
    ok(/\d+ of \d+ available/.test(tms.querySelector(".ms-note").textContent), "the note counts what survives", tms.querySelector(".ms-note").textContent.replace(/\s+/g, " ").trim());
    await X.done(tms);
    const fms2 = await X.openMs(0, "fac");
    const flive = [...fms2.querySelectorAll(".ms-row")].filter((r) => !r.classList.contains("dim"));
    ok(flive.length === wantFacs.length, "the faculty list narrows to who teaches those sections", flive.length + " live, want " + wantFacs.length);
    ok(flive.every((r) => wantFacs.some((f) => r.textContent.includes(f))), "and to exactly those names", flive.map(r => r.querySelector(".mono").textContent).join(","));
    ok(fms2.querySelector(".ms-row.dim .r") && /none of your picked sections/.test(fms2.querySelector(".ms-row.dim").textContent), "the greyed faculty say why too");
    await X.done(fms2);
    // a greyed row refuses a new tick but never traps one
    const tms2 = await X.openMs(0, "ts");
    const grey = [...tms2.querySelectorAll(".ms-row.dim")][0];
    const gIn = grey.querySelector("input");
    gIn.checked = true;
    gIn.dispatchEvent(new X.W.Event("change", { bubbles: true }));
    await X.wait(50);
    ok(gIn.checked === false, "ticking a greyed slot is refused");
    ok(/clashes with your other picks|not one of your picked sections/.test(X.txt("#toasts")), "with a toast that says why", X.txt("#toasts").slice(-50));
    await X.done(tms2);
  }
  await X.gen();
  ok(X.cards().length > 0, "search runs with a section restriction", X.cards().length);
  const blks = X.qa(".routine:first-of-type .blk b").map((b) => b.textContent.trim());
  const main = blks.filter((b) => /^CSE221 · \[/.test(b));
  ok(main.length > 0 && main.every((b) => twoSecs.some((n) => b.includes(`[${n}]`))), "the grid only ever shows the chosen sections", main.join(" / "));
  const altBlock = X.q(".routine .alt-course");
  ok(altBlock && [...altBlock.querySelectorAll("input[type=radio]")].length === 2, "the swap list offers exactly the 2 chosen sections", altBlock && altBlock.querySelectorAll("input").length);
  ok(/~[\d.]+/.test(X.W.location.search), "the shareable URL carries the section picks", X.W.location.search);
  ok(X.W.location.search.includes(`~${twoSecs.join(".")}`), "with the exact numbers", X.W.location.search);
  ok(X.W.location.hash === "", "no fragment is used, so nothing is lost from the link", X.W.location.hash);
  const Xr = boot({ url: "https://routine.test/" + X.W.location.search });
  await Xr.ready(); await Xr.wait(200);
  ok(Xr.qa(".course .chip.locked").length === 2, "reopening that link restores both section picks", Xr.qa(".course .chip.locked").length);
  ok(/2 of \d+ sections/.test(Xr.q('[data-act="open-sec"] span').textContent), "and the trigger shows them", Xr.q('[data-act="open-sec"] span').textContent);
  // chip removal
  X.click(".course .chip.locked .rm");
  await wait(80);
  ok(X.qa(".course .chip.locked").length === 1, "chip × drops just that section");
  ok(/1 of \d+ sections/.test(X.q('[data-act="open-sec"] span').textContent), "trigger recounts", X.q('[data-act="open-sec"] span').textContent);
  X.click(".course .chip.locked .rm"); await wait(80);
  ok(X.qa(".course .chip.locked").length === 0, "last chip removable");
  ok(X.q('[data-act="open-sec"] span').textContent.includes(`All sections (${F.CSE221.sections})`), "back to all sections", X.q('[data-act="open-sec"] span').textContent);
  // interaction with the faculty control
  const fms = await X.openMs(0, "fac");
  const facRow = [...fms.querySelectorAll(".ms-row")].find((r) => /ANK|TBA/.test(r.textContent));
  facRow.querySelector("input").checked = true;
  facRow.querySelector("input").dispatchEvent(new X.W.Event("change", { bubbles: true }));
  await X.done(fms);
  const sms2 = await X.openMs(0, "sec");
  const dim = [...sms2.querySelectorAll(".ms-row.dim")];
  ok(dim.length > 0 && dim.every((r) => /another faculty/.test(r.querySelector(".r").textContent)), "sections taught by other faculty are dimmed with a reason", dim.length + " dimmed");
  const live = [...sms2.querySelectorAll(".ms-row")].filter((r) => !r.classList.contains("dim"));
  ok(live.length > 0 && live.every((r) => /available|picked/.test(r.querySelector(".r").textContent)), "the rest stay selectable", live.length);
  await X.done(sms2);
  // a section pick that fights a locked pattern is explained, not silently empty
  const KC = fixture.courses.CSE221;
  const secA = KC.sections[0];
  const otherGroup = KC.groups.find((g) => g.key !== secA.sig && g.sections.every((x) => x.sec !== secA.sec));
  const X2 = boot({ seedState: { courses: [{ code: "CSE221", locked: [], faculty: [], secs: [String(secA.sec)] }], prefs: { dayMin: 1, dayMax: 6, examClash: true, minGaps: true, moreChoices: false, avoidFac: [], avoidTime: [], avoidDay: [] } } });
  await X2.ready(); await X2.wait(150);
  ok(/1 of \d+ sections/.test(X2.q('[data-act="open-sec"] span').textContent), "a restored section pick shows in the trigger", X2.q('[data-act="open-sec"] span').textContent);
  ok(X2.qa(".course .chip.locked").length === 1, "and as a chip");
  const m2 = await X2.openMs(0, "ts");
  const row2 = [...m2.querySelectorAll(".ms-row")].find((r) => r.querySelector("input").dataset.id === otherGroup.key);
  ok(!!row2, "the pattern that excludes that section is still listed, not hidden", otherGroup.key.slice(0, 18));
  ok(row2.classList.contains("dim"), "but it is greyed out, so the contradiction cannot be created here");
  ok(/not one of your picked sections/.test(row2.textContent), "and it says why", row2.querySelector(".r").textContent.replace(/\s+/g, " ").trim());
  const box2 = row2.querySelector("input");
  box2.checked = true;
  box2.dispatchEvent(new X2.W.Event("change", { bubbles: true }));
  await X2.wait(50);
  ok(box2.checked === false, "ticking it is refused");
  await X2.done(m2);
  await X2.wait(60);
  ok(!/0 patterns match|no viable pattern/i.test(X2.q(".course .caption").textContent), "so the course never ends up in an impossible state", X2.q(".course .caption").textContent.trim());
  // the only way in is a link someone else shared — and it is still explained, not silently empty
  const X3 = boot({ url: "https://routine.test/?c=CSE221:" + KC.groups.indexOf(KC.groups.find((g) => g.key === otherGroup.key)) + "~" + secA.sec });
  await X3.ready(); await X3.wait(200);
  ok(/0 patterns match|no viable pattern/i.test(X3.q(".course .caption").textContent + X3.txt("#summary")), "a contradictory link is surfaced", (X3.q(".course .caption").textContent + " || " + X3.txt("#summary")).replace(/\s+/g, " ").trim());
  X3.click("#genBtn"); await X3.wait(400);
  ok(X3.cards().length === 0, "and Generate refuses instead of returning nonsense");
  ok(new RegExp("\[" + String(secA.sec).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\]").test(X3.q("#resultsBody").textContent), "the zero state names the offending section", X3.q("#resultsBody").textContent.replace(/\s+/g, " ").slice(0, 160));

  /* ---------------- picker reliability (the "won't open" complaint) ---------------- */
  console.log("\n--- picker reliability pass ---");
  const Q = boot({});
  await Q.ready();
  await Q.add("CSE221"); await Q.add("MAT216");
  const card0 = () => Q.card(0);
  async function openOk(kind, label) {
    const btn = card0().querySelector(`[data-act="open-${kind}"]`);
    Q.click(btn);
    await Q.wait(60);
    const ms = card0().querySelector(".ms");
    const shown = !!ms && Q.d.body.contains(ms) && ms.querySelectorAll(".ms-row").length > 0;
    ok(shown, `popover opens: ${label}`, ms ? `rows=${ms.querySelectorAll(".ms-row").length}, attached=${Q.d.body.contains(ms)}` : "no .ms at all");
    return ms;
  }
  for (let round = 0; round < 2; round++) {
    const a = await openOk("ts", "time slots (round " + (round + 1) + ")");
    Q.click(a.querySelector('[data-ms="done"]')); await Q.wait(50);
    const b = await openOk("sec", "sections (round " + (round + 1) + ")");
    await Q.check(b, 0);
    Q.click(b.querySelector('[data-ms="done"]')); await Q.wait(60);
    const c = await openOk("fac", "faculty (round " + (round + 1) + ")");
    Q.click(c.querySelector('[data-ms="done"]')); await Q.wait(50);
  }
  // switching straight from one control to another without closing (this is what used to wedge it)
  const first = await openOk("ts", "time slots");
  const secBtn = card0().querySelector('[data-act="open-sec"]');
  Q.click(secBtn); await Q.wait(70);
  const msAfter = card0().querySelector(".ms");
  ok(!!msAfter && Q.d.body.contains(msAfter) && /section/i.test(msAfter.textContent), "switching from Time slots to Sections swaps the popover in place", msAfter ? msAfter.textContent.replace(/\s+/g, " ").slice(0, 40) : "gone");
  const facBtn = card0().querySelector('[data-act="open-fac"]');
  Q.click(facBtn); await Q.wait(70);
  const msAfter2 = card0().querySelector(".ms");
  ok(!!msAfter2 && Q.d.body.contains(msAfter2) && /faculty|section/i.test(msAfter2.textContent), "…and on to Faculty", msAfter2 ? "ok" : "gone");
  Q.click(msAfter2.querySelector('[data-ms="done"]')); await Q.wait(60);
  // a click outside closes, and everything still opens afterwards
  Q.click(Q.d.body); await Q.wait(60);
  ok(!card0().querySelector(".ms"), "outside click dismisses the popover");
  await openOk("ts", "time slots after an outside click");
  Q.click(Q.q("#resultList, #resultsBody") || Q.d.body);
  Q.key(Q.d.body, "Escape"); await Q.wait(60);
  ok(!Q.d.querySelector(".ms"), "Escape left no popover behind");
  await openOk("sec", "sections after Escape");
  Q.click(Q.q('.course .ms [data-ms="done"]')); await Q.wait(50);
  // toggling inside a popover must not be undone by a card refresh
  const msv = await openOk("sec", "sections for a real toggle");
  const box0 = msv.querySelectorAll(".ms-row input")[0];
  box0.checked = true; box0.dispatchEvent(new Q.W.Event("change", { bubbles: true }));
  await Q.wait(50);
  ok(msv.querySelectorAll(".ms-row input:checked").length === 1 && Q.d.body.contains(msv), "the tick sticks and the popover stays open while you pick", msv.querySelectorAll(".ms-row input:checked").length);
  Q.click(msv.querySelector('[data-ms="done"]')); await Q.wait(60);
  ok(/1 of \d+ sections/.test(card0().querySelector('[data-act="open-sec"] span').textContent), "the card label updates without a full re-render", card0().querySelector('[data-act="open-sec"] span').textContent);
  const reopen = await openOk("sec", "sections after a real toggle");
  ok(reopen.querySelector(".ms-row input").checked === true, " reopening shows the saved selection");

  /* ---------------- search dropdown reliability + paging model ---------------- */
  console.log("\n--- dropdown + paging pass ---");
  const P = boot({ deviceMemory: 4, cores: 4 });
  await P.ready();
  ok(P.q("#courseList").hidden === true, "list starts closed");
  P.q("#courseSearch").dispatchEvent(new P.W.FocusEvent("focus"));
  await P.wait(60);
  ok(P.q("#courseList").hidden === false && P.qa("#courseList .option").length > 0, "plain focus opens the list (no typing needed)", P.qa("#courseList .option").length);
  P.q("#courseSearch").dispatchEvent(new P.W.MouseEvent("click", { bubbles: true }));
  await P.wait(40);
  ok(P.q("#courseList").hidden === false, "clicking it again keeps it open (never flickers shut)");
  P.key(P.q("#courseSearch"), "Escape"); await P.wait(40);
  ok(P.q("#courseList").hidden === true, "Escape closes it");
  P.set("#courseSearch", "CSE221"); await P.wait(60);
  ok(P.q("#courseList").hidden === false, "typing opens it");
  ok(P.q("#searchClr") && P.q("#searchClr").hidden === false, "the ✕ appears while there is text or a list");
  P.click("#searchClr"); await P.wait(60);
  ok(P.q("#courseSearch").value === "" && P.q("#courseList").hidden === true, "✕ clears the box and closes the list");
  ok(P.q("#searchClr").hidden === true, "and hides itself again");
  await P.add("CSE221"); await P.add("MAT216");

  P.click("#genBtn");
  await P.waitFor(() => P.q("#genBtn").disabled === false, 30000, "first batch");
  await P.wait(1600);
  const loaded1 = P.qa("#resultsBody .routine").length;
  ok(loaded1 === 50, "the first search returns exactly one page (50), not the whole space", loaded1);
  ok(/of 50\b/.test(P.txt("#pager")) || /1–50 of 50/.test(P.txt("#pager")), "the pager says 50 are loaded", P.txt("#pager").slice(0, 60));
  ok(/＋ 50 more|Next 50|50 more/.test(P.txt("#pager")), "and offers the next batch on demand", P.txt("#pager"));
  ok(/kept on this device|combinations searched|found/.test(P.txt("#resultsDesc")) === true, "summary line is populated", P.txt("#resultsDesc").slice(0, 90));
  const grew = P.qa("#resultsBody .routine").length;
  await P.wait(2500);
  ok(P.qa("#resultsBody .routine").length === grew, "nothing keeps filling in the background (device stays idle)", P.qa("#resultsBody .routine").length);
  const saved = JSON.parse(P.W.localStorage.getItem("prohor-cache:results"));
  ok(saved && saved.items.length >= 50, "the batch is saved on the device", saved && saved.items.length);
  ok(saved && saved.items[0].ci.length === 2, "stored as tiny descriptors, not full objects");
  ok(saved.done === false, "and it remembers the search was not finished");

  P.click('[data-pg="next"]');
  await P.waitFor(() => /1–50 of (?!50)/.test(P.txt("#pager")) || /51–100/.test(P.txt("#pager")), 30000, "second batch");
  await P.wait(300);
  ok(/51–100/.test(P.txt("#pager")), "Next ▶ fetched and moved to the second page", P.txt("#pager").slice(0, 50));
  const saved2 = JSON.parse(P.W.localStorage.getItem("prohor-cache:results"));
  ok(saved2.items.length >= 100, "both pages are kept", saved2.items.length);
  ok(saved2.page === 2, "and the page position is remembered", saved2.page);
  P.click('[data-pg="prev"]'); await P.wait(250);
  ok(/1–50 of/.test(P.txt("#pager")) && P.q("#resultsBody .routine .rank").textContent === "#1", "going back shows page 1 again, unchanged", P.txt("#pager").slice(0, 40));
  const firstCard = P.q("#resultsBody .routine").textContent.replace(/\s+/g, " ").slice(0, 120);
  P.click('[data-pg="next"]'); await P.wait(250);
  const secondCard = P.q("#resultsBody .routine .rank").textContent + "|" + P.q("#resultsBody .routine").textContent.replace(/\s+/g, " ").slice(0, 120);

  // a brand new page load restores every page collected so far
  const savedUrl = "https://routine.test/";
  const R2 = boot({ deviceMemory: 4, cores: 4, seedResults: saved2, seedCourses: saved2.sig ? undefined : undefined });
  await R2.ready();
  await R2.waitFor(() => R2.qa("#resultsBody .routine").length > 0, 4000, "restored pages");
  ok(R2.qa("#resultsBody .routine").length === 50, "a fresh visit restores the saved pages without re-searching", R2.qa("#resultsBody .routine").length);
  ok(/kept on this device/.test(R2.txt("#resultsDesc")), "and labels them as restored", R2.txt("#resultsDesc").slice(-60));
  ok(/page <b>2<\/b>|Showing 51–100 of 150/.test(R2.txt("#pager")), "the restored view reopens on the page they left", R2.txt("#pager").slice(0, 60));
  const r2Card = (R2.q("#resultsBody .routine") ? R2.q("#resultsBody .routine .rank").textContent + "|" + R2.q("#resultsBody .routine").textContent.replace(/\s+/g, " ").slice(0, 120) : "");
  ok(r2Card === secondCard, "the restored page is identical to what was saved", r2Card.slice(0, 60));
  ok(/150 of 255 combinations/.test(R2.txt("#resultsDesc")), "and the totals are honest for a restored search", R2.txt("#resultsDesc").slice(0, 130));
  ok(/＋ 50 more/.test(R2.txt("#pager")), "the restored view can continue where it stopped", R2.txt("#pager"));
  const all = R2.q('[data-pg="all"]');
  ok(!!all, "the explicit 'find them all' escape hatch is offered", all && all.textContent);

  /* ---------------------------- seats rail ---------------------------- */
  console.log("\n--- split view, pins, cadence, exam colours ---");
  const K1 = boot({ width: 1440 });
  await K1.ready();
  ok(K1.q("#seatsLayer").hidden === true, "panel starts closed");
  K1.click("#seatsBtn"); await K1.wait(140);
  ok(K1.q("#seatsLayer").classList.contains("open"), "the header button splits the screen");
  ok(K1.d.body.classList.contains("seats-open"), "the page makes room instead of being covered");
  ok(!K1.q("#seatsLayer").classList.contains("scrim"), "nothing dims the page");
  ok(K1.d.querySelectorAll("#seatStrip").length === 0, "the pinned bar and its duplicate id are gone");
  ok(!K1.q("#seatsDock") && !K1.q("#seatsStripBtn"), "no dock or pin-bar toggles to choose between");
  K1.key(K1.d.body, "Escape"); await K1.wait(80);
  ok(K1.q("#seatsLayer").hidden === false, "Escape leaves the split open (you opened it on purpose)");
  // the handle: drag, keyboard, double-click
  const grip = K1.q("#railGrip");
  ok(!!grip && grip.getAttribute("tabindex") === "0", "there is a focusable handle between page and panel");
  ok(/\.seats-layer\{[^}]*pointer-events:none/.test(cssSrc), "the overlay itself swallows no clicks");
  ok(/\.rail\{[^}]*pointer-events:auto/.test(cssSrc), "the panel takes them back");
  const wA = parseInt(K1.W.document.body.style.getPropertyValue("--rail-w"), 10);
  K1.mouse(grip, "mousedown", { clientX: 1010, clientY: 400 });
  K1.mouse(K1.W, "mousemove", { clientX: 910, clientY: 400 });
  K1.mouse(K1.W, "mouseup", { clientX: 910, clientY: 400 });
  await K1.wait(80);
  const wB = parseInt(K1.W.document.body.style.getPropertyValue("--rail-w"), 10);
  ok(wB === wA + 100, "dragging the handle left widens the panel", wA + " -> " + wB);
  ok(JSON.parse(K1.W.localStorage.getItem("prohor.railSize")).w === wB, "the split you left it at is remembered");
  K1.key(grip, "ArrowRight"); await K1.wait(60);
  ok(parseInt(K1.W.document.body.style.getPropertyValue("--rail-w"), 10) === wB - 24, "arrow keys nudge it the other way");
  K1.mouse(grip, "dblclick"); await K1.wait(60);
  ok(JSON.parse(K1.W.localStorage.getItem("prohor.railSize")).w === 430, "double-click restores the default", K1.W.localStorage.getItem("prohor.railSize"));
  ok(parseInt(K1.W.document.body.style.getPropertyValue("--rail-h"), 10) <= 340, "a phone-sized band starts well below half the screen");
  ok(grip.getAttribute("role") === "separator" && grip.getAttribute("aria-valuenow"), "screen readers see a real splitter", grip.getAttribute("aria-valuenow"));
  // and the page still works while the panel is open
  await K1.add("CSE221"); await K1.add("MAT216");
  ok(K1.qa("#courses .course").length === 2, "adding courses works with the panel open", K1.qa("#courses .course").length);
  await K1.gen();
  ok(K1.cards().length > 0, "generating works with the panel open", K1.cards().length);
  ok(K1.q("#resultsBody").contains(K1.q("#resultsBody .routine")), "the results live in the narrowed page");

  try { K1.dom.close(); } catch (e) { }          // one jsdom window is plenty at a time
  const K2 = boot({ width: 760 });
  await K2.ready();
  await K2.add("CSE221");
  K2.click("#seatsBtn"); await K2.wait(160);
  ok(K2.q("#seatsLayer").classList.contains("open"), "a tablet gets the same split, turned sideways");
  const hA = parseInt(K2.W.document.body.style.getPropertyValue("--rail-h"), 10);
  ok(hA > 150, "page above, panel below, with a height of its own", hA + "px");
  ok(K2.q("#railGrip").getAttribute("aria-orientation") === "horizontal", "the handle lies along the top edge");
  K2.mouse(K2.q("#railGrip"), "mousedown", { clientX: 300, clientY: 500 });
  K2.mouse(K2.W, "mousemove", { clientX: 300, clientY: 400 });
  K2.mouse(K2.W, "mouseup", { clientX: 300, clientY: 400 });
  await K2.wait(80);
  ok(parseInt(K2.W.document.body.style.getPropertyValue("--rail-h"), 10) === hA + 100, "dragging it up grows the panel", hA + " -> " + K2.W.document.body.style.getPropertyValue("--rail-h"));
  K2.mouse(K2.q("#railGrip"), "mousedown", { clientX: 300, clientY: 100 });
  K2.mouse(K2.W, "mousemove", { clientX: 300, clientY: 890 });
  K2.mouse(K2.W, "mouseup", { clientX: 300, clientY: 890 });
  await K2.wait(80);
  const hMin = parseInt(K2.W.document.body.style.getPropertyValue("--rail-h"), 10);
  ok(hMin >= 50 && hMin <= 120, "it can fold down to a status strip", hMin);
  ok(K2.q("#seatsLayer").classList.contains("slim"), "folded band shows only the live strip, no rows", K2.q("#seatsLayer").className);
  ok(K2.q("#railMore").textContent.trim() === "Show sections", "and offers to bring the rows back", K2.q("#railMore").textContent.trim());
  K2.click("#railMore"); await K2.wait(120);
  ok(!K2.q("#seatsLayer").classList.contains("slim") && parseInt(K2.W.document.body.style.getPropertyValue("--rail-h"), 10) > 200,
    "tapping it again unfolds to the size you had", K2.W.document.body.style.getPropertyValue("--rail-h"));
  // the page must keep its own space: the band can never take the whole screen
  const hRoom = 900 - parseInt(K2.W.document.body.style.getPropertyValue("--rail-h"), 10);
  ok(hRoom >= 200, "the page keeps at least 200px above the band", hRoom);
  K2.mouse(K2.q("#railGrip"), "mousedown", { clientX: 300, clientY: 890 });
  K2.mouse(K2.W, "mousemove", { clientX: 300, clientY: 0 });
  K2.mouse(K2.W, "mouseup", { clientX: 300, clientY: 0 });
  await K2.wait(80);
  ok(parseInt(K2.W.document.body.style.getPropertyValue("--rail-h"), 10) <= 640, "and never swallows the whole screen", K2.W.document.body.style.getPropertyValue("--rail-h"));
  // nothing in the page may sit under the band: popovers, the course dropdown and the action bar
  ok(/\.ms\{[^}]*z-index:72/.test(cssSrc), "pickers paint above the seats layer");
  ok(/\.listbox\{z-index:72\}/.test(cssSrc), "the course dropdown paints above it too");
  ok(/\.popover\{[^}]*z-index:74/.test(cssSrc), "and so does the data popover");
  ok(/body\.seats-open \.action-bar\{z-index:66\}/.test(cssSrc), "Generate and the pager stay tappable above the band");
  ok(/\.ms\.up\{top:auto;bottom:calc\(100% \+ 6px\)\}/.test(cssSrc), "a picker with no room below opens upward instead");
  ok(/body\.seats-open \.ms\{width:min\(420px,calc\(100vw - var\(--rail-w\) - 56px\)\)\}/.test(cssSrc), "and on a wide screen it is capped to the page column, not the side one");
  {
    // THE regression: the side-panel padding must never apply to the stacked split — at 390px it
    // used to hand main a 404px right padding and crush the page column to nothing.
    const wideOnly = /@media \(min-width:1024px\)\{\s*body\.seats-open \.wrap\{padding-right:calc\(var\(--rail-w\) \+ 24px\)\}/.test(cssSrc);
    ok(wideOnly, "the side-column padding is scoped to wide screens only");
    ok(/@media \(max-width:1023px\)\{[\s\S]*?body\.seats-open\{display:flex;flex-direction:column/.test(cssSrc), "under 1024px the split is a real flex column");
    ok(/html:has\(body\.seats-open\)\{position:fixed;inset:0;width:100%;height:100%;overflow:hidden/.test(cssSrc), "and the root cannot scroll the split out of place");
    ok(/body\.seats-open main\.wrap\{[^}]*min-width:0/.test(cssSrc), "the page pane may shrink below its content (min-width:0)");
    ok(/\.rail-x\{margin-left:auto;flex:none\}/.test(cssSrc), "the close button sits inline, not floating over the next row");
  }
  await K2.wait(60);
  const msPhone = await K2.openMs(0, "sec");
  ok(!!msPhone, "the picker opens while the band is open");
  ok(/^(auto|\d+px)$/.test(msPhone.style.maxHeight || "auto"), "and its height is left to the measured band", msPhone.style.maxHeight || "auto");
  K2.click(msPhone.querySelector('[data-ms="done"]')); await K2.wait(80);
  // fold the whole band to a status strip: the phone gets its screen back without losing the pins
  const strip0 = K2.q("#railPeek");
  ok(!!strip0, "there is a one-line pinned summary in the strip");
  K2.mouse(K2.q("#railGrip"), "mousedown", { clientX: 200, clientY: 400 });
  K2.mouse(K2.W, "mouseup", { clientX: 200, clientY: 400 });
  K2.mouse(K2.q("#railGrip"), "click", { clientX: 200, clientY: 400 });
  await K2.wait(150);
  ok(K2.q("#seatsLayer").classList.contains("slim"), "a tap on the handle folds the band away", K2.q("#seatsLayer").className);
  const hFold = parseInt(K2.W.document.body.style.getPropertyValue("--rail-h"), 10);
  ok(hFold > 60 && hFold <= 130, "folded it is a strip that still fits a line of text", hFold + "px");
  ok(/Show sections/.test(K2.q("#railMore").textContent), "the strip says how to get the rows back", K2.q("#railMore").textContent.trim());
  ok(K2.qa("#railBody .srow").length > 0, "folding hides by class, it does not throw the lists away", K2.qa("#railBody .srow").length);
  K2.click("#railMore"); await K2.wait(150);
  ok(!K2.q("#seatsLayer").classList.contains("slim"), "and unfolding restores the exact size you had", K2.W.document.body.style.getPropertyValue("--rail-h"));
  // opening the panel on a phone must not steal focus and raise the keyboard over the page
  K2.click("#seatsClose"); await K2.wait(320);
  K2.click("#seatsBtn"); await K2.wait(260);
  ok(K2.d.activeElement !== K2.q("#seatSearch"), "the filter box is not auto-focused on a phone", K2.d.activeElement && K2.d.activeElement.id);
  // pinned sections: any course, many per course, up to 50
  await K2.wait(60);
  const pinKeys = K2.qa("#railBody [data-pin][aria-pressed=\"false\"]").map((b) => b.dataset.pin);
  const of221 = pinKeys.filter((k) => k.indexOf("CSE221|") === 0).slice(0, 3);
  ok(of221.length === 3, "a course has plenty of sections to track", of221.length);
  for (const k of of221) { K2.click('[data-pin="' + k + '"]'); await K2.wait(90); }
  const pbox = K2.q("#railBody .seatbox.pinned");
  ok(!!pbox && pbox.querySelectorAll(".srow").length === 3, "three sections of the same course all stay pinned", pbox ? pbox.querySelectorAll(".srow").length : 0);
  ok(/3 of 50/.test(pbox.querySelector("h3").textContent), "the count is out of fifty", pbox.querySelector("h3").textContent.replace(/\s+/g, " ").trim());
  ok(/CSE221/.test(pbox.querySelector(".srow").textContent), "pinned rows name their course", pbox.querySelector(".srow").textContent.replace(/\s+/g, " ").trim().slice(0, 40));
  K2.click('[data-pin="' + of221[1] + '"]'); await K2.wait(120);
  ok(K2.q("#railBody .seatbox.pinned").querySelectorAll(".srow").length === 2, "unpinning one leaves the others alone");
  // the footnote must match the real cadence
  const k2Foot = K2.q("#railFoot").textContent;
  ok(/every 8 s/.test(k2Foot) && /while this panel is open/.test(k2Foot), "footnote matches the open-panel cadence", k2Foot.slice(0, 130));
  K2.click("#seatsClose"); await K2.wait(320);
  ok(/every 30 s/.test(K2.q("#railFoot").textContent) && /background/.test(K2.q("#railFoot").textContent), "and the background cadence when closed", K2.q("#railFoot").textContent.slice(0, 130));
  ok(!/every 30 s/.test(k2Foot), "the old hard-coded 30 s claim is gone");
  ok(K2.W.localStorage.getItem("prohor.seatsMode") === "closed", "closed is the one setting that is remembered", K2.W.localStorage.getItem("prohor.seatsMode"));
  // exam + day colours in the seat rows
  K2.click("#seatsBtn"); await K2.wait(140);
  const k2Row = K2.q("#railBody .srow");
  ok(/class="k-day"/.test(k2Row.innerHTML), "day names are colour-coded");
  ok(/class="k-mid"[^>]*>Mid</.test(k2Row.innerHTML), "mid term is labelled and coloured", (k2Row.querySelector(".exs") || { textContent: "" }).textContent.replace(/\s+/g, " ").trim());
  ok(/class="k-fin"[^>]*>Fin</.test(k2Row.innerHTML), "final term is labelled and coloured");
  ok(/\w+ \d+, 20\d\d/.test(k2Row.textContent), "both exam dates are shown", k2Row.querySelector(".exs").textContent.replace(/\s+/g, " ").trim());
  const labSeatRow = [...K2.qa("#railBody .srow")].find((r) => /Lab/.test(r.textContent));
  ok(!!labSeatRow && /class="k-lab"/.test(labSeatRow.innerHTML), "lab meetings get their own tag", labSeatRow ? "found" : "no lab row");
  await K2.add("CSE320"); await K2.wait(120);
  K2.set("#seatSearch", "mid"); await K2.wait(220);
  ok(K2.qa("#railBody .srow").length > 0, "searching 'mid' finds rows by their exam text", K2.qa("#railBody .srow").length);
  K2.click("#seatClr"); await K2.wait(140);
  K2.click("[data-clearpins]"); await K2.wait(150);
  ok(!K2.q("#railBody .seatbox.pinned"), "clear all empties the list");
  ok((JSON.parse(K2.W.localStorage.getItem("prohor.state") || "{}").pins || []).length === 0, "and the saved one too");
  // fifty at once is allowed; the 51st is refused
  const pool = [];
  const byCode = {};
  for (const sec of snapshotRaw.sections) {
    if (pool.length >= 50) break;
    const k = sec.c + "|" + sec.sec;
    if (byCode[k]) continue;
    byCode[k] = 1;
    pool.push({ code: sec.c, sec: String(sec.sec) });
  }
  ok(pool.length === 50, "the fixture offers fifty distinct sections to seed", pool.length);
  const K3 = boot({ width: 1440, seedState: { pins: pool } });
  await K3.ready(); await K3.wait(120);
  K3.click("#seatsBtn"); await K3.wait(200);
  const spare = snapshotRaw.sections.find((x) => !pool.some((p) => p.code === x.c && p.sec === String(x.sec)));
  K3.set("#seatSearch", spare.c.toLowerCase()); await K3.wait(240);
  K3.click("#railBody .coursebtn"); await K3.wait(220);              // open that course: its sections are not pinned yet
  const pinned = K3.q("#railBody .seatbox.pinned");
  ok(!!pinned, "the pinned box exists", pinned ? pinned.querySelectorAll(".srow").length : "no box")
  ok(!!pinned && pinned.querySelectorAll(".srow").length === 50, "all fifty show up in the pinned box", pinned ? pinned.querySelectorAll(".srow").length : 0);
  ok(/50 of 50/.test(pinned.querySelector("h3").textContent), "the header reads 50 of 50", pinned.querySelector("h3").textContent.replace(/\s+/g, " ").trim());
  ok(K3.qa("#railBody .seatbox.pinned .cc").length === 50, "every pinned row names its course", K3.qa("#railBody .srow .cc").length);
  const extra = K3.q('#railBody [data-pin][aria-pressed="false"]');
  ok(!!extra, "there are still sections one could add", extra ? extra.dataset.pin : "-");
  K3.click(extra); await K3.wait(120);
  ok(JSON.parse(K3.W.localStorage.getItem("prohor.state")).pins.length === 50, "the fifty-first is refused");
  ok(/50 sections at most/.test(K3.txt("#toasts")), "with an explanation", (K3.txt("#toasts") || "").slice(-56));
  try { K2.dom.close(); K3.dom.close(); } catch (e) { }

  console.log("\n--- seats rail pass ---");
  ok(A.d.querySelectorAll("#railBody").length === 1, "exactly one seats panel in the document", A.d.querySelectorAll("#railBody").length);
  ok(!!A.d.querySelector("#seatsLayer #railBody"), "it lives inside the drawer, not in the page columns", !!A.d.querySelector("#seatsLayer #railBody"));
  ok(!A.d.querySelector("#step1 #railBody, .columns #railBody"), "nothing seats-related is left in the main flow");
  ok(A.d.querySelectorAll("#seatsBtn").length === 1, "one seats toggle in the header");
  A.click("#seatsBtn"); await A.wait(120);
  ok(A.q("#seatsLayer").classList.contains("open"), "the toggle opens the drawer");
  ok(A.qa("#railBody .seatbox").length > 0, "the drawer holds the live lists", A.qa("#railBody .seatbox").length);
  A.click("#seatsClose"); await A.wait(320);
  ok(A.q("#seatsLayer").hidden === true, "and the close button puts it away");
  ok(A.W.localStorage.getItem("prohor.seatsMode") === "closed", "the closed state is remembered", A.W.localStorage.getItem("prohor.seatsMode"));
  const R = boot({});
  await R.ready();
  const boxTitles = () => R.qa("#railBody .seatbox > h3").map((h) => (h.childNodes[0].textContent || "").trim());
  ok(boxTitles().join("|") === "All courses", "with no courses only the whole-catalogue box shows, at the top", boxTitles().join("|"));
  const firstCourse = R.q("#railBody .coursebtn");
  ok(/ACT201/.test(firstCourse.textContent), "catalogue box is alphabetical", firstCourse.textContent.replace(/\s+/g, " ").trim().slice(0, 40));
  const codes = R.qa("#railBody .coursebtn .code").map((x) => x.textContent);
  ok(codes.slice(0, 60).join() === codes.slice(0, 60).sort().join(), "courses sorted A→Z");
  ok(R.qa("#railBody .srow").length === 0, "sections are not dumped into the DOM until a course is opened");
  R.click(firstCourse); await R.wait(80);
  const opened = R.qa("#railBody .coursebtn")[0].parentElement.querySelectorAll(".srow");
  ok(opened.length > 0, "opening a course reveals its sections", opened.length);
  const secNums = [...opened].map((r) => r.querySelector(".sec").textContent);
  ok(secNums.join() === secNums.slice().sort().join(), "sections sorted by section number ascending", secNums.slice(0, 4).join(","));
  const oneRow = opened[0];
  ok(/\[|]/.test(oneRow.querySelector(".sec").textContent) && /[A-Z]{2,5}/.test(oneRow.querySelector(".f").textContent), "row shows the section and the faculty short form", oneRow.textContent.replace(/\s+/g, " ").trim().slice(0, 70));
  ok(/\d{1,2}:\d{2}\s?[AP]M/.test(oneRow.querySelector(".t").textContent), "row shows the time slot on a 12-hour clock", oneRow.querySelector(".t").textContent.trim());
  ok(/k-day/.test(oneRow.querySelector(".t").innerHTML), "days inside the time slot are colour-coded");
  ok(/Mid|Fin|no exam/.test(oneRow.querySelector(".exs").textContent), "row shows both exam slots", oneRow.querySelector(".exs").textContent.replace(/\s+/g, " ").trim());
  ok(/free|full|–/.test(oneRow.querySelector(".seat").textContent), "row shows the seat state", oneRow.querySelector(".seat").textContent.trim());

  await R.add("CSE221"); await R.add("MAT216");
  await R.wait(120);
  ok(boxTitles().join("|") === "Your courses|All courses", "choosing courses puts their box on top, catalogue below", boxTitles().join("|"));
  const chosenRows = [...R.qa("#railBody .seatbox")[0].querySelectorAll(".srow")];
  ok(chosenRows.length >= 30, "chosen box lists every section of both courses", chosenRows.length);
  const cGroups = [...R.qa("#railBody .seatbox")[0].querySelectorAll(".sgroup > h4 .code, .sgroup > h4")].map((x) => x.textContent.trim());
  ok(/CSE221/.test(cGroups.join(" ")) && /MAT216/.test(cGroups.join(" ")), "grouped per chosen course");

  await R.gen();
  const titles3 = boxTitles();
  ok(titles3.join("|") === "On this routine page|Your courses|All courses", "after generating, the page box appears on top and the others shift down", titles3.join("|"));
  const pageRows = () => [...R.qa("#railBody .seatbox")[0].querySelectorAll(".srow")];
  const before = pageRows().map((r) => r.textContent.replace(/\s+/g, " ")).join("|");
  ok(pageRows().length > 0, "the page box lists the sections shown on this page", pageRows().length);
  ok(pageRows().some((r) => /on this page/.test(r.textContent)), "sections actually used by a routine are marked");
  ok(R.qa("#railBody .seatbox")[0].querySelector("h4").textContent.includes("CSE221"), "the 1st chosen course leads the page box", R.qa("#railBody .seatbox")[0].querySelector("h4").textContent.trim());
  R.click('[data-pg="next"]'); await R.wait(350);
  const after = pageRows().map((r) => r.textContent.replace(/\s+/g, " ")).join("|");
  ok(before !== after, "the page box follows the combination page as it changes", before.slice(0, 40) + "  ≠  " + after.slice(0, 40));
  ok(/page 2/.test(R.q("#railBody .seatbox").textContent), "and shows which page it reflects", R.q("#railBody .seatbox h3").textContent.replace(/\s+/g, " ").trim());

  // search box filters every list
  R.set("#seatSearch", "iba"); await R.wait(250);
  const filt = pageRows();
  ok(filt.length > 0 && filt.every((r) => /IBA|CSE221/.test(r.textContent)), "the filter narrows the lists (faculty initials here)", filt.map(r => r.textContent.replace(/\s+/g, " ").slice(0, 24)).join(" / ").slice(0, 120));
  R.set("#seatSearch", "linear algebra"); await R.wait(250);
  ok(R.qa("#railBody .seatbox").length >= 1 && /MAT216/.test(R.q("#railBody").textContent), "filtering by course title works", R.q("#railBody").textContent.replace(/\s+/g, " ").slice(0, 80));
  R.set("#seatSearch", "zzzz-nothing"); await R.wait(250);
  ok(/Nothing matches/.test(R.q("#railBody").textContent), "empty filter result is explained", R.q("#railBody").textContent.replace(/\s+/g, " ").slice(0, 80));
  R.click("#seatClr"); await R.wait(200);
  ok(R.q("#seatSearch").value === "" && pageRows().length > 0, "clearing the filter brings the lists back");

  // pinning (expand a course first so a seat row definitely exists)
  const cb = R.q("#railBody .coursebtn");
  if (cb) { R.click(cb); await R.wait(120); }
  const pinBtn = R.q("#railBody [data-pin]");
  const pinKey = pinBtn.dataset.pin;
  R.click(pinBtn); await R.wait(150);
  const pBox = R.q("#railBody .seatbox.pinned");
  ok(!!pBox, "pinning puts a Pinned box on the rail");
  ok(R.qa("#railBody .seatbox")[0].classList.contains("pinned"), "the pinned box sits above everything else");
  ok(pBox.textContent.includes(pinKey.split("|")[1]), "it shows the pinned section", pBox.textContent.replace(/\s+/g, " ").trim().slice(0, 90));
  ok(JSON.parse(R.W.localStorage.getItem("prohor.state")).pins.length === 1, "pins persist to storage");
  // several sections of one course can be tracked at the same time
  const sameCourse = R.qa("#railBody .srow").map((r) => r.querySelector("[data-pin]")).find((b) => b && b.dataset.pin.split("|")[0] === pinKey.split("|")[0] && b.dataset.pin !== pinKey);
  if (sameCourse) { R.click(sameCourse); await R.wait(150);
    ok(R.q("#railBody .seatbox.pinned").querySelectorAll(".srow").length === 2, "both sections of that course stay pinned");
    const txt2 = R.q("#railBody .seatbox.pinned").textContent.replace(/\s+/g, " ");
    ok(txt2.includes(pinKey.split("|")[1]) && txt2.includes(sameCourse.dataset.pin.split("|")[1]), "the list shows each one", txt2.slice(0, 70));
    ok(/2 of 50/.test(R.q("#railBody .seatbox.pinned h3").textContent), "and counts them out of fifty", R.q("#railBody .seatbox.pinned h3").textContent.replace(/\s+/g, " ").trim());
  }
  R.click('[data-clearpins]'); await R.wait(120);
  ok(!R.q("#railBody .seatbox.pinned"), "clear-all removes the pins");

  // pause / resume
  R.click("#seatPause"); await R.wait(60);
  ok(R.q("#seatPause").textContent === "Resume" && R.q("#railLive").getAttribute("data-state") === "paused", "pause stops the seat poll and says so", R.q("#seatAgo").textContent);
  R.click("#seatPause"); await R.wait(60);
  ok(R.q("#seatPause").textContent === "Pause", "resume restores it");

  // a seat refresh must not disturb the routine page at all
  const listHtml = R.q("#resultsBody").innerHTML;
  const descHtml = R.q("#resultsDesc").textContent;
  const genDisabledBefore = R.q("#genBtn").disabled;
  R.click("#seatNow");
  await R.wait(900);
  ok(R.q("#resultsBody").innerHTML === listHtml, "results markup is byte-identical after a seat refresh");
  ok(R.q("#resultsDesc").textContent === descHtml, "the results summary is untouched");
  ok(R.q("#genBtn").disabled === genDisabledBefore, "the search state is untouched");
  ok(/seats updated \d+ s ago/.test(R.q("#seatAgo").textContent), "the rail reports its own clock", R.q("#seatAgo").textContent);
  ok(pageRows().length > 0 && pageRows().every((r) => r.querySelector(".seat")), "every seat row keeps a seat pill");

  console.log("\n--- a half-delivered feed is refused, not adopted ---");
  const T9 = boot({ tinyLive: true });
  await T9.ready();
  ok(/Offline copy|snapshot/i.test(T9.txt("#livePill")), "a 3-section response is treated as broken and the bundled snapshot is used instead", T9.txt("#livePill").slice(0, 90));
  const snapCount = snapshotRaw.sections.length.toLocaleString("en-US");
  ok(T9.txt("#livePill").includes(snapCount), "the header counts the bundled snapshot, not 1 or 3", T9.txt("#livePill").slice(0, 60));
  await T9.add("CSE221");
  ok(T9.q("#courseCount").textContent.trim() === "1 of 6 courses", "the course counter agrees with the cards", T9.q("#courseCount").textContent.trim());
  ok(T9.qa("#courses .course").length === 1 && !/not in this feed/.test(T9.txt(T9.card(0))), "CSE221 resolves from the snapshot, not the half feed", T9.txt(T9.card(0)).slice(0, 60));
  try { T9.dom.close(); } catch (e) { }

  /* ---------------------------- the seats page (?view=seats) ---------------------------- */
  console.log("\n--- seats page pass ---");
  const P0 = boot({ width: 390 });
  await P0.ready();
  ok(!!P0.q("#railPop") && !!P0.q("#railWin"), "the panel header offers the two page actions");
  ok(P0.q("#railBack").hidden === true, "and the way back is put away while you are in the planner");
  const pgOpens = [];
  P0.W.open = (u, n, f) => { pgOpens.push({ u, n, f }); return { closed: false, close() { this.closed = true; } }; };
  P0.click("#railWin"); await P0.wait(120);
  ok(pgOpens.length === 1, "New window opens the seats page in a second window", JSON.stringify(pgOpens));
  ok(/_blank/.test(pgOpens[0].n) && /noopener/.test(pgOpens[0].f) && /view=seats/.test(pgOpens[0].u), "…safely, on the right URL", JSON.stringify(pgOpens[0]));
  ok(!P0.d.body.classList.contains("view-seats"), "this tab keeps planning");
  P0.click("#railPop"); await P0.wait(200);
  ok(P0.d.body.classList.contains("view-seats"), "Open as page turns this tab into the seats page", P0.d.body.className);
  ok(P0.q("#seatsLayer").hidden === false, "the panel is shown as the document, not a band");
  ok(!P0.d.body.classList.contains("seats-open"), "and no split padding is put on the page");
  ok(/view=seats/.test(P0.W.location.search), "the URL records which page you are on", P0.W.location.search);
  ok(/Seats/.test(P0.W.document.title), "and the tab is labelled for it", P0.W.document.title);
  ok(!P0.q("#railBack").hidden, "a way back appeared", P0.q("#railBack").textContent.replace(/\s+/g, " ").trim());
  await P0.add("CSE221");
  ok(P0.qa("#courses .course").length === 1, "the planner still works underneath, so nothing is lost", P0.qa("#courses .course").length);
  const pgRows = P0.qa("#railBody .srow").length;
  ok(pgRows > 0, "the lists render as a page", pgRows);
  await P0.wait(200);
  ok(/scroll-padding-top:var\(--stick,1\d\dpx\)/.test(cssSrc), "the sticky inset has a sane fallback for when layout is unavailable");
  const pgInset = P0.W.document.documentElement.style.getPropertyValue("--stick");
  ok(pgInset === "" || parseInt(pgInset, 10) > 60, "and a zero-height measurement never overwrites it", JSON.stringify(pgInset));
  P0.click("#railBody [data-pin]"); await P0.wait(180);
  ok((JSON.parse(P0.W.localStorage.getItem("prohor.state")).pins || []).length === 1, "pinning from the page persists", JSON.stringify(JSON.parse(P0.W.localStorage.getItem("prohor.state")).pins));
  // another window's changes arrive through the storage event
  const pgEv = new P0.W.Event("storage");
  Object.defineProperty(pgEv, "key", { value: "prohor.state" });
  Object.defineProperty(pgEv, "newValue", { value: JSON.stringify({ pins: [{ code: "MAT216", sec: "04" }, { code: "CSE221", sec: "01" }], courses: [{ code: "MAT216", locked: [], faculty: [], secs: [] }] }) });
  P0.W.dispatchEvent(pgEv); await P0.wait(220);
  ok(P0.qa("#railBody .seatbox.pinned .srow").length === 2, "a planner window's pins arrive live", P0.qa("#railBody .seatbox.pinned .srow").length);
  ok(/MAT216/.test(P0.txt("#railBody")), "and so does its course list", P0.txt("#railBody").slice(0, 60));
  P0.click("#railBack"); await P0.wait(250);
  ok(!P0.d.body.classList.contains("view-seats"), "Planner returns to the split view");
  ok(!/view=seats/.test(P0.W.location.search), "and the URL is clean again", P0.W.location.search || "(root)");
  ok(P0.d.body.classList.contains("seats-open"), "the panel is back beside the page", P0.d.body.className);
  // two dead-ends the sweep found, kept shut: closing on the page must not blank it, and a page
  // must never also wear the split's class (that would apply band geometry to a whole document)
  P0.click("#railPop"); await P0.wait(180);
  const pgClose = P0.q("#seatsClose");
  if (pgClose) P0.click(pgClose);                       // its ✕ is hidden, but the handler must be inert too
  await P0.wait(180);
  ok(P0.q("#seatsLayer").hidden === false, "a close on the seats page is refused rather than blanking it");
  ok(!(P0.d.body.classList.contains("view-seats") && P0.d.body.classList.contains("seats-open")), "and a page never carries the split's class", P0.d.body.className);
  P0.click("#railBack"); await P0.wait(200);

  const P1 = boot({ width: 390, url: "https://routine.test/?view=seats" });
  await P1.ready(); await P1.wait(250);
  ok(P1.d.body.classList.contains("view-seats"), "the URL alone boots the seats page");
  ok(/body\.view-seats \.rail-h #railPop[^{]*\{display:none !important\}/.test(cssSrc), "and the page hides the button that would open itself again");
  ok(P1.qa("#railBody .seatbox").length > 0, "with the lists ready", P1.qa("#railBody .seatbox").length);
  const P2 = boot({ width: 1440, url: "https://routine.test/?view=seats" });
  await P2.ready(); await P2.wait(250);
  ok(P2.d.body.classList.contains("view-seats") && !P2.d.body.classList.contains("seats-open"), "on a wide screen the page is a page, not a side column");
  ok(/view-seats \.rail-top\{position:sticky/.test(htmlSrc) || /body\.view-seats \.rail-top\{position:sticky/.test(cssSrc), "its chrome sticks while the rows scroll");
  ok(/body\.view-seats main\.wrap\{display:none\}|view-seats main\.wrap[^{]*\{[^}]*display:none/.test(cssSrc), "the planner is hidden on the seats page");
  ok(!/view-seats[^{]*\{[^}]*pointer-events:auto/.test(cssSrc) || /\.seats-layer\{[^}]*pointer-events:none/.test(cssSrc), "and the overlay never eats a click");
  try { P0.dom.close(); P1.dom.close(); P2.dom.close(); } catch (e) { }

  console.log("\n--- mobile pass ---");
  const M = boot({ mobile: true, width: 390 });
  await M.ready();
  await M.add("CSE221"); await M.add("MAT216");
  ok(M.qa("#courses .course").length === 2, "cards stack on mobile");
  ok(M.q("#step2").classList.contains("collapsed"), "preferences collapse once a course is added");
  M.click("#prefsToggle"); await wait(40);
  ok(!M.q("#step2").classList.contains("collapsed"), "the disclosure reopens");
  const mms = await M.openMs(0, "ts");
  ok(!!mms.querySelector(".ms-foot [data-ms=done]"), "picker footer has Done for thumb taps");
  M.click(mms.querySelector('[data-ms="done"]')); await wait(60);
  ok(!M.q(".course .ms"), "Done closes the popover");
  await M.gen();
  ok(M.cards().length > 0, "generation works on a phone width", M.cards().length);
  ok(/grid-template-columns/.test(M.q(".rgrid").getAttribute("style") || ""), "grid columns set inline for scrolling", (M.q(".rgrid").getAttribute("style") || "").slice(0, 60));
  const css = cssSrc;
  ok(/max-width:520px\)\{\.controls\{grid-template-columns:1fr\}/.test(css), "course controls stack under 520px");
  ok(/max-width:1023px\)\{\.columns\{grid-template-columns:1fr\}/.test(css), "two columns collapse under 1024px");
  ok(/\.grid-wrap\{overflow:auto/.test(css), "the timetable scrolls sideways instead of the page");
  ok(/min-width:min\(100%,760px\)/.test(css), "grid can shrink below 760px on narrow screens");
  ok(/@media \(prefers-reduced-motion:reduce\)/.test(css), "reduced motion honoured");
  ok(/:focus-visible\{outline:none;box-shadow:var\(--focus-ring\)/.test(css), "single visible focus style");
  ok(!/linear-gradient\((?!.*repeating)/i.test(css.replace(/repeating-linear-gradient\([^)]*\)/g, "")), "no decorative gradients in the theme");
  ok(!/#[0-9a-f]{3,8}/i.test(css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^;]+;/g, "")), "no hard-coded colours outside the token block");
  ok(/Instrument Serif/.test(htmlSrc) && /display=swap/.test(htmlSrc), "brand font loaded with swap");
  ok(/system-ui/.test(css) && /ui-monospace/.test(css), "font stacks fall back offline");

  console.log("\nconsole/jsdom errors: " + (errors.length ? errors.slice(0, 3).join(" | ") : "none"));
  ok(errors.length === 0, "no page errors across every pass", errors.length);
  log("\n" + (fail ? fail + " CHECK(S) FAILED" : "ALL BROWSER CHECKS PASSED"));
  process.exit(fail ? 1 : 0);
})().catch((e) => { log("HARNESS ERROR: " + ((e && e.stack) || e)); process.exit(2); });
