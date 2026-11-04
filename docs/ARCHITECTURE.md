# Architecture

## High-level shape

Lead Finder is a single Next.js application plus one background worker. Both talk to
the same PostgreSQL database and the same pg-boss schema.

```
Browser (React 19 / TanStack Query)
  │  fetch /api/*
  ▼
Next.js App Router (route handlers + server components)
  │  workspace-scoped data layer
  ├──────────────► PostgreSQL (Drizzle ORM)
  │                   ▲
  │  send job         │  claim job
  ▼                   │
pg-boss ──────────► worker (tsx src/worker/index.ts)
                      ├─ import.process
                      ├─ scan.business
                      ├─ export.generate
                      ├─ score.recalculate
                      └─ healthcheck
```

Long-running work never runs inside a request handler. Uploads are stored, a job is
enqueued, and the worker does the parsing/scanning. The UI subscribes to
`GET /api/events` (Server-Sent Events) and invalidates TanStack Query caches when a job
changes state.

## Directory map

```
src/app/                 App Router pages and API route handlers
src/components/          UI: shell, feature views, Radix-based primitives
src/lib/api/             Route wrapper, error envelope, rate limiting
src/lib/auth/            Better Auth config, session → workspace context, page guards
src/lib/data/            Workspace-scoped reads, mutations, filters, facets, saved views
src/lib/db/              Drizzle client, schema, generated migrations
src/lib/dedupe/          Deterministic decision policy + merge/undo service
src/lib/discovery/       OSM Overpass, Google Places, AI planning and Nominatim geocoding
src/lib/events/          In-process SSE event bus
src/lib/export/          CSV generation and export job record
src/lib/import/          Upload parsing, CSV/ZIP safety, mapping, ingestion
src/lib/jobs/            pg-boss singleton, queue names and payload types
src/lib/normalize/       Name, phone, email, website, category normalisation
src/lib/scan/            SSRF checks, fetcher, HTML extraction, scan orchestration
src/lib/score/           Score config, engine, profile service
src/lib/storage/         Local upload storage
src/worker/              Worker entrypoint and job registrations
scripts/                 Local DB, migrations, demo seed, screenshots
tests/                   Vitest suites, fixture server, Playwright specs
docs/                    Architecture, audit, progress, screenshots
```

## Data model

The schema is defined in [`src/lib/db/schema.ts`](../src/lib/db/schema.ts) and applied by
the generated migration in `src/lib/db/migrations/0000_peaceful_outlaw_kid.sql`.

27 tables:

- **Auth:** `user`, `session`, `account`, `verification`
- **Tenancy:** `workspaces`, `memberships`
- **Leads:** `businesses`, `business_locations`, `source_records`, `contact_points`
- **Imports:** `import_jobs`, `import_row_errors`
- **Scans:** `scan_jobs`, `scan_results`, `evidence_records`
- **Scoring:** `score_profiles`, `score_results`
- **Workflow:** `notes`, `tags`, `business_tags`, `activities`, `saved_views`
- **Dedupe:** `duplicate_candidates`, `merge_history`
- **Discovery/export:** `saved_searches`, `export_jobs`, `category_mappings`

22 of those tables are workspace-owned and carry `workspace_id NOT NULL`. The four
auth tables (`user`, `session`, `account`, `verification`) are global by design.

`businesses` is the canonical lead row. It stores the latest scan summary
(`latest_scan_id`, `latest_scan_outcome`, `latest_chatbot_result`, `last_checked_at`) so
list queries stay cheap, while full page-by-page evidence lives in `scan_results` and
`evidence_records`.

Merged leads are retained with `merged_into_id` set. This is what makes undo possible
and keeps foreign-key history intact. All normal queries exclude merged rows.

## Request lifecycle

1. A route handler resolves the session with `getWorkspaceContext()`.
2. The context contains the user, active workspace, role, timezone and workspace list.
3. The data layer takes that context and always adds
   `WHERE workspace_id = ctx.workspaceId`.
4. Mutations write an `activities` row and publish an SSE event.
5. Errors are normalised by `src/lib/api/route.ts` into
   `{ error: { code, message, details } }`. Unexpected errors get an `errorId` and are
   logged with pino; they never leak stack traces to the client.
6. Sensitive write endpoints apply a simple in-memory per-user rate limit.

Next.js 16 specifics: `headers()`/`cookies()` are async, and dynamic route `params` are
Promises. Route handlers therefore `await params` and `await getWorkspaceContext()`.

## Authentication and tenancy

Better Auth runs at `/api/auth/[...all]` with email + password. The setup screen is
available only while there are zero users; creating the first owner also creates their
workspace and membership in a transaction. Self-service signup stays disabled unless
`ALLOW_SIGNUP=true`.

The auth client is created without an explicit `baseURL`, so it calls `/api/auth/*` on
the current origin. Localhost, LAN addresses and deployed domains all work.

Workspace isolation is enforced at the query layer, not by the UI. The isolation test
creates two users, two workspaces, two leads, a duplicate pair, notes and tags, then
proves that cross-workspace reads/updates/merges cannot see or mutate the other side.

## Import pipeline

1. `POST /api/imports` accepts one upload, enforces the size cap, stores it, sniffs the
   format and builds a preview: headers, guessed mapping, warnings, row hint and any
   duplicate file.
2. ZIPs are handled by `src/lib/import/zip.ts`: entry count, per-entry size, total
   uncompressed size and compression ratio are bounded; absolute paths, traversal and
   unsafe entries are rejected. Invalid archives fail deterministically instead of
   hanging.
3. `POST /api/imports/[id]/start` stores the confirmed mapping and enqueues
   `import.process`.
4. The worker parses rows, normalises fields, matches duplicates, inserts or merges, and
   records row-level errors. Progress is persisted after batches.
5. Duplicate decisions:
   - `merge` — same phone with similar name, or same registrable domain plus supporting
     name/location evidence.
   - `review` — similar name within a short distance, or ambiguous domain collisions.
   - `none` — no candidate.
   Review pairs appear in `/duplicates` and can be merged or dismissed.
6. Cancellation is cooperative: the worker checks the job status between batches.

Normalisation is shared by every entry point (import, discovery, manual create, scan):

- names: NFKC, punctuation/whitespace folding, lowercase comparison key
- phones: E.164 via `libphonenumber-js`
- emails: trimmed lowercase with syntax check
- websites: URL parse, hostname extraction, registrable-domain variants
- categories: mapping table from free-text labels to the fixed category keys

## Website scanner

The scanner is the most safety-sensitive part of the app.

**Target validation (`src/lib/scan/ssrf.ts`)**

- Only `http`/`https` URLs.
- Hostnames are resolved and every returned address is classified. Loopback, private,
  link-local, unique-local, multicast, unspecified, documentation and other non-public
  ranges are rejected.
- IPv6 brackets are stripped before classification, so public IPv6 literals work while
  private IPv6 literals stay blocked.
- DNS is pinned for the request and re-checked on every redirect, which closes the
  DNS-rebinding gap between validation and connection.
- Redirects are followed manually and each hop is re-validated.
- A test-only escape hatch (`ALLOW_PRIVATE_TARGETS_FOR_TESTS`) permits a local fixture
  server. Production startup refuses to run with it enabled.

**Fetching (`src/lib/scan/fetch.ts`)**

- Fixed, configurable user agent.
- `robots.txt` is fetched and checked before page requests; disallowed paths are skipped
  and recorded honestly.
- Connect and total timeouts, retry limit, body size cap and content-type checks.
- Per-host delay and a global concurrency limit.
- Only public HTML is read. No forms are submitted, no logins, no authenticated areas.

**Extraction (`src/lib/scan/extract.ts`)**

- Cheerio-based extraction of contact emails, phones, WhatsApp links, contact forms,
  booking/inquiry forms and common chat-widget signatures (including a JSON signature
  list).
- Each finding is attached to the page and URL where it was seen as evidence.
- Pages checked are bounded (`SCAN_MAX_PAGES`, default 4).

**Outcomes**

- `success` — the site was reached and pages were inspected.
- `partial` — some pages failed or robots/timeout cut the scan short.
- `failed` — nothing usable was inspected.
- Scan-dependent scoring and "no chatbot" conclusions require `success`.

Results are cached for `SCAN_CACHE_DAYS` (default 7). A user can force a rescan.

## Scoring

Scoring is configurable per workspace and versioned. The default profile totals exactly
100:

| Component | Max | How it is earned |
| --- | --- | --- |
| Industry fit | 30 | Per-category points from the profile |
| Website inspected | 15 | Only when `outcome === "success"` |
| No chatbot detected | 20 | Only when a successful scan found no widget |
| WhatsApp, no chatbot | 5 | Only when a successful scan found an explicit WhatsApp link and no widget |
| Contact channels | 20 | Email 8, phone 4, WhatsApp 4, contact form 4 |
| Inquiry interaction | 10 | Booking 6, inquiry form 4 |

Rules enforced by the engine and covered by tests:

- Config validation rejects a profile whose maximum is not 100.
- Failed, partial and unknown scans award **zero** scan-dependent points. They never
  award "no chatbot" points.
- Imported email/phone points still count even without a scan.
- Unknown category keys produce an honest explanation ("not in the scoring profile;
  default N points") rather than a silent zero.
- Every score result stores its components, reasons, profile id and profile version.
- Changing the active profile can be previewed, then recalculated for the workspace by a
  job.

## Discovery

`/discovery` supports two real providers:

- **OpenStreetMap / Overpass** - named amenity/shop/tourism queries by country and city.
  Results include OSM tags and a source ID; they are imported as `source_records`.
  Requests are retried across `OVERPASS_ENDPOINTS` on 429/5xx/network failures, with
  per-attempt timeouts (`OVERPASS_TIMEOUT_MS`) and an in-memory cache
  (`OVERPASS_CACHE_MINUTES`). The default endpoint is `overpass-api.de`; no unreliable
  mirror is hardcoded.
- **Google Places** - used only when `GOOGLE_PLACES_API_KEY` is set. With no key the UI
  shows an explicit unavailable state. The daily budget is displayed as configuration and
  is not yet enforced by a persistent counter.

There is no generated/placeholder provider. If a source fails, the run reports the
failure; it does not substitute fake businesses. Saved searches let a user repeat a
query; runs are recorded and marked.

### AI search planner (Gemini / Grok)

`POST /api/discovery/plan` turns a plain-language request into validated filters:
country, city, 1-8 category keys, a result limit and a target provider. The model
receives only the user's description and a strict system prompt. It is never treated as
a data source: the response schema has no fields for business names, addresses, phones,
emails or websites, and the app rejects anything outside the filter shape. The resulting
filters must still be run through Overpass or Google Places.

Gemini uses `GEMINI_MODEL` (default `gemini-2.5-flash`). Grok uses the OpenAI-compatible
`GROK_BASE_URL` (default `https://api.x.ai/v1`) and `GROK_MODEL` (default `grok-4`).
`auto` picks the first configured planner. Missing keys produce an honest unavailable
state; manual discovery keeps working without AI.

### Map and geocoding

`GET /api/discovery/geocode` proxies OpenStreetMap Nominatim, with caching, a 1 req/s
throttle and a configurable user agent (`GEOCODE_USER_AGENT`). The discovery screen uses
it to preview the search area and plots result coordinates on a Leaflet map with OSM
tiles. Map positions come from the source and are labelled as unverified; no address is
invented. The UI shows up to 200 mapped results from the current run.

### Discovery failure handling

When every Overpass attempt fails, the API returns the number of attempts, the last
status or reason, and actionable options (retry later, narrow the search, add a mirror or
configure Google Places). Nothing is saved. The public Overpass service is shared and
can return 502 "at capacity"; the app backs off, falls back to configured mirrors and
never shows placeholder results.

## Export

CSV export is generated synchronously by `POST /api/leads/export` from the current
filters (plus optional notes and do-not-contact rows). The response is streamed as a
download with a row count header, and the export is recorded in `export_jobs` for audit.

## Jobs

`src/lib/jobs/boss.ts` owns the pg-boss singleton. On start it creates every queue in
`JOB_NAMES` explicitly — pg-boss 12 does not create queues on demand — and does not cache
a rejected startup, so a transient database failure can retry.

| Queue | Work |
| --- | --- |
| `import.process` | Parse, dedupe and ingest an uploaded file |
| `scan.business` | Scan one business website (batches of 5) |
| `export.generate` | Reserved for large exports |
| `score.recalculate` | Recalculate every lead after a profile change |
| `healthcheck` | Worker liveness check |

The worker registers handlers, logs with pino, and is a separate process from the web
server. Imports and scans require it to be running.

## UI

- Warm off-white / forest-green / amber design tokens, dark mode via a `.dark` class.
- Sidebar shell with active-route highlighting, theme toggle and workspace switcher.
- Lead table: server-side filtering, sorting, pagination, column visibility, bulk
  actions, saved views and export.
- Lead detail: overview, contacts with verification state, scan evidence, score
  breakdown, notes, activity and duplicate links.
- Honest status badges map one-to-one to the labels in the README.
- All pages are responsive at 1440, 1024 and 390 px; screenshots are captured against
  the production build.

## Test strategy

- **Vitest (130 tests, 10 files):** normalisation, dedupe policy, scoring engine,
  extraction, SSRF/security, import/ZIP parsing, discovery retry/cache, AI plan
  validation and geocode parsing, fetcher fixture server and workspace isolation. The
  isolation file hits a real PostgreSQL database.
- **Playwright (16 tests):** auth gating, dashboard, leads, lead detail, duplicates,
  imports (including preview), discovery availability, scans, settings, and responsive
  layout at narrow widths.
- **Screenshots:** a Playwright script signs in as the demo owner and captures every
  screen at three widths and two themes.

## Failure handling

- API errors are typed (`NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `RATE_LIMITED`,
  `INTERNAL_ERROR`) and rendered with actionable messages.
- Invalid uploads fail with a row/entry explanation instead of a partial import.
- Failed scans are persisted as failures with a reason; they do not silently disappear.
- Jobs are retried by pg-boss; a failed import job records its error and can be retried.
- The UI distinguishes "no data", "not detected", "unknown" and "scan incomplete".
