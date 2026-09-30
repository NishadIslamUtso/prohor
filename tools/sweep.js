/*
 * Randomised UI sweep for Prohor — the "click everything in a random order" check.
 *
 * Seeded, so a failure reproduces:  node tools/sweep.js [seed]
 * It drives the real page in jsdom across both views (the split band and ?view=seats) and asserts,
 * after every single action, that the app cannot have fallen into a bad state:
 *   · the URL and the body class agree about which view you are in, and a page is never also a split
 *   · the band's hidden attribute and body.seats-open stay in step
 *   · a greyed picker row never accepts a tick; no picker is left detached in the DOM
 *   · pins stay ≤ 50 and well-formed, courses ≤ 6, ids unique, --rail-w / --stick in range
 *   · no "undefined" / "NaN" / "[object Object]" ever reaches the visible text
 *   · no uncaught page error, and a foreign storage event (another window) can never corrupt state
 */
const fs = require("fs"), path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const path0 = require("path");
const root = path0.resolve(__dirname, "..");
const full = JSON.parse(fs.readFileSync(path.join(root, "snapshot.json"), "utf8"));
const KEEP = new Set(["CSE221", "MAT216", "CSE320", "CSE250", "CSE101", "ACT201", "CHN101", "PHY111"]);
const seenC = new Set();
const snap = Object.assign({}, full, { sections: full.sections.filter(x => KEEP.has(x.c) ? true : (seenC.has(x.c) ? false : (seenC.add(x.c), true))) });
const names = JSON.parse(fs.readFileSync(path.join(root, "faculty-names.json"), "utf8"));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const core = fs.readFileSync(path.join(root, "core.js"), "utf8");

let seed = Number(process.argv[2] || 1);
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const IGNORED = /not implemented: window'?s?[\s.]*scrollto|could not parse css/i;
const errs = [];
const vc = new VirtualConsole();
vc.on("jsdomError", e => { const m = "jsdomError: " + String((e && (e.detail || e.message)) || e); if (!IGNORED.test(m)) errs.push(m); });
vc.on("error", (...a) => errs.push("console.error: " + a.join(" ")));

let fail = 0;
function ok(c, l, x) { if (c) console.log("pass  " + l + (x !== undefined ? "  -> " + x : "")); else { fail++; console.log("FAIL  " + l + (x !== undefined ? "  -> " + x : "")); } }

(async () => {
  const dom = new JSDOM(html.replace('<script src="./core.js"></script>', "<script>" + core + "</scr" + "ipt>"), {
    url: "https://routine.test/", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: false, media: q, addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { } });
      Object.defineProperty(w, "innerWidth", { value: 390, configurable: true, writable: true });
      Object.defineProperty(w, "innerHeight", { value: 844, configurable: true, writable: true });
      w.Element.prototype.scrollIntoView = function () { };
      w.opened = [];
      w.open = (u, n, f) => { w.opened.push(u); return { close() { }, focus() { } }; };
      w.HTMLCanvasElement.prototype.getContext = function () { const n = () => { }; return { canvas: this, scale: n, fillRect: n, strokeRect: n, beginPath: n, closePath: n, moveTo: n, lineTo: n, fill: n, arc: n, stroke: n, fillText: n, measureText: (t) => ({ width: String(t).length * 6 }), set fillStyle(v) { }, get fillStyle() { return "#000"; }, set strokeStyle(v) { }, set lineWidth(v) { }, set font(v) { }, set textBaseline(v) { } }; };
      w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";
      w.HTMLAnchorElement.prototype.click = function () { (w.__dl = w.__dl || []).push(this.download); };
      w.fetch = async (u) => {
        const s = String(u);
        if (s.includes("connect.json")) { if (rnd() < 0.12) throw new TypeError("Failed to fetch"); return { ok: true, status: 200, headers: { get: () => null }, json: async () => snap }; }
        if (s.includes("snapshot.json")) return { ok: true, status: 200, headers: { get: () => null }, json: async () => snap };
        if (s.includes("faculty-names.json")) return { ok: true, status: 200, headers: { get: () => null }, json: async () => names };
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => { throw new Error("404"); } };
      };
    }
  });
  const d = dom.window.document, W = dom.window;
  const q = (s) => d.querySelector(s);
  const qa = (s) => Array.prototype.slice.call(d.querySelectorAll(s));
  const txt = (x) => { const e = typeof x === "string" ? q(x) : x; return e ? e.textContent.replace(/\s+/g, " ").trim() : ""; };
  const click = (x) => { const e = typeof x === "string" ? q(x) : e0(x); if (e && e.dispatchEvent) e.dispatchEvent(new W.MouseEvent("click", { bubbles: true, cancelable: true })); return e; };
  const e0 = (x) => x;
  const mouse = (x, type, cx, cy) => { const e = typeof x === "string" ? q(x) : x; if (e) e.dispatchEvent(new W.MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx || 0, clientY: cy || 0 })); };
  const key = (x, k) => { const e = typeof x === "string" ? q(x) : x; if (e) e.dispatchEvent(new W.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); };

  const t0 = Date.now();
  while (Date.now() - t0 < 20000 && !/[0-9][0-9,]* sections?/.test(txt("#livePill"))) await wait(50);
  ok(q("#livePill").getAttribute("data-state") !== "busy", "booted", txt("#livePill").slice(0, 50));

  const codes = [...KEEP];
  const kinds = ["ts", "sec", "fac"];
  let steps = 0, pages = 0, wins = 0, gens = 0;

  for (let i = 0; i < 220; i++) {
    const r = rnd();
    try {
      if (r < 0.1) {                                   // add a course
        const inp = q("#courseSearch");
        if (inp && !inp.disabled) {
          const code = pick(codes);
          inp.value = code; inp.dispatchEvent(new W.Event("input", { bubbles: true }));
          await wait(35);
          const o = qa("#courseList .option").find((x) => x.dataset.code === code);
          if (o) { o.dispatchEvent(new W.MouseEvent("mousedown", { bubbles: true, cancelable: true })); steps++; }
          if (rnd() < 0.2 && q("#searchClr") && !q("#searchClr").hidden) click("#searchClr");
        }
      } else if (r < 0.3) {                             // a picker on a random card
        const cards = qa("#courses .course");
        if (!cards.length) continue;
        const card = pick(cards);
        const btn = card.querySelector('[data-act="open-' + pick(kinds) + '"]');
        if (!btn) continue;
        click(btn); await wait(40);
        const ms = card.querySelector(".ms");
        if (!ms) { ok(false, "a picker failed to open", btn.dataset.act); break; }
        const rows = [].slice.call(ms.querySelectorAll(".ms-row"));
        for (let n = 0; n < 3 && rows.length; n++) {
          const row = pick(rows), box = row.querySelector("input");
          if (!box) continue;
          box.checked = !box.checked;
          box.dispatchEvent(new W.Event("change", { bubbles: true }));
          await wait(6);
          if (row.classList.contains("dim") && box.checked) { ok(false, "a greyed row accepted a tick"); break; }
        }
        if (rnd() < 0.3) click(ms.querySelector('[data-ms="all"]'));
        if (rnd() < 0.2) click(ms.querySelector('[data-ms="clear"]'));
        await wait(25);
        click(ms.querySelector('[data-ms="done"]')); await wait(40);
        steps++;
      } else if (r < 0.42) {                            // the seats page: pop out / open as page / back
        const g = rnd();
        if (g < 0.3) { click("#railWin"); wins++; }
        else if (g < 0.65) { click("#railPop"); pages++; }
        else click("#railBack");
        await wait(140); steps++;
      } else if (r < 0.52) {                            // band controls
        const el = pick(["#railGrip", "#railMore", "#seatsClose", "#seatsBtn", "#seatNow", "#seatPause"]);
        if (el === "#railGrip") { mouse("#railGrip", "mousedown", 200, Math.floor(rnd() * 900)); mouse(W, "mousemove", 200, Math.floor(rnd() * 1200) - 150); mouse(W, "mouseup", 200, 400); key("#railGrip", pick(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"])); if (rnd() < 0.4) mouse("#railGrip", "click", 200, 400); }
        else click(el);
        await wait(110); steps++;
      } else if (r < 0.62) {                            // pins + the catalogue
        if (rnd() < 0.45) { const p = q('#railBody [data-pin][aria-pressed="false"]') || q("#railBody [data-pin]"); if (p) click(p); }
        else { const cb = q('#railBody .coursebtn[aria-expanded="false"]') || q("#railBody .coursebtn"); if (cb) click(cb); }
        if (rnd() < 0.4) { const sa = q("#railBody [data-showall]"); if (sa) click(sa); }
        if (rnd() < 0.3) click("[data-clearpins]");
        await wait(120); steps++;
      } else if (r < 0.72) {                            // the seat filter
        const inp = q("#seatSearch");
        inp.value = pick(["", "iba", "lab", "cse", "mid", "9:", "zz-nope", "  spaced  "]);
        inp.dispatchEvent(new W.Event("input", { bubbles: true }));
        await wait(170);
        if (rnd() < 0.3 && q("#seatClr") && !q("#seatClr").hidden) click("#seatClr");
        steps++;
      } else if (r < 0.84) {                            // generate + paging + swap + png + prefs
        if (!q("#genBtn").disabled) { click("#genBtn"); gens++; await wait(320); }
        const nx = q('[data-pg="next"]'); if (nx && !nx.disabled) { click(nx); await wait(280); }
        if (rnd() < 0.3) { const pv = q('[data-pg="prev"]'); if (pv && !pv.disabled) { click(pv); await wait(220); } }
        if (rnd() < 0.25) { const al = pick(qa("#resultsBody .alt-course input[type=radio]")); if (al) { al.checked = true; al.dispatchEvent(new W.Event("change", { bubbles: true })); await wait(90); } }
        if (rnd() < 0.15) { const dl = pick(qa('[data-ra="png"]')); if (dl) { click(dl); await wait(140); } }
        if (rnd() < 0.2) { const sz = q("#pageSize"); if (sz) { sz.value = pick(["10", "25", "50"]); sz.dispatchEvent(new W.Event("change", { bubbles: true })); await wait(220); } }
        if (rnd() < 0.2) { const so = q("#sortBy"); if (so) { so.value = pick([].slice.call(so.options).map(o => o.value)); so.dispatchEvent(new W.Event("change", { bubbles: true })); await wait(140); } }
        steps++;
      } else if (r < 0.93) {                            // rotate + theme + a storage event from "another window"
        try { Object.defineProperty(W, "innerWidth", { value: pick([360, 390, 700, 1024, 1280, 1600]), configurable: true, writable: true }); } catch (e) { }
        W.dispatchEvent(new W.Event("resize"));
        if (rnd() < 0.4) click("#themeBtn");
        if (rnd() < 0.5) {
          const ev = new W.Event("storage");
          Object.defineProperty(ev, "key", { value: rnd() < 0.75 ? "prohor.state" : "something.else" });
          const payload = rnd() < 0.25 ? "{ not json" : JSON.stringify({
            pins: Array.from({ length: Math.floor(rnd() * 8) }, () => { const c = pick(codes); return { code: c, sec: String(1 + Math.floor(rnd() * 9)) }; }),
            courses: [{ code: pick(codes), locked: [], faculty: [], secs: [] }],
          });
          Object.defineProperty(ev, "newValue", { value: payload });
          W.dispatchEvent(ev);
        }
        await wait(90); steps++;
      } else {                                          // prefs + escape + dialog
        const chip = pick(qa("#step2 button")); if (chip) click(chip);
        if (rnd() < 0.4) key(d.body, "Escape");
        if (rnd() < 0.2) { click("#howBtn"); await wait(60); click("#howClose"); }
        await wait(50); steps++;
      }
    } catch (e) { ok(false, "step " + i + " threw", (e && e.message) || e); break; }

    // ── invariants ──────────────────────────────────────────────────────────────────
    const body = d.body, layer = q("#seatsLayer"), html2 = d.documentElement;
    const viewPage = body.classList.contains("view-seats");
    const splitOpen = body.classList.contains("seats-open");
    if (viewPage && splitOpen) { ok(false, "a page and a split at once", body.className); break; }
    if (viewPage !== /view=seats/.test(W.location.search)) { ok(false, "the URL and the view disagree", W.location.search + " / " + body.className); break; }
    if (viewPage && layer.hidden) { ok(false, "the seats page hides the panel it exists to show"); break; }
    if (!viewPage && layer.hidden === splitOpen) { ok(false, "the band and its class are out of step", String(layer.hidden) + "/" + splitOpen); break; }
    const ids = qa("[id]").map(x => x.id);
    if (new Set(ids).size !== ids.length) { ok(false, "duplicate ids appeared"); break; }
    const saved = JSON.parse(W.localStorage.getItem("prohor.state") || "{}");
    const pins = saved.pins || [];
    if (pins.length > 50) { ok(false, "pins escaped the cap", pins.length); break; }
    if (pins.some(p => !p || !p.code || p.sec == null)) { ok(false, "a malformed pin was saved", JSON.stringify(pins.slice(-2))); break; }
    if (saved.courses && saved.courses.length > 6) { ok(false, "more than six courses saved", saved.courses.length); break; }
    const rh = parseInt(html2.style.getPropertyValue("--stick") || html2.style.getPropertyValue("--stick") || "0", 10);
    if (rh && (rh < 40 || rh > 400)) { ok(false, "the sticky inset is nonsense", rh); break; }
    const rw = parseInt(body.style.getPropertyValue("--rail-w") || "0", 10);
    if (rw && (rw < 290 || rw > 1250)) { ok(false, "the band width escaped its range", rw); break; }
    const seen = ["#courses", "#step2", "#resultsBody", "#railBody", "#summary", ".action-bar", "footer"].map(sel => { const e = q(sel); return e ? e.textContent : ""; }).join(" ");
    if (/undefined|NaN|\[object Object\]/.test(seen)) {
      ok(false, "junk text at step " + i, (seen.match(/.{0,50}(undefined|NaN|\[object Object\]).{0,30}/) || [""])[0].replace(/\s+/g, " ")); break;
    }
    if (!q(".ms") && q("#courses .ms")) { ok(false, "a detached popover"); break; }
    if (errs.length) { ok(false, "page error during the sweep", errs[0]); break; }
  }

  console.log("      steps=" + steps + " page-toggles=" + pages + " new-windows=" + wins + " generates=" + gens);
  ok(steps > 60, "the sweep actually exercised the app", steps);
  ok(pages > 1 && wins > 0, "both the page toggle and the pop-out ran", pages + " / " + wins);
  ok(qa("#railBody .seatbox").length > 0, "the panel always renders at least one list", qa("#railBody .seatbox").length);
  console.log("page errors: " + (errs.length ? errs.slice(0, 3).join(" | ") : "none"));
  ok(errs.length === 0, "no uncaught page errors");
  console.log("\n" + (fail ? fail + " SWEEP CHECK(S) FAILED" : "SWEEP CLEAN (seed " + (process.argv[2] || 1) + ")"));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("HARNESS " + ((e && e.stack) || e)); process.exit(2); });
