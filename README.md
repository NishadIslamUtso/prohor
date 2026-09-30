# Prohor — BRACU Routine Planner

**Prohor** (প্রহর — a Bengali unit of time, one eighth of a day) builds conflict-free weekly class
routines for BRAC University students. Pick your courses, set your constraints, and Prohor
enumerates every valid combination — class meetings *and* mid/final exam slots checked — ranked by
how comfortable each week would be.

- **Live app:** <https://prohor-rg.vercel.app/>
- **Data:** the Connect-CDN feed used by Connect Unlocked — `https://usis-cdn.eniamza.com/connect.json`
- **Stack:** no build step, no framework, no backend. `index.html` + `core.js` + `worker.js` + JSON.
- **Status:** unofficial student project; not affiliated with BRAC University. Always confirm in
  BRACU Connect before relying on a routine.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Feature overview](#feature-overview)
3. [How it works](#how-it-works)
4. [Architecture and project structure](#architecture-and-project-structure)
5. [Data loading and caching](#data-loading-and-caching)
6. [Live seat tracking](#live-seat-tracking)
7. [Running locally](#running-locally)
8. [Deployment](#deployment)
9. [Testing](#testing)
10. [Notes on the data](#notes-on-the-data)
11. [Feedback](#feedback)

---

## What it does

BRAC University publishes sections, schedules, rooms, faculty and exam slots through its student
portal's public feed. Choosing a combination of sections with no class or exam overlap is a
tedious puzzle to solve by hand. Prohor solves it:

1. You add up to **six courses** from a searchable combobox (code *or* title, `/` to focus,
   ↑↓ + Enter).
2. You narrow each course with three symmetric filters — **time slots**, **sections** and
   **faculty** — and global preferences (days on campus, avoid faculty/time slots/days, exam
   clash checking, gap minimisation).
3. Prohor enumerates **every conflict-free routine**, scores them (fewer days, shorter days,
   fewer gaps first) and presents them 50 at a time as printable timetable cards.
4. A **seats panel** tracks live free-seat counts for the sections you care about, and a
   one-click **PNG export** gives you a clean image of any routine.

Everything runs client-side: after the first load the app works fully offline, on a phone,
installable as a PWA.

## Feature overview

### Course selection and constraints

- Up to six course cards, each with its own colour and three multi-select pickers:
  **Time slots** (meeting patterns grouped by day pair), **Sections**
  (`[01] IBA · 09C-16T · Sun+Tue 11:00–12:20`) and **Faculty** ("only these faculty").
- **The three pickers constrain one another symmetrically.** Locking `[01]` greys out the
  patterns and faculty that section never meets; locking a pattern greys out sections the same
  way. Every option stays visible — impossible ones are dimmed with the reason on the right
  ("another time slot is locked", "taught by another faculty", "avoided time or day") — the
  footer shows an honest `12 of 17 available`, and tapping a dimmed row is refused with a toast
  instead of being half-applied. A pick stranded by a later change stays ticked but is flagged
  (`1 of your current picks no longer fits — untick it to free the rest`), so no popover can
  trap you. A contradiction arriving from an old share link is explained in plain words.
- **Sections with identical days/times collapse into one pattern**, so a routine is never
  duplicated 18 ways; cards state how many sections each pattern stands for.

### Search and results

- Resumable depth-first enumeration in a **Web Worker** (main-thread time-slicing as fallback).
- Class conflicts and mid/final exam overlaps are both checked; exam clashes can be allowed with
  a switch (the offending blocks get a red ring and a `CLASH` tag in the exam table, and blocked
  pairings are counted).
- **50 routines per page, on demand** — `Next ▶`, `＋ 50 more`, or an explicit `Find them all`
  full sweep. Page position and per-card section swaps persist on the device (IndexedDB with
  localStorage fallback) and are restored after a reload, labelled *kept on this device*.
- Batch size scales with `hardwareConcurrency`; the full-sweep cap scales with `deviceMemory`.
- Every card shows a real timetable grid (Saturday–Thursday, plus Friday when the feed has
  Friday classes), colour-coded course blocks, hatched lab blocks, muted `free` cells, and a
  `Course · Mid · Final · Section · Faculty` table ordered chronologically.

### Export and sharing

- **Download as PNG** — the timetable and exam table rendered on canvas in a print-ready light
  theme with the Prohor header (wordmark, the semester term such as *Fall 2026*, and the section
  list), a QR code back to the site and a data-source line. 12-hour clock throughout, at 2× scale.
- **Copy** grabs the section list as text; **Print all** uses a dedicated print stylesheet.
- **Copy link** encodes the entire search — courses, locked patterns, faculty picks, day window,
  avoids — in the URL, and pressing **Generate** before data has loaded queues the search and runs
  it automatically once the feed lands.

### Seats panel

- A resizable split view (beside the page on wide screens, below it on phones/tablets; drag the
  handle or use arrow keys) that can also become its own page at `?view=seats`. Two windows stay
  in sync through `storage` events.
- Three boxes — **On this routine page**, **Your courses**, **All courses** (collapsed per
  course) — plus a **Pinned** box (up to 50 sections) for watching specific seat counts.
- Free seats = `capacity − consumedSeat`, refreshed from the live feed every 8 s while open and
  every 30 s in the background, in a dedicated worker so polling can never disturb a running
  search. Failures back off up to 8 minutes. Over-subscribed sections read `full · +5 over`,
  never a negative number.
- **Whenever a section's seat number changes, every row showing that section — in every box —
  pulses a soft translucent green wash exactly once**, in light and dark themes alike. The tint
  sits behind the labels so every detail stays readable, folding or re-filtering never replays
  the pulse, and the animation is disabled under `prefers-reduced-motion`.
- Each row shows the section, faculty short form, meeting pattern, mid/final dates and a seat
  pill. Folding the panel leaves a 96 px status strip with one line of pinned chips.

### Saved semesters

When the feed rolls over to a new session, the previous one is filed on the device (up to 8
semesters). A semester switch in the panel header lets you browse an old semester exactly as it
was — but only the **All courses** box follows it. The pinned, on-this-page and your-courses
boxes keep showing live seats, and polling keeps running while you browse the past.

The archive also keeps the teacher as they last were: BRACU sometimes flips a published
instructor back to TBA mid-semester, so the app remembers the last real initial per section
(the live view still shows whatever the feed says, TBA included). When the semester is filed,
each section stores its last real name — only a section that stayed TBA from the first usable
snapshot to the last is archived as TBA.

### Platform and accessibility

- Light and dark themes ("Merul Indigo" tokens, BRAC blue `#253494` with a marigold accent), no
  flash of the wrong theme on load.
- One layout from 360 px phones to wide desktops; all controls ≥ 40 px; safe-area aware; the
  timetable scrolls inside its own frame so the page never scrolls sideways.
- Combobox/listbox semantics, `aria-pressed` chips, `role="switch"`, `aria-live` result
  announcements, one visible focus ring, `prefers-reduced-motion` and `prefers-color-scheme`
  honoured.
- PWA manifest and icons for Add to Home Screen.

## How it works

The engine pipeline (all in `core.js`):

1. **Normalise** — each feed item becomes class-meeting events (including the paired lab's
   meetings) plus mid/final exam records.
2. **Group** — within a course, sections sharing the sorted `day + start + end` signature become
   one pattern; the pattern remembers every section inside it.
3. **Filter** — locked patterns, section/faculty picks and avoided faculty/times/days narrow each
   course row; the three pickers are judged against one another so availability counts stay honest.
4. **Search** — resumable depth-first enumeration over rows ordered by fewest candidates first.
   Pairwise incompatibility (class overlap *or* exam overlap) is precomputed into bitmaps, so a
   branch dies at the first clash; partials exceeding the day window are cut early. Scores prefer
   fewer days, shorter days, fewer gaps, and optionally patterns with more section choices.
5. **Render** — results stay as tiny `{ci, score}` descriptors and are materialised only for the
   page being viewed. One `buildView()` model drives the HTML grid, the exam table *and* the PNG
   painter, so the export can never drift from the screen.

Measured on the real feed: 3 courses (`CSE221 + MAT216 + CSE320`) → 2,400 combinations →
1,623 routines; 5 courses → 192,000 combinations → 12,776 routines in ~50 ms.

## Architecture and project structure

There is no build step: the repository root *is* the deployable site.

```
prohor/
├── index.html            markup, all CSS ("Merul Indigo" tokens, light + dark) and the UI layer
├── core.js               engine: UMD module — window.RGCore in browsers, require()able in Node
├── worker.js             Web Worker: search enumeration + isolated seat polling
├── snapshot.json         compact offline copy of the feed (exam fields included)
├── faculty-names.json    optional faculty-initial → full-name map (feed carries initials only)
├── manifest.webmanifest  PWA metadata
├── favicon.svg, icon*.svg/png, apple-touch-icon.png
├── test.js               engine test suite (Node, no dependencies)
└── tools/
    ├── worker-test.js    worker protocol + exam blocking + seat-polling isolation tests
    ├── browser-test.js   full UI suite driving the real page in jsdom
    ├── sweep.js          seeded random-action sweep over both views, asserting invariants
    ├── layout-audit.js   real-Chromium geometry/hit-test audit (Playwright)
    └── build-snapshot.py rebuilds snapshot.json from a raw connect.json dump
```

### Module responsibilities

| File | Responsibility |
| --- | --- |
| `index.html` | App state, comboboxes and pickers, results rendering, seats panel + seats page, semester archive, preferences, share links, persistence (`prohor.state`, IndexedDB), theme, toasts, keyboard shortcuts |
| `core.js` | Feed normalisation (`fromApi`/`buildIndex`), pattern grouping, candidate filtering, `createEnumerator` (the DFS search), `scoreRoutine`, `buildView` (shared view model), `paintRoutine` (canvas PNG), QR encoder, `seatRows` (slim seat projection) |
| `worker.js` | Message protocol (`init` / `more` / `ping` / `fetch-seats`); receives slim candidates, returns compact transferable `{ci, score}` descriptors; a second instance polls seats so polling never queues behind a search |

### Runtime data flow

```
connect.json (live) ──► core.fromApi ──► buildIndex ──► courses / patterns / exams
        │                                                   │
        ├──► core.seatRows ──► seats panel (its own worker) │
        ▼                                                   ▼
 IndexedDB/localStorage cache                      worker.js (DFS search)
        │                                                   │ {ci, score}
        ▼                                                   ▼
 snapshot.json (bundled fallback) ────────────────► buildView ──► HTML grid / exam table / PNG
```

## Data loading and caching

1. On open, the live feed is fetched and stored in IndexedDB (localStorage fallback).
2. For the next 6 hours the page paints instantly from cache while a quiet background
   revalidation runs; after 6 hours the next load, a 60-second tick in a long-open tab, or the tab
   becoming visible again triggers a refetch.
3. If the live feed cannot be reached, the app falls back to the bundled `snapshot.json`, then
   to the last cached copy of any age. The header pill always states which source is on screen
   (*Live*, *Cached*, *Offline copy*, *Stale copy*), and **Refresh** forces a re-fetch.
4. When the saved feed is old, the page races the live endpoint against `snapshot.json` and
   paints from whichever answers first, then quietly upgrades to live data — pattern keys are
   content-based, so locked slots survive the swap. A pending **Generate** press is queued and
   runs once data lands.
5. Revalidation compares a **content fingerprint**, not a section count: a refresh that returns
   the same sections rolls the clock without rebuilding (Refresh is effectively free), and a
   republish that edits rooms or exams at the *same* section count is noticed and rebuilt
   instead of being served stale while claiming to be live. When the feed moves to a new
   session, the previous semester is filed on the device automatically, pins on dropped sections
   are pruned, and the planner keeps running on the new data without a reload.

## Live seat tracking

- A dedicated `Worker` instance handles only `fetch-seats`, so a poll can never queue behind or
  interleave with an enumeration; results never re-render the routine list (a test asserts
  `#resultsBody` is byte-identical across a seat refresh), and rail repaints are coalesced to
  idle time.
- Cadence: 8 s while the panel is open, 30 s in the background, exponential backoff on failure
  (30 s → … → 8 min). **Pause** and **Check now** sit in the panel header; the footnote is
  generated from the live cadence so it always says exactly what is happening.
- 8 s is a deliberate floor: each poll pulls the ~3.3 MB feed, so faster polling would cost a
  phone's data plan and the CDN's bandwidth for little gain.

## Running locally

```bash
cd prohor                 # the folder holding these files
python3 -m http.server 8000     # or: npx serve .
# open http://localhost:8000
```

Double-clicking `index.html` also works (the live feed is fetched; `file://` may block the
worker, in which case the search runs on the main thread).

## Deployment

### GitHub Pages

1. Upload these files to the **repository root**: `index.html`, `core.js`, `worker.js`,
   `snapshot.json`, `faculty-names.json`, `manifest.webmanifest`, `favicon.svg`, `icon.svg`,
   `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png`, plus an empty
   `.nojekyll` file (stops Jekyll from mangling the JSON).
2. **Settings → Pages → Source: Deploy from a branch → `main` / (root) → Save**.
3. Open `https://<user>.github.io/<repo>/`.

Every path is relative, so the site works from a project page or a user page.

### Vercel

Import the repository as an *Other* (no-framework) project and serve the repository root; the app
itself needs no configuration.

### Scaling and hosting cost

There is no backend, so "many users" never touches your quota the way a dynamic site would:

- **What a visitor costs you:** the static shell (≈ 1.1 MB uncompressed; far less over the wire
  with Brotli) served as files. On the free Hobby tier (100 GB/month) that is on the order of a
  hundred thousand first visits a month; repeat visitors mostly revalidate.
- **What a visitor costs themselves:** live feed + seat polling (`≈ 3.3 MB` per poll of
  `connect.json`, every 8 s with the panel open and 30 s in the background) — this traffic goes
  to the Connect-CDN, not to your hosting bandwidth, and it is why the cadence is capped and
  failures back off exponentially instead of hammering the upstream.
- **No runtime to scale:** the search runs in a worker on the user's own device; there are no
  serverless functions, no cold starts, and nothing per-user on the server at all.

## Testing

```bash
node test.js                    # engine checks: grouping, day window, filters, exams, view model,
                                # PNG painter (incl. the header/semester geometry)
node tools/worker-test.js       # worker protocol, exam blocking, seat-polling isolation,
                                # success + failure contracts of the seat worker
npm i jsdom                     # once
node tools/browser-test.js      # full UI suite in jsdom: split view, seats page, paging, pickers,
                                # semester rollover, same-count drift, hostile-feed escaping
node tools/sweep.js 20260928    # seeded random-action sweep over both views + invariants
npm i -D playwright             # once, for the layout audit
node tools/layout-audit.js      # real Chromium at 360/390/768/1440 px: hit-tests every control
SNAPSHOT_ONLY=1 node tools/browser-test.js    # the same suite pinned to the bundled snapshot

# refresh the offline copy (also picks up a new semester)
curl -o connect.json https://usis-cdn.eniamza.com/connect.json
python3 tools/build-snapshot.py --in connect.json --out snapshot.json
```

The sweep is seeded, so a failure reproduces exactly: after every action it asserts the URL and
body class agree on the view, dimmed picker rows never accept a tick, pins stay ≤ 50, courses ≤ 6,
ids unique, and no `undefined` / `NaN` / `[object Object]` reaches visible text.

## Notes on the data

- Sections in the current feed belong to session `20263` (Fall 2026), classes
  `2026-10-03 → 2027-01-04`; 1,864 of 2,092 sections across 534 courses publish exam slots, and
  **every** paired lab lists `TBA` as faculty — that is the source data, not a bug.
- Session ids map to terms by their fifth digit (`20263` → *Fall 2026*): `1` Spring, `2` Summer,
  `3` Fall. The app and the PNG export always name the term, never the raw id.
- `capacity`, `consumedSeat` and `prerequisiteCourses` are in the feed; the first two power the
  seats panel, prerequisites are not surfaced yet.
- `faculty-names.json` is optional: map initials to full names and they render as
  `SWK · Saharia Islam` in class blocks, chips and the faculty picker. Unknown initials display
  as-is.

## Feedback

Found a bug, a stale mapping, or a routine that should not be possible?
[Send feedback on Gmail](https://mail.google.com/mail/?view=cm&fs=1&to=nishadislamutso@gmail.com&su=Prohor%20routine%20planner%20feedback)
· [Source code](https://github.com/NishadIslamUtso/prohor)
