# Prohor — BRACU routine planner

**Prohor** (প্রহর — a Bengali unit of time, one-eighth of a day) builds conflict-free weekly class
routines for BRAC University from the live **Connect-CDN** feed used by Connect Unlocked:
`https://usis-cdn.eniamza.com/connect.json`

Unofficial student project — not affiliated with BRAC University. No build step, no framework, no
backend: `index.html` + `core.js` + `worker.js` + a JSON feed. Works on a phone, works offline, ready
for GitHub Pages.

## How the data is loaded

1. On open, the **live feed** is fetched and stored in IndexedDB (localStorage fallback).
2. The next 6 hours, the page paints **instantly from that cache** while a quiet background
   revalidation runs; after 6 hours the next load (or a 60-second tick in a long-open tab, or the tab
   becoming visible again) refetches.
3. If the live feed can't be reached, the app automatically falls back to `snapshot.json` (a bundled
   copy of the feed). If that fails too, the last cached copy of any age is used. The header pill always
   says which one you're looking at, and **Refresh** forces a re-fetch.
4. **Generate works before the data lands**: pressing it early queues the search (and writes the
   shareable URL), then runs on its own once the feed arrives — your picked courses, locked patterns
   and preferences are all restored *before* the network settles, so nothing is lost.

## Features

- **Step 1 · Pick your courses** — a searchable combobox (code *or* title, `/` to focus, ↑↓ + Enter)
  that adds up to 6 course cards. Each card gets its own hue and two popovers: **Time slots**
  (patterns grouped by day pair, with a filter box, Select all / Clear / Done) and **Faculty**
  ("only these faculty", with per-faculty section counts). Locked patterns appear as removable chips;
  the caption reads `18 sections · 16 patterns · 1 pattern · 1 section match`.
- **Sections that share identical days/times are one pattern.** A routine is never duplicated 18 ways,
  and every card states how many sections that pattern stands for.
- **Swap an alternative section.** Under each routine, a radio list per course; choosing another section
  rewrites that card in place — grid labels, rooms, faculty, exam rows — while days and times stay
  identical. The choice survives paging and reload.
- **Sticky action bar** — `3 courses · 1 time slot locked · 2 filters · ~1,623 combinations`, live
  progress while searching, `⌘/Ctrl + Enter` to generate.
- **Exam-aware.** Mid *and* final slots are read from the feed; combinations whose exams overlap are
  rejected (and the count of blocked pairings is reported). Turning the switch off lets them through
  with a red ring on the offending blocks plus a `CLASH` tag in the exam table.
- **Timetable template + exam table on every card.** The routine is a real grid: `Time` column, six day
  columns (Saturday–Thursday; Friday appears when the feed has Friday classes), the standard slot ladder
  clipped to the routine's own span, thin divider rows between slots, empty cells kept (muted `free`),
  labs hatched and tagged, and a `Course · Mid · Final · Section · Faculty` table underneath.
- **Download as PNG** — renders that same grid, light theme with the Prohor header, at 2–3× and saves
  `prohor-CSE221-MAT216-CSE320.png`. No libraries, works offline. `Copy` grabs the section list;
  `Print all` uses a print stylesheet.
- **All routines, paged.** 50 per page (page size 10/25/50), ◀ Prev / Next ▶, and results already found
  are kept while the search continues. On weaker devices the search pauses at a cap and offers
  `＋ 50 more` or `Find them all`. Results stream in a **Web Worker** when available — otherwise the same
  engine time-slices on the main thread. Batch size scales with `hardwareConcurrency`, the cap with
  `deviceMemory`.
- **Preferences.** Days on campus (dual slider, min can't cross max), Check exam clashes, Minimise gaps
  and long days, Prefer patterns with more section choices, avoid faculty (suggestions scoped to your
  selected courses), avoid time slots, avoid days, Reset preferences. Everything persists in
  `prohor.state`, and `Copy link` writes the whole search (courses, locked patterns, faculty, days,
  avoids) into the URL.
- **Theme & accessibility.** "Merul Indigo" tokens (BRAC blue `#253494`, marigold accent only on the logo,
  the best-match badge and slider thumbs), light *and* dark via `data-theme` with no flash on load and a
  header toggle; Inter + Instrument Serif + JetBrains Mono; 40 px controls; `aria-pressed` chips,
  `role="switch"`, combobox/listbox semantics, `aria-live` result announcements, one visible focus ring,
  `prefers-reduced-motion` respected, all colours from the token block.
- **Mobile.** Course cards and controls stack, the timetable scrolls sideways instead of squashing,
  popovers carry a Done button, layout is usable at 360 px, and there's a PWA manifest + icons for Add to
  Home Screen.

## Run locally

```bash
cd prohor            # the folder holding these files
python3 -m http.server 8000      # or: npx serve .
# open http://localhost:8000
```

Double-clicking `index.html` works too (it fetches the live feed; `file://` may block the worker, in
which case the search runs on the main thread).

## Domain

<https://prohor-rg.vercel.app/>

## Files

| File | Purpose |
| --- | --- |
| `index.html` | markup, theme tokens and the app script |
| `core.js` | data transform, pattern grouping, conflict engine, view model, PNG painter (browser + Node) |
| `worker.js` | search worker; receives slim candidates, returns compact descriptors |
| `snapshot.json` | compact offline copy of the feed (includes exam fields) |
| `faculty-names.json` | optional initials → full name map |
| `manifest.webmanifest`, `favicon.svg`, `icon*.png` | PWA, home screen, favicon (Prohor mark) |
| `test.js`, `tools/worker-test.js`, `tools/browser-test.js` | the three suites above |
| `tools/build-snapshot.py` | rebuilds `snapshot.json` from a raw `connect.json` |

## Notes on the data

- Sections in the current feed belong to session `20263`, classes `2026-10-03 → 2027-01-04`; 1,856 of
  2,083 sections publish exam slots, and **every** paired lab lists `TBA` as faculty — that's the source
  data, not a bug here.
- `capacity`, `consumedSeat` and `prerequisiteCourses` are in the feed but not surfaced yet.
- Feedback: <mailto:nishadislamutso@gmail.com> · Code: <https://github.com/NishadIslamUtso>
