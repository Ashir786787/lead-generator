# Testing report

**Date:** 2026-11-05
**Build tested:** `lead-finder@1.0.0`, Next.js 16.4.4 (Turbopack production build)
**Environment:** Windows, Node.js v25.1.0, pnpm 10.20.0, Chromium (Playwright),
PostgreSQL through `embedded-postgres` on `127.0.0.1:5433`

This report covers a full-app audit: the release gate, the HTTP API, the browser flows,
the background worker, live public data sources and the scanner against real websites.
Bugs found during the audit were fixed before the final gate. Every result below was
observed on the final build.

## How it was tested

1. **Automated gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
2. **HTTP acceptance harness:** a temporary Node script signed in against the running
   production server and exercised 28 real API flows (auth, leads, contacts, saved views,
   manual creation, bulk actions, scans, imports, duplicates, discovery, assistant,
   scoring, export, SSE). The script was removed after the run; its results are recorded
   below.
3. **Browser suite:** `pnpm exec playwright test` against `http://localhost:3000` with the
   combined web + worker stack.
4. **Live source checks:** Nominatim geocoding/POI discovery, the Groq assistant, and
   `fetchPage` against `example.com`, `www.iana.org` and `www.wikipedia.org`.
5. **Visual evidence:** `pnpm screenshots` captured 60 PNGs at 1440/1024/390 in light and
   dark themes.

The demo workspace was recreated with `pnpm seed:demo` before the final acceptance run and
again before screenshots. All demo records remain fictional; no real business was
invented or added by the tests.

## Final results

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm typecheck` | **Pass** | no output |
| `pnpm lint` | **Pass** | 0 errors; 1 known non-blocking TanStack Table React Compiler warning |
| `pnpm test` | **Pass** | 11 files, 150 tests |
| `pnpm build` | **Pass** | production build completed; one pre-existing Turbopack tracing warning in `src/lib/storage/index.ts` |
| `pnpm exec playwright test` | **Pass** | 18 tests (1 setup + 17 Chromium) |
| HTTP acceptance | **Pass** | 28/28 checks |
| Screenshots | **Pass** | 60 PNGs at 1440/1024/390, light/dark |
| Live scan smoke test | **Pass** | `example.com`, `iana.org`, `wikipedia.org` returned HTTP 200 / `success` |
| Live discovery | **Pass** | Nominatim returned 10 Lisbon dentist records |
| Live assistant | **Pass** | Groq returned advice in ~0.3–0.7 s across runs |

## Acceptance matrix (HTTP, production build)

| # | Area | Check | Result |
| --- | --- | --- | --- |
| 1 | Auth | Sign in as the seeded demo user | Pass |
| 2 | Setup | `/api/setup/status` reports an existing workspace | Pass |
| 3 | Auth | Unauthenticated `/api/leads` is rejected with 401 | Pass |
| 4 | Leads | List returns seeded records and a total | Pass — 7 visible / 7 |
| 5 | Leads | Free-text search filters correctly | Pass — 2 matches for “Marina” |
| 6 | Leads | Pipeline status filter narrows correctly | Pass — 1 won lead |
| 7 | Leads | Facets and workspace overview load | Pass — total 8 |
| 8 | Leads | Detail returns contacts, score and latest scan | Pass — 5 contacts |
| 9 | Leads | Status change persists and reverts | Pass |
| 10 | Leads | Tags and notes round-trip | Pass |
| 11 | Contacts | Verification can be toggled | Pass — `verifiedByUser` true, then reset |
| 12 | Saved views | Create, list and delete | Pass |
| 13 | Leads | Manual creation + live scan + bulk archive | Pass — scan `success`, `affected: 1` |
| 14 | SSRF | Loopback target is rejected | Pass — `rejected_url` |
| 15 | Scans | Cancel a queued scan | Pass — `cancelled` |
| 16 | Imports | Preview maps columns without committing | Pass — 8 columns, 2 rows |
| 17 | Imports | Start, process, row error, complete | Pass — 2 processed, 1 new, 1 row error |
| 18 | Imports | Cancelling a finished import is refused honestly | Pass — 409 |
| 19 | Duplicates | Merge, undo, and pair returns to review | Pass |
| 20 | Discovery | Providers report real availability | Pass — OSM available, Google Places unavailable |
| 21 | Discovery | Geocode “Lisbon” | Pass — Lisbon, Portugal |
| 22 | Discovery | Live OSM discovery | Pass — 10 real records via Nominatim |
| 23 | Assistant | General question returns advice | Pass — Groq, 330 chars |
| 24 | Assistant | Request without a city returns guidance | Pass — asks for the city, no 400 |
| 25 | Scoring | Active profile loads and previews | Pass — profile 1 |
| 26 | Scoring | Recalculation job accepted by worker | Pass — 202 queued |
| 27 | Export | CSV download with real rows | Pass — 18 rows |
| 28 | Events | Scoped SSE stream opens | Pass — `connected` event |

## Bugs found and fixed

### 1. Scans stayed `queued` forever when only the web app was running (high)

**Reproduction:** start `pnpm start`/`next start` without `pnpm worker`, create a scan, and
watch `/api/scans`. The job remained `queued` because no pg-boss worker consumed
`scan.business`.

**Impact:** the reported “Website Scans is broken” symptom. Imports and score
recalculation had the same dependency.

**Fix:**

- `pnpm dev` and `pnpm start` now launch web + worker together through `scripts/stack.ts`.
  Standalone `dev:web`, `start:web`, `worker` and `worker:once` remain available.
- Worker health is read from pg-boss heartbeats (`src/lib/jobs/health.ts`). Missing schema
  or database errors are treated as offline, not as page failures.
- `/api/scans`, single-lead scans and bulk scans return `workerOnline`.
- The app shell, Scans page and lead workspace show an honest “Automation worker offline”
  banner with the start command. Queued jobs are preserved and resume when the worker
  connects.
- Tests: `tests/worker-health.test.ts` (5 tests) plus a Playwright check that the banner
  is absent while the stack runs.

### 2. Real websites returned HTTP 400/403 because the scanner replaced the hostname (high)

**Reproduction:** with the worker running, scanning `https://example.com`, `iana.org` or
`wikipedia.org` returned `unreachable` with HTTP 400/403.

**Cause:** SSRF protection resolved the hostname, then rewrote the request URL to the IP
and set a `Host` header manually. undici treats `Host` as a forbidden header and drops it,
so the server saw the IP as the hostname and rejected the virtual host.

**Fix:** requests now keep the original hostname (correct `Host` and TLS SNI) while
`connect.lookup` pins the socket to the already-validated IP. Every redirect hop is
re-resolved and re-validated, and cross-domain redirects are refused. A regression test
(`tests/fetch.test.ts`) asserts the fixture server receives the original hostname.

**Verified live:** `example.com`, `www.iana.org` and `www.wikipedia.org` returned HTTP 200
with `success`; the acceptance scan completed `success` with 1–4 pages checked.

### 3. Undo restored the business but not the duplicate review pair (medium)

**Reproduction:** merge a pending duplicate pair, then undo the merge. The business
returned, but the pair no longer appeared in the review queue.

**Fix:** the merge snapshot now records the candidate ids the merge resolved. Undo sets
them back to `pending` and clears `resolvedAt`/`resolvedBy`. Snapshots created before this
change still restore business data safely. The acceptance run now merges and undoes a
seeded pair and asserts the pair reappears.

### Harness assumptions corrected (not app bugs)

The first acceptance run reported three failures that turned out to be wrong expectations
in the test script:

- Contact verification returns `verifiedByUser` (and the UI labels it “Verified by you”),
  not `verified`.
- Bulk archive returns `affected`, not `archived`.
- Duplicate undo did not reopen the pair — this one was a genuine gap and is fixed above.

## Behaviour verified around honest labels

- Incomplete scans render as `Scan incomplete` / `Needs manual review`; detection results
  use `Detected`, `Not detected in checked pages` or `Unknown`.
- Failed sources return an honest error; no placeholder businesses are produced.
- `google_places` reports unavailable without a key instead of failing the page.
- A request without a city returns chat guidance, not an HTTP 400 or invented filters.
- Demo data stays inside the fictional `Demo (fictional)` workspace.

## Security and tenancy checks

- Anonymous API access returns 401.
- Loopback scan targets are rejected as `rejected_url`.
- The scanner re-validates DNS on every redirect hop and blocks cross-domain redirects.
- robots.txt rules are obeyed; disallowed pages are reported as incomplete.
- `tests/isolation.test.ts` and `tests/security.test.ts` pass as part of the 150-test
  suite, covering workspace isolation and request hardening.
- No email/SMS/WhatsApp sending code exists; contact buttons only open the user’s own
  client.

## Residual limitations and risks

1. **Worker heartbeat delay.** pg-boss writes a heartbeat roughly every 30 seconds, so the
   offline banner can appear briefly after a restart even though the worker is starting.
   The Playwright test polls the API before asserting.
2. **No headless browser.** Client-side-injected widgets/buttons may be missed and are
   reported as not detected or unknown.
3. **Bounded crawling and bot protection.** `SCAN_MAX_PAGES=4` by default; WAFs,
   CAPTCHAs, consent walls and login pages can stop a scan. The app does not bypass them.
4. **Demo websites are fictional.** Seeded `.example` domains cannot be scanned for real;
   use a real URL or a manual lead to exercise successful live scans. `pnpm seed:demo`
   restores the fictional values.
5. **Missing optional keys.** No xAI Grok or Google Places key is configured, so those
   providers report unavailable; OSM and Groq are live.
6. **Lint warning.** The TanStack Table React Compiler warning is known and
   non-blocking; the component still behaves correctly in browser tests.
7. **Secrets.** API keys were pasted into chat during setup and should be rotated.

## Evidence

- Unit/integration: `pnpm test` → 11 files, 150 tests passing.
- Browser: `pnpm exec playwright test` → 18 passing.
- Gate: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass.
- Screenshots: `docs/screenshots/` (60 PNGs).
- Live scan and discovery results are reproduced in the matrix above.
