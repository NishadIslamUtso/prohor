#!/usr/bin/env python3
"""Build a compact offline snapshot (snapshot.json) from a raw connect.json dump.

Usage:
    python3 tools/build-snapshot.py [--in connect.json] [--out snapshot.json]

The app fetches the live URL first and falls back to this file when offline.
"""
import argparse, json, os, sys, datetime

DAY_IDX = {"SATURDAY": 0, "SUNDAY": 1, "MONDAY": 2, "TUESDAY": 3, "WEDNESDAY": 4, "THURSDAY": 5, "FRIDAY": 6}


def mins(t):
    if not t:
        return None
    h, m, s = (list(map(int, t.split(":"))) + [0])[:3]
    return h * 60 + m


def ev(rows):
    out = []
    for x in rows or []:
        d = DAY_IDX.get(str(x.get("day", "")).upper())
        a, b = mins(x.get("startTime")), mins(x.get("endTime"))
        if d is None or a is None or b is None:
            continue
        out.append([d, a, b])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", default="connect.json")
    ap.add_argument("--out", dest="dst", default="snapshot.json")
    ap.add_argument("--url", default="https://usis-cdn.eniamza.com/connect.json")
    args = ap.parse_args()

    raw = json.load(open(args.src, encoding="utf-8"))
    items = raw if isinstance(raw, list) else (raw.get("sections") or raw.get("data") or [])
    sessions = sorted({it.get("semesterSessionId") for it in items if it.get("semesterSessionId")})
    starts = sorted({(it.get("sectionSchedule") or {}).get("classStartDate") for it in items if (it.get("sectionSchedule") or {}).get("classStartDate")})
    ends = sorted({(it.get("sectionSchedule") or {}).get("classEndDate") for it in items if (it.get("sectionSchedule") or {}).get("classEndDate")})

    out = []
    for it in items:
        ss = it.get("sectionSchedule") or {}
        out.append({
            "id": it.get("sectionId"),
            "c": it.get("courseCode"),
            "nm": it.get("courseName"),
            "sec": str(it.get("sectionName")),
            "f": it.get("faculties") or "TBA",
            "ct": it.get("courseType"),
            "cr": it.get("courseCredit"),
            "r": it.get("roomNumber") or it.get("roomName"),
            "cls": ev(ss.get("classSchedules")),
            "lab": ev(it.get("labSchedules")),
            "lr": it.get("labRoomName"),
            "lf": it.get("labFaculties"),
            "lc": it.get("labCourseCode"),
            "mid": ss.get("midExamDetail"),
            "fin": ss.get("finalExamDetail"),
            "fd": ss.get("finalExamDate"), "fs": mins(ss.get("finalExamStartTime")), "fe": mins(ss.get("finalExamEndTime")),
            "md": ss.get("midExamDate"), "ms": mins(ss.get("midExamStartTime")), "me": mins(ss.get("midExamEndTime")),
            "cap": it.get("capacity"),
            "used": it.get("consumedSeat"),
            "start": ss.get("classStartDate"),
            "end": ss.get("classEndDate"),
        })

    payload = {
        "meta": {
            "source": args.url,
            "generatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "semesterSessionIds": sessions,
            "classStartDate": starts[0] if starts else None,
            "classEndDate": ends[-1] if ends else None,
            "count": len(out),
        },
        "sections": out,
    }
    os.makedirs(os.path.dirname(args.dst) or ".", exist_ok=True)
    with open(args.dst, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=True)
    print(f"wrote {args.dst}: {len(out)} sections, {os.path.getsize(args.dst)} bytes")


if __name__ == "__main__":
    sys.exit(main())
