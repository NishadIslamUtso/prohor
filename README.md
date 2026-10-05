# Prohor — BRACU Routine Planner

**Prohor** (প্রহর) builds weekly class routines for BRAC University students. Choose up to six
courses, set constraints, and compare routines without class or lab clashes. Midterm and final
exam checks are enabled by default.

- **Website:** <https://prohor-rg.vercel.app/>
- **Feed:** <https://usis-cdn.eniamza.com/connect.json>
- **Stack:** static HTML, CSS and JavaScript; no application server or build step.
- **Unofficial:** confirm sections, faculty, exams and seats in BRACU Connect before registration.

## Run locally

```sh
python3 -m http.server 8000 --bind 0.0.0.0
# Open http://localhost:8000
```

The website needs no npm installation. Serve it over HTTP rather than opening `index.html`
with `file://`, which can prevent workers and JSON requests from loading.

## Features

### Course selection and preferences

- Search by course code or title. `/` focuses search; arrow keys and Enter select a result.
- Filter each course by time pattern, section and faculty. Incompatible choices are explained;
  existing selections remain removable. Identical meeting patterns are grouped together.
- Set maximum campus days and unavailable days/times.
- Seat modes: **Ignore** (fresh/reset default), **Prefer available**, or **Require available**.
  Require excludes known-full sections; unknown counts remain eligible. Explicit saved choices
  survive reloads.
- One ranking selector: Balanced, Fewer campus days, Less total campus time, or Shorter days &
  fewer gaps. Legacy custom combinations remain visible as Custom until replaced.
- Advanced contains faculty exclusions and exam checking. Minimum-day constraints and duplicate
  ranking switches are removed, including their legacy saved/link settings.

### Results and sharing

- Search runs in a worker with main-thread fallback. Find more continues enumeration; Find them
  all requests a larger sweep within device-dependent limits. Rankings apply to results found
  so far, not unseen combinations.
- Sort by Best overall, Fewest days, Fewest gaps, Latest start, Earliest finish, or Most section
  choices. Latest start compares the earliest class of each routine; Earliest finish compares
  its latest class end across the week.
- Grid/day-list views show meetings and exams. Alternative sections update the routine and show
  exam-conflict warnings where applicable.
- Copy section lists, print results, or download a 2× PNG. The PNG QR links to the app homepage,
  not the specific routine.
- Share links include course selections and constraints. Versioned links reset unspecified
  constraints rather than inheriting the recipient's settings; older links remain readable.
- Preferences, pins, theme and eligible result pages persist locally. Feed/scoring changes
  invalidate incompatible saved results. Reset clears device state, not repository history.

### Seats and collected semesters

- Resizable seats panel and standalone `?view=seats` page, with same-origin tab synchronization.
- Lists: Pinned (up to 50 sections), On this routine page, Your courses, and All courses.
- Seat changes update rows without rebuilding results or moving the list's scroll position.
- Only **All courses** follows the semester selector. Saved courses start collapsed, including
  filtered results; explicit open/closed choices are separate per semester during the visit.
- Current live and collected views remain distinct: a preserved faculty initial does not replace
  a published TBA in live planning.

## Repository collection

`tools/collect-semesters.py` writes `data/semesters/`; visitors' browsers only read these files.

- Retain the **latest eight semesters total**, including the current collected semester.
  Collecting a ninth removes the oldest semester file and its index entry. Git history is not rewritten.
- Keep the last known non-TBA faculty/lab initials and observed reassignment history.
- Refresh capacity and enrolled seats on each successful collection. Remaining seats are
  `max(0, capacity - enrolled)`; unknown counts stay unknown.
- Retain disappeared sections within the eight-semester window, with their last observation dates.
  Saved and live totals can therefore differ. The panel's tracked count covers known seat counts,
  not necessarily every section in the collection.
- Invalid or failed collection attempts leave the existing data unchanged.

The workflow is configured for **every six hours** (`17 */6 * * *`) and manual dispatch.
**It is not activated merely by these local files.** Its explicit target is currently
`arena/01a10a61-prohor`; publication, GitHub permissions and deployment must be reviewed before use.
See [collection format, provenance and activation instructions](data/semesters/README.md).

The current seed comes from the **September 26, 2026** snapshot: Fall 2026 (`20263`), 2,092 sections.
It is not a successful recent live capture. Collection cannot reconstruct observations it never received.

## Loading, polling and offline behavior

| Operation | Policy |
|---|---|
| Catalogue | Ten-minute cache age with background revalidation; checks also occur on return to a stale tab |
| Slow initial feed | Try bundled snapshot after 1.4 seconds; a delayed snapshot cannot overwrite a live result |
| Network JSON deadline | 15 seconds, including response body; native-fetch fallback supports older cached core scripts |
| IndexedDB open/read | 1.5-second deadline before fallback, so a stalled cache does not block loading |
| Seats | 30-second polling, requested 60 seconds in a hidden tab; failure backoff up to eight minutes |
| Seat worker | 20-second watchdog; cancelled/obsolete replies are ignored |
| Repository collection | Six-hour GitHub schedule, once activated; independent of browser polling |

Pause stops automatic seat checks; Refresh performs a manual check. Catalogue revalidation is
independent. Seat polling updates displayed counts, not already-generated routines or catalogue
candidates: seat-based generation may use older data than the panel's latest poll.

The badge distinguishes live, cached, stale and bundled data. The snapshot displays its source
date. There is **no service worker**: offline planning requires app files to remain available, and
a cold offline reload is not guaranteed. Browser storage can be denied, evicted or cleared.

## Project layout

| Path | Purpose |
|---|---|
| `index.html` | UI, styles, state, persistence and network coordination |
| `core.js` | Shared feed normalization, filtering, enumeration, view model and PNG rendering |
| `worker.js` | Search and seat-polling protocols, using separate worker instances |
| `snapshot.json` | Dated offline feed |
| `faculty-names.json` | Optional initials-to-name lookup |
| `data/semesters/` | Repository collection and format/activation documentation |
| `.github/workflows/collect-semesters.yml` | Scheduled/manual collection and JSON commits |
| `tools/collect-semesters.py` | Validate, merge and retain semester observations |
| `tools/build-snapshot.py` | Convert raw Connect data into the compact snapshot |
| `test.js`, `tools/*test*.js`, `tools/*audit*.js`, `tools/sweep.js` | Functional, browser and rendering checks |
| `docs/TESTING.md` | Test scope, regression coverage and release checks |

The engine searches courses in fewest-candidates-first order and precomputes incompatibilities.
Workers return deterministic compact descriptors; the page materializes routines from the same
candidate order. `buildView()` supplies the HTML and PNG representations.

## Tests

Use Node.js supported by the locked dependencies (Node 22.22+ works), Python 3, and Chromium:

```sh
npm ci
npx playwright install --with-deps chromium
# Keep the local HTTP server running in another terminal.
npm run test:acceptance
npm audit
```

`URL` overrides the browser-test target (default `http://localhost:8000/index.html`).
`CHROMIUM_PATH` selects an existing compatible browser. A missing browser is not a passing test.

| Command | Coverage |
|---|---|
| `npm test` | Core, network deadlines, worker, picker, PNG and jsdom integration |
| `npm run test:collector` | Repository persistence, seats/faculty updates, validation and eight-semester eviction |
| `npm run test:layout` | Chromium layouts, preferences, search recovery and mixed-version fetching |
| `npm run test:exports` | Native clipboard/PNG/PDF and export failures |
| `npm run test:boundaries` | Pin cap, repository ownership and unavailable storage/archive |
| `npm run test:extremes` | Stalled storage, quota errors, malformed links, throttled search and narrow layouts |
| `npm run test:ux` | Dialog naming, reset messaging, keyboard focus and warning fit |
| `npm run test:archive-fold` | Collapsed saved-course defaults, toggling, filtering and semester isolation |
| `npm run test:sweep` | Seeded interaction sequence |
| `npm run test:acceptance` | All of the above |

Engine/UI harnesses may use a local raw `connect.json`; otherwise they use the snapshot.
`SNAPSHOT_ONLY=1` pins the jsdom suite to the snapshot. Fixture tests do not establish live-feed
availability, successful GitHub automation or registration accuracy.

See [testing and release checks](docs/TESTING.md) for coverage and remaining
browser, device, accessibility and deployment limitations.

## Refresh the offline snapshot

```sh
curl --fail --location -o connect.json https://usis-cdn.eniamza.com/connect.json
python3 tools/build-snapshot.py --in connect.json --out snapshot.json
npm test
```

The builder expects raw Connect API data, not a compact snapshot. Review the metadata and diff;
keep raw downloads out of Git. Snapshot refresh and repository collection are separate operations.

## Deployment and maintenance

Serve the repository root as a static site (for example, GitHub Pages or Vercel without a build
command). Include `index.html`, `core.js`, `worker.js`, `snapshot.json`, `faculty-names.json`,
**`data/semesters/*.json`**, the manifest and icons. Test dependencies are not production assets.
Relative paths support subdirectory hosting.

- Deploy HTML/core/worker together. Update their versioned script URLs together when changing APIs.
- Preserve candidate ordering and worker descriptor contracts. Bump the saved scoring version
  when ranking semantics change.
- Preference changes need defaults, persistence, share-link, reset and stale-result coverage.
- Retain comments explaining invariants and failure handling, not a running change history.
- Verify collection commits actually trigger your host's deployment; `GITHUB_TOKEN` commits may
  not trigger downstream GitHub workflows. Activation details are in the collection documentation.

[Feedback](mailto:nishadislamutso@gmail.com?subject=Prohor%20routine%20planner%20feedback)
· [Source](https://github.com/NishadIslamUtso/prohor)
