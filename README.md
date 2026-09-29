# Prohor — BRACU routine planner

## Domain

<https://prohor-rg.vercel.app/>

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

- **Pick your courses** — a searchable combobox (code *or* title, `/` to focus, ↑↓ + Enter)
  that adds up to six course cards; the box disables itself at six with "remove one to add another", and a
  ✕ at the right end clears the field and shuts the dropdown in one tap. Each card gets its own hue and three multi-select popovers:
  **Time slots** (patterns grouped by day pair), **Sections** (`[01] IBA · 09C-16T · Sun+Tue 11:00–12:20`,
  rows the other filters exclude are dimmed with a reason) and **Faculty** ("only these faculty", with
  per-faculty section counts). All three always list **every** option — the ones that clash with your other
  picks are greyed out with the reason on the right ("another time slot is locked", "taught by another
  faculty", "avoided time or day") instead of disappearing, the footer reads `12 of 17 available`, and
  tapping a greyed row is refused with a toast rather than half-applied. Picks render as removable chips
  and the caption reads `19 sections · 17 patterns · 2 sections picked · 1 pattern ·
  2 sections match`.
- **Three ways to narrow a course, all three in each other's direction.** Time slots, Sections and Faculty
  constrain one another symmetrically: every picker is judged against the *other two* plus the avoid filters,
  so locking `[01]` greys out the patterns and the faculty that section never meets — exactly as locking a
  pattern greys out sections. `1 of 17 available` in the footer of a picker is the honest count of what is
  left. Picking an impossible combination is refused with the reason instead of half-applied, a pick that a
  later change strands stays ticked but is flagged (`1 of your current picks no longer fits — untick it to
  free the rest`) and can always be unticked, so no popover can trap you. A contradiction that arrives from an
  old share link — where it cannot be refused — is explained in plain words instead of returning nothing:
  `CSE221: the locked time slot does not include the section [05] — unlock a time slot or pick a section
  that meets at it`.
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
- **Colour-coded seat labels.** `Sat`, `Tue`… day names in the brand blue, times in tabular grey, `Lab` as
  an outlined tag in that course's hue, `Mid` in amber and `Fin` in red — so a row reads at a glance
  instead of needing to be parsed. Section headings stay unnumbered: *Pick your courses*, *Set your
  preferences*, *Compare routines*.
- **Pickers that always work.** Each of Time slots / Sections / Faculty opens on focus, click or typing
  (the old "sometimes it doesn't" came from a refresh replacing the button the popover was mounting
  into), closes on `Esc`, an outside tap or the ✕ inside the field, and switching straight from one
  picker to another swaps in place instead of vanishing. The suite hammers all three for two full
  rounds plus the tricky transitions to keep this fixed.
- **12-hour clock everywhere.** The grid gutter, the blocks, the exam table, the pickers and the chips all
  read `09:30 AM – 10:50 AM` — one clock across the whole app, and the same in the PNG and print output.
- **Timetable template + exam table on every card.** The routine is a real grid: `Time` column, six day
  columns (Saturday–Thursday; Friday appears when the feed has Friday classes), the standard slot ladder
  clipped to the routine's own span, thin divider rows between slots, empty cells kept (muted `free`),
  labs hatched and tagged, and a `Course · Mid · Final · Section · Faculty` table underneath.
- **Download as PNG** — renders that same grid, light theme with the Prohor header, at 2–3× and saves
  `prohor-CSE221-MAT216-CSE320.png`. No libraries, works offline. `Copy` grabs the section list;
  `Print all` uses a print stylesheet.
- **Seats panel — one adjustable split view, on every device, with the page never squeezed out.** The
  header's `Seats` button opens it and the layout makes room: **beside** the page on screens ≥ 1024 px
  (300–560 px wide, the page keeps ≥ 460 px), **below** the page on phones and tablets (default 42 % of the
  height, capped at 340 px, and it can never take more than the viewport minus 260 px — so a card, the
  table and the buttons always fit above it). Nothing dims, nothing is modal, `Esc` does not close it, and
  the page stays fully interactive: pickers, the course dropdown, the data popover and the sticky action bar
  are all stacked *above* the band, and a picker with no room left below its button **opens upward** with its
  height capped to the page band instead of the viewport (`fitMs` / `fitOverlays`). **Drag the handle to set
  the split**; arrow keys nudge it (Shift for bigger steps), `Home` or a double-click returns it to the
  default, and the size is remembered per device (`prohor.railSize`).
- **…or make it a page of its own.** Two buttons in the panel header: **New window** opens `?view=seats`
  in a second window (`window.open`, `noopener`), and **Open as page** turns this tab into that page —
  the planner keeps running underneath, so **Planner** takes you straight back. On the seats page the panel
  *is* the document (`body.view-seats`): `main` and the action bar are hidden, the top chrome (title, live
  line, filter) sticks as one measured block (`--stick`, recomputed on every render and resize so
  `scrollIntoView` never tucks a row under it), the course name sticks above its own sections, the boxes run
  in two columns from 980 px, and the pinned chips stay one scrollable line. Closing there is a no-op on
  purpose — a page with nothing in it is not a feature. Because both windows are the same origin, pins and
  course picks travel between them through the `storage` event: pin something in the seats window and the
  planner's Pinned box updates without a reload. Bookmarkable at `…/index.html?view=seats`.
- **Tap the handle = fold it to a strip.** One tap on the handle (or *Hide sections* in the panel header)
  folds the band to a 96 px status strip that still shows the live dot, the refresh age and **one line of
  chips for your pinned sections** (`CSE221 [01] full · MAT216 [04] 3 free`), so the page has the whole
  screen back without losing track of the seats you are chasing. Tap again to unfold to exactly the size you
  had; the lists are hidden by a class, never thrown away. Free seats for every section, straight from the feed's
  `capacity − consumedSeat`, and it never over-reports: an over-subscribed section reads `full · +5 over`
  instead of a negative number. Each row shows the section, the **faculty short form**, the **time slot**
  with the **mid and final dates** under it, and a seat pill (`12 free` / `3 free` / `full`). Three boxes stack in the order
  the situation dictates: **On this routine page** (only once routines exist — the sections shown by the
  50 cards on the page you are reading, re-collected every time you page or sort), then **Your courses**
  (all sections of the courses you added, section-number ascending — it sits on top until a search
  finishes, then slides below), then **All courses** (the whole catalogue A→Z, each course collapsed and
  opened on demand, so 534 courses never mean 2,000 DOM rows). One filter box on top searches all three
  by course code, course title, faculty initials, faculty name, section or room.
- **Pin up to 50 sections.** The pin button on any row keeps that section in a Pinned box at the top of the
  panel, so you can watch several seat counts at once while you compare routines — any number of sections per
  course, sorted course then section, each row naming its course. The header counts them (`7 of 50`),
  the fifty-first is refused with a toast, `clear all` wipes them, and pins persist in `localStorage`. A pin
  whose section disappears from the feed is dropped at the next refresh instead of holding a slot.
- **Seat polling can't disturb searching.** The rail has its own 30-second timer and its **own worker**
  (`fetch-seats`), so a poll never queues behind or interleaves with an enumeration; results are never
  re-rendered because of it (the test asserts `#resultsBody` is byte-identical before and after a refresh),
  rail repaints are coalesced to idle time, failures back off (30 s → 60 s → … max 8 min), and `Pause` /
  `Check now` are right in the panel header.
- **Honest cadence note.** The panel's footnote is generated from the live cadence, so it says exactly
  what is happening (`every 8 s while this panel is on screen`, `every 30 s in the background`) instead of
  a hard-coded number. 8 s is as fast as it is worth going: each poll pulls the ~3.3 MB feed, so faster
  would cost a phone's data and the CDN's bandwidth for little gain — `Check now` is there when you want
  it this second.
- **50 at a time, on demand, nothing ever lost.** One press = one page of 50. The search then *stops* and
  waits — no background grinding on a phone. `Next ▶` past what is loaded fetches the next 50, `＋ 50 more`
  grabs a page without moving, and `Find them all` is the explicit opt-in for a full sweep (that one is
  capped by device memory, the per-page flow is not). Every batch, your page position and your per-card
  section swaps are saved to the device (IndexedDB, localStorage fallback), so a reload — or coming back
  hours later — reopens the same list on the same page, labelled *kept on this device*. Results stream in a **Web Worker** when available — otherwise the same
  engine time-slices on the main thread. Batch size scales with `hardwareConcurrency`, the cap with
  `deviceMemory`.
- **Works even when the network is slow.** The saved feed on the device is used first; if it is missing or
  older than 6 h, the page races the live endpoint against the bundled `snapshot.json` and paints the
  pickers from whichever answers first (snapshot usually wins locally, in ~ms), then quietly upgrades to
  live data — pattern keys are content-based, so your locked slots survive the swap. A pending Generate
  press is queued and runs automatically once data lands.
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

## Devices

Built to be used on any of them: iPhone (Safari), Android (Chrome), iPad, MacBook/Windows/Linux desktops,
and small laptops down to 360 px. One layout with three breakpoints (360 / 520 / 1024 / 1280): the columns
stack on narrow screens, the seats panel docks beside the page on wide ones and slides up under it on phones
and tablets (the handle adjusts both), the timetable scrolls inside its own frame so the page never scrolls sideways, all controls are
≥ 40 px tall, `dvh`-free fixed positioning plus `env(safe-area-inset-*)` keep the sticky action bar clear
of the iOS home bar and Android gesture bar, and `prefers-reduced-motion` / `prefers-color-scheme` are both
honoured. Add-to-home-screen works via the manifest, so it can live on a phone's home screen like an app.

## Run locally

```bash
cd prohor            # the folder holding these files
python3 -m http.server 8000      # or: npx serve .
# open http://localhost:8000
```

Double-clicking `index.html` works too (it fetches the live feed; `file://` may block the worker, in
which case the search runs on the main thread).

## Deploy on Vercel (zero config)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/prohor)

`vercel.json` in this repo already pins the right settings (`framework: null`, `outputDirectory: "."`), so
the deploy popup needs nothing:

| Popup field | Value |
| --- | --- |
| Git Repo | your repo |
| Branch to Deploy | `main` |
| Project Name | `prohor` (becomes `prohor.vercel.app`) |
| Root Directory | **`.`** — only change it if the files sit in a subfolder |
| Framework Preset | **Other** |
| Build Command | *(enable Override, leave the box empty — no build step)* |
| Output Directory | **`.`** (already set by `vercel.json`) |
| Install Command | *(enable Override, leave empty — there is no `package.json`)* |
| Development Command | leave empty (or `npx serve .`) |
| Environment Variables | none — the app calls the public Connect-CDN feed |

CLI route instead: `npm i -g vercel`, then in the unzipped folder `vercel` for a preview and
`vercel --prod` to publish. Answer the prompts: *Set up and deploy? Y* → pick your scope →
*Link to existing project? N* → *Project name* `prohor` → *Where is your code? ./` →
*Override settings? N*.

Gotchas worth knowing:
- Files must be at the **project root** (or set Root Directory). If you push them into a `prohor/`
  folder in the repo, either move them up or point Root Directory at `prohor`.
- `vercel.json` is inert on GitHub Pages, and `.nojekyll` is inert on Vercel — keeping both is fine.
- If the site ever asks you to log in to view it, turn off **Settings ▸ Deployment Protection ▸
  Vercel Authentication / Password Protection**.
- Static only: no env vars, no server code. The one network call is
  `https://usis-cdn.eniamza.com/connect.json`, which returns `access-control-allow-origin: *`, so it works
  from any domain (it also falls back to `snapshot.json` when offline).

## Deploy on GitHub Pages

1. Upload these files to the **repo root**:
   `index.html`, `core.js`, `worker.js`, `snapshot.json`, `faculty-names.json`, `manifest.webmanifest`,
   `favicon.svg`, `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`,
   `apple-touch-icon.png`, `.nojekyll` (plus `vercel.json` if you use Vercel)
2. **Settings → Pages → Source: Deploy from a branch → `main` / (root) → Save**.
3. Open `https://<user>.github.io/<repo>/`.

`.nojekyll` stops Jekyll from mangling the JSON and every path is relative, so it works from a project
page or a user page.

## Tests

```bash
node test.js                    # 96 engine checks: grouping, day window, filters, exams, view model, painter
node tools/worker-test.js       # 23 checks on the worker protocol, exam blocking and seat polling
npm i jsdom                     # once
node tools/browser-test.js      # 451 checks driving the real UI in jsdom (split, seats page, paging, pickers)
node tools/sweep.js 20260928    # seeded random-action sweep over both views + the invariants that must never break
node tools/layout-audit.js      # real Chromium at 360/390/768/1440: hit-tests every control, measures both panes
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
| `vercel.json` | Vercel: framework `null`, serve the root, sensible caching + security headers |
| `test.js`, `tools/worker-test.js`, `tools/browser-test.js` | the three suites above |
| `tools/sweep.js` | seeded random clicking (both views, pop-outs, foreign `storage` events) against invariants: pins ≤ 50, courses ≤ 6, unique ids, no junk text, no page errors, view and URL always agreeing |
| `tools/layout-audit.js` | the same checks a human does with a finger: what is under the tap, and how much of each pane is chrome vs content (needs `npm i -D playwright`) |
| `tools/build-snapshot.py` | rebuilds `snapshot.json` from a raw `connect.json` |

## Notes on the data

- Sections in the current feed belong to session `20263`, classes `2026-10-03 → 2027-01-04`; 1,856 of
  2,083 sections publish exam slots, and **every** paired lab lists `TBA` as faculty — that's the source
  data, not a bug here.
- `capacity`, `consumedSeat` and `prerequisiteCourses` are in the feed but not surfaced yet.
- Feedback: <mailto:nishadislamutso@gmmail.com> · Code: <https://github.com/NishadIslamUtso>
