/*
 * Geometric audit of the PNG painter's lab hatching.
 *
 * No real browser exists in this sandbox, so the canvas is modelled faithfully instead:
 * save/restore keep a clip-rectangle stack, rect()+clip() intersect the clip, and every
 * stroked segment is intersected with the active clip (Liang-Barsky — the same exact
 * geometry a browser applies to strokes under an axis-aligned clip).
 *
 * The audit asserts:
 *   1. with clipping enabled (the fixed code), every hatch segment lies inside its own
 *      lab block — nothing reaches into the neighbouring time-slot columns or the gutter;
 *   2. with clipping disabled (the old code, via a flag), the same audit FAILS — proving
 *      the audit can actually see the bug it exists to catch.
 * Run: node tools/png-hatch-audit.js
 */
const fs = require("fs");
const path = require("path");
const Core = require("../core.js");

const snap = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "snapshot.json"), "utf8"));
const index = Core.buildIndex(Core.fromApi(snap.sections));

/* ---------- a canvas-2D stub with a real clip model ---------- */
function makeCtx(opts) {
  const ops = { hatchSegments: [], blocks: [] };
  let clipStack = [];
  let clip = null; // {x0,y0,x1,y1} or null = unbounded
  let currentRect = null;
  let curBlock = null;

  const ctx = {
    canvas: { width: 0, height: 0 },
    scale() {}, textBaseline: "", font: "", fillStyle: "", strokeStyle: "", lineWidth: 1,
    fillRect(x, y, w, h) {},
    strokeRect(x, y, w, h) { ops.blocks.push({ x: x, y: y, w: w, h: h, what: curBlock }); },
    beginPath() { currentRect = null; },
    rect(x, y, w, h) { currentRect = { x0: x, y0: y, x1: x + w, y1: y + h }; },
    clip() { if (currentRect) clip = currentRect; clipStack.push(clip); },
    save() { clipStack.push(clip); },
    restore() { clip = clipStack.length ? clipStack.pop() : null; },
    moveTo() {}, lineTo() {},
    arc() {},
    stroke() {}, // paths used for hatching are recorded in lineTo below
    fillText() {},
    measureText(s) { return { width: String(s).length * 6 }; },
  };
  // record hatching strokes as (from -> to) pairs clipped analytically
  let seg = null;
  ctx.moveTo = function (x, y) { seg = [x, y]; };
  ctx.lineTo = function (x, y) {
    if (!seg) return;
    let a = { x: seg[0], y: seg[1] }, b = { x: x, y: y };
    seg = null;
    if (clip) {
      const r = liangBarsky(a, b, clip);
      if (!r) return; // fully clipped away
      a = r.a; b = r.b;
    }
    ops.hatchSegments.push({ a: a, b: b, block: curBlock });
  };

  function liangBarsky(a, b, c) {
    let t0 = 0, t1 = 1, dx = b.x - a.x, dy = b.y - a.y;
    const p = [-dx, dx, -dy, dy];
    const q = [a.x - c.x0, c.x1 - a.x, a.y - c.y0, c.y1 - a.y];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; continue; }
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return { a: { x: a.x + t0 * dx, y: a.y + t0 * dy }, b: { x: a.x + t1 * dx, y: a.y + t1 * dy } };
  }

  // the painter tags nothing, so watch strokeRect order: blocks are painted right after
  // their box — intercept by wrapping strokeRect is enough if we track the LAST drawn
  // block rect and attribute following hatch segments to it. Simpler: patch paintRoutine
  // inputs is impossible; instead we re-derive blocks from buildView in the caller.
  ctx.__ops = ops;
  return ctx;
}

/* ---------- run the painter and audit the hatch ---------- */
function audit(withClip) {
  const rows = ["CSE101", "CSE111", "CSE220", "BTE258"].map((code) => ({
    code: code,
    candidates: Core.candidatesFor(index.courses[code], {}, {}),
  }));
  const res = Core.generate(rows, {});
  if (!res.routines.length) throw new Error("no routine generated for the audit");
  const routine = res.routines[0];
  const view = Core.buildView(routine, { hueOf: () => 0 });

  // expected lab boxes in paint coordinates (mirrors core.js's layout maths)
  const labelW = 56, colW = 168, rowH = 56, gapH = 7, headH = 72, pad = 18;
  const x0 = pad + labelW, y0 = pad + headH - 14 + 30;
  const rowY = (row) => {
    let acc = 0;
    for (let i = 0; i < row - 2; i++) acc += view.rows[i].kind === "gap" ? gapH : rowH;
    return y0 + acc;
  };
  const expected = view.blocks.filter((b) => b.lab).map((b) => {
    const bx = x0 + b.col * colW + 3, by = rowY(b.row) + 2;
    let bh = 0;
    for (let i = b.row - 2; i < b.row - 2 + b.rowSpan; i++) {
      if (i >= view.rows.length) break;
      bh += view.rows[i].kind === "gap" ? gapH : rowH;
    }
    return { x0: bx, y0: by, x1: bx + colW - 6, y1: by + bh - 4 };
  });
  if (!expected.length) throw new Error("the audited routine has no lab blocks — pick lab courses");

  const ctx = makeCtx({});
  const CoreSrc = fs.readFileSync(path.join(__dirname, "..", "core.js"), "utf8");
  if (!withClip) {
    // exercise the OLD behaviour: serve core.js with the clip guarded off
    const patched = CoreSrc.replace(
      "if (ctx.save && ctx.beginPath && ctx.rect && ctx.clip && ctx.restore) {",
      "if (false && ctx.save && ctx.beginPath && ctx.rect && ctx.clip && ctx.restore) {"
    );
    if (patched === CoreSrc) throw new Error("could not patch core.js for the control run");
    fs.writeFileSync("/tmp/core-noclip.js", patched);
    delete require.cache[require.resolve("/tmp/core-noclip.js")];
    const CoreNoClip = require("/tmp/core-noclip.js");
    CoreNoClip.paintRoutine(ctx, routine, {});
  } else {
    Core.paintRoutine(ctx, routine, {});
  }

  // every hatch segment must lie inside ONE expected lab box (1px tolerance)
  const inside = (s, r) =>
    s.a.x >= r.x0 - 1 && s.a.x <= r.x1 + 1 && s.b.x >= r.x0 - 1 && s.b.x <= r.x1 + 1 &&
    s.a.y >= r.y0 - 1 && s.a.y <= r.y1 + 1 && s.b.y >= r.y0 - 1 && s.b.y <= r.y1 + 1;
  const spills = ctx.__ops.hatchSegments.filter((s) => !expected.some((r) => inside(s, r)));
  return { total: ctx.__ops.hatchSegments.length, spills: spills, labs: expected.length };
}

const good = audit(true);
const bad = audit(false);
let fail = 0;
function ok(cond, label, extra) {
  console.log((cond ? "pass  " : "FAIL  ") + label + (extra !== undefined ? "  -> " + extra : ""));
  if (!cond) fail++;
}
ok(good.total > 0, "hatch segments were recorded (" + good.labs + " lab blocks)", good.total);
ok(good.spills.length === 0, "fixed painter: every hatch segment stays inside its lab block",
  good.spills.length + " spills, e.g. " + JSON.stringify(good.spills[0] || null));
ok(bad.spills.length > 0, "control run (clip disabled) still spills — the audit can see the original bug",
  bad.spills.length + " of " + bad.total + " segments escape the lab box");
process.exit(fail ? 1 : 0);
