/*
 * Verifies worker.js: the message protocol, that slim candidates are enough to search, and that the
 * compact results the worker returns can be rendered by the main thread's own copy of the rows.
 *   node tools/worker-test.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const C = require(path.join(root, "core.js"));

// fake the worker global scope, then load worker.js in it
const posted = [];
global.self = global;
global.postMessage = (m) => posted.push(m);
global.importScripts = undefined;
require(path.join(root, "worker.js"));

const snap = JSON.parse(fs.readFileSync(path.join(root, "snapshot.json"), "utf8"));
const idx = C.buildIndex(snap.sections);
const sizesOf = (codes) => codes.map((c) => idx.courses[c].groups.length);
const codes = ["CSE221", "CSE250", "CSE320", "MAT216"];
const richRows = codes.map((c) => ({ code: c, candidates: C.candidatesFor(idx.courses[c], {}, { avoidFaculty: [], avoidSlots: [], avoidDays: [] }) }));
const slimRows = richRows.map((r) => ({
  code: r.code,
  candidates: r.candidates.map((c) => ({
    key: c.key, code: c.code, label: c.label, count: c.count, mask: c.mask, evA: c.evA, exA: c.exA,
    events: c.events.map((e) => ({ day: e.day, start: e.start, end: e.end, kind: e.kind, room: e.room }))
  }))
}));

let fail = 0;
function ok(cond, label, extra) {
  if (!cond) { fail++; console.log("FAIL  " + label + (extra !== undefined ? "  -> " + extra : "")); }
  else console.log("pass  " + label + (extra !== undefined ? "  -> " + extra : ""));
}

self.onmessage({ data: { type: "init", rows: slimRows, prefs: { minDays: 1, maxDays: 6 } } });
ok(posted[0] && posted[0].type === "ready", "init answers with ready", JSON.stringify(posted[0] && posted[0].type));
const expectSpace = sizesOf(codes).reduce((a, b) => a * b, 1);
ok(posted[0].space === expectSpace, "ready reports the search space", posted[0].space + " = " + sizesOf(codes).join("×"));
ok(posted[0].rowCodes.length === 4 && posted[0].rowCodes.slice().sort().join() === codes.slice().sort().join(), "ready echoes the row order", posted[0].rowCodes.join(","));

self.onmessage({ data: { type: "more", want: 50, budgetMs: 1000 } });
const b1 = posted[posted.length - 1];
ok(b1.type === "batch" && b1.items.length === 50, "first batch has 50 items", b1.items.length);
ok(b1.done === false, "first batch is not the end");
ok(b1.items.every((it) => it.ci && typeof it.score === "number" && typeof it.alt === "number"), "items are compact descriptors");
ok(typeof b1.tried === "number" && b1.tried > 0, "batch reports combinations tried", b1.tried);

self.onmessage({ data: { type: "more", want: 50000, budgetMs: 4000 } });
const b2 = posted[posted.length - 1];
ok(b2.done === true, "search completes", b2.valid + " valid");
const local = C.createEnumerator(richRows, { minDays: 1, maxDays: 6 });
const localAll = local.next({ want: 1e9 });
ok(b2.valid === localAll.valid, "worker finds the same total as the main-thread engine", b2.valid + " vs " + localAll.valid);
const localTotal = C.createEnumerator(richRows, { minDays: 1, maxDays: 6 }).next({ want: 1e9 }).valid;
ok(b2.items.length === localTotal - 50, "second batch carries the remainder", b2.items.length + " of " + localTotal);

// results must be renderable by the main thread using its own rich rows
const ord = C.orderRows(richRows);
const all = b1.items.concat(b2.items);
const r0 = C.buildRoutine(ord, all[0], null, ord.N);
ok(r0.picks.length === 4 && r0.events.length >= 8, "main thread can materialise a worker result", r0.events.length + " meetings");
ok(r0.picks.every((p) => p.chosen && p.chosen.faculty), "materialised picks carry faculty");
const noDup = all.every((it) => {
  const ev = C.buildRoutine(ord, it, null, ord.N).events;
  for (let i = 0; i < ev.length; i++) for (let j = i + 1; j < ev.length; j++) if (ev[i].day === ev[j].day && ev[i].start < ev[j].end && ev[j].start < ev[i].end) return false;
  return true;
});
ok(noDup, "sampled worker results are conflict-free");

// exam-awareness inside the worker: ACT201 + CHN101 only clash on their final exams
const exRows = ["ACT201", "CHN101"].map((c) => ({ code: c, candidates: C.candidatesFor(idx.courses[c], {}, {}) }));
const exSlim = exRows.map((r) => ({
  code: r.code,
  candidates: r.candidates.map((c) => ({ key: c.key, code: c.code, label: c.label, count: c.count, mask: c.mask, evA: c.evA, exA: c.exA, events: c.events.map((e) => ({ day: e.day, start: e.start, end: e.end, kind: e.kind, room: e.room })) }))
}));
posted.length = 0;
self.onmessage({ data: { type: "init", rows: exSlim, prefs: { minDays: 1, maxDays: 6 } } });
self.onmessage({ data: { type: "more", want: 50000, budgetMs: 4000 } });
const examOn = posted[posted.length - 1];
ok(examOn.valid === 0, "worker rejects every combination whose exams collide", examOn.valid);
ok(examOn.stats.examBlockedPairs > 0, "worker reports how many pairings the exams blocked", examOn.stats.examBlockedPairs);
posted.length = 0;
self.onmessage({ data: { type: "init", rows: exSlim, prefs: { minDays: 1, maxDays: 6, ignoreExams: true } } });
self.onmessage({ data: { type: "more", want: 50000, budgetMs: 4000 } });
const examOff = posted[posted.length - 1];
ok(examOff.valid > 0, "same rows, exam check off -> schedulable", examOff.valid);

posted.length = 0;
self.onmessage({ data: { type: "more", want: 5 } });
ok(posted[posted.length - 1].type === "batch" || posted[posted.length - 1].type === "error", "unknown state still answers", posted[posted.length - 1].type);

console.log("\n" + (fail ? fail + " CHECK(S) FAILED" : "ALL WORKER CHECKS PASSED"));
process.exit(fail ? 1 : 0);
