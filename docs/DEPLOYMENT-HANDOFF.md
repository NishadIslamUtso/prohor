# Combined SEO and collection-workflow handoff

This patch replaces every earlier SEO/collector patch, including the first combined patch. Apply only this version. It includes SEO metadata,
a separate About page linked from the existing footer, robots.txt, sitemap.xml, SEO test wiring, a default-branch
checkout/push fix, collector regression assertions, and updated documentation.

## Safe application

1. Inspect the current branch and local changes; preserve the user's work and Google verification
   file/tag/DNS record. Do not replace the repository with the old session checkout.
2. Confirm the primary production URL. SEO URLs assume https://prohor-rg.vercel.app/.
   If different, update canonical/Open Graph URLs, robots sitemap URL, sitemap location and the
   expectations in tools/seo-test.js together before publishing.
3. Run `git apply --check /path/to/prohor-combined-v2.patch` from the repo root.
   If it fails, stop and inspect which changes already exist or conflict. Do not use force,
   reset, blind overwrites or rejected hunks. If an earlier patch is already applied, reconcile
   the remaining changes manually; do not apply duplicate canonical tags or npm scripts.
4. After a clean check, apply the patch and inspect `git diff` and `git diff --check`.
5. Run `npm ci`, `npm run test:seo`, `npm run test:collector`, and the full `npm run test:acceptance`
   with a local HTTP server and Chromium. Check mobile/desktop appearance and preserve verification.
6. Publish through the new coding session's normal PR process. Do not deploy failing changes.

## Collection: verify, do not assume

- Expand the failed checkout step to confirm its precise error. The previous workflow referenced
  a temporary branch for checkout and push; this patch uses the default branch for both.
- Keep Actions enabled and allow the job's `contents: write` permission. Review branch protection;
  do not disable protection blindly. If bot pushes are forbidden, use a reviewed PR-based publishing
  arrangement rather than bypassing repository policy.
- After merging, start a NEW manual Run workflow from the updated default branch. An old failed
  run can use the old workflow revision. Confirm checkout, tests, fetch and collection commit all pass.
- Verify added/updated/deleted collection JSON reaches the hosting deployment. GITHUB_TOKEN commits
  may not trigger push-based downstream Actions. Confirm the host behavior or configure deployment
  explicitly; this patch does not guess provider credentials or change hosting settings.
- Keep the six-hour cron, latest-eight retention, preserved non-TBA faculty and refreshed saved seats.
  These rules are unchanged. Failures before the collector step do not update or delete saved data.
- A later CDN or permissions error is a separate issue; a checkout fix alone cannot prove end-to-end success.

## Google Search after deployment

1. Preserve the existing Search Console verification; do not ask the user for account credentials.
2. Check that the production homepage, /robots.txt and /sitemap.xml return HTTP 200 without login.
   Confirm the production host does not inject X-Robots-Tag: noindex or block Googlebot.
3. In the verified property, submit https://prohor-rg.vercel.app/sitemap.xml (or the confirmed domain).
4. Inspect the homepage, Test live URL and Request indexing if eligible. Monitor indexing status.
   The patch does not submit to Search Console, verify ownership or guarantee indexing/ranking.

## Dependency advisory found while packaging

A fresh `npm audit` reports a high-severity advisory for transitive `source-map-js` below 1.2.2
(GHSA-68fv-2mgg-jv7q). Recheck the advisory in the new session, review a targeted lockfile update,
and rerun tests. This handoff deliberately does not bundle an untested dependency upgrade.
The static production app does not load node_modules, but its test-tool dependencies still need maintenance.

## Patch verification and scope

Packaging was tested in an isolated reconstructed pre-SEO copy: check/apply/reverse-check,
file equality, UI-warning removal without changes to core/worker logic, SEO static checks and collector tests.
This is not proof it applies unchanged to the user's latest main branch. Recheck there.
No GitHub operation, deployment or actual workflow run was performed while packaging.
No core.js, worker.js, semester data, collector logic or dependency-lock changes are included.

## Layout requirement

Keep all SEO explanatory text off the planner. Use the separate `about.html` and the existing footer link; do not re-add the previous `.planner-intro` block or hidden keyword paragraphs. Remove the calendar-warning banner, its CSS and its rendering helper only. Preserve class/lab/exam checks and every other planner control. Verify mobile and desktop layouts before deployment.

Latest validation: the full acceptance suite passed after removing the calendar banner and
moving explanatory content to About. Initial planner/control geometry matched the pre-SEO
layout at 360px and 1440px. No runtime core/worker logic or collected-data files are in the patch.
