# Prohor demo — mock CDN

A sandbox-safe copy of the app fed by a **mock Connect-CDN**, for watching how Prohor
handles live change without touching the real feed.

## Run

```
node demo/server.js          # serves the whole repo
```

- `/` — the real app, unmodified (still polls the live CDN).
- `/demo` — the same app fed by the mock: seats drift and faculty names change on
  **every poll** (~30 s while the seats panel is open, ~60 s in a background tab).
- `/mock/connect.json?sem=autumn26|spring27` — the mock feed itself (JSON, mutated per request).

## What the mock exercises

- **Seat movement** — ~35 sections per poll gain/lose seats, so the seats rail flashes,
  the `full`/`low` pills move, and (with "Prefer sections with free seats" on) re-generating
  re-ranks routines away from sections that just filled up.
- **Faculty changes** — a `TBA` section now and then gets named (pre-advising progress),
  and every few polls a named faculty swaps. The faculty-memory (`prohor.facmem`) and
  picker flows are exercised honestly.
- **Two semesters** — *Autumn 2026* (in progress, session `20263`) and *Spring 2027*
  (pre-advising preview, session `20271`: dates shifted, ~9 % of sections not yet published,
  a few brand-new sections, most seats free). Switching between them in the floating MOCK
  panel makes the app **file the current semester away as a saved semester**, which you can
  then browse from the semester selector in the seats panel.

The demo shim only overrides `RGCore.DATA_URL` and tags seat-worker messages with the mock
URL; no application file is modified. The `demo.sem` key deliberately does not start with
`prohor`, so the wordmark reset does not eat the demo controls.
