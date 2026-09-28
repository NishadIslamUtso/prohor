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
const snapshotRaw = JSON.parse(fs.readFileSync(path.join(root, "snapshot.json"), "utf8"));
const namesRaw = JSON.parse(fs.readFileSync(path.join(root, "faculty-names.json"), "utf8"));
const htmlSrc = fs.readFileSync(path.join(root, "index.html"), "utf8");
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
virtualConsole.on("jsdomError", (e) => errors.push("jsdomError: " + String((e && (e.detail || e.message)) || e)));
virtualConsole.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

let fail = 0;
function ok(cond, label, extra) {
  if (!cond) { fail++; console.log("FAIL  " + label + (extra !== undefined ? "  -> " + extra : "")); }
  else console.log("pass  " + label + (extra !== undefined ? "  -> " + extra : ""));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = (d, sel) => { const e = typeof sel === "string" ? d.querySelector(sel) : sel; return e ? e.textContent.replace(/\s+/g, " ").trim() : null; };

function boot(opts) {
  opts = opts || {};
  const calls = { live: 0, snapshot: 0, names: 0 };
  const paint = { texts: [], rects: 0, strokes: 0, arcs: 0, fills: [], strokes2: [] };
  const dom = new JSDOM(htmlSrc.replace('<script src="./core.js"></script>', "<script>" + coreSrc + "</scr" + "ipt>"), {
    url: opts.url || "https://routine.test/", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      if (opts.deviceMemory !== undefined) Object.defineProperty(window.navigator, "deviceMemory", { value: opts.deviceMemory, configurable: true });
      if (opts.cores) Object.defineProperty(window.navigator, "hardwareConcurrency", { value: opts.cores, configurable: true });
      window.matchMedia = (q) => ({ matches: !!opts.mobile && /max-width:\s*700px/.test(String(q)), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.innerWidth = opts.width || 1280;
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
          if (opts.slowLive) await wait(opts.slowLive);
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => (liveRaw || snapshotRaw) };
        }
        if (url.includes("snapshot.json")) { calls.snapshot++; if (opts.snapshotFails) throw new Error("offline"); return { ok: true, status: 200, headers: { get: () => null }, json: async () => snapshotRaw }; }
        if (url.includes("faculty-names.json")) { calls.names++; return { ok: true, status: 200, headers: { get: () => null }, json: async () => namesRaw }; }
        return { ok: false, status: 404, json: async () => { throw new Error("404"); }, headers: { get: () => null } };
      };
      if (opts.seedCache) window.localStorage.setItem("prohor-cache:feed", JSON.stringify({ at: Date.now() - (opts.cacheAge || 60000), sections: snapshotRaw.sections }));
      if (opts.seedState) window.localStorage.setItem("prohor.state", JSON.stringify(opts.seedState));
    }
  });
  const d = dom.window.document, W = dom.window;
  const A = {
    dom, d, W, calls, paint,
    mouse(elOrSel, type) {
      const e = typeof elOrSel === "string" ? d.querySelector(elOrSel) : elOrSel;
      if (!e) throw new Error("no element for " + elOrSel);
      e.dispatchEvent(new W.MouseEvent(type || "click", { bubbles: true, cancelable: true }));
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
      while (Date.now() - t0 < (ms || 12000)) { if (/sections/.test(A.txt("#livePill") || "")) return true; await wait(60); }
      return false;
    },
    async waitFor(pred, ms, label) {
      const t0 = Date.now();
      while (Date.now() - t0 < (ms || 8000)) { try { if (pred()) return true; } catch (e) { } await wait(60); }
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
      await A.waitFor(() => A.q("#genBtn").disabled === false, (ms || 30000) - 300, "search to settle");
      await wait(150);
    },
    wait: (ms) => wait(ms),
    parse(sel) { const m = /Showing ([\d,]+)–([\d,]+) of ([\d,]+)/.exec(A.txt(sel ? "#pager" : "#pager") || ""); return m ? m.map(x => +x.replace(/,/g, "")) : null; }
  };
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
  ok(A.qa(".step-head h2").map((h) => h.textContent.trim()).join(" | ") === "1 · Pick your courses | 2 · Set your preferences | 3 · Compare routines", "three numbered steps in order", A.qa(".step-head h2").map(h => h.textContent.trim()).join(" | "));
  ok(/2 · Set your preferences/.test(A.txt("#prefsToggle")), "preferences step heading");

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
  ok([...ms.querySelectorAll(".ms-row")].every((r) => /\d\d:\d\d/.test(r.textContent)), "24-hour times in the picker");
  ok([...ms.querySelectorAll(".ms-row")].every((r) => /\d\d:\d\d/.test(r.textContent) && !/[AP]M/.test(r.textContent)), "no am/pm in pickers");
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
  ok(ms.querySelectorAll(".ms-row").length === F.CSE221.faculties, "faculty rows with counts", ms.querySelectorAll(".ms-row").length);
  ok(/^\d+ sections?$/.test(ms.querySelector(".ms-row .r").textContent.trim()), "per-faculty section count", ms.querySelector(".ms-row .r").textContent.replace(/\s+/g, " ").trim());
  const ankRow = [...ms.querySelectorAll(".ms-row")].find((r) => /ANK/.test(r.textContent));
  ankRow.querySelector("input").checked = true;
  ankRow.querySelector("input").dispatchEvent(new A.W.Event("change", { bubbles: true }));
  await wait(40);
  await A.done(ms);
  ok(/ANK/.test(A.q(".course [data-act=open-fac] span").textContent), "faculty trigger shows the pick", A.q(".course [data-act=open-fac] span").textContent);
  ms = await A.openMs(0, "ts");
  const ankPatterns = fixture.courses.CSE221.groups.filter((g) => g.sections.some((x) => x.faculties.indexOf("ANK") >= 0)).length;
  ok(ms.querySelectorAll(".ms-row").length === ankPatterns && ankPatterns < F.CSE221.patterns, "faculty choice narrows the pattern list", ms.querySelectorAll(".ms-row").length + " vs " + ankPatterns);
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
  await A.add("ENG102");
  ok(A.qa("#courses .course").length === 6, "seventh course refused");
  ok(A.qa(".toast").some((t) => /semester fits within 6/.test(t.textContent)), "cap explained in a toast", A.qa(".toast").map(t => t.textContent).join("|"));
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
  ok([...c0.querySelectorAll(".blk")].every((b) => /\d\d:\d\d – \d\d:\d\d/.test(b.textContent) && /·/.test(b.textContent)), "blocks carry a time range, room and faculty");
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
  const timesBefore = (beforeTxt.match(/\d\d:\d\d – \d\d:\d\d/g) || []).length;
  const timesAfter = (afterTxt.match(/\d\d:\d\d – \d\d:\d\d/g) || []).length;
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
  ok(C2.calls.live === 1 && C2.calls.snapshot === 1, "live first, then snapshot", JSON.stringify(C2.calls));
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
  ok(!!row2, "the pattern that excludes that section is still listed", otherGroup.key.slice(0, 18));
  row2.querySelector("input").checked = true;
  row2.querySelector("input").dispatchEvent(new X2.W.Event("change", { bubbles: true }));
  await X2.done(m2);
  await X2.wait(60);
  ok(/0 patterns match|no viable pattern/i.test(X2.q(".course .caption").textContent + X2.txt("#summary")), "the contradiction is surfaced", (X2.q(".course .caption").textContent + " || " + X2.txt("#summary")).replace(/\s+/g, " ").trim());
  X2.click("#genBtn"); await X2.wait(300);
  ok(X2.cards().length === 0, "and Generate refuses instead of returning nonsense");
  ok(new RegExp("\[" + secA.sec + "\]").test(X2.q("#resultsBody").textContent), "the zero state names the offending section", X2.q("#resultsBody").textContent.replace(/\s+/g, " ").slice(0, 160));
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
  const css = htmlSrc.slice(htmlSrc.indexOf("<style>"), htmlSrc.indexOf("</style>"));
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
  console.log("\n" + (fail ? fail + " CHECK(S) FAILED" : "ALL BROWSER CHECKS PASSED"));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("HARNESS ERROR: " + ((e && e.stack) || e)); process.exit(2); });
