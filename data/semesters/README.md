# Repository-owned semester collection

This folder is the source of truth for collected faculty initials, sections and seat observations.
Browsers read it; they do not own or maintain the collection.

## Collection rules

- Key records by **semester → course code + section number** to isolate semesters.
- Keep the **latest eight semesters total**, including the current collected semester. A ninth
  evicts the oldest semester file and manifest entry. Order by semester ID, not fetch time.
  Eviction does not rewrite Git history.
- Preserve known faculty and lab initials when a later response says TBA or leaves them empty.
  A real replacement updates the last-known value and appends observed reassignment history.
- Refresh capacity and enrolled seats for each section received. The website calculates free
  seats as `max(0, capacity - enrolled)`; missing counts remain unknown.
- Retain sections absent from later responses within the eight-semester window, with their
  last observation dates. Their counts are not newly confirmed or necessarily current.
- Reject failed, empty, suspiciously small, ambiguous-semester or duplicate-key inputs before
  changing files. Old observations cannot overwrite newer ones.

Collection records are observations, not verified teaching history. Values published between
successful polls can be missed; names never observed cannot be reconstructed.

## File format

- `index.json`: schema version and retained semester IDs.
- `<semester>.json`: semester metadata, course names, section rows and observations.

Each `rows["COURSE|SECTION"]` uses the website's compact catalogue format:

```text
[lastKnownFaculty, room, labRoom, labCourse, capacity, usedSeats, flatMeetings, flatExams]
```

`observations` stores first/last observation dates, latest published faculty values, last-known
lab faculty and faculty-change history. A semester's update date does not imply every retained
section was seen in that update.

## Run the collector

```sh
python3 tools/collect-semesters.py
python3 tools/test-collect-semesters.py
```

The collector uses Python's standard library and a 30-second network timeout. It validates and
merges before writing, replaces individual JSON files atomically, then removes evicted files.
Git publishes additions, updates and deletions together in one commit. A failed push should be
retried against the latest branch state, not force-pushed.

### Seed provenance

The initial `20263.json` came from `snapshot.json`: **2026-09-26T06:17:53Z**, 2,092 sections.
It is a dated import, not a recent successful live collection. To reproduce that import:

```sh
python3 tools/collect-semesters.py --in snapshot.json --observed-at 2026-09-26T06:17:53Z
```

## Schedule and activation

`.github/workflows/collect-semesters.yml` supports manual dispatch and runs every six hours:
`17 */6 * * *` — 00:17, 06:17, 12:17 and 18:17 UTC. In Dhaka (UTC+6), the daily clock times are
also 00:17, 06:17, 12:17 and 18:17. GitHub scheduling, execution and deployment can add delay.
This schedule is independent of browser seat polling and does not require visitors.

The workflow checks out and pushes to the repository's default branch, named by the
`COLLECTION_BRANCH` environment variable (`github.event.repository.default_branch`, falling back to
`github.ref_name` for scheduled runs). It must not depend on a temporary PR branch.
The reported scheduled runs failed at checkout, before collection; the detailed checkout log
is still needed to confirm the precise failure. A successful run and deployment must be verified.

1. Confirm the deployed site reads the default branch's collection.
2. Publish the updated workflow on the default branch. Start a **new Run workflow** from that
   branch after merging, rather than rerunning an old failure tied to the previous workflow.
3. Enable Actions and permit `contents: write`. Branch protection may require PR-based publishing.
4. Verify a successful fetch, collection commit and host deployment. `GITHUB_TOKEN` commits may
   not trigger downstream GitHub workflows that depend on `push` events.
5. Monitor failed runs and observation dates. GitHub can delay or disable schedules; this project
   has no separate external uptime monitor.

Only collection JSON files, including evictions, are staged by the workflow. No per-user backend
or additional credentials are required.

## Website behavior

Deploy the manifest and semester JSON files alongside the static site. The browser reads them
without writing `prohor.facmem` or `prohor.semesters`. Resetting device preferences cannot erase
repository history; ordinary current-feed caches, pins and preferences remain local.

Only **All courses** follows the semester selector. Saved course headings start collapsed,
including filtered results. The current semester has separate live and collected views:
preserved initials do not falsely replace TBA in live planning. Historical seats are observations,
not a promise of current registration availability.
