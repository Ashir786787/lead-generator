# Progress

This document records how the project was built, the gate results at each phase, the
acceptance evidence, and the issues found and fixed along the way.

## Phase gates

The release gate is:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Final result on 2026-11-05:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Pass (no output) |
| `pnpm lint` | Pass, 0 errors. One non-blocking React Compiler warning for TanStack Table's `useReactTable` |
| `pnpm test` | Pass — 11 files, 150 tests |
| `pnpm build` | Pass — production build (one pre-existing Turbopack tracing warning) |
| `pnpm exec playwright test` | Pass — 18 tests (1 setup + 17 Chromium) |
| HTTP acceptance | Pass — 28/28 checks against the production build (see `docs/TESTING_REPORT.md`) |
| Worker + live scans | Pass — combined `pnpm start` launched web + worker; `example.com`, `iana.org` and `wikipedia.org` scanned with HTTP 200 / `success` |
| Screenshots | 60 PNGs at 1440/1024/390, light/dark |
| Live discovery | Nominatim POI index returned real records in 1.5–3.8 s for Lisbon dentists (30), Berlin cafes (20), Karachi restaurants (25) and Madrid law firms (19); honest combined error covered by tests |
| Live map | Nominatim geocode returned Lisbon bounds; Leaflet loaded OSM tiles with no console errors |
| AI assistant | Live Groq (`qwen/qwen3.8-27b`) returned validated filters for “cafes in Berlin” in 376 ms, advice for a general lead question in 686 ms, a clarification for “dentists in a city near me” in 411 ms, and a context-aware follow-up: “I sell web design services…” then “Berlin” produced a Berlin plan for restaurants, salons, gyms and clinics. Advice, missing-city guidance, category guidance and history forwarding are covered by tests |

## Phases

| Phase | Scope | Gate |
| --- | --- | --- |
| 0 | Scaffold: Next.js 16, TypeScript strict, Tailwind 4, lint/format, pnpm, env contract, Docker compose, local Postgres fallback | typecheck/lint pass |
| 1 | Database: 27 tables, workspace invariants, enums, indexes, constraints, generated migration, migration runner | typecheck; migration applies to a clean database |
| 2 | Auth and tenancy: Better Auth email+password, first-run setup, workspace membership, scoped `getWorkspaceContext`, page guards | typecheck; sign-in/sign-up flow verified |
| 3 | Normalisation and data layer: names, phones, emails, websites, categories, scores, filters, facets, mutations, saved views | typecheck; unit tests pass |
| 4 | Dedupe: deterministic decisions, review queue, merge/undo with note/tag/activity preservation | typecheck; dedupe tests pass |
| 5 | Imports: CSV/TSV/GeoJSON/ZIP parsing, safety limits, preview, mapping, background ingestion, row errors, cancellation | typecheck; import tests pass |
| 6 | Scanner: SSRF/DNS pinning, redirects, robots, timeouts, extraction, signatures, cache, queue/worker | typecheck; security/extract/fetch tests pass |
| 7 | Scoring: 100-point config, validation, engine withholding rules, versioned profiles, preview, recalculation job | typecheck; score tests pass |
| 8 | Discovery, export, events, settings, worker: OSM provider, Google availability state, CSV export, SSE, scan/import/score jobs | typecheck; production acceptance run |
| 9 | UI: app shell, dashboard, leads, lead detail, duplicates, imports, discovery, scans, settings, scoring, login/setup | typecheck/lint; responsive review; screenshots |
| 10 | Tests, acceptance, docs, demo seed, screenshots, git history | full gate + Playwright + acceptance |
| 11 | Discovery resilience and AI/map: Overpass retries/fallback/cache, Gemini, xAI Grok and Groq filter planners, Nominatim geocoding, Leaflet result map | full gate + live planner/geocode/map checks + honest upstream-failure check |
| 12 | Reliable free discovery and chat assistant: Nominatim POI tag search first, Overpass backup, city-only searches, chat-style plan replies, early stop on invalid plans | full gate + live API planner/discovery checks |
| 13 | Conversational assistant: search vs advice intents, guidance for general lead questions, recent-turn context for follow-ups, chat clarification instead of a missing-city error, no provider retry for advice | full gate + live advice/clarification/search/follow-up checks + Playwright advice bubble |

## Acceptance run

Executed against the production build (`pnpm build && pnpm start`) with the worker
running and a freshly seeded demo workspace. Results from the API-level acceptance run:

| Check | Observed |
| --- | --- |
| Demo sign-in | 200, session established |
| Seeded leads | 8 fictional businesses |
| Import preview | CSV headers mapped to name/category/website/phone/email/street/city/country |
| Import start | Queued, 202 |
| Import completion | Status `completed`, rows 1, new 1, duplicates 0, review 0 |
| Imported lead query | `Acceptance Bakery` returned in Dubai |
| Contact points | `email, phone` present on the imported lead |
| Duplicate queue | 1 pending pair from the seed |
| Scans | 6 listed, outcomes `success` and `partial` |
| Scoring profile | Active profile maximum exactly 100 |
| Discovery providers | `osm:available`, `google_places:unavailable` (no key configured) |
| AI planners | Live with configured keys: Gemini (`gemini-3.1-flash-lite`) and Groq (`qwen/qwen3.8-27b`) returned validated filters or guidance; xAI Grok remains unconfigured; the no-key 409 path stays covered by tests |
| Assistant advice | “what kind of leads are helpfull to find buisness” returned guidance naming example categories, not businesses; “dentists in a city near me” asked for the city instead of failing |
| Geocoding | `GET /api/discovery/geocode?q=Lisbon, Portugal` returned 200 with bounds and two matches |
| Map | Leaflet container loaded 8 OSM tiles; no browser console errors |
| Overpass failure path | Public server returned 502 "at capacity"; the app reported attempts, mirror hint and no saved rows |
| CSV export | 200, 11 lines, includes the imported lead; recorded in `export_jobs` |
| Workspaces | 1 workspace, active workspace id returned |

The imported acceptance row was removed by re-running `pnpm seed:demo`, leaving the
demo workspace deterministic. No acceptance data was written to a real workspace.

## Test counts

| Suite | Files | Tests | Notes |
| --- | --- | --- | --- |
| Vitest | 10 | 144 | Unit + integration against real PostgreSQL for isolation |
| Playwright | 9 specs | 17 | 1 auth setup, 16 browser tests |

Vitest files:

- `tests/normalize.test.ts` — name/phone/email/website/category normalisation
- `tests/dedupe.test.ts` — merge/review/none policy and thresholds
- `tests/score.test.ts` — 100-point config, withholding, unknown categories, reasons
- `tests/extract.test.ts` — contact/chatbot/WhatsApp/form extraction
- `tests/security.test.ts` — SSRF classification, redirects, unsafe URLs
- `tests/fetch.test.ts` — robots, timeouts, pinned DNS, fixture server behaviour
- `tests/import.test.ts` — CSV/TSV/GeoJSON/ZIP parsing and archive safety
- `tests/discovery.test.ts` — Overpass retry, remark errors, cache and honest failure
- `tests/planner.test.ts` — category aliases, plan validation, Gemini and Groq request
  shapes, auto-mode fallback, unconfigured-planner behaviour, Nominatim parsing
- `tests/isolation.test.ts` — workspace isolation, dedupe-by-host, scan-outcome filter,
  merge/undo preservation

Playwright coverage: auth gating, wrong password, dashboard, discovery availability, the
AI planner's honest unavailable state, duplicates, imports + preview, leads list/filter,
lead detail, scans, settings, responsive layout.

## Screenshots

The `pnpm screenshots` script signs in as the demo owner, captures each screen at
1440×900, 1024×768 and 390×844, in light and dark mode, then captures the sign-in page
without a session.

Screens: `dashboard`, `leads`, `lead-detail`, `duplicates`, `imports`, `discovery`,
`scans`, `settings`, `scoring`, `login`.

60 files follow the pattern `<screen>-<viewport>-<theme>.png` in
[`docs/screenshots/`](screenshots). Examples:

| Screen | 1440 light | 1024 dark | 390 light |
| --- | --- | --- | --- |
| Dashboard | [link](screenshots/dashboard-1440-light.png) | [link](screenshots/dashboard-1024-dark.png) | [link](screenshots/dashboard-390-light.png) |
| Leads | [link](screenshots/leads-1440-light.png) | [link](screenshots/leads-1024-dark.png) | [link](screenshots/leads-390-light.png) |
| Lead detail | [link](screenshots/lead-detail-1440-light.png) | [link](screenshots/lead-detail-1024-dark.png) | [link](screenshots/lead-detail-390-light.png) |
| Duplicates | [link](screenshots/duplicates-1440-light.png) | [link](screenshots/duplicates-1024-dark.png) | [link](screenshots/duplicates-390-light.png) |
| Imports | [link](screenshots/imports-1440-light.png) | [link](screenshots/imports-1024-dark.png) | [link](screenshots/imports-390-light.png) |
| Discovery | [link](screenshots/discovery-1440-light.png) | [link](screenshots/discovery-1024-dark.png) | [link](screenshots/discovery-390-light.png) |
| Scans | [link](screenshots/scans-1440-light.png) | [link](screenshots/scans-1024-dark.png) | [link](screenshots/scans-390-light.png) |
| Settings | [link](screenshots/settings-1440-light.png) | [link](screenshots/settings-1024-dark.png) | [link](screenshots/settings-390-light.png) |
| Scoring | [link](screenshots/scoring-1440-light.png) | [link](screenshots/scoring-1024-dark.png) | [link](screenshots/scoring-390-light.png) |
| Sign in | [link](screenshots/login-1440-light.png) | [link](screenshots/login-1024-dark.png) | [link](screenshots/login-390-light.png) |

All files were verified programmatically: every image's width matches its viewport and
every file is a non-trivial PNG. Screenshots are captured from the production build, not
the dev server, to avoid the development overlay.

## Issues found and fixed

### pg-boss 12 does not create queues on demand

Symptom: imports/scans failed with `Queue import.process does not exist`, and the worker
crashed on startup when registering handlers.

Fix: `src/lib/jobs/boss.ts` now starts pg-boss, calls `createQueue()` for every name in
`JOB_NAMES` (idempotent), and only then allows `send()`/`work()`. A rejected startup is
not cached, so a later request can retry.

### Drizzle array interpolation produced invalid SQL

Symptom: imports failed with `op ANY/ALL (array) requires array on right side` for
queries like `website_host = ANY(($3, $4))`.

Fix: replaced hand-written `sql\`... = ANY(${array})\`` with Drizzle's `inArray` /
`notInArray` in:

- duplicate host matching
- merge undo for notes, activities and business tags
- scan-outcome lead filtering

### Merge/undo lost linked records

Symptom: the merge moved notes/tags but undo could not reliably restore them; an early
test also merged across workspaces because it reused an unrelated fixture id.

Fix: undo now uses typed array predicates and restores the pre-merge note/tag/activity
sets. A dedicated isolation test creates a duplicate inside the same workspace, merges
it, undoes, and asserts the note and tag return to the original business.

### Duplicate host matching needed supporting evidence

The host-only branch could not merge records by domain alone (by design), which made the
first regression test fail. The test now supplies the same street and name, matching the
documented policy: a shared domain merges only with supporting name/location evidence.

### Discovery could have implied fake results

Resolved by design: OSM is a real provider; Google Places is explicitly unavailable
without a key. There is no placeholder/generated fallback.

### Public Overpass is unreliable and the first implementation hid it

Symptom: a live Lisbon search timed out at 30 seconds; the next attempt received
`HTTP 502` from `overpass-api.de` with "All query workers are busy". The old provider made
one request with a fixed timeout, had no retry, no fallback endpoint and no cache.

Fix: `src/lib/discovery/service.ts` now has a configurable endpoint list
(`OVERPASS_ENDPOINTS`), per-attempt timeout (`OVERPASS_TIMEOUT_MS`), bounded retries with
backoff and `Retry-After` support, fallback across mirrors, and an in-memory cache
honouring `OVERPASS_CACHE_MINUTES`. Error text includes the attempt count and the last
real reason. The timeout was raised to 55 seconds because the public service can queue a
valid query for 30–40 seconds. No regional mirror was hardcoded, because one tested
mirror answers but only contains Swiss data — using it would silently return incomplete
results.

### AI could have become a fake lead source

The planner is deliberately constrained: it receives only the user's description, must
return a JSON filter object or plain-text guidance, and the server validates it with Zod
before use. The schema has no business/contact fields. Unsupported categories and a
missing city produce a chat clarification instead of a search, and Google Places plans
fall back to OpenStreetMap when no key is configured. The models never generate rows in
the lead table.

### AI planner model names changed under us

The first live Gemini call failed with HTTP 404: `gemini-2.5-flash` is retired for new
keys and the API recommended `gemini-3.8-flash`. That newer model, plus `gemini-3.7-flash`,
`gemini-3.6-flash`, `gemini-3.5-flash` and `gemini-flash-latest`, were returning 503
"high demand" or taking over a minute during the check, so the default became
`gemini-3.1-flash-lite`, which returned valid JSON. Its latency still varied a lot across
calls (1.3–22.6 seconds), which is why `auto` prefers Groq. All model names stay
environment-configurable.

The supplied "Groq" key (`gsk_...`) is Groq Cloud, not xAI Grok (`xai-...`). Groq is now a
third first-class planner using its OpenAI-compatible endpoint. Its account did not expose
`llama-3.3-70b-versatile`; `qwen/qwen3.8-27b` answered in about 0.3 seconds, so that is the
default. In `auto` mode the app now tries Groq first for speed, then Gemini and Grok, and
falls back to the next configured planner when one fails and shows a fallback note in the
plan, rather than making the user retry manually.

### Map integration and CSP

Leaflet is imported only in the browser and uses vector circle markers, so no marker image
assets are needed. The CSP `img-src` was extended for `*.tile.openstreetmap.org`, and
`.leaflet-container` is isolated so tile panes cannot sit above app chrome. A live check
confirmed 8 tiles loaded with no console errors.

### Public Overpass made discovery feel broken

Live checks after the first resilience round still failed for users: overpass-api.de took
20–48 s, returned 502 "at capacity", or reported a runtime error as HTTP 400. A mirror
list was not a real fix because several public mirrors were dead, slower or regionally
incomplete. The user-visible result was a red error for a perfectly valid search.

Fix: OpenStreetMap discovery now reads the **Nominatim POI index first** with exact tag
queries such as `[amenity=dentist]` bounded to the geocoded city box. It is the same OSM
data, needs no key, and answered in 1.5–3.8 s for Lisbon, Berlin, Karachi and Madrid in
live checks (30/20/25/19 named records). Overpass remains a backup for categories the
index cannot find, and both sources share the existing `osm:<type>/<id>` ids so dedupe is
unchanged. Named businesses only: unnamed POIs are skipped rather than turned into junk
leads. The UI labels the real source honestly.

### The planner rejected valid city-only prompts

The parser required both `city` and `country`, so "cafes in Berlin" produced "The plan is
missing a location". Auto mode then retried every model, turning one user-input problem
into a slow multi-provider failure. Country is now optional with a visible note, a missing
city is still rejected, and a `400` from plan validation stops the auto chain immediately.
Gemini's timeout was raised to 40 s and output tokens capped at 400; Groq stayed at
0.24–0.46 s in live checks. The planner card is now a chat-style assistant with a message
thread, Enter-to-send and example prompts, while still returning only filters.

### The assistant treated every message as a search

Symptom: the user asked “what kind of leads are helpfull to find buisness” and the chat
replied “The plan is missing a city. Include a location…”. A general question was forced
through the search-plan schema, so the only possible outcome was a validation error.

Fix: the assistant schema now has an explicit `intent` (`search` or `advice`) and an
`answer` field. General questions, “how do I use this?”, scoring questions and requests
with no city return plain-text guidance in the chat thread; a search plan still renders
the category/limit preview with “Apply & run”. The chat also sends the last eight turns
with each message, so a follow-up such as a bare city keeps its context. Missing-city and
unsupported-category replies now ask for the missing detail instead of throwing a `400`,
so `auto` mode returns the first valid reply and does not retry every provider. Advice is
capped at 1,600 characters, never carries business/contact fields, and the prompt forbids
naming real companies. Live Groq checks returned advice in 686 ms, a city clarification in
411 ms and a valid Berlin cafe plan in 376 ms. Unit tests cover all three intents and
history forwarding; the Playwright suite checks that an advice reply renders without
“Apply” buttons.

### Scans stayed queued because only the web app was started

Symptom: pressing "Scan website" left the job at `queued` forever. Reproduction showed
the web app alone was running; pg-boss had no connected worker, so nothing consumed
`scan.business`.

Fix: `pnpm dev` and `pnpm start` now launch the web app and the jobs worker together via
`scripts/stack.ts` (standalone `dev:web`, `start:web`, `worker` and `worker:once` remain).
The app detects worker heartbeats from pg-boss's `instance` table, which is populated by
running workers. `/api/scans`, single and bulk scan responses expose `workerOnline`, and
the Scans page, lead views and the app shell show an honest "Automation worker offline"
banner with the start command instead of implying the scan is progressing. Jobs are never
dropped; they resume when a worker connects. A pure parser (`parseWorkerHealth`) has
unit tests, and a Playwright check asserts the banner is absent while the combined stack
is running. Verified live: after the first heartbeat, `/api/scans` returned
`workerOnline: true` and queued scans completed.

### Live scans failed on real websites

Symptom: even with the worker running, scans of public sites returned `unreachable` with
HTTP 400 or 403. The SSRF protection resolved the hostname, then replaced the URL host
with the validated IP and set a `Host` header manually. undici treats `Host` as a
forbidden header, so the request arrived with the IP as the hostname; virtual-hosted
servers rejected it.

Fix: the request URL now keeps the original hostname (preserving the `Host` header and
TLS SNI), while a custom `connect.lookup` pins the socket to the address that passed SSRF
validation. A regression test asserts the fixture server receives the original hostname,
and live scans of `example.com`, `iana.org` and `wikipedia.org` returned HTTP 200 with
`success`.

### Undo did not reopen the resolved duplicate

Symptom: merging a duplicate pair, then undoing the merge restored the business but the
pair did not return to the review queue. The merge snapshot did not record which
candidate rows the merge resolved.

Fix: the merge snapshot now stores those candidate ids, and undo sets them back to
`pending` with `resolvedAt`/`resolvedBy` cleared. Older snapshots without the field still
undo business data safely. The HTTP acceptance run now merges and undoes a seeded pair
and asserts that the pair reappears.

### Vercel serverless mode

Vercel has no persistent worker or writable disk, so jobs stayed `queued` and uploads were
lost between invocations. The app now supports an explicit inline mode (`INLINE_JOBS=true`,
automatic when `VERCEL=1`):

- `queueScans`, `startImport` and score recalculation run the work inside the originating
  request instead of sending a pg-boss job. `getWorkerHealth` reports the queues as online
  so the offline banner is not shown.
- Uploaded files are stored as base64 in the new `import_jobs.file_data` column
  (`UPLOAD_STORAGE=database`), materialized into `/tmp` only while parsing, and cleared
  after a successful import. Listing imports explicitly excludes the payload column.
- Long-running routes declare `maxDuration = 300`. Inline scans stop starting new work
  after `INLINE_JOB_BUDGET_MS` (default 180 s) and mark the remainder failed with an
  explanation instead of leaving them queued forever.
- Migration `0001_smart_war_machine.sql` adds `file_data`.

Verified locally with `INLINE_JOBS=true UPLOAD_STORAGE=database`: a CSV import completed
inline (`completed`, 0 errors, `file_data` cleared), a fixture-site scan returned
`success`, scoring returned `recalculated: true`, and `/api/scans` reported
`workerOnline: true`. Normal worker mode remains the default.

## Decision log (abbreviated)

- Local PostgreSQL runs through `embedded-postgres` on port 5433 because Docker and a
  system `psql` were unavailable. `docker-compose.yml` is still shipped for normal
  environments.
- Auth is email + password. Signup is first-user-only unless `ALLOW_SIGNUP=true`.
- Exports are synchronous CSV with an audit row, which is simpler and reliable for the
  expected list sizes.
- Scan-dependent points require a successful scan; partial and failed scans are honest
  but score-neutral.
- Screenshots and acceptance use a dedicated demo user and fictional workspace, so an
  owner workspace stays clean.
- `db:reset` requires explicit confirmation and refuses production.
- The app name comes from `NEXT_PUBLIC_APP_NAME`, default `Lead Finder`.
- Gemini, xAI Grok and Groq are search planners only. Real leads always come from the
  Nominatim POI index, Overpass or Google Places; the planner schema cannot carry business
  records.
- The assistant also answers general questions with labeled guidance and uses the last
  eight turns for follow-ups. A reply without a city or supported category asks for the
  missing detail rather than failing, so the chat is useful for “how do I use this?”
  without weakening search validation. Only user messages and assistant replies or plan
  summaries are sent to the model, never workspace leads.
- Public Overpass reliability is outside the app's control, so discovery reads the
  Nominatim POI index first, uses Overpass only as a backup, caches and reports failures
  honestly instead of inventing data.
- `leaflet` is the only new runtime dependency for maps; tiles come directly from
  OpenStreetMap with attribution, and geocoding uses Nominatim with a throttled proxy.
