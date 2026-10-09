# Testing and release checks

## Run the maintained suite

Install dependencies with `npm ci`, install Chromium with
`npx playwright install --with-deps chromium`, and start a local static server:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
# In another terminal:
npm run test:acceptance
npm audit
```

Browser suites accept `URL` (default `http://localhost:8000/index.html`) and
`CHROMIUM_PATH` for an existing compatible browser. Python 3 is required for collector tests.
A browser launch failure or unavailable dependency is not a passing test.

## Coverage

| Area | Checks |
|---|---|
| Search discovery | Static metadata and separate About page, canonical query variants, crawl rules and homepage/About sitemap (`npm run test:seo`) |
| Catalogue | Live/cache/snapshot paths, timeouts, malformed data, late responses, mixed core/worker versions |
| Selection/preferences | Search, six-course cap, constrained pickers, maximum days, exclusions, ranking presets, seat modes, exams, migration/reset |
| Generation/results | Conflict engine, worker fallback, deterministic replay, sorting, saved pagination, duplicate/loss prevention |
| Sharing/export | Preference round trips, malformed/large links, native clipboard/PNG/PDF, clipboard/canvas failures |
| Persistence | Invalid saved state, denied/quota-limited storage, stalled IndexedDB, reset during search |
| Seats | Polling/retry/pause, cancellation, updates without replacing rows, pins, split/standalone views |
| Repository collection | Durable files, non-TBA preservation, faculty history, refreshed seats, missing sections, semester isolation, chronological eight-semester eviction, deletion staging, invalid/failed response protection |
| Archive browsing | Read-only repository data, collapsed defaults, mouse/keyboard toggling, filtering, semester isolation, unavailable archive recovery |
| UI | Responsive geometry, unobstructed controls, dialog names, focus restoration, truthful reset/error messages, long warning wrapping, footer About link navigation (mouse, keyboard, phone tap, not covered by the action bar) |
| Stress probes | Six-course main-thread search at 4× CPU throttling, narrow/short viewports, one seeded interaction sweep |

The aggregate command runs the functional, collector, Chromium layout/recovery, export,
boundary, extreme-case, UI, archive-fold and interaction suites. Individual commands are
listed in the root README and `package.json`.

Previously reproduced regressions remain covered by reusable tests. Temporary session logs,
historical comparison harnesses and duplicated audit reports are not maintained project files.
Record the command, commit, environment and result when running these checks for a release.

## Interpretation and release gates

- Fixture tests prove behavior under their inputs, not current CDN availability or registration accuracy.
- Chromium/Linux is the tested browser environment. Firefox, Safari/iOS, real Android devices,
  private modes, genuine low-memory/full-disk conditions and mobile connectivity still need testing.
- Injected quota failures and CPU/CSS zoom emulation are not real hardware or browser-toolbar zoom.
- Screen readers, complete contrast/touch-target review, virtual-keyboard overlap, physical printing,
  visual PDF approval, QR scanning, installation and cold offline launch remain manual checks.
- Passing finite scenarios does not establish that the app is bug-free or handles every search space.
- The bundled feed and initial collection are dated September 26, 2026. Live requests from the
  development sandbox have failed at TLS; successful offline fallback is not proof of live freshness.
- Repository automation must be published and permitted. The workflow targets the repository's
  default branch; review write permissions, branch protection and host deployment behavior.
  Verify a real fetch → collection commit (including evictions) → deployed update. Do not infer
  successful automation from the Python tests or the presence of a workflow file.
- Confirm final section details, faculty, exams and seats in BRACU Connect.

See [collection activation and provenance](../data/semesters/README.md) for operational details.
