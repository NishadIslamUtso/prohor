/*
 * BRAC University Routine Generator — core
 * Data transform, slot grouping, conflict engine, timetable layout, PNG painter.
 * UMD: window.RGCore in browsers, module.exports in Node (so tests can require it).
 * Data source: Connect-CDN  https://usis-cdn.eniamza.com/connect.json
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RGCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DATA_URL = "https://usis-cdn.eniamza.com/connect.json";
  var SNAPSHOT_URL = "./snapshot.json";
  var REFRESH_MS = 6 * 60 * 60 * 1000;          // data auto-refresh window

  var DAYS = ["SATURDAY", "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
  var DAY_SHORT = { SATURDAY: "SAT", SUNDAY: "SUN", MONDAY: "MON", TUESDAY: "TUE", WEDNESDAY: "WED", THURSDAY: "THU", FRIDAY: "FRI" };
  var DAY_LABEL = { SATURDAY: "Saturday", SUNDAY: "Sunday", MONDAY: "Monday", TUESDAY: "Tuesday", WEDNESDAY: "Wednesday", THURSDAY: "Thursday", FRIDAY: "Friday" };

  // The standard BRAC slot ladder; the printable template is built from these edges.
  var TIME_SLOTS = [
    { start: 480, end: 560, label: "08:00 AM–09:20 AM" },
    { start: 570, end: 650, label: "09:30 AM–10:50 AM" },
    { start: 660, end: 740, label: "11:00 AM–12:20 PM" },
    { start: 750, end: 830, label: "12:30 PM–01:50 PM" },
    { start: 840, end: 920, label: "02:00 PM–03:20 PM" },
    { start: 930, end: 1010, label: "03:30 PM–04:50 PM" },
    { start: 1020, end: 1100, label: "05:00 PM–06:20 PM" }
  ];

  /* ---------------------------------- utils --------------------------------- */

  function dayIndex(d) {
    if (typeof d === "number") return d;
    return DAYS.indexOf(String(d || "").toUpperCase().trim());
  }
  function toMinutes(t) {
    if (typeof t === "number") return t;
    if (!t) return NaN;
    var s = String(t).trim().toUpperCase();
    var m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/);
    if (!m) return NaN;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10), ap = m[4];
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return h * 60 + mi;
  }
  function fmtTime(min) {
    if (typeof min !== "number" || isNaN(min)) return "";
    var h24 = Math.floor(min / 60) % 24, mm = min % 60;
    var ap = h24 >= 12 ? "PM" : "AM", h12 = h24 % 12 || 12;
    return (h12 < 10 ? "0" + h12 : "" + h12) + ":" + (mm < 10 ? "0" + mm : mm) + " " + ap;
  }
  // Compact 24-hour label for grid gutters and chips: 08:00 / 13:50 / 18:20.
  // Unambiguous inside the 08:00–18:20 teaching window and much narrower than AM/PM.
  function fmtTimeShort(min) {
    if (typeof min !== "number" || isNaN(min)) return "";
    var h = Math.floor(min / 60) % 24, mm = min % 60;
    return (h < 10 ? "0" + h : "" + h) + ":" + (mm < 10 ? "0" + mm : mm);
  }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // "2027-01-07" -> "Thu, Jan 7, 2027"
  function fmtDate(iso) {
    if (!iso) return "";
    var p = String(iso).split("-");
    if (p.length !== 3) return String(iso);
    var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    if (isNaN(dt.getTime())) return String(iso);
    var wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()];
    return wd + ", " + MON[+p[1] - 1] + " " + (+p[2]) + ", " + p[0];
  }
  function uniq(a) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < a.length; i++) if (a[i] != null && !seen[a[i]]) { seen[a[i]] = 1; out.push(a[i]); }
    return out;
  }
  function uniqSorted(a) { return uniq(a).sort(); }
  function overlaps(a, b) { return a.start < b.end && b.start < a.end; }
  function popcount(m) { var n = 0; while (m) { n += m & 1; m >>>= 1; } return n; }

  /* --------------------------- raw feed -> compact record --------------------- */

  function evs(list) {
    var out = [], i, e, d, s, t;
    for (i = 0; i < (list || []).length; i++) {
      e = list[i];
      d = dayIndex(e.day != null ? e.day : e[0]);
      s = toMinutes(e.start != null ? e.start : (e[1] != null ? e[1] : e.startTime));
      t = toMinutes(e.end != null ? e.end : (e[2] != null ? e[2] : e.endTime));
      if (d < 0 || isNaN(s) || isNaN(t)) continue;
      out.push([d, s, t]);
    }
    return out;
  }
  function examRec(date, start, end, detail, kind) {
    var s = toMinutes(start), t = toMinutes(end);
    if (!date && !detail) return null;
    if (isNaN(s) || isNaN(t)) return null;
    return { kind: kind, date: date || null, start: s, end: t, detail: detail || null };
  }

  // Accepts the live Connect-CDN array, its object wrappers, or our own compact records.
  function fromApi(raw) {
    var items = Array.isArray(raw) ? raw : (raw && (raw.sections || raw.data || raw.content || raw.items)) || [];
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      if (!it) continue;
      if (it.c && !it.courseCode) { out.push(it); continue; }        // already compact
      if (!it.courseCode) continue;
      var ss = it.sectionSchedule || {};
      out.push({
        id: it.sectionId != null ? it.sectionId : null,
        c: it.courseCode, nm: it.courseName || it.courseCode,
        sec: it.sectionName != null ? String(it.sectionName) : "?",
        f: it.faculties == null ? "TBA" : String(it.faculties),
        ct: it.courseType || (it.sectionType === "LAB" ? "LAB" : "THEORY"),
        cr: it.courseCredit != null ? it.courseCredit : null,
        r: it.roomNumber || it.roomName || null,
        cls: evs(ss.classSchedules),
        lab: evs(it.labSchedules),
        lr: it.labRoomName || null, lf: it.labFaculties || null, lc: it.labCourseCode || null,
        mid: ss.midExamDetail || null, fin: ss.finalExamDetail || null,
        fd: ss.finalExamDate || null, fs: toMinutes(ss.finalExamStartTime), fe: toMinutes(ss.finalExamEndTime),
        md: ss.midExamDate || null, ms: toMinutes(ss.midExamStartTime), me: toMinutes(ss.midExamEndTime),
        cap: it.capacity != null ? it.capacity : null, used: it.consumedSeat != null ? it.consumedSeat : null,
        sid: it.semesterSessionId != null ? it.semesterSessionId : null,
        start: ss.classStartDate || null, end: ss.classEndDate || null
      });
    }
    return out;
  }

  /* ---------------------------- record -> full section ------------------------ */

  function normalizeSection(rec) {
    var isLabCourse = (rec.ct === "LAB" || rec.ct === "STUDIO");
    var events = [], labs = [], i, e;
    var cls = rec.cls || rec.classSchedules || [];
    for (i = 0; i < cls.length; i++) {
      e = cls[i];
      events.push({
        day: dayIndex(e.day != null ? e.day : e[0]),
        start: toMinutes(e.start != null ? e.start : e[1]),
        end: toMinutes(e.end != null ? e.end : e[2]),
        kind: isLabCourse ? "LAB" : "CLASS", room: rec.r || null
      });
    }
    var lraw = rec.lab != null ? rec.lab : (rec.labSchedules || []);
    for (i = 0; i < lraw.length; i++) {
      e = lraw[i];
      labs.push({
        day: dayIndex(e.day != null ? e.day : e[0]),
        start: toMinutes(e.start != null ? e.start : e[1]),
        end: toMinutes(e.end != null ? e.end : e[2]),
        kind: "LAB", room: rec.lr || null
      });
    }
    var fac = uniq(String(rec.f || "TBA").toUpperCase().split(/[^A-Z]+/).filter(Boolean));
    if (!fac.length) fac = ["TBA"];
    var labFac = rec.lf ? uniq(String(rec.lf).toUpperCase().split(/[^A-Z]+/).filter(Boolean)) : [];
    var exams = [];
    var fin = examRec(rec.fd, rec.fs, rec.fe, rec.fin, "FINAL");
    var mid = examRec(rec.md, rec.ms, rec.me, rec.mid, "MID");
    if (fin) exams.push(fin);
    if (mid) exams.push(mid);

    var o = {
      id: rec.id, code: (rec.c || "").toUpperCase(), name: rec.nm || rec.c,
      sec: rec.sec, credit: rec.cr, type: rec.ct,
      faculties: fac, faculty: fac.join(", "),
      room: rec.r || null, labRoom: rec.lr || null,
      labCourse: rec.lc || null, labFaculties: labFac, labFaculty: labFac.join(", ") || "TBA",
      exams: exams, examText: rec.fin || null, midText: rec.mid || null,
      cap: rec.cap, used: rec.used, start: rec.start, end: rec.end,
      events: events, labs: labs
    };
    o.label = o.code + "-[" + o.sec + "]";
    o.all = events.concat(labs);
    o.all.forEach(function (ev) {
      ev.section = o;
      ev.faculty = ev.kind === "LAB" ? o.labFaculty : o.faculty;
      if (ev.kind === "LAB") ev.room = ev.room || o.labRoom;
      ev.dayName = DAYS[ev.day];
      ev.range = fmtTime(ev.start) + " – " + fmtTime(ev.end);
    });
    // stable key for exam comparison
    o.examKey = exams.map(function (x) { return x.kind + "|" + x.date + "|" + x.start + "|" + x.end; }).sort().join(";");
    var days = {};
    o.all.forEach(function (x) { days[x.day] = 1; });
    o.dayNums = Object.keys(days).map(Number).sort(function (a, b) { return a - b; });
    o.days = o.dayNums.map(function (n) { return DAYS[n]; });
    o.sig = o.all.map(function (x) { return x.day + "|" + x.start + "|" + x.end; }).sort().join(";");
    return o;
  }

  /* ------------------------------- index building ---------------------------- */

  function slotLabel(evs) {
    function span(list) {
      var by = {}, keys = [];
      list.forEach(function (e) {
        var k = e.start + "-" + e.end;
        if (!by[k]) { by[k] = []; keys.push(k); }
        by[k].push(DAY_SHORT[DAYS[e.day]] || "?");
      });
      keys.sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); });
      return keys.map(function (k) {
        var p = k.split("-");
        return by[k].join("+") + " " + fmtTime(parseInt(p[0], 10)) + "–" + fmtTime(parseInt(p[1], 10));
      }).join("  ·  ");
    }
    var classes = evs.filter(function (e) { return e.kind !== "LAB"; });
    var labs = evs.filter(function (e) { return e.kind === "LAB"; });
    var out = [];
    if (classes.length) out.push(span(classes));
    if (labs.length) out.push("LAB " + span(labs));
    return out.join("  ·  ") || "No schedule";
  }

  function buildIndex(sections) {
    var courses = Object.create(null);
    var list = sections || [];
    for (var i = 0; i < list.length; i++) {
      var rec = normalizeSection(list[i]);
      if (!rec.code) continue;
      var code = rec.code;
      if (!courses[code]) courses[code] = {
        code: code, name: rec.name, credit: rec.credit, type: rec.type,
        start: rec.start, end: rec.end, sections: [], groups: [], byGroup: Object.create(null)
      };
      var C = courses[code];
      if ((!C.name || C.name === C.code) && rec.name) C.name = rec.name;
      if (rec.start && !C.start) C.start = rec.start;
      C.sections.push(rec);
      var key = rec.sig || ("no-sched-" + C.sections.length);
      var g = C.byGroup[key];
      if (!g) {
        g = { key: key, code: code, events: rec.all.slice(), sections: [], faculties: [], secNames: [], examKey: rec.examKey };
        C.byGroup[key] = g;
        C.groups.push(g);
      } else if (g.examKey !== rec.examKey) {
        g.examVaried = true;
      }
      g.sections.push(rec);
      rec.faculties.forEach(function (f) { g.faculties.push(f); });
      g.secNames.push(rec.sec);
    }

    var codes = Object.keys(courses).sort();
    var daysUsed = []; for (var q = 0; q < 7; q++) daysUsed.push(0);
    for (var k = 0; k < codes.length; k++) {
      var C2 = courses[codes[k]];
      C2.groups.sort(function (a, b) {
        var x = a.events.length ? Math.min.apply(null, a.events.map(function (e) { return e.day * 10000 + e.start; })) : 1e9;
        var y = b.events.length ? Math.min.apply(null, b.events.map(function (e) { return e.day * 10000 + e.start; })) : 1e9;
        return x - y || a.key.localeCompare(b.key);
      });
      C2.groups.forEach(function (g, idx) {
        g.sections.sort(function (a, b) { return String(a.sec).localeCompare(String(b.sec)); });
        g.faculties = uniqSorted(g.faculties);
        g.secNames = uniqSorted(g.secNames);
        g.hasLab = g.events.some(function (e) { return e.kind === "LAB"; });
        g.label = slotLabel(g.events);
        g.alternatives = g.count = g.sections.length;
        g.exams = g.sections[0].exams.slice();           // representative (groups are exam-uniform except in ~2% of cases)
        g.examVaried = !!g.examVaried;
        var dm = {};
        g.events.forEach(function (e) { dm[e.day] = 1; daysUsed[e.day] = 1; });
        g.dayNums = Object.keys(dm).map(Number).sort(function (a, b) { return a - b; });
        g.dayNames = g.dayNums.map(function (n) { return DAYS[n]; });
        g.mask = g.dayNums.reduce(function (m, n) { return m | (1 << n); }, 0);
        g.idx = idx;
      });
      C2.faculties = uniqSorted([].concat.apply([], C2.sections.map(function (s) { return s.faculties; })));
      C2.labs = uniq(C2.sections.map(function (s) { return s.labCourse; }).filter(Boolean));
      C2.name = C2.name || C2.code;
    }
    return {
      courses: courses, codes: codes, daysUsed: daysUsed,
      faculties: (function () {
        var set = {};
        codes.forEach(function (c) { courses[c].sections.forEach(function (s) { s.faculties.forEach(function (f) { set[f] = 1; }); }); });
        return Object.keys(set).sort();
      })(),
      count: codes.reduce(function (n, c) { return n + courses[c].sections.length; }, 0),
      groupCount: codes.reduce(function (n, c) { return n + courses[c].groups.length; }, 0),
      examsKnown: codes.reduce(function (n, c) {
        return n + courses[c].sections.filter(function (s) { return s.exams.length; }).length;
      }, 0)
    };
  }

  /* ------------------------------ pickers / filter --------------------------- */

  function sectionOptions(C, facultyFilter) {
    if (!C || !C.groups) return [];
    var out = [];
    (C.groups || []).forEach(function (g) {
      var secs = facultyFilter && facultyFilter.length
        ? g.sections.filter(function (s) { return s.faculties.some(function (f) { return facultyFilter.indexOf(f) >= 0; }); })
        : g.sections;
      if (!secs.length) return;
      out.push({
        value: g.key, group: g, sections: secs,
        label: g.label + "   ·   " + secs.length + (secs.length > 1 ? " sections" : " section"),
        sub: secs.map(function (s) { return s.label + " " + s.faculty; }).join(", ")
      });
    });
    return out;
  }
  function facultyOptions(C) {
    if (!C) return [];
    return (C.faculties || []).map(function (f) {
      var n = C.sections.filter(function (s) { return s.faculties.indexOf(f) >= 0; }).length;
      return { value: f, label: f + "  (" + n + ")", sub: "" };
    });
  }

  function classesCompatible(a, b) {
    for (var i = 0; i < a.evA.length; i++) {
      var x = a.evA[i];
      for (var j = 0; j < b.evA.length; j++) {
        var y = b.evA[j];
        if (x[0] === y[0] && x[1] < y[2] && y[1] < x[2]) return false;
      }
    }
    return true;
  }
  function examsConflict(a, b) {
    for (var i = 0; i < a.exA.length; i++) {
      var x = a.exA[i];
      for (var j = 0; j < b.exA.length; j++) {
        var y = b.exA[j];
        if (x[0] && x[0] === y[0] && x[1] < y[2] && y[1] < x[2]) return true;   // same exam date, overlapping time
      }
    }
    return false;
  }
  function candidateCompatible(a, b, ignoreExams) {
    if (!classesCompatible(a, b)) return false;
    if (ignoreExams) return true;
    return !examsConflict(a, b);
  }

  // Rows are searched fewest-candidates-first; ties broken by course code so the
  // worker (searching) and the main thread (rendering) always agree on the order.
  function orderRows(rows) {
    var order = rows.map(function (r, i) { return i; });
    order.sort(function (a, b) {
      return (rows[a].candidates.length - rows[b].candidates.length) || String(rows[a].code).localeCompare(String(rows[b].code));
    });
    var R = order.map(function (i) { return rows[i]; });
    return { order: order, R: R, N: R.length, sizes: R.map(function (r) { return r.candidates.length; }) };
  }

  // Turn a compact search result back into a renderable routine, honouring the
  // per-card section choice the user makes from the alternatives list.
  function buildRoutine(ord, item, pickSec, N) {
    var ci = item.ci, R = ord.R, picks = new Array(N), events = [];
    for (var z = 0; z < N; z++) {
      var cand = R[z].candidates[ci[z]];
      // pickSec is keyed by the caller's row index; ci is keyed by search order.
      var secIdx = 0, want = pickSec && pickSec[ord.order[z]];
      if (typeof want === "number" && want >= 0 && want < cand.sections.length) secIdx = want;
      var sec = cand.sections[secIdx];
      var evs = (cand.events || cand.group.events).map(function (e) {
        var copy = {};
        for (var kk in e) if (kk !== "section" && kk !== "faculty" && kk !== "room") copy[kk] = e[kk];
        copy.section = sec;
        copy.faculty = e.kind === "LAB" ? (sec.labFaculties.length ? sec.labFaculties.join(", ") : "TBA") : sec.faculties.join(", ");
        copy.room = e.kind === "LAB" ? (sec.labRoom || null) : (sec.room || null);
        copy.sec = sec.sec; copy.code = sec.code;
        return copy;
      });
      picks[ord.order[z]] = {
        code: cand.code, label: cand.label, key: cand.key, count: cand.count,
        sections: cand.sections, secIdx: secIdx, chosen: sec,
        events: evs, examVaried: cand.examVaried, exams: sec.exams, conflict: null
      };
      events = events.concat(evs);
    }
    for (var a = 0; a < N; a++) {
      for (var b = a + 1; b < N; b++) {
        var ea = picks[a].exams, eb = picks[b].exams, clash = null;
        for (var x = 0; x < ea.length && !clash; x++) {
          for (var y = 0; y < eb.length; y++) {
            if (ea[x].date && ea[x].date === eb[y].date && ea[x].start < eb[y].end && eb[y].start < ea[x].end) {
              clash = ea[x].kind + " exam clashes with " + picks[b].code + " on " + fmtDate(ea[x].date) + " " + fmtTime(ea[x].start) + "–" + fmtTime(ea[x].end);
              break;
            }
          }
        }
        if (clash) { picks[a].conflict = picks[a].conflict || clash; picks[b].conflict = picks[b].conflict || clash; }
      }
    }
    var sc = scoreOfEvents(picks.map(function (p) { return p.events; }), item.alt, picks[0] && picks[0].prefs);
    return { picks: picks, events: events, days: sc.days, dayNos: sc.dayNos, gaps: sc.gaps, span: sc.span, early: sc.early, alt: item.alt, score: item.score };
  }

  function scoreOfEvents(eventLists, alt, prefs) {
    var perDay = {}, dayNos = [], gaps = 0, early = 0, span = 0;
    (eventLists || []).forEach(function (l) {
      l.forEach(function (e) { (perDay[e.day] = perDay[e.day] || []).push(e); });
    });
    dayNos = Object.keys(perDay).map(Number).sort(function (a, b) { return a - b; });
    dayNos.forEach(function (d) {
      var l = perDay[d].slice().sort(function (a, b) { return a.start - b.start; });
      span += (l[l.length - 1].end - l[0].start);
      if (l[0].start <= 480) early++;
      for (var i = 1; i < l.length; i++) { var g = l[i].start - l[i - 1].end; if (g > 0) gaps += g; }
    });
    void alt; void prefs;
    return { days: dayNos.length, dayNos: dayNos, gaps: gaps, span: span, early: early };
  }

  // One search candidate = one slot group (already narrowed by faculty + avoid filters).
  function makeCandidate(g, code, sections) {
    var evA = sections.length ? [] : [];
    // events are shared by every section of the group; rooms/exams are per section
    g.events.forEach(function (e) { evA.push([e.day, e.start, e.end]); });
    var exA = (g.exams || []).map(function (x) { return [x.date, x.start, x.end]; });
    return {
      key: g.key, code: code, label: g.label, group: g, sections: sections,
      events: g.events, count: sections.length, evA: evA, exA: exA, mask: g.mask,
      examVaried: !!g.examVaried
    };
  }

  // does an avoid-day / avoid-time filter kill this whole pattern?
  function avoidKills(g, filters) {
    filters = filters || {};
    var avoidDays = filters.avoidDays || [], avoidSlots = filters.avoidSlots || [], i, k;
    if (!g.events.length) return true;
    for (i = 0; i < g.events.length; i++) {
      var e = g.events[i];
      if (avoidDays.length && avoidDays.indexOf(DAYS[e.day]) >= 0) return true;
      for (k = 0; k < avoidSlots.length; k++) if (overlaps(e, avoidSlots[k])) return true;
    }
    return false;
  }

  function candidatesFor(C, row, filters) {
    if (!C || !C.groups) return [];
    filters = filters || {};
    var picked = row && row.sections && row.sections.length ? row.sections : null;
    var facs = row && row.faculties && row.faculties.length ? row.faculties : null;
    var only = row && row.onlySections && row.onlySections.length ? row.onlySections.map(String) : null;
    var avoid = filters.avoidFaculty || [];
    var out = [];
    (C.groups || []).forEach(function (g) {
      if (picked && picked.indexOf(g.key) < 0) return;
      if (avoidKills(g, filters)) return;
      var secs = g.sections.filter(function (s) {
        if (only && only.indexOf(String(s.sec)) < 0) return false;
        if (facs && !s.faculties.some(function (f) { return facs.indexOf(f) >= 0; })) return false;
        if (avoid.length && s.faculties.some(function (f) { return avoid.indexOf(f) >= 0; })) return false;
        return true;
      });
      if (!secs.length) return;
      out.push(makeCandidate(g, C.code, secs));
    });
    return out;
  }

  // Everything the "Sections" picker needs: every section of the course, each with the
  // pattern it belongs to and whether the other controls still let it through.
  function sectionChoices(C, row, filters) {
    if (!C || !C.groups) return [];
    row = row || {};
    filters = filters || {};
    var picked = row.sections && row.sections.length ? row.sections : null;
    var facs = row.faculties && row.faculties.length ? row.faculties : null;
    var avoid = filters.avoidFaculty || [];
    var out = [];
    C.groups.forEach(function (g) {
      var groupOk = (!picked || picked.indexOf(g.key) >= 0) && !avoidKills(g, filters);
      g.sections.forEach(function (s) {
        var facOk = !facs || s.faculties.some(function (f) { return facs.indexOf(f) >= 0; });
        var avOk = !(avoid.length && s.faculties.some(function (f) { return avoid.indexOf(f) >= 0; }));
        out.push({
          value: s.sec, sec: s.sec, code: C.code, label: s.label, groupKey: g.key,
          faculty: s.faculty, faculties: s.faculties, room: s.room,
          labCourse: s.labCourse, labRoom: s.labRoom, labFaculty: s.labFaculty,
          pattern: g.label, credit: s.credit, name: s.name,
          viable: groupOk && facOk && avOk,
          reason: !groupOk ? (picked && picked.indexOf(g.key) < 0 ? "another time slot is locked" : "avoided time or day")
                  : !facOk ? "taught by another faculty"
                  : !avOk ? "faculty is on the avoid list" : ""
        });
      });
    });
    out.sort(function (a, b) { return String(a.sec).localeCompare(String(b.sec)); });
    return out;
  }

  /* ------------------------- resumable, ranked enumeration ------------------- */

  // Returns an enumerator that can be advanced in slices, so the UI never blocks
  // and "next 50" continues exactly where the last batch stopped.
  //   en.next({want, budgetMs, sort}) -> {items, done, scanned, valid, space}
  //   en.materialize(item, chosenSections) -> full routine object
  function createEnumerator(rows, prefs) {
    prefs = prefs || {};
    var minDays = prefs.minDays != null ? prefs.minDays : 1;
    var maxDays = prefs.maxDays != null ? prefs.maxDays : 7;
    var ord = orderRows(rows);
    var order = ord.order, N = ord.N, R = ord.R, sizes = ord.sizes;
    void ord;
    var space = sizes.reduce(function (a, b) { return a * b; }, 1);

    var stats = { examBlockedPairs: 0, pairs: 0 };
    // pairwise incompatibility bitmaps: bad[d][i][e] -> words over candidates of depth e (< d)
    var bad = [];
    for (var d = 0; d < N; d++) {
      bad[d] = [];
      for (var i = 0; i < sizes[d]; i++) {
        var perDepth = [];
        for (var e = 0; e < d; e++) {
          var words = new Uint32Array(Math.ceil(sizes[e] / 32) || 1);
          for (var j = 0; j < sizes[e]; j++) {
            var A = R[d].candidates[i], B = R[e].candidates[j];
            if (!classesCompatible(A, B)) words[j >> 5] |= (1 << (j & 31));
            else if (!prefs.ignoreExams && examsConflict(A, B)) {
              words[j >> 5] |= (1 << (j & 31));
              stats.examBlockedPairs++;
            }
            stats.pairs++;
          }
          perDepth[e] = words;
        }
        bad[d][i] = perDepth;
      }
    }
    var masks = R.map(function (r) { return Uint32Array.from(r.candidates.map(function (c) { return c.mask; })); });

    var ord = { order: order, R: R };
    var st = { depth: 0, idx: new Int32Array(N + 1), chosen: new Int32Array(N), maskAt: new Int32Array(N + 1), done: false, scanned: 0, valid: 0, tried: 0 };

    function okAt(depth, i) {
      var m = (depth ? st.maskAt[depth - 1] : 0) | masks[depth][i];
      if (popcount(m) > maxDays) return false;
      var row = bad[depth][i];
      for (var e = 0; e < depth; e++) {
        var j = st.chosen[e];
        if (row[e][j >> 5] & (1 << (j & 31))) return false;
      }
      return true;
    }

    // A leaf = one fully considered combination. minDays/ maxDays are judged here
    // because a single course can add several days at once.
    function emit() {
      var ci = new Int32Array(N);
      for (var z = 0; z < N; z++) ci[z] = st.chosen[z];
      var sc = scoreOf(ci);
      if (sc.days < minDays || sc.days > maxDays) return null;
      st.valid++;
      return { ci: ci, days: sc.days, gaps: sc.gaps, span: sc.span, early: sc.early, alt: sc.alt, score: sc.score };
    }

    function scoreOf(ci) {
      var perDay = {}, events = [], days = 0, alt = 1, earliest = 1440, latest = 0;
      for (var z = 0; z < N; z++) {
        var cand = R[z].candidates[ci[z]];
        alt *= cand.count;
        for (var k = 0; k < cand.events.length; k++) {
          var ev = cand.events[k];
          (perDay[ev.day] = perDay[ev.day] || []).push(ev);
          if (ev.start < earliest) earliest = ev.start;
          if (ev.end > latest) latest = ev.end;
        }
      }
      var dayNos = Object.keys(perDay).map(Number).sort(function (a, b) { return a - b; });
      var gaps = 0, early = 0, span = 0;
      dayNos.forEach(function (dn) {
        var l = perDay[dn].slice().sort(function (a, b) { return a.start - b.start; });
        span += (l[l.length - 1].end - l[0].start);
        if (l[0].start <= 480) early++;
        for (var t = 1; t < l.length; t++) { var gp = l[t].start - l[t - 1].end; if (gp > 0) gaps += gp; }
      });
      void events;
      var v = dayNos.length * 100000;
      if (prefs.preferShortDay !== false) v += span * 10;
      v += gaps;
      if (prefs.preferAlt && alt > 1) v -= Math.min(90000, 30000 * (Math.log(alt) / Math.LN2));
      return { days: dayNos.length, dayNos: dayNos, gaps: gaps, span: span, early: early, alt: alt, score: v };
    }

    function next(opts) {
      opts = opts || {};
      var want = opts.want || 50;
      var budget = opts.budgetMs || 0;
      var t0 = Date.now();
      var out = [];
      if (st.done || !N) { st.done = true; return { items: out, done: true, scanned: st.scanned, tried: st.tried, valid: st.valid, space: space }; }
      while (out.length < want) {
        if (budget && (Date.now() - t0) > budget) break;
        if (st.depth < 0) { st.done = true; break; }
        if (st.depth === N) {
          // full assignment: judge it, then resume the scan at the last row
          // (st.idx[N-1] already points past the choice just handled).
          st.tried++;
          var item = emit();
          if (item) out.push(item);
          st.depth = N - 1;
          if (want && out.length >= want) { /* handled by loop guard */ }
          continue;
        }
        var advanced = false;
        while (st.idx[st.depth] < sizes[st.depth]) {
          var i = st.idx[st.depth]++;
          st.scanned++;
          if (!okAt(st.depth, i)) continue;
          st.chosen[st.depth] = i;
          st.maskAt[st.depth] = (st.depth ? st.maskAt[st.depth - 1] : 0) | masks[st.depth][i];
          st.depth++;
          if (st.depth < N) st.idx[st.depth] = 0;
          advanced = true;
          break;
        }
        // no candidate left at this depth -> unwind; each ancestor's idx already
        // points at its next untried candidate, so nothing must be skipped here.
        if (!advanced) st.depth--;
      }
      if (out.length && opts.sort) out.sort(function (a, b) { return a.score - b.score; });
      return { items: out, done: st.done, scanned: st.scanned, tried: st.tried, valid: st.valid, space: space };
    }

    function materialize(item, pickSec) { return buildRoutine(ord, item, pickSec, N); }

    return {
      next: next, materialize: materialize,
      get done() { return st.done; },
      get scanned() { return st.scanned; },
      get valid() { return st.valid; },
      space: space, N: N, stats: stats,
      get tried() { return st.tried; },
      rowCodes: R.map(function (r) { return r.code; }),
      order: order
    };
  }

  function conflicts(list) {
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        if (list[i].day === list[j].day && overlaps(list[i], list[j])) return true;
      }
    }
    return false;
  }
  function scoreRoutine(events) {
    var perDay = Object.create(null);
    events.forEach(function (e) { (perDay[e.day] = perDay[e.day] || []).push(e); });
    var dayNos = Object.keys(perDay).map(Number).sort(function (a, b) { return a - b; });
    var gaps = 0, early = 0, span = 0;
    dayNos.forEach(function (d) {
      var l = perDay[d].slice().sort(function (a, b) { return a.start - b.start; });
      span += (l[l.length - 1].end - l[0].start);
      if (l[0].start <= 480) early++;
      for (var i = 1; i < l.length; i++) { var g = l[i].start - l[i - 1].end; if (g > 0) gaps += g; }
    });
    return { days: dayNos.length, dayNos: dayNos, gaps: gaps, early: early, span: span, rank: dayNos.length };
  }

  // One-shot convenience wrapper (used by tests and by tiny search spaces).
  function generate(rows, prefs) {
    prefs = prefs || {};
    var usable = (rows || []).filter(function (r) { return r && r.code && r.candidates && r.candidates.length; });
    var empty = (rows || []).filter(function (r) { return !r.candidates || !r.candidates.length; });
    if (empty.length) return { ok: false, reason: "empty", emptyCourses: empty.map(function (r) { return r.code; }), valid: 0, routines: [] };
    if (!usable.length) return { ok: false, reason: "norequest", valid: 0, routines: [] };
    var en = createEnumerator(usable, prefs);
    var topK = prefs.topK || 30, cap = prefs.maxScan || 4000000;
    var all = [], res, truncated = false;
    do {
      res = en.next({ want: 500, budgetMs: prefs.budgetMs || 0 });
      all = all.concat(res.items);
      if (en.scanned > cap) { truncated = true; break; }
    } while (!res.done);
    all.sort(function (a, b) { return a.score - b.score; });
    var routines = all.slice(0, topK).map(function (it) { return en.materialize(it); });
    return {
      ok: true, routines: routines, valid: res.valid, scanned: en.scanned, tried: en.tried, space: en.space,
      truncated: truncated, minDays: prefs.minDays, maxDays: prefs.maxDays
    };
  }

  /* ---------------------------- timetable template --------------------------- */

  function weekGrid(routine) {
    var perDay = {};
    DAYS.forEach(function (d) { perDay[d] = []; });
    routine.events.forEach(function (e) { perDay[DAYS[e.day]].push(e); });
    Object.keys(perDay).forEach(function (d) { perDay[d].sort(function (a, b) { return a.start - b.start || a.end - b.end; }); });
    return perDay;
  }

  /* -------------------------------- text export ----------------------------- */

  function routineText(routine, opts) {
    opts = opts || {};
    var grid = weekGrid(routine);
    var lines = [];
    if (opts.title) lines.push(opts.title);
    lines.push("ROUTINE  ·  " + routine.picks.length + " course(s)  ·  " + routine.days + " day(s)/week");
    lines.push("");
    (opts.days || DAYS).forEach(function (d) {
      var l = grid[d]; if (!l.length) return;
      lines.push((DAY_LABEL[d] || d) + "  (" + l.length + " class" + (l.length > 1 ? "es" : "") + ")");
      l.forEach(function (e) {
        var s = e.section || {};
        lines.push("  " + fmtTime(e.start) + " – " + fmtTime(e.end) + "  " +
          (e.kind === "LAB" && s.labCourse ? s.labCourse : s.label) +
          (e.kind === "LAB" ? " (LAB)" : "") + "  ·  " + e.faculty + "  ·  " + (e.room || "-"));
      });
      lines.push("");
    });
    lines.push("SECTIONS IN THIS ROUTINE");
    routine.picks.forEach(function (p) {
      lines.push("  " + p.code + " — " + p.label + "  [using " + p.chosen.label + " · " + p.chosen.faculty + "]" +
        (p.count > 1 ? "  (" + p.count + " alternatives)" : ""));
    });
    var ex = examRows(routine);
    if (ex.length) {
      lines.push("");
      lines.push("EXAMS (mid + final)");
      ex.forEach(function (x) { lines.push("  " + x.text); });
    }
    return lines.join("\n");
  }

  function examRows(routine) {
    var out = [];
    routine.picks.forEach(function (p) {
      var sec = p.chosen;
      (sec.exams || []).forEach(function (x) {
        var clash = p.conflict && p.conflict.indexOf(x.kind) >= 0 ? "  ⚠ clashes with " + p.conflict.split(" · ")[0].replace(" & ", " / ") : "";
        out.push({
          kind: x.kind, code: p.code, sec: sec.sec, faculty: sec.faculty,
          date: x.date, start: x.start, end: x.end,
          text: x.kind + "  " + p.code + "-[" + sec.sec + "]  " + fmtDate(x.date) + "  " + fmtTime(x.start) + "–" + fmtTime(x.end) +
            "  ·  " + sec.faculty + clash
        });
      });
    });
    out.sort(function (a, b) { return (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start) || (a.kind === b.kind ? 0 : a.kind === "MID" ? -1 : 1); });
    return out;
  }

  /* ------------------------- shared view model (HTML + PNG) ------------------ */
  /* One model drives the on-screen grid, the day list, the exam table and the canvas
     painter, so the export can never drift from what the user sees. */

  var DAY_ABBR = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
  var HUES = [
    { bg: "#E8EBFA", line: "#8F9BE8", text: "#1F2C7C" },
    { bg: "#DDF4F1", line: "#5FC1B4", text: "#0F5E55" },
    { bg: "#FCF1D6", line: "#E5B65B", text: "#7A4F00" },
    { bg: "#FCE4EA", line: "#EA8AA3", text: "#8A1F3E" },
    { bg: "#F0E6FB", line: "#B48BE6", text: "#56268F" },
    { bg: "#E0F5E6", line: "#6FCB8B", text: "#1E6B3A" },
    { bg: "#DFF0FB", line: "#6FB9E6", text: "#0F4E75" },
    { bg: "#FDE9DC", line: "#F0A070", text: "#7F3A0F" }
  ];
  function hueOfIndex(n) { return HUES[n % HUES.length]; }

  function periodIndex(min) {                       // which standard slot a minute falls in
    for (var i = 0; i < TIME_SLOTS.length; i++) if (min >= TIME_SLOTS[i].start && min < TIME_SLOTS[i].end) return i;
    for (i = 0; i < TIME_SLOTS.length; i++) if (min < TIME_SLOTS[i].start) return i;
    return TIME_SLOTS.length - 1;
  }

  function routineSummary(routine) {
    var perDay = {}, events = routine.events, i, e;
    var minStart = 1440, maxEnd = 0, classes = 0;
    for (i = 0; i < events.length; i++) {
      e = events[i];
      (perDay[e.day] = perDay[e.day] || []).push(e);
      if (e.start < minStart) minStart = e.start;
      if (e.end > maxEnd) maxEnd = e.end;
      if (e.kind !== "LAB") classes++;
    }
    var days = [], dayCount = 0, longest = 0, gapCount = 0, gapMin = 0;
    for (i = 0; i < 7; i++) {
      var l = perDay[i] || [];
      days.push(!!l.length);
      if (l.length) dayCount++;
      var span = 0, t0 = 0, t1 = 0;
      if (l.length) {
        l = l.slice().sort(function (a, b) { return a.start - b.start; });
        t0 = l[0].start; t1 = l[l.length - 1].end; span = t1 - t0;
        for (var k = 1; k < l.length; k++) { var g = l[k].start - l[k - 1].end; if (g > 0) { gapCount++; gapMin += g; } }
      }
      if (span > longest) longest = span;
    }
    return { days: days, dayCount: dayCount, minStart: minStart, maxEnd: maxEnd, longest: longest, gapCount: gapCount, gapMin: gapMin, classes: classes, alt: routine.alt };
  }

  function buildView(routine, opts) {
    opts = opts || {};
    var sum = routineSummary(routine);
    var nCols = opts.friday || sum.days[6] ? 7 : 6;
    var cols = [];
    for (var d = 0; d < nCols; d++) cols.push({ day: d, label: DAY_ABBR[d], full: DAY_LABEL[DAYS[d]], free: !sum.days[d] });

    // rows = standard periods covering this routine, plus one buffer and a 6px divider row between
    var lo = 6, hi = 0, i, used = [];
    for (i = 0; i < routine.events.length; i++) {
      var e = routine.events[i];
      var a = periodIndex(e.start), b = periodIndex(e.end - 1);
      lo = Math.min(lo, a); hi = Math.max(hi, b);
    }
    if (hi < lo) { lo = 0; hi = TIME_SLOTS.length - 1; }
    lo = Math.max(0, lo - 1); hi = Math.min(TIME_SLOTS.length - 1, hi + 1);
    var rows = [];
    for (i = lo; i <= hi; i++) {
      rows.push({ kind: "slot", period: i, a: TIME_SLOTS[i].start, b: TIME_SLOTS[i].end,
                  label: fmtTimeShort(TIME_SLOTS[i].start), label2: fmtTimeShort(TIME_SLOTS[i].end) });
      if (i < hi) rows.push({ kind: "gap", period: i });
    }
    function rowOf(p) { return 2 * (p - lo) + 2; }              // +2 = header row in the CSS grid

    var clashMap = examClashMap(routine);
    var blocks = [];
    routine.events.forEach(function (ev) {
      var col = ev.day; if (col >= nCols) return;
      var p0 = periodIndex(ev.start), p1 = periodIndex(ev.end - 1);
      var sec = ev.section || {};
      // a block is ringed when the section in use has a clashing mid or final
      var clash = !!(clashMap[sec.code + "|MID"] || clashMap[sec.code + "|FINAL"]);
      var first = Math.max(p0, lo), last = Math.min(Math.max(p1, first), hi);
      blocks.push({
        col: col, row: rowOf(first), rowSpan: Math.max(1, (last - first) * 2 + 1),
        code: sec.code, label: ev.kind === "LAB" ? (sec.labCourse || (sec.code + "L")) : (sec.code + " · [" + sec.sec + "]"),
        time: fmtTimeShort(ev.start) + " – " + fmtTimeShort(ev.end),
        room: ev.room || "—", faculty: ev.faculty || "TBA",
        lab: ev.kind === "LAB", clash: clash,
        hue: opts.hueOf ? opts.hueOf(sec.code) : 0,
        tip: sec.label + " · " + (ev.kind === "LAB" ? (sec.labCourse || "") + " lab" : sec.name || "") +
             " · " + (ev.faculty || "TBA") + " · " + (ev.room || "no room") +
             (sec.exams && sec.exams.length ? " · " + sec.exams.map(function (x) { return x.kind + " " + fmtDate(x.date) + " " + fmtTime(x.start); }).join(" · ") : "")
      });
    });
    blocks.sort(function (x, y) { return x.col - y.col || x.row - y.row; });

    // exam table (dates come straight from the chosen sections)
    var clashInfo = examClashMap(routine);
    var exams = routine.picks.map(function (p, pi) {
      function cell(kind) {
        var x = null;
        (p.chosen.exams || []).forEach(function (z) { if (z.kind === kind) x = z; });
        if (!x) return null;
        return { date: x.date, time: fmtTimeShort(x.start) + " – " + fmtTimeShort(x.end), clock: fmtTime(x.start) + " – " + fmtTime(x.end), clash: clashInfo[p.code + "|" + kind] || false };
      }
      return {
        code: p.code, hue: opts.hueOf ? opts.hueOf(p.code) : pi, sec: p.chosen.sec, fac: p.chosen.faculty,
        mid: cell("MID"), fin: cell("FINAL"), pattern: p.label,
        sections: p.sections.map(function (s, si) {
          return { sec: s.sec, fac: s.faculties.join(", "), room: s.room, sel: si === p.secIdx,
                   clash: s.examKey !== p.chosen.examKey };
        })
      };
    });
    var altCount = routine.picks.reduce(function (n, p) { return n + (p.count - 1); }, 0);

    return { cols: cols, rows: rows, blocks: blocks, exams: exams, summary: sum, altCount: altCount, nCols: nCols, lo: lo, hi: hi, rowOf: rowOf };
  }

  // which (course, exam kind) pairs actually collide with another course in this routine
  function examClashMap(routine) {
    var map = {}, picks = routine.picks;
    for (var a = 0; a < picks.length; a++) {
      for (var b = a + 1; b < picks.length; b++) {
        var ea = picks[a].chosen.exams || [], eb = picks[b].chosen.exams || [], i, j;
        for (i = 0; i < ea.length; i++) for (j = 0; j < eb.length; j++) {
          if (ea[i].date && ea[i].date === eb[j].date && ea[i].kind === eb[j].kind && ea[i].start < eb[j].end && eb[j].start < ea[i].end) {
            map[picks[a].code + "|" + ea[i].kind] = true; map[picks[b].code + "|" + ea[i].kind] = true;
          }
        }
      }
    }
    return map;
  }

  /* ------------------------------ canvas painter ----------------------------- */
  /* Always light theme with the Prohor header, regardless of the UI theme — the
     image is meant to be printed or shared. Pure 2D-context code, so Node tests can
     run it against a stub context. */

  var L = {
    bg: "#FFFFFF", ink: "#131630", ink2: "#4B5170", ink3: "#7A8099", line: "#E1E4EF", line2: "#C9CEE0",
    head: "#F0F2F9", gap: "#F6F7FB", primary: "#253494", accent: "#E8A317", danger: "#C62F4A"
  };

  function paintRoutine(ctx, routine, opts) {
    opts = opts || {};
    var S = opts.scale || 2;
    var view = buildView(routine, { hueOf: function (code) { return opts.hueOf ? opts.hueOf(code) : 0; }, friday: opts.friday });
    var labelW = 56, colW = opts.colW || 168, rowH = 56, gapH = 7, headH = 74, pad = 18;
    var gridH = 30;                                   // day header row
    view.rows.forEach(function (r) { gridH += r.kind === "gap" ? gapH : rowH; });
    var examH = view.exams.length ? 26 + view.exams.length * 24 : 0;
    var W = pad * 2 + labelW + colW * view.nCols;
    var H = pad + headH + gridH + 12 + examH + 26 + pad;

    if (ctx.canvas) { ctx.canvas.width = Math.round(W * S); ctx.canvas.height = Math.round(H * S); }
    if (ctx.scale) ctx.scale(S, S);
    ctx.textBaseline = "top";
    function setFont(size, weight, mono) {
      ctx.font = (weight || 400) + " " + size + "px " + (mono ? "'JetBrains Mono', ui-monospace, Menlo, monospace" : "Inter, system-ui, 'Segoe UI', Roboto, sans-serif");
    }
    function box(x, y, w, h, fill, stroke) {
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1); }
    }
    function clip(t, w) {
      if (!ctx.measureText) return t;
      t = String(t);
      if (ctx.measureText(t).width <= w) return t;
      while (t.length > 3 && ctx.measureText(t + "…").width > w) t = t.slice(0, -1);
      return t + "…";
    }

    box(0, 0, W, H, opts.bg || L.bg);
    // header: mark + wordmark + session
    drawMark(ctx, pad, pad, 30);
    setFont(21, 400); ctx.fillStyle = L.ink;
    ctx.fillText(opts.title || "Prohor", pad + 40, pad + 4);
    setFont(12, 400); ctx.fillStyle = L.ink3;
    ctx.fillText(clip(opts.subtitle || "BRAC University routine · unofficial", W - 120), pad + 40, pad + 30);
    setFont(12, 600); ctx.fillStyle = L.ink2;
    var right = opts.meta || (routine.picks.map(function (p) { return p.code; }).join(" · "));
    ctx.fillText(clip(right, W - 200 - pad * 2), W - pad - ctx.measureText(right).width - 4, pad + 8);
    setFont(11, 400); ctx.fillStyle = L.ink3;
    var codes = "colour = course · hatched = lab · red ring = exam clash";
    ctx.fillText(codes, W - pad - ctx.measureText(codes).width - 4, pad + 28);
    var y0 = pad + headH - 14;

    // day header
    var x0 = pad + labelW, y = y0;
    box(pad, y, labelW + colW * view.nCols, 30, L.head, L.line);
    setFont(11, 600); ctx.fillStyle = L.ink3;
    ctx.fillText("Time", pad + 8, y + 9);
    view.cols.forEach(function (c, i) {
      setFont(12, 600); ctx.fillStyle = c.free ? L.ink3 : L.ink2;
      var t = c.full || c.label, tw = ctx.measureText ? ctx.measureText(t).width : t.length * 7;
      ctx.fillText(t, x0 + i * colW + (colW - tw) / 2, y + 9);
    });
    y += 30;

    // grid rows
    view.rows.forEach(function (r) {
      var h = r.kind === "gap" ? gapH : rowH;
      if (r.kind === "gap") {
        box(pad, y, labelW + colW * view.nCols, h, L.gap, null);
        y += h; return;
      }
      box(pad, y, labelW, h, L.head, L.line);
      setFont(10, 500, true); ctx.fillStyle = L.ink3;
      ctx.fillText(r.label, pad + 6, y + 5);
      ctx.fillText(r.label2, pad + 6, y + 19);
      for (var c = 0; c < view.nCols; c++) box(x0 + c * colW, y, colW, h, c >= 0 && view.cols[c].free ? "rgba(19,22,48,.022)" : null, L.line);
      y += h;
    });

    // "free" labels
    view.cols.forEach(function (c, i) {
      if (!c.free) return;
      setFont(11, 400); ctx.fillStyle = L.ink3;
      var t = "free", tw = ctx.measureText ? ctx.measureText(t).width : 26;
      ctx.fillText(t, x0 + i * colW + (colW - tw) / 2, y0 + 30 + 24);
    });

    // class / lab blocks
    var blockY = function (row) {
      var acc = 0;
      for (var i = 0; i < row - 2; i++) acc += view.rows[i] ? (view.rows[i].kind === "gap" ? gapH : rowH) : 0;
      return y0 + 30 + acc;
    };
    view.blocks.forEach(function (b) {
      var hue = hueOfIndex(b.hue);
      var bx = x0 + b.col * colW + 3, by = blockY(b.row) + 2;
      var bw = colW - 6, bh = 0;
      for (var i = b.row - 2; i < b.row - 2 + b.rowSpan; i++) {
        if (i >= view.rows.length) break;
        bh += view.rows[i].kind === "gap" ? gapH : rowH;
      }
      bh -= 4;
      box(bx, by, bw, bh, hue.bg, L.line);
      ctx.fillStyle = hue.line; ctx.fillRect(bx, by, 3, bh);
      if (b.clash) { ctx.strokeStyle = L.danger; ctx.lineWidth = 1.5; ctx.strokeRect(bx + .75, by + .75, bw - 1.5, bh - 1.5); }
      if (b.lab) {
        ctx.strokeStyle = "rgba(127,127,127,.16)"; ctx.lineWidth = 1;
        for (var s = -bh; s < bw; s += 8) { ctx.beginPath(); ctx.moveTo(bx + s, by + bh); ctx.lineTo(bx + s + bh, by); ctx.stroke(); }
      }
      var tx = bx + 9, ty = by + 6;
      setFont(11.5, 600); ctx.fillStyle = hue.text;
      ctx.fillText(clip(b.lab ? b.label + "  LAB" : b.label, bw - 14), tx, ty);
      setFont(10.5, 400, true); ctx.fillStyle = hue.text;
      ctx.fillText(clip(b.time, bw - 14), tx, ty + 16);
      if (bh > 48) { setFont(10, 400, true); ctx.fillStyle = L.ink2; ctx.fillText(clip(b.room + " · " + b.faculty, bw - 14), tx, ty + 31); }
    });

    // exams
    if (examH) {
      y += 6;
      setFont(10.5, 600); ctx.fillStyle = L.ink3;
      ctx.fillText("COURSE", pad + 4, y + 4);
      ctx.fillText("MID", pad + 96, y + 4);
      ctx.fillText("FINAL", pad + 300, y + 4);
      ctx.fillText("SECTION", W - pad - 150, y + 4);
      ctx.fillText("FACULTY", W - pad - 66, y + 4);
      y += 22;
      view.exams.forEach(function (ex) {
        var hue = hueOfIndex(ex.hue);
        ctx.fillStyle = hue.line; ctx.fillRect(pad + 4, y + 4, 9, 9);
        setFont(11.5, 600, true); ctx.fillStyle = L.ink; ctx.fillText(ex.code, pad + 20, y + 1);
        setFont(11, 400); ctx.fillStyle = L.ink2;
        ctx.fillText(ex.mid ? clip((ex.mid.clash ? "⚠ " : "") + fmtDate(ex.mid.date) + " · " + ex.mid.time, 190) : "not published", pad + 96, y + 1);
        ctx.fillText(ex.fin ? clip((ex.fin.clash ? "⚠ " : "") + fmtDate(ex.fin.date) + " · " + ex.fin.time, 180) : "not published", pad + 300, y + 1);
        ctx.fillText("[" + ex.sec + "]", W - pad - 150, y + 1);
        ctx.fillText(clip(ex.fac, 60), W - pad - 66, y + 1);
        y += 24;
      });
    }
    setFont(10.5, 400); ctx.fillStyle = L.ink3;
    ctx.fillText(clip(opts.footer || "Data: BRACU Connect via Connect-CDN (unofficial)", W - pad * 2), pad, H - pad - 12);
    return { width: W, height: H, blocks: view.blocks.length, exams: view.exams.length, cols: view.nCols, rows: view.rows.length };
  }

  function drawMark(ctx, x, y, size) {
    if (!ctx.arc) return;
    var r = size * 0.30, cx = x + size / 2, cy = y + size / 2 + size * 0.03, w = Math.max(2, size * 0.11);
    for (var i = 0; i < 8; i++) {
      var gap = (8 / 360) * Math.PI * 2, rot = (-22.5 + i * 45) * Math.PI / 180;
      ctx.beginPath();
      ctx.strokeStyle = (i === 1 || i === 2) ? L.accent : L.primary;
      ctx.lineWidth = w;
      ctx.arc(cx, cy, r + w / 2, rot + gap / 2, rot + (45 * Math.PI / 180) - gap / 2);
      ctx.stroke();
    }
    ctx.fillStyle = L.primary;
    ctx.fillRect(cx - r - w * .9, cy - size * 0.06, w * 1.1, size * 0.46);
  }

  return {
    DATA_URL: DATA_URL, SNAPSHOT_URL: SNAPSHOT_URL, REFRESH_MS: REFRESH_MS,
    DAYS: DAYS, DAY_SHORT: DAY_SHORT, DAY_LABEL: DAY_LABEL, TIME_SLOTS: TIME_SLOTS, LIGHT: L,
    fromApi: fromApi, buildIndex: buildIndex,
    sectionOptions: sectionOptions, facultyOptions: facultyOptions, sectionChoices: sectionChoices, avoidKills: avoidKills, candidatesFor: candidatesFor,
    createEnumerator: createEnumerator, orderRows: orderRows, buildRoutine: buildRoutine, generate: generate,
    conflicts: conflicts, scoreRoutine: scoreRoutine, candidateCompatible: candidateCompatible,
    weekGrid: weekGrid,
    routineText: routineText, examRows: examRows, paintRoutine: paintRoutine,
    slotLabel: slotLabel, fmtTime: fmtTime, fmtTimeShort: fmtTimeShort, fmtDate: fmtDate,
    DAY_ABBR: DAY_ABBR, HUES: HUES, hueOfIndex: hueOfIndex, periodIndex: periodIndex,
    buildView: buildView, examClashMap: examClashMap, routineSummary: routineSummary, drawMark: drawMark,
    toMinutes: toMinutes, dayIndex: dayIndex, uniq: uniq, uniqSorted: uniqSorted, popcount: popcount
  };
});
