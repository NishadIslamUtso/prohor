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

## Deploy on GitHub Pages

1. Upload these files to the **repo root**:
   `index.html`, `core.js`, `worker.js`, `snapshot.json`, `faculty-names.json`, `manifest.webmanifest`,
   `favicon.svg`, `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`,
   `apple-touch-icon.png`, `.nojekyll`
2. **Settings → Pages → Source: Deploy from a branch → `main` / (root) → Save**.
3. Open `https://<user>.github.io/<repo>/`.

`.nojekyll` stops Jekyll from mangling the JSON and every path is relative, so it works from a project
page or a user page.

## Tests

```bash
node test.js                    # 63 engine checks: grouping, day window, filters, exams, view model, painter
node tools/worker-test.js       # 18 checks on the worker protocol and exam blocking
npm i jsdom                     # once
node tools/browser-test.js      # 196 checks driving the real UI in jsdom
SNAPSHOT_ONLY=1 node tools/browser-test.js    # same suite against the bundled snapshot

# refresh the offline copy (also picks up a new semester)
curl -o connect.json https://usis-cdn.eniamza.com/connect.json
python3 tools/build-snapshot.py --in connect.json --out snapshot.json
```

## How it works

1. **Normalise** — each feed item becomes events (class meetings + the paired lab's meetings) plus exam
   records (`finalExamDate/StartTime/EndTime`, same for mid).
2. **Group** — per course, sections sharing the sorted `day + start + end` signature become one pattern;
   the pattern remembers every section inside it.
3. **Filter** — locked patterns, chosen faculties, avoided faculty / times / days narrow each row.
4. **Search** — a resumable depth-first enumeration over rows sorted by fewest candidates. Pairwise
   incompatibility (class overlap *or* exam overlap) is precomputed into bitmaps, so a branch dies at the
   first clash and any partial exceeding the max days is cut. Scores prefer fewer days, shorter days, fewer
   gaps and optionally more section choices.
5. **Render** — results stay as tiny `{ci, score}` descriptors and are materialised only for the page you
   are reading; `buildView()` produces one model that drives the HTML grid, the day list, the exam table
   *and* the PNG, so the export can't drift from the screen.

Measured on the real feed: 3 courses (`CSE221 + MAT216 + CSE320`) → 2,400 combinations → 1,623 routines;
5 courses → 192,000 combinations → 12,776 routines in ~50 ms.

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
