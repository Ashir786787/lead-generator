# Lead Finder

Lead Finder is a self-hosted business lead research and qualification app. It imports
business lists you already have, discovers businesses from real public sources, checks
their websites, deduplicates the records, and scores how good a fit they are for an
outreach offer — without ever sending a message.

The product is deliberately **manual-outreach only**. There is no email, SMS or WhatsApp
sending code anywhere in the app. The output is a clean, evidence-backed list that a
human reviews and works through.

> **Demo data is fictional and isolated.** The only fake records in the system live in a
> workspace called `Demo (fictional)`, created by `pnpm seed:demo`. Real workspaces never
> receive sample data.

## What it does

- **Import** CSV, TSV, GeoJSON and ZIP uploads with column mapping, preview, row-level
  error reporting, duplicate detection, undo-safe merges and cancellation.
- **Discover** businesses from OpenStreetMap (Nominatim POI index, with Overpass as a
  backup) and, when a key is present, Google Places. A chat-style AI assistant powered by
  Gemini, xAI Grok or Groq turns plain language into validated search filters, or answers
  general questions about choosing leads and using the app - the models never supply
  leads. A Leaflet/OpenStreetMap map previews the search area and plots real
  result coordinates. Providers are honest about availability; there are no placeholder
  results.
- **Scan** public websites with a hardened fetcher: SSRF/DNS-rebinding protection,
  redirect re-validation, `robots.txt` checks, per-host politeness delays, timeouts, body
  size caps and a fixed user agent.
- **Qualify** with a 100-point scoring profile: industry fit, a fully inspected site, no
  detected chat widget, WhatsApp-without-chatbot, reachable contact channels and
  inquiry/booking interactions.
- **Deduplicate** with deterministic rules (phone, domain, name, street, distance) and a
  review queue; merges are reversible.
- **Work the list** with filters, saved views, notes, tags, pipeline status, follow-up
  dates, do-not-contact, bulk actions and CSV export.

The app compiles to 41 app paths: 12 pages, 28 API handlers and the framework's
not-found entry.

## Honest labels

Scan results use only these labels:

`Detected` · `Not detected in checked pages` · `Unknown` · `Scan incomplete` ·
`Needs manual review`

A failed or partial scan never awards scan-dependent score points, and never claims a
chat widget is absent. "Not detected" means exactly that — not detected in the pages
that were actually checked.

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 20.9+, TypeScript strict |
| Framework | Next.js 16 App Router, React 19 |
| Styling | Tailwind CSS 4, shadcn-style components on Radix UI |
| Data fetching | TanStack Query, TanStack Table |
| Validation | Zod 4 |
| Database | PostgreSQL 16+ (Drizzle ORM) |
| Jobs | pg-boss 12 worker, or inline jobs on serverless |
| Auth | Better Auth (email + password) |
| Logging | pino |
| Tests | Vitest + Playwright |
| Package manager | pnpm 10 |

## Quick start

```bash
pnpm install

# 1. Start PostgreSQL
#    Option A (no Docker required): bundled local Postgres on port 5433
pnpm db:up
#    Option B: docker compose up -d
#    (then set DATABASE_URL to port 5432)

# 2. Apply migrations
pnpm db:migrate

# 3. Copy and adjust environment
#    .env.example documents every variable.
cp .env.example .env
#    At minimum set BETTER_AUTH_SECRET to a long random value.

# 4. Run the app and the worker together
pnpm dev       # http://localhost:3000, also starts the jobs worker

# Prefer separate terminals? Run the web app and worker independently:
pnpm dev:web
pnpm worker
```

Website scans, imports and score recalculation are processed by the pg-boss worker. The
combined `dev`/`start` commands launch it for you; if you use `dev:web` or `start:web` on
their own, start `pnpm worker` too. The app shows an "Automation worker offline" banner
when no worker heartbeat is visible, and queued jobs resume as soon as one connects.

On a serverless host there is no worker process. Set `INLINE_JOBS=true` (or deploy to
Vercel, which sets it automatically) and jobs run inside the request that creates them.
See [Deployment](#deployment).

On first run the database has zero users. Open `http://localhost:3000/setup` to create
the owner account. After that, self-service signup is disabled unless
`ALLOW_SIGNUP=true`.

### Demo workspace (fictional)

```bash
pnpm seed:demo
# Email:    demo@leadfinder.example
# Password: demo-password-123
# Workspace: Demo (fictional)
```

The seed is deterministic and only deletes/recreates the demo workspace. It never
touches an owner workspace. Run it again at any time to reset the demo.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Next.js dev server + jobs worker |
| `pnpm dev:web` | Next.js dev server only (start `pnpm worker` too) |
| `pnpm build` / `pnpm start` | Production build / server + jobs worker |
| `pnpm start:web` | Production server only (start `pnpm worker` too) |
| `pnpm worker` | Background worker (imports, scans, exports, scoring, healthcheck) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit/integration suite |
| `pnpm test:e2e` | Playwright browser suite |
| `pnpm check` | typecheck + lint + test + build (release gate) |
| `pnpm db:up` / `db:down` / `db:status` | Bundled local PostgreSQL |
| `pnpm db:migrate` | Apply Drizzle migrations |
| `pnpm db:generate` | Generate a migration after schema changes |
| `pnpm db:reset` | Drop and recreate the schema (requires `--yes`, refuses production) |
| `pnpm seed:demo` | Recreate the fictional demo workspace |
| `pnpm screenshots` | Capture the UI at 1440/1024/390, light/dark |
| `pnpm fixture:server` | Local fixture server used by scanner tests |

## Configuration

All variables are documented in [`.env.example`](.env.example). The most important:

| Variable | Default | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_NAME` | `Lead Finder` | Brand name shown in the UI |
| `DATABASE_URL` | local port 5433 | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | dev placeholder | **Must** be replaced in production |
| `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Auth and absolute URL base |
| `ALLOW_SIGNUP` | `false` | Signup only when zero users, or always when true |
| `STORAGE_DIR` | `.data/storage` | Upload storage (`/tmp/storage` on Vercel) |
| `UPLOAD_STORAGE` | `local` | `local` or `database`; defaults to `database` in inline mode |
| `INLINE_JOBS` | `false` | Run jobs inside the request (auto-enabled on Vercel) |
| `INLINE_JOB_BUDGET_MS` | `180000` | Inline scan budget before remaining scans are failed honestly |
| `MAX_UPLOAD_BYTES` | 50 MiB | Upload cap (Vercel request bodies are capped at 4.5 MB) |
| `SCAN_*` | see example | Timeouts, page count, politeness, UA |
| `ALLOW_PRIVATE_TARGETS_FOR_TESTS` | `false` | Test-only; startup fails in production |
| `OVERPASS_ENDPOINT` | public OSM endpoint | Backup tag search when the POI index is empty |
| `OVERPASS_ENDPOINTS` | empty | Comma-separated fallback mirrors |
| `OVERPASS_TIMEOUT_MS` / `OVERPASS_RETRIES` | `20000` / `0` | Per-attempt timeout and retries |
| `OVERPASS_CACHE_MINUTES` | `60` | In-memory cache for identical queries |
| `GOOGLE_PLACES_API_KEY` | empty | Empty means the provider reports unavailable |
| `GEOCODE_USER_AGENT` | scanner UA | Set a real contact for Nominatim in production |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | empty / `gemini-3.1-flash-lite` | Optional AI search planner and guidance |
| `GROK_API_KEY` / `GROK_MODEL` | empty / `grok-4` | Optional xAI Grok planner and guidance |
| `GROQ_API_KEY` / `GROQ_MODEL` | empty / `qwen/qwen3.8-27b` | Optional Groq Cloud planner and guidance (not xAI Grok) |
| `PG_BOSS_SCHEMA` | `pgboss` | Job queue schema |
| `LOG_LEVEL` | `info` | pino level |

Production startup refuses to run with the development auth secret or with
`ALLOW_PRIVATE_TARGETS_FOR_TESTS=true`.

## Discovery, AI planning and maps

Discovery has two real sources: OpenStreetMap (no key) and Google Places (key required).
Search `/discovery` manually, or chat with the AI assistant and let Gemini, xAI Grok or Groq
help:

1. Ask for a specific search, for example “dentists in Lisbon, Portugal”. The assistant
   returns only `intent`, `city`, an optional `country`, categories (1-8), a result limit
   and a target provider. It has no schema fields for businesses, contacts or websites.
2. Ask a general question, for example “which kinds of businesses are good leads?” or
   “how does the lead score work?”. The assistant replies with plain-text guidance in
   `answer`. Advice never names a real business and is not a search plan.
3. Follow-ups keep context. The browser sends up to the last 8 turns, so a reply such as
   “web design” followed by “Berlin” can become a plan. Only your messages and the
   assistant's replies or plan summaries are sent; workspace leads and contacts never are.
4. The app validates a search plan and shows the filters as a chat reply. A city is
   required; a missing country is allowed and noted. If no city is given, or no supported
   category matches, the assistant asks for that detail instead of producing an error.
5. Running the plan calls the live source, imports through the normal dedupe pipeline
   and plots returned coordinates on the OpenStreetMap map.

If no AI key is set, the assistant says so and manual discovery still works. `auto`
prefers Groq for speed, then Gemini, then Grok, and transparently falls back if a planner
fails (the chat reply shows which model was used). General guidance and missing-city
clarifications return immediately as chat replies, so `auto` never retries every provider
for them.

OpenStreetMap discovery reads the public Nominatim POI index with exact tag queries such as
`[amenity=dentist]` inside the geocoded city box. It is free, keyless and normally answers
in 1–4 seconds. If the index has no matches, the app tries Overpass as a backup and reports
an honest error if both fail. Nothing is saved on failure.

Maps use Leaflet with OpenStreetMap tiles. Geocoding and POI queries share a 1 request/second
Nominatim throttle with caching. Positions are source coordinates, not verified addresses.
Set `GEOCODE_USER_AGENT` to a real contact URL/email before public deployment.

## Deployment

### Vercel (serverless, free tier)

Vercel has no long-lived worker process or durable local disk, so the app switches to
**inline jobs** and **database uploads**:

- Scans, imports and score recalculation run inside the API request that starts them.
- Uploaded files are stored as base64 in `import_jobs.file_data` and cleared after a
  successful import. `/tmp` is used only for working files.
- The worker-offline banner stays hidden because the app reports inline jobs as online.

Set these environment variables (Vercel sets `VERCEL=1`, which enables the first two
automatically):

```bash
INLINE_JOBS=true
UPLOAD_STORAGE=database
STORAGE_DIR=/tmp/storage
DATABASE_URL=postgresql://...        # managed Postgres, direct/session connection
BETTER_AUTH_SECRET=...               # openssl rand -base64 32
BETTER_AUTH_URL=https://your-app.vercel.app
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

Also set `SCAN_USER_AGENT` and `GEOCODE_USER_AGENT` to a real contact URL/email, plus any
AI keys you use. Do **not** set `ALLOW_PRIVATE_TARGETS_FOR_TESTS=true` or
`NODE_ENV=development` in production.

Run migrations against the production database once before the first deploy:

```bash
DATABASE_URL="postgresql://...?sslmode=require" pnpm db:migrate
```

Then deploy from `main`, open `https://your-app.vercel.app/setup`, and create the owner
account. `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_APP_NAME` are baked into the build, so
redeploy after changing them.

Vercel-specific limits (the UI reports them honestly):

- Function duration is capped at 300 seconds. Inline scans stop starting new work after
  `INLINE_JOB_BUDGET_MS` (default 180 s) and mark the remainder failed with an explanation.
  Large imports can still exceed the cap; split them into smaller files.
- Request bodies are capped at 4.5 MB on Hobby, so uploads must be smaller than that even
  though `MAX_UPLOAD_BYTES` allows more locally.
- Live events use `LISTEN/NOTIFY`; a serverless stream can be cut at the function limit.
  The UI also polls, so job progress still appears.
- Use a direct or session-mode Postgres URL (not Neon's transaction pooler) so
  `LISTEN/NOTIFY` and migrations work.

### Long-running host (Railway, Render, Fly.io, VPS)

Use one service that runs the web app and worker together (`pnpm start`), a persistent
volume (for example `/data` mounted with `STORAGE_DIR=/data/storage`), and managed
PostgreSQL. Keep `INLINE_JOBS=false` and `UPLOAD_STORAGE=local`. This mode removes the
serverless limits above and is the better choice for large imports or bulk scans.

## Data safety

- Every workspace-owned table has `workspace_id NOT NULL`; all reads and writes go
  through a workspace-scoped context.
- The isolation suite creates two workspaces and proves cross-workspace reads, updates,
  merges and deletes are impossible.
- Uploaded archives are checked for entry count, total/entry size, compression ratio and
  path traversal. Unsafe ZIPs are rejected before extraction.
- The scanner never follows a redirect or resolves a host that points at a private,
  loopback, link-local, multicast or otherwise non-public address.
- No secrets are committed. `.env` is ignored; `.env.example` contains placeholders only.

## Screenshots

60 captures at 1440, 1024 and 390 px in light and dark mode live in
[`docs/screenshots/`](docs/screenshots). Start with:

- [Dashboard, 1440 light](docs/screenshots/dashboard-1440-light.png)
- [Leads, 1440 light](docs/screenshots/leads-1440-light.png)
- [Lead detail, 1440 dark](docs/screenshots/lead-detail-1440-dark.png)
- [Scoring, 1024 light](docs/screenshots/scoring-1024-light.png)
- [Sign in, 390 dark](docs/screenshots/login-390-dark.png)

They are generated against the production build with `pnpm screenshots` after
`pnpm seed:demo`; the full inventory is in [docs/PROGRESS.md](docs/PROGRESS.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - layers, data model, flows, safety controls
- [Testing report](docs/TESTING_REPORT.md) - full-app audit, pass/fail matrix, bugs fixed
- [Progress](docs/PROGRESS.md) - phase gates, test counts, acceptance evidence
- [Audit](docs/AUDIT.md) — requirement-by-requirement status
- [Questions](docs/QUESTIONS.md) — missing inputs and assumptions
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Deferred work](docs/DEFERRED.md)

## License

Private/internal project. No license has been granted for redistribution.
