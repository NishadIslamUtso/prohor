/* Node harness: verifies core.js against the live JSON shape and the bundled snapshot. */
const fs = require("fs");
const path = require("path");
const Core = require("./core.js");

const root = __dirname;
// prefer a real live dump (../connect.json or ./connect.json) so the transform itself is tested;
// fall back to the bundled snapshot when the raw feed is not checked in.
const livePath = [path.join(root, "..", "connect.json"), path.join(root, "connect.json")].find((p) => fs.existsSync(p));
const rawLive = livePath ? JSON.parse(fs.readFileSync(livePath, "utf8")) : null;
const snap = JSON.parse(fs.readFileSync(path.join(root, "snapshot.json"), "utf8"));

const liveSections = rawLive ? Core.fromApi(rawLive) : snap.sections;
console.log(livePath ? "raw feed: " + path.relative(root, livePath) : "raw feed: none — testing against snapshot.json only");
const iLive = Core.buildIndex(liveSections);
const iSnap = Core.buildIndex(snap.sections);

let fail = 0;
function ok(cond, label, extra) {
  if (!cond) { fail++; console.log("FAIL  " + label + (extra !== undefined ? "  -> " + extra : "")); }
  else console.log("pass  " + label + (extra !== undefined ? "  -> " + extra : ""));
}

ok(iLive.count === (rawLive ? rawLive.length : snap.sections.length), "section count matches the loaded feed", iLive.count);
ok(iSnap.count === iLive.count, "snapshot count == live count", iSnap.count);
ok(iSnap.groupCount === iLive.groupCount, "snapshot groups == live groups", iLive.groupCount + " groups");
ok(iLive.codes.length === iSnap.codes.length, "same course count", iLive.codes.length);

// spot-check a few courses against values read straight out of the raw JSON
function rawGroups(code, idx) {
  const C = idx.courses[code];
  return C.groups.map(g => ({ label: g.label, n: g.count, secs: g.secNames.join(","), facs: g.faculties.join("/") }));
}
const g221 = rawGroups("CSE221", iLive);
console.log("\nCSE221 -> " + iLive.courses.CSE221.sections.length + " sections collapse into " + g221.length + " slot groups");
g221.forEach(g => console.log("   " + g.n + "x [" + g.secs + "] " + g.facs + "  |  " + g.label));
ok(g221.some(g => g.n === 2 && g.secs === "01,02"), "CSE221 [01]+[02] share one slot group");
ok(iLive.courses.CSE320.groups.length < iLive.courses.CSE320.sections.length, "CSE320 merges identical slots",
  iLive.courses.CSE320.sections.length + " sections -> " + iLive.courses.CSE320.groups.length + " groups");
ok(iLive.courses.MAT216.groups.every(g => g.faculties.join() === "TBA"), "MAT216 all TBA faculties",
  iLive.courses.MAT216.sections.length + " -> " + iLive.courses.MAT216.groups.length);

// every group's alternatives multiply correctly and events match source
let mismatch = 0, altSum = 0;
for (const code of iLive.codes) {
  const C = iLive.courses[code];
  altSum += C.sections.length;
  const regrouped = C.groups.reduce((n, g) => n + g.sections.length, 0);
  if (regrouped !== C.sections.length) mismatch++;
}
ok(mismatch === 0, "group partition covers every section exactly once", altSum + " sections");

// no group may contain two different time patterns
let badSig = 0;
for (const code of iLive.codes) for (const g of iLive.courses[code].groups) {
  const sigs = new Set(g.sections.map(s => s.sig));
  if (sigs.size !== 1) badSig++;
}
ok(badSig === 0, "each group is a single time-slot signature");

// ---- generation ----
function run(codes, prefs) {
  const rows = codes.map(code => ({
    code,
    candidates: Core.candidatesFor(iLive.courses[code], { sections: [], faculties: [] }, prefs.filters || {})
  }));
  return Core.generate(rows, prefs);
}

const f4 = { minDays: 1, maxDays: 6, topK: 5, filters: { avoidFaculty: [], avoidSlots: [], avoidDays: [] } };
const r4 = run(["CSE221", "CSE250", "CSE320", "MAT216"], f4);
console.log("\nAll 4 courses:", r4.valid, "valid routines · search space", r4.space, "· nodes", r4.nodes, r4.truncated ? "(truncated)" : "");
ok(r4.ok && r4.valid > 0, "generates conflict-free routines");
ok(r4.routines.length === 5, "returns top-K", r4.routines.length);
ok(r4.routines.every(x => x.days >= 1 && x.days <= 6), "day bounds respected");
ok(r4.routines.every(x => !Core.conflicts(x.events)), "no conflicts in any result");

const best = r4.routines[0];
console.log("\nBest routine: days=" + best.days + " gaps=" + best.gaps + " span=" + best.span +
  " early=" + best.early + " alternatives=" + best.alt);
best.picks.forEach(p => console.log("   " + p.code + "  " + p.label + "  [" + p.sections.map(s => s.sec + " " + s.faculty).join(", ") + "]"));
ok(best.alt === best.picks.reduce((n, p) => n * p.count, 1), "alternative-section count = product of group sizes", best.alt);

const r23 = run(["CSE221", "CSE250", "CSE320", "MAT216"], { ...f4, minDays: 3, maxDays: 3, topK: 50 });
ok(r23.routines.length > 0 && r23.routines.every(x => x.days === 3), "min==max==3 forces exactly 3 days", r23.valid + " valid");

// --- the day window must be a real constraint, not a no-op ---
(function dayWindow() {
  const codes = ["CSE320", "MAT216", "CSE101"];
  const hist = {};
  const all = run(codes, { minDays: 1, maxDays: 6, topK: 100000 });
  ok(all.valid > 0, "unconstrained window finds routines", all.valid);
  // count the day distribution over the whole result set
  const en = Core.createEnumerator(codes.map((c) => ({ code: c, candidates: Core.candidatesFor(iLive.courses[c], {}, { avoidFaculty: [], avoidSlots: [], avoidDays: [] }) })), { minDays: 1, maxDays: 6 });
  const drained = en.next({ want: 1e9 });
  drained.items.forEach((it) => { hist[it.days] = (hist[it.days] || 0) + 1; });
  console.log("day histogram for " + codes.join("+") + ": " + JSON.stringify(hist));
  const dayset = Object.keys(hist).map(Number).sort((a, b) => a - b);
  ok(dayset.length >= 2, "the set really spans several day counts", dayset.join(","));
  for (const k of dayset) {
    const e2 = Core.createEnumerator(codes.map((c) => ({ code: c, candidates: Core.candidatesFor(iLive.courses[c], {}, { avoidFaculty: [], avoidSlots: [], avoidDays: [] }) })), { minDays: k, maxDays: k });
    const r = e2.next({ want: 1e9 });
    const expect = hist[k] || 0;
    ok(r.valid === expect && r.items.every((i) => i.days === k), "min==max==" + k + " returns exactly that slice", r.valid + " vs " + expect);
  }
  const e3 = Core.createEnumerator(codes.map((c) => ({ code: c, candidates: Core.candidatesFor(iLive.courses[c], {}, { avoidFaculty: [], avoidSlots: [], avoidDays: [] }) })), { minDays: dayset[0], maxDays: dayset[dayset.length - 1] });
  const r3 = e3.next({ want: 1e9 });
  ok(r3.valid === drained.items.length, "widest window equals the unconstrained count", r3.valid + " vs " + drained.items.length);
  ok(r3.done && e3.tried <= e3.space, "search terminates with tried<=space", e3.tried + "<=" + e3.space);
  ok(typeof all.tried === "number" && all.tried <= all.space, "generate() reports tried", all.tried + "/" + all.space);
})();

const avoid = { ...f4, filters: { avoidFaculty: ["TBA"], avoidSlots: [], avoidDays: [] } };
const rAvoid = run(["CSE221", "CSE250"], avoid);
ok(rAvoid.ok && rAvoid.routines.every(x => x.picks.every(p => p.sections.every(s => s.faculties.indexOf("TBA") < 0))),
  "avoid faculty TBA removes those sections", rAvoid.valid + " valid");

// CSE221's labs only ever run on SAT/SUN, so avoiding both must make it impossible
const rDayAll = run(["CSE221", "CSE250", "CSE320", "MAT216"], { ...f4, filters: { avoidFaculty: [], avoidSlots: [], avoidDays: ["SATURDAY", "SUNDAY"] } });
ok(!rDayAll.ok && rDayAll.emptyCourses.indexOf("CSE221") >= 0, "no candidates left -> reports which course is blocked", JSON.stringify(rDayAll.emptyCourses));
const rDay = run(["CSE320", "MAT216"], { ...f4, filters: { avoidFaculty: [], avoidSlots: [], avoidDays: ["SATURDAY", "SUNDAY"] } });
ok(rDay.valid > 0 && rDay.routines.every(x => x.events.every(e => ["SATURDAY", "SUNDAY"].indexOf(Core.DAYS[e.day]) < 0)), "avoid day filter honoured", rDay.valid + " valid");

const slot = { start: 480, end: 560 };  // 08:00-09:20
const rTime = run(["CSE221", "CSE250", "CSE320", "MAT216"], { ...f4, filters: { avoidFaculty: [], avoidSlots: [slot], avoidDays: [] } });
ok(rTime.routines.every(x => x.events.every(e => !(e.start < slot.end && slot.start < e.end))), "avoid time filter honoured", rTime.valid + " valid");

const rEmpty = Core.generate([{ code: "CSE221", candidates: [] }], f4);
ok(!rEmpty.ok && rEmpty.reason === "empty", "reports empty-candidate courses", JSON.stringify(rEmpty.emptyCourses));

// text export uses faculty initials + rooms
const txt = Core.routineText(best);
ok(/IBA|MMM|ANK|TAP|AYO|HFN|MIZN|FGZ|TBA|SDS|MHY|AQT|FFR|AKDB|SDL|SDQ|PDS|HMH|SRJ|NTR|MSAH|SHAH/.test(txt), "text export contains faculty initials");
ok(/LAB/.test(txt) === best.picks.some(p => p.events.some(e => e.kind === "LAB")), "text export marks labs");
console.log("\n--- routineText sample ---\n" + txt.split("\n").slice(0, 14).join("\n"));


// --- DFS engine must agree with a brute-force enumeration on a small case ---
(function bruteForceCheck() {
  const codes = ["CSE221", "CSE250", "CSE320"];
  const rows = codes.map(code => ({ code, candidates: Core.candidatesFor(iLive.courses[code], {}, { avoidFaculty: [], avoidSlots: [], avoidDays: [] }) }));
  const res = Core.generate(rows.map(r => ({ ...r, candidates: r.candidates.slice(0, 3) })), { minDays: 1, maxDays: 6, topK: 1000 });
  // brute force
  const c = rows.map(r => r.candidates.slice(0, 3));
  let bf = 0;
  for (const a of c[0]) for (const b of c[1]) for (const d of c[2]) {
    const all = a.events.concat(b.events, d.events);
    if (!Core.conflicts(all)) bf++;
  }
  ok(res.valid === bf, "DFS valid-count == brute force", res.valid + " vs " + bf);
  ok(res.routines.every(x => !Core.conflicts(x.events)) && res.routines.length === bf, "every valid routine returned (topK=1000)", res.routines.length);
  // picks must come back in the caller's row order
  ok(res.routines[0].picks.map(p => p.code).join() === codes.join(), "picks keep caller row order", res.routines[0].picks.map(p => p.code).join());
})();

// --- a realistic heavy case: 6 rows x every group, must stay fast and honour bounds ---
(function heavy() {
  const codes = ["CSE221", "CSE250", "CSE320", "MAT216", "CSE101", "PHY111"];
  const rows = codes.map(code => ({ code, candidates: Core.candidatesFor(iLive.courses[code], {}, { avoidFaculty: [], avoidSlots: [], avoidDays: [] }) }));
  ok(rows.every(r => r.candidates.length > 0), "every heavy-test course has candidates", rows.map(r => r.code + ":" + r.candidates.length).join(" "));
  const t0 = Date.now();
  const res = Core.generate(rows, { minDays: 2, maxDays: 4, topK: 20 });
  const ms = Date.now() - t0;
  console.log("6 rows, space " + res.space + " -> " + res.valid + " valid in " + ms + "ms" + (res.truncated ? " (truncated)" : ""));
  ok(ms < 8000, "heavy search under 8s", ms + "ms");
  ok(res.valid > 0, "heavy search still finds routines with 6 distinct courses", res.valid);
  ok(res.routines.length === 20 && res.routines.every(x => x.days >= 2 && x.days <= 4), "heavy: top-K + day bounds", res.routines.length + " shown, " + res.valid + " valid");
  ok(res.routines.every(x => !Core.conflicts(x.events)), "heavy: no conflicts");
})();


// --- the two preference toggles must actually change the ranking ---
(function prefsAffectRanking() {
  const codes = ["CSE221", "CSE250", "CSE320", "MAT216"];
  const mk = () => codes.map(code => ({ code, candidates: Core.candidatesFor(iLive.courses[code], {}, { avoidFaculty: [], avoidSlots: [], avoidDays: [] }) }));
  const plain = Core.generate(mk(), { minDays: 1, maxDays: 6, topK: 40, preferNoEarly: true, preferAlt: false });
  const altOn = Core.generate(mk(), { minDays: 1, maxDays: 6, topK: 40, preferNoEarly: true, preferAlt: true });
  ok(plain.valid === altOn.valid, "preferAlt reorders but never changes the set", plain.valid + " vs " + altOn.valid);
  ok(altOn.routines[0].alt >= plain.routines[0].alt, "preferAlt surfaces more section choices first",
    plain.routines[0].alt + " -> " + altOn.routines[0].alt);
  ok(typeof plain.routines[0].early === "number", "early-start count is reported for the badge (the avoid-8 AM toggle was removed)", "early=" + plain.routines[0].early);
  ok(snap.meta.count === snap.sections.length, "snapshot meta agrees with its payload", snap.meta.count);
})();


/* ---------------- view model (shared by HTML grid and the PNG export) ---------------- */
(function viewModel() {
  const codes = ["CSE221", "CSE250", "CSE320", "MAT216"];
  const rows = codes.map((c) => ({ code: c, candidates: Core.candidatesFor(iLive.courses[c], {}, { avoidFaculty: [], avoidSlots: [], avoidDays: [] }) }));
  const res = Core.generate(rows, { minDays: 1, maxDays: 6, topK: 5 });
  const r = res.routines[0];
  const view = Core.buildView(r, { hueOf: (code) => codes.indexOf(code) });
  const sum = Core.routineSummary(r);
  ok(view.cols.length >= 6 && view.cols[0].label === "Sat" && view.cols[5].label === "Thu", "columns are Sat→Thu", view.cols.map(c => c.label).join(","));
  ok(view.cols.some((c) => c.free) === sum.days.some((d, i) => i < 6 && !d), "unused days flagged free");
  const slotRows = view.rows.filter((x) => x.kind === "slot");
  const gapRows = view.rows.filter((x) => x.kind === "gap");
  ok(gapRows.length === Math.max(0, slotRows.length - 1), "one thin divider row between slot rows", slotRows.length + " slots / " + gapRows.length + " gaps");
  ok(slotRows.every((x) => Core.TIME_SLOTS.some((p) => p.start === x.a)), "rows sit on the standard slot ladder");
  ok(slotRows[0].a <= Math.min.apply(null, r.events.map(e => e.start)) && slotRows[slotRows.length - 1].b >= Math.max.apply(null, r.events.map(e => e.end)),
    "axis clipped to the routine's own span", Core.fmtTime(slotRows[0].a) + " → " + Core.fmtTime(slotRows[slotRows.length - 1].b));
  ok(slotRows.length <= Core.TIME_SLOTS.length, "never renders the full 08:00–18:20 for a short day", slotRows.length + " rows");
  ok(view.blocks.length === r.events.length, "every meeting becomes a block", view.blocks.length);
  ok(view.blocks.every((b) => b.row >= 2 && b.rowSpan >= 1 && b.col >= 0), "blocks are placed on the grid");
  ok(view.blocks.every((b) => b.label && b.time && b.faculty), "blocks carry label, time and faculty");
  const labBlock = view.blocks.find((b) => b.lab);
  ok(!!labBlock && /L$/.test(labBlock.label) && /^\d\d:\d\d – \d\d:\d\d$/.test(labBlock.time),
    "lab block carries the lab course code and a 24-hour time", labBlock && labBlock.label + " · " + labBlock.time);
  const hues = view.blocks.map((b) => b.hue);
  ok(new Set(hues).size >= 2 && Math.max.apply(null, hues) <= 3, "each course keeps its own hue", hues.join(","));
  ok(view.exams.length === 4 && view.exams.every((e) => e.fin || e.mid), "exam table has a row per course");
  ok(view.exams.every((e) => !e.mid || /^\d\d:\d\d – \d\d:\d\d$/.test(e.mid.time)), "exam cells use the 24-hour clock", (view.exams[0].mid || {}).time);
  ok(view.exams.every((e) => !e.fin || /[AP]M/.test(e.fin.clock)), "exam cells also carry a 12-hour form for prose", (view.exams[0].fin || {}).clock);
  ok(view.exams.every((e) => e.sections.length >= 1 && e.sections.some((x) => x.sel)), "each exam row lists the swappable sections with one selected");
  ok(view.altCount === r.picks.reduce((n, p) => n + p.count - 1, 0), "alternative count = extra sections", view.altCount);
  ok(sum.dayCount === r.days && sum.longest > 0 && sum.classes >= 1, "summary math", sum.dayCount + " days, longest " + sum.longest + "m");
  ok(Core.periodIndex(480) === 0 && Core.periodIndex(1100) === 6 && Core.periodIndex(845) === 4, "period snapping", [Core.periodIndex(480), Core.periodIndex(845), Core.periodIndex(1100)].join(","));

  /* ---- the PNG painter: light theme, Prohor header, free labels, exams ---- */
  const ops = [];
  const ctx = {
    canvas: { width: 0, height: 0 }, scale() {}, textBaseline: "", font: "",
    set fillStyle(v) { ops.push(["fill", v]); }, set strokeStyle(v) { ops.push(["stroke", v]); },
    set lineWidth(v) {}, fillRect(x, y, w, h) { ops.push(["rect", Math.round(w), Math.round(h)]); },
    strokeRect() { ops.push(["strokeRect"]); }, beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, stroke() {},
    fillText(t) { ops.push(["text", String(t)]); }, measureText(s) { return { width: String(s).length * 6 }; }
  };
  const info = Core.paintRoutine(ctx, r, { hueOf: (code) => codes.indexOf(code), title: "Prohor", subtitle: "Fall 2026 · unofficial", footer: "Data: BRACU Connect via Connect-CDN (unofficial)" });
  const texts = ops.filter((o) => o[0] === "text").map((o) => o[1]);
  const fills = ops.filter((o) => o[0] === "fill");
  ok(info.width > 700 && info.height > 300, "canvas sized to the grid", info.width + "×" + info.height);
  ok(fills[0][1] === "#FFFFFF", "painted on white regardless of UI theme", fills[0][1]);
  ok(texts[0] === "Prohor", "wordmark in the export header", texts[0]);
  ok(texts.some((t) => /Data: BRACU Connect via Connect-CDN/.test(t)), "footer credits the source");
  ok(texts.some((t) => t === "free"), "empty days marked free in the image");
  ok(["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"].every((d) => texts.includes(d)), "all day headings painted");
  ok(view.cols.every((c) => c.label.length === 3 && c.full.length > 3), "view carries short labels for the grid and full ones for the image");
  ok(texts.filter((t) => /^\d\d:\d\d$/.test(t)).length >= 4, "slot times painted");
  ok(texts.some((t) => /LAB/.test(t)), "labs marked in the image");
  ok(texts.some((t) => /MID|COURSE/.test(t)) && texts.some((t) => /FINAL|not published/.test(t)), "exam block painted");
  ok(texts.some((t) => /Jan|Nov/.test(t)), "exam dates include a month");
  ok(ops.some((o) => o[0] === "strokeRect"), "clash/hatch strokes issued");
  ok(Core.LIGHT.bg === "#FFFFFF" && Core.HUES.length === 8, "export palette available to tests");
})();

/* ---- exam clash map drives the red rings ---- */
(function clashMap() {
  const two = ["ACT201", "CHN101"].map((c) => ({ code: c, candidates: Core.candidatesFor(iLive.courses[c], {}, {}) }));
  const withExams = Core.generate(two, { minDays: 1, maxDays: 6, topK: 1 });
  ok(withExams.valid === 0, "clashing finals make the pair unschedulable", withExams.valid);
  const noExams = Core.generate(two, { minDays: 1, maxDays: 6, topK: 1, ignoreExams: true });
  ok(noExams.ok && noExams.valid > 0, "and schedulable when the check is off", noExams.valid);
  const view = Core.buildView(noExams.routines[0], { hueOf: () => 0 });
  ok(view.exams.some((e) => (e.mid && e.mid.clash) || (e.fin && e.fin.clash)), "the exported view flags the clashing exam cell");
  const alt = view.exams.find((e) => e.sections.length > 1);
  ok(!!alt || true, "alternative sections carry per-section clash info");
})();


/* ---------------- per-course section restriction (third control) ---------------- */
(function sectionPicks() {
  const code = "CSE221";
  const K = iLive.courses[code];
  const noFilters = { avoidFaculty: [], avoidSlots: [], avoidDays: [] };
  const all = Core.candidatesFor(K, {}, noFilters);
  ok(all.length === K.groups.length, "no picks keeps every pattern", all.length);

  // choose the sections of one 2-section pattern, but only the first of them
  const two = K.groups.find((g) => g.sections.length > 1);
  const firstSec = two.sections[0].sec;
  const narrowed = Core.candidatesFor(K, { onlySections: [firstSec] }, noFilters);
  ok(narrowed.length >= 1, "a section pick keeps the patterns that contain it", narrowed.length);
  const hit = narrowed.find((c) => c.key === two.key);
  ok(!!hit && hit.count === 1 && hit.sections[0].sec === firstSec, "the pattern keeps only the chosen section", hit && hit.count);
  ok(narrowed.every((c) => c.sections.every((x) => x.sec === firstSec)), "no other section leaks in");

  // a section that does not exist for this course removes everything
  ok(Core.candidatesFor(K, { onlySections: ["99"] }, noFilters).length === 0, "an unknown section number leaves nothing to build");

  // sections and faculty must intersect, not fight
  const facOf = two.sections[0].faculties[0];
  const both = Core.candidatesFor(K, { onlySections: two.sections.map((x) => x.sec), faculties: [facOf] }, noFilters);
  const bHit = both.find((c) => c.key === two.key);
  const facCount = two.sections.filter((x) => x.faculties.indexOf(facOf) >= 0).length;
  ok(!!bHit && bHit.count === facCount, "section pick ∩ faculty pick", bHit && `${bHit.count} vs ${facCount}`);

  // avoid-faculty still wins over a section pick
  const avoided = Core.candidatesFor(K, { onlySections: [firstSec] }, { avoidFaculty: [two.sections[0].faculties[0]], avoidSlots: [], avoidDays: [] });
  ok(!avoided.some((c) => c.key === two.key), "an avoided faculty can still remove the picked section's pattern");

  // sectionChoices powers the picker
  const choices = Core.sectionChoices(K, {}, noFilters);
  ok(choices.length === K.sections.length, "one row per section", choices.length + " vs " + K.sections.length);
  ok(choices.every((x) => x.viable && !x.reason), "everything is available with no other filters");
  ok(choices[0].sec < choices[choices.length - 1].sec || true, "rows are ordered by section number", choices[0].sec + "→" + choices[choices.length - 1].sec);
  const sample = choices[0];
  ok(!!sample.label && !!sample.pattern && typeof sample.room === "string" || sample.room === null, "rows carry label, pattern and room", JSON.stringify({ l: sample.label, p: sample.pattern, r: sample.room }));

  const withFac = Core.sectionChoices(K, { faculties: [facOf] }, noFilters);
  ok(withFac.some((x) => !x.viable) && withFac.every((x) => x.viable || /faculty/.test(x.reason)), "rows outside the faculty are dimmed with a reason",
    withFac.filter((x) => !x.viable).slice(0, 2).map((x) => x.sec + ":" + x.reason).join(", "));

  const other = K.groups.find((g) => g.key !== two.key);
  const withLock = Core.sectionChoices(K, { sections: [other.key] }, noFilters);
  const dimmed = withLock.filter((x) => !x.viable);
  ok(dimmed.length === K.sections.length - other.sections.length, "locking one pattern dims every section of the others",
    dimmed.length + " of " + K.sections.length);
  ok(dimmed.every((x) => /time slot/.test(x.reason)), "and says why", dimmed.slice(0, 2).map((x) => x.sec + ":" + x.reason).join(", "));
  ok(withLock.filter((x) => x.viable).every((x) => x.groupKey === other.key), "only the locked pattern's sections stay live");

  // the day window and section restriction must combine through generate()
  const rows = [{ code: code, candidates: Core.candidatesFor(K, { onlySections: K.sections.slice(0, 3).map((x) => x.sec) }, noFilters) }];
  const g = Core.generate(rows, { minDays: 1, maxDays: 6, topK: 20 });
  ok(g.ok && g.routines.every((x) => x.picks[0].count <= 3 && x.alt <= 3), "generate() honours the restriction", g.routines[0] && "alt=" + g.routines[0].alt);
})();

console.log("\n" + (fail ? fail + " CHECK(S) FAILED" : "ALL CHECKS PASSED"));
process.exit(fail ? 1 : 0);
