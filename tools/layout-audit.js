/*
 * Layout audit for Prohor — the checks jsdom cannot do.
 *
 * jsdom has no layout engine, so it cannot tell you that a panel is sitting on top of the course
 * search, or that a picker opens underneath it. This drives a real Chromium and asserts, with
 * hit-tests and measured geometry, at six viewport/view combinations:
 *
 *   planner (split view)
 *   · every control the user needs is the thing under their finger — nothing is covered
 *   · the band and the page each own their own space; neither can be slid out from under the other
 *   · pickers stay inside the page pane, flip up when there is no room, and scroll there
 *   · the document never scrolls sideways; the timetable scrolls inside its own frame
 *   · folding the band returns the screen to the page and keeps the pinned seats readable
 *
 *   seats page (?view=seats)
 *   · the panel is the document: in flow, page-scrolling, planner hidden, no handle to fight
 *   · the sticky panel header clears the app header; the last row is reachable
 *   · a second page (the planner) can add a course and this page follows it live
 *
 *   npm i -D playwright && npx playwright install chromium      # once
 *   python3 -m http.server 8000 &                                # or any static server
 *   node tools/layout-audit.js                                   # against http://localhost:8000
 *   URL=https://your-site.example node tools/layout-audit.js
 *
 * Exits 1 on a failure, 3 when no browser is available (so CI without one stays green).
 */

const BASE = (process.env.URL || "http://localhost:8000/index.html").replace(/\/index\.html$/, "");
const CASES = [
  { width: 360, height: 800, name: "phone-small" },
  { width: 390, height: 844, name: "phone" },
  { width: 768, height: 1024, name: "tablet" },
  { width: 1440, height: 900, name: "desktop" },
  { width: 390, height: 844, name: "phone-seats-page", view: "seats" },
  { width: 1440, height: 900, name: "desktop-seats-page", view: "seats" },
];

let chromium;
try { chromium = require("playwright").chromium; }
catch (e) {
  console.log("playwright is not installed here — skipping the layout audit.");
  console.log("  npm i -D playwright && npx playwright install chromium");
  process.exit(3);
}

let fail = 0;
const ok = (cond, label, extra) => {
  console.log((cond ? "pass  " : "FAIL  ") + label + (extra !== undefined ? "  -> " + extra : ""));
  if (!cond) fail++;
};

// ── runs in the page ────────────────────────────────────────────────────────────────
function inspect(targets) {
  const q = (s) => document.querySelector(s);
  const label = (el) => !el ? "nothing" : (el.id ? "#" + el.id : el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/)[0] : ""));
  const pane = q("main").getBoundingClientRect();
  const layer = q("#seatsLayer");
  const bandOpen = !!layer && !layer.hidden;
  const band = bandOpen ? q("#rail").getBoundingClientRect() : null;
  const stacked = innerWidth >= 1024 ? false : bandOpen;

  const hits = targets.map(([sel, note, zone]) => {
    const el = q(sel);
    if (!el) return { note, na: true, why: "not on this page" };
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) return { note, na: true, why: "hidden at this width" };
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    if (cy < 0 || cy > innerHeight) return { note, offscreen: true, y: Math.round(b.y) };
    const top = document.elementFromPoint(cx, cy);
    const reaches = !!top && (top === el || el.contains(top) || !!(top.closest && top.closest(sel)));
    let inZone = true;
    if (zone === "pane" && bandOpen && stacked) inZone = b.bottom <= pane.bottom + 1 && b.top >= pane.top - 1;
    if (zone === "band" && bandOpen) inZone = b.top >= band.top - 1 && b.bottom <= band.bottom + 1;
    return { note, ok: reaches && inZone, y: Math.round(b.y), scrolled: Math.round(document.scrollingElement.scrollTop), by: reaches ? null : label(top), zone: inZone ? zone : "NOT in " + zone };
  });

  const spill = [];
  document.querySelectorAll("body *").forEach((el) => {
    if (el.closest(".grid-wrap") || el.closest(".exam-wrap")) return;         // these scroll on purpose
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth + 1 || r.left < -1) {
      spill.push(label(el) + "@" + Math.round(r.right));
    }
  });

  return {
    hits,
    vw: innerWidth, vh: innerHeight,
    stacked, bandOpen,
    view: document.body.className,
    layerPos: getComputedStyle(layer).position,
    band: band ? { top: Math.round(band.top), h: Math.round(band.height), w: Math.round(band.width) } : null,
    paneH: Math.round(pane.height),
    railH: parseInt(getComputedStyle(document.body).getPropertyValue("--rail-h"), 10) || 0,
    railW: parseInt(getComputedStyle(document.body).getPropertyValue("--rail-w"), 10) || 0,
    docScrollW: document.scrollingElement.scrollWidth,
    docScrollH: document.body.scrollHeight,
    paneScrollX: q("main").scrollWidth > q("main").clientWidth + 1,
    rootScroll: Math.round(document.scrollingElement.scrollTop),
    spill: spill.slice(0, 6),
    rows: document.querySelectorAll("#railBody .srow").length,
    chromeH: bandOpen && q("#railBody") ? Math.round(q("#railBody").getBoundingClientRect().top - band.top) : 0,
    rowsVisible: bandOpen && q("#railBody") ? Math.round(q("#railBody").getBoundingClientRect().height) : 0,
    footShown: !!q("#railFoot") && getComputedStyle(q("#railFoot")).display !== "none",
  };
}

function pickerState() {
  const ms = document.querySelector(".ms");
  if (!ms) return { none: true };
  const b = ms.getBoundingClientRect();
  const body = ms.querySelector(".ms-body");
  const bb = body.getBoundingClientRect();
  const pane = document.querySelector("main").getBoundingClientRect();
  const first = ms.querySelector(".ms-row").getBoundingClientRect();
  return {
    up: ms.classList.contains("up"), rows: ms.querySelectorAll(".ms-row").length,
    top: Math.round(b.top), bottom: Math.round(b.bottom), paneBottom: Math.round(pane.bottom), paneTop: Math.round(pane.top),
    box: { t: Math.round(bb.top), b: Math.round(bb.bottom), h: Math.round(bb.height) },
    scrolls: body.scrollHeight > body.clientHeight + 1,
    firstVisible: first.top >= pane.top - 1 && first.bottom <= pane.bottom + 1,
  };
}

// ── the checks ──────────────────────────────────────────────────────────────────────
const PLANNER_TARGETS = [
  ["#courseSearch", "course search", "pane"],
  ['#courses .course [data-act="open-ts"]', "time-slot picker trigger", "pane"],
  ['#courses .course [data-act="open-sec"]', "section picker trigger", "pane"],
  ['#courses .course [data-act="open-fac"]', "faculty picker trigger", "pane"],
  ["#genBtn", "generate", "row"],
  ["#seatsBtn", "seats toggle", "row"],
  ["#railBody [data-pin]", "pin button", "band"],
  ["#seatSearch", "seat filter", "band"],
  ["#railMore", "fold button", "band"],
  ['[data-pg="next"]', "next page", "pane"],
];
const PAGE_TARGETS = [
  ["#seatsBtn", "seats toggle (goes back)", "any"],
  ["#railBack", "back to the planner", "any"],
  ["#railFoot", "the footnote", "any"],
  ["#seatSearch", "seat filter", "any"],
  ["#railBody .srow [data-pin]", "a section's pin button", "any"],
  ["#railBody .coursebtn", "a course row", "any"],
];

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  for (const vp of CASES) {
    const seatsPage = vp.view === "seats";
    console.log("\n--- " + vp.name + " " + vp.width + "x" + vp.height + (seatsPage ? " · seats page" : " · planner") + " ---");
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e.message)));
    await page.goto(BASE + (seatsPage ? "/index.html?view=seats" : "/index.html"), { waitUntil: "load" });
    await page.waitForFunction(() => /[0-9][0-9,]* sections?/.test((document.querySelector("#livePill") || {}).textContent || ""), { timeout: 25000 }).catch(() => { });

    if (!seatsPage) {
      for (const code of ["CSE221", "MAT216"]) {
        await page.click("#courseSearch");
        await page.type("#courseSearch", code, { delay: 12 });
        await page.waitForTimeout(300);
        await page.click("#courseList .option");
        await page.waitForTimeout(250);
      }
      await page.click("#genBtn");
      await page.waitForTimeout(2400);
      await page.click("#seatsBtn");
      await page.waitForTimeout(700);
    } else {
      await page.waitForTimeout(1200);
      // the seats page opens collapsed, like the panel: one click should be enough to get to a section
      await page.evaluate(() => { const c = document.querySelector("#railBody .coursebtn"); if (c) c.click(); });
      await page.waitForTimeout(350);
    }

    const g = await page.evaluate(inspect, seatsPage ? PAGE_TARGETS : PLANNER_TARGETS);
    g.hits.forEach((h) => {
      if (h.na) { console.log("na    " + h.note + " — " + h.why); return; }
      ok(!h.offscreen && h.ok !== false, h.note + " is what a tap lands on", JSON.stringify(h));
    });
    ok(g.docScrollW <= g.vw + 1, "the document does not scroll sideways", g.docScrollW + " vs " + g.vw);
    ok(!g.paneScrollX, "the page pane does not scroll sideways", String(g.paneScrollX));
    ok(g.spill.length === 0, "nothing sticks out past the viewport", g.spill.join(" ") || "clean");

    if (!seatsPage) {
      ok(g.stacked ? g.band && g.band.top + g.band.h <= g.vh + 2 : true, "the band ends at the bottom edge", JSON.stringify(g.band));
      ok(g.stacked ? g.paneH >= 280 : g.railW >= 300 && g.railW <= g.vw - 400,
        g.stacked ? "the page keeps room to work in" : "the side panel leaves the page real room", g.stacked ? g.paneH + "px" : g.railW + " of " + g.vw);
      ok(!g.stacked || g.rowsVisible >= 110 || g.rows === 0, "the band spends most of itself on rows, not chrome", "chrome " + g.chromeH + " / rows " + g.rowsVisible);
      ok(!g.stacked || !g.footShown || g.rowsVisible >= 140, "the footnote never eats the rows", "foot " + g.footShown + " rows " + g.rowsVisible);

      for (const kind of ["ts", "sec", "fac"]) {
        await page.click('#courses .course [data-act="open-' + kind + '"]');
        await page.waitForTimeout(420);
        const pk = await page.evaluate(pickerState);
        ok(!pk.none, kind + " picker opens with the band on screen");
        ok(pk.bottom <= pk.paneBottom + 2 && pk.top >= pk.paneTop - 2, kind + " picker stays between the pane's edges", JSON.stringify({ t: pk.top, b: pk.bottom, pT: pk.paneTop, pB: pk.paneBottom, up: pk.up }));
        ok(pk.box.h >= 100, kind + " picker keeps real room for its rows", JSON.stringify(pk.box));
        ok(pk.scrolls || pk.rows < 8, kind + " picker scrolls when the options overflow", String(pk.scrolls));
        await page.click('.ms [data-ms="done"]');
        await page.waitForTimeout(220);
      }

      // taps: a viable row takes it, a greyed one is refused
      await page.click('#courses .course [data-act="open-ts"]');
      await page.waitForTimeout(400);
      const tick = await page.evaluate(() => {
        const ms = document.querySelector(".ms"), body = ms.querySelector(".ms-body");
        const cb = body.getBoundingClientRect();
        const spot = (row) => { if (!row) return null; const b = row.getBoundingClientRect();
          return { x: Math.round(b.x + 24), y: Math.round(Math.min(Math.max(b.top + 8, cb.top + 8), cb.bottom - 8)) }; };
        return { live: spot(ms.querySelector(".ms-row:not(.dim)")), dim: spot(ms.querySelector(".ms-row.dim")) };
      });
      if (tick.live) { await page.mouse.click(tick.live.x, tick.live.y); await page.waitForTimeout(220); }
      ok(await page.evaluate(() => !!document.querySelector(".ms .ms-row:not(.dim) input:checked")), "a tap on a row ticks it", JSON.stringify(tick.live));
      if (tick.dim) { await page.mouse.click(tick.dim.x, tick.dim.y); await page.waitForTimeout(220); }
      ok(await page.evaluate(() => !document.querySelector(".ms .ms-row.dim input:checked")), "a tap on a greyed row is refused, not half-applied");
      await page.click('.ms [data-ms="done"]'); await page.waitForTimeout(220);

      await page.evaluate(() => { const p = document.querySelectorAll('#railBody [data-pin][aria-pressed="false"]'); for (let i = 0; i < Math.min(3, p.length); i++) p[i].click(); });
      await page.waitForTimeout(400);
      await page.click("#railGrip"); await page.waitForTimeout(450);
      const f = await page.evaluate(() => ({
        slim: document.querySelector("#seatsLayer").classList.contains("slim"),
        h: parseInt(getComputedStyle(document.body).getPropertyValue("--rail-h"), 10),
        paneH: Math.round(document.querySelector("main").getBoundingClientRect().height),
        peek: ((document.querySelector("#railPeek") || {}).textContent || "").replace(/\s+/g, " ").trim(),
        stacked: innerWidth < 1024,
      }));
      if (f.stacked) {
        ok(f.slim && f.h <= 140, "tapping the handle folds the band to a strip", JSON.stringify(f).slice(0, 90));
        ok(f.paneH >= vp.height - 260, "folding returns the screen to the page", f.paneH + " of " + vp.height);
        ok(/CSE221/.test(f.peek), "the pinned seats stay readable while folded", f.peek.slice(0, 70));
        await page.click("#railGrip"); await page.waitForTimeout(400);
        ok(await page.evaluate(() => !document.querySelector("#seatsLayer").classList.contains("slim")), "tapping again unfolds it");
      } else {
        ok(!f.slim, "on a wide screen the handle resizes instead of folding", JSON.stringify(f).slice(0, 60));
      }

      const hand = await page.evaluate(async () => {
        const m = document.querySelector("main");
        m.scrollTop = 400;
        await new Promise((r) => setTimeout(r, 120));
        const before = m.scrollTop;
        document.querySelector("#seatsClose").click();
        await new Promise((r) => setTimeout(r, 400));
        const doc = Math.round(window.scrollY);
        document.querySelector("#seatsBtn").click();
        await new Promise((r) => setTimeout(r, 400));
        return { before, doc, again: m.scrollTop, stacked: innerWidth < 1024 };
      });
      if (hand.stacked) {
        ok(hand.doc >= hand.before - 80, "closing the split hands the scroll back to the page", JSON.stringify(hand));
        ok(hand.again >= hand.before - 80 && hand.again <= hand.before + 140, "reopening keeps the same place", JSON.stringify(hand));
      }
      ok(await page.evaluate(() => document.scrollingElement.scrollTop === 0), "the root cannot scroll the split out of place");
    } else {
      // ── the seats page ──
      ok(/view-seats/.test(g.view), "the seats page renders as a page", g.view);
      ok(g.layerPos === "static", "the panel is in the document flow, not a band", g.layerPos);
      const sp = await page.evaluate(() => {
        const vis = (x) => { const e = document.querySelector(x); if (!e) return "missing"; return getComputedStyle(e).display === "none" ? "hidden" : "shown"; };
        return {
          planner: vis("main"), action: vis(".action-bar"), back: vis("#railBack"),
          pop: vis("#railPop"), win: vis("#railWin"), grip: vis("#railGrip"), close: vis("#seatsClose"),
          more: vis("#railMore"), title: document.title,
          scrollable: document.body.scrollHeight > innerHeight + 20,
        };
      });
      ok(sp.planner === "hidden" && sp.action === "hidden", "the planner and its sticky bar are not on this page", sp.planner + "/" + sp.action);
      ok(sp.back === "shown", "a way back is offered", sp.back);
      ok(sp.grip === "hidden" && sp.close === "hidden" && sp.more === "hidden", "the split-only controls are gone", sp.grip + "/" + sp.close + "/" + sp.more);
      ok(sp.pop === "hidden" && sp.win === "hidden", "and the panel-only buttons stay off the page", sp.pop + "/" + sp.win);
      ok(sp.scrollable, "the page scrolls as a page", String(sp.scrollable));
      ok(/Seats/.test(sp.title), "the tab is labelled for what it shows", sp.title);
      const expand = await page.evaluate(() => ({
        courses: document.querySelectorAll("#railBody .coursebtn").length,
        open: document.querySelectorAll('#railBody .coursebtn[aria-expanded="true"]').length,
        rows: document.querySelectorAll("#railBody .srow").length,
      }));
      ok(expand.rows > 0, "a course in the list opens and shows its sections", JSON.stringify(expand));
      const end = await page.evaluate(async () => {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise((r) => setTimeout(r, 200));
        const rows = [...document.querySelectorAll("#railBody .srow")];
        const lb = rows.length ? rows[rows.length - 1].getBoundingClientRect() : null;
        const foot = document.querySelector("#railFoot").getBoundingClientRect();
        return { lastBottom: lb ? Math.round(lb.bottom) : null, footBottom: Math.round(foot.bottom), vh: innerHeight, reachable: !!lb && lb.bottom <= innerHeight + 2 };
      });
      ok(end.reachable, "scrolling to the bottom really reveals the last row", JSON.stringify(end));
      const sticky = await page.evaluate(async () => {
        window.scrollTo(0, 400);
        await new Promise((r) => setTimeout(r, 150));
        const h = document.querySelector(".rail-h").getBoundingClientRect();
        const a = document.querySelector(".app-header").getBoundingClientRect();
        return { hTop: Math.round(h.top), aBottom: Math.round(a.bottom), covered: h.top < a.bottom - 1 };
      });
      ok(!sticky.covered, "the sticky panel header clears the app header", JSON.stringify(sticky));

      // a second window (the planner) drives this one through storage
      const other = await ctx.newPage();
      await other.goto(BASE + "/index.html", { waitUntil: "load" });
      await other.waitForTimeout(1800);
      await other.click("#courseSearch");
      await other.type("#courseSearch", "CSE320", { delay: 10 });
      await other.waitForTimeout(300);
      await other.click("#courseList .option");
      await other.waitForTimeout(400);
      const sync = await page.evaluate(() => ({
        boxes: [...document.querySelectorAll("#railBody .seatbox > h3")].map((h) => h.textContent.replace(/\s+/g, " ").trim().slice(0, 26)),
        txt: ((document.querySelector("#railBody") || {}).textContent || "").replace(/\s+/g, " ").slice(0, 400),
      }));
      ok(/CSE320/.test(sync.txt), "a course added in the planner tab shows up here live", JSON.stringify(sync.boxes));
      await other.close();
    }

    ok(errs.length === 0, "no page errors", errs.slice(0, 2).join(" | "));
    await page.screenshot({ path: "/tmp/audit-" + vp.name + ".png" });
    await ctx.close();
  }
  await browser.close();
  console.log("\n" + (fail ? fail + " LAYOUT CHECK(S) FAILED" : "LAYOUT AUDIT PASSED") + "  ·  screenshots at /tmp/audit-*.png");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("AUDIT ERROR " + ((e && e.stack) || e)); process.exit(2); });
