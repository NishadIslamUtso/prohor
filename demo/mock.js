/*
 * Mock Connect-CDN feed for the Prohor demo.
 *
 * Builds two semesters out of the bundled snapshot.json:
 *   autumn26 — session 20263, the snapshot as-is (a semester in progress);
 *   spring27 — session 20271, a pre-advising preview: dates shifted one term out,
 *              a slice of sections not yet published, a handful of brand-new ones,
 *              most seats still free, several faculties still TBA.
 *
 * Every request to the "CDN" returns a freshly mutated copy: seat counts drift up and
 * down, a TBA faculty now and then gets named, and occasionally a faculty swaps —
 * exactly the kind of movement the live feed shows during advising week.
 */
const fs = require("fs");
const path = require("path");

const snap = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "snapshot.json"), "utf8"));
const BASE = snap.sections;

/* deterministic RNG so the demo is reproducible for a given request number */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtExam(iso, startMin, endMin) {
  // "2027-01-11" + 840/960 -> "Jan 11, 2027 2:00 PM - 4:00 PM"
  if (!iso) return null;
  const p = String(iso).split("-");
  if (p.length !== 3) return null;
  const f = (m) => {
    const h24 = Math.floor(m / 60) % 24, mm = m % 60;
    const ap = h24 >= 12 ? "PM" : "AM", h = h24 % 12 || 12;
    return h + ":" + (mm < 10 ? "0" + mm : mm) + " " + ap;
  };
  return MONTHS[+p[1] - 1] + " " + (+p[2]) + ", " + p[0] + " " + f(startMin) + " - " + f(endMin);
}
function shiftISO(iso, days) {
  if (!iso) return null;
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + days * 86400000);
  return d.toISOString().slice(0, 10);
}

/* ---------- the two semesters, derived once at boot ---------- */
function buildAutumn26() {
  // deep-enough clone so mutations never touch the snapshot
  return BASE.map((r) => Object.assign({}, r));
}

function buildSpring27() {
  const SHIFT = 128;  // Oct 3 2026 -> Feb 8 2027
  const rnd = mulberry32(20271);
  const out = [];
  for (const r of BASE) {
    if (rnd() < 0.09) continue;                       // not published yet
    const n = Object.assign({}, r);
    n.sid = 20271;
    n.start = shiftISO(r.start, SHIFT);
    n.end = shiftISO(r.end, SHIFT);
    const ss = { classSchedules: undefined };
    n.fd = shiftISO(r.fd, SHIFT); n.fs = r.fs; n.fe = r.fe;
    n.fin = fmtExam(n.fd, r.fs, r.fe);
    n.md = shiftISO(r.md, SHIFT); n.ms = r.ms; n.me = r.me;
    n.mid = fmtExam(n.md, r.ms, r.me);
    if (r.cap != null) n.used = Math.max(0, Math.round(r.cap * (0.05 + rnd() * 0.55))); // pre-advising: mostly open
    if (rnd() < 0.12) n.f = "TBA";                    // faculty not announced yet
    out.push(n);
  }
  // a few brand-new sections that have no autumn twin at all
  const rnd2 = mulberry32(7);
  const host = ["CSE221", "CSE250", "CSE320", "MAT216", "PHY111", "ENG102"];
  for (const code of host) {
    const twin = BASE.find((r) => r.c === code);
    if (!twin) continue;
    const n = Object.assign({}, twin);
    n.id = 900000 + Math.floor(rnd2() * 999);
    n.sec = String(60 + Math.floor(rnd2() * 20));
    n.sid = 20271;
    n.start = shiftISO(twin.start, SHIFT);
    n.end = shiftISO(twin.end, SHIFT);
    n.fd = shiftISO(twin.fd, SHIFT); n.fin = fmtExam(n.fd, twin.fs, twin.fe);
    n.md = shiftISO(twin.md, SHIFT); n.mid = fmtExam(n.md, twin.ms, twin.me);
    n.capacity = twin.capacity; n.consumedSeat = 0;
    n.f = "TBA";
    out.push(n);
  }
  return out;
}

/* ---------- per-request mutation ---------- */
const NAMES = ["SRDA", "MAMR", "TANZ", "NHMN", "RBR", "AKM", "SMBH", "FRHN", "JHM", "DSK", "MNH", "TMD"];
const state = {
  requests: 0,
  sems: {
    autumn26: { session: 20263, label: "Autumn 2026 (in progress)", start: "2026-10-03", end: "2027-01-04", sections: buildAutumn26() },
    spring27: { session: 20271, label: "Spring 2027 (pre-advising preview)", start: "2027-02-08", end: "2027-05-24", sections: buildSpring27() },
  },
};

function mutate(sem) {
  sem.__req = (sem.__req || 0) + 1;
  const rnd = mulberry32(sem.session * 7919 + sem.__req);
  const S = sem.sections;
  // 1) seats drift: ~120 sections move by a few seats each poll — sparse enough to be
  // realistic, frequent enough that any open rail visibly moves within a poll or three
  for (let i = 0; i < 120; i++) {
    const r = S[Math.floor(rnd() * S.length)];
    if (r.cap == null || r.used == null) continue;
    const delta = Math.round((rnd() - 0.42) * 7);       // slight upward bias: fills over time
    r.used = Math.max(0, Math.min(r.cap, r.used + delta));
  }
  // 2) advising progress: an unnamed faculty occasionally gets named (stays named)
  if (rnd() < 0.8) {
    const tba = S.filter((r) => String(r.f) === "TBA");
    if (tba.length) {
      const r = tba[Math.floor(rnd() * tba.length)];
      r.f = NAMES[Math.floor(rnd() * NAMES.length)];
    }
  }
  // 3) every few polls, a swap: someone drops, someone else takes the section
  if (sem.__req % 6 === 0) {
    const named = S.filter((r) => String(r.f) !== "TBA");
    if (named.length) {
      const r = named[Math.floor(rnd() * named.length)];
      let next = NAMES[Math.floor(rnd() * NAMES.length)];
      if (next === r.f) next = NAMES[(NAMES.indexOf(next) + 3) % NAMES.length];
      r.f = next;
    }
  }
}

function feed(semKey) {
  const sem = state.sems[semKey] || state.sems.autumn26;
  mutate(sem);
  state.requests++;
  return {
    meta: {
      source: "mock://prohor-demo/connect.json",
      generatedAt: new Date().toISOString(),
      semesterSessionIds: [sem.session],
      classStartDate: sem.start,
      classEndDate: sem.end,
      count: sem.sections.length,
      demo: sem.label + " · request #" + sem.__req,
    },
    sections: sem.sections,
  };
}

module.exports = { feed, sems: Object.keys(state.sems), labels: { autumn26: state.sems.autumn26.label, spring27: state.sems.spring27.label } };
