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
- **Discover** businesses from OpenStreetMap (Overpass API) and, when a key is present,
  Google Places. Providers are honest about availability; there are no placeholder
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

The app compiles to 40 routes: 12 pages, 26 API handlers and the framework's global
error/not-found entries.

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
| Jobs | pg-boss 12, separate worker process |
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

# 4. Run the app and the worker in separate terminals
pnpm dev       # http://localhost:3000
pnpm worker
```

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
| `pnpm dev` | Next.js dev server |
| `pnpm build` / `pnpm start` | Production build / server |
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
| `STORAGE_DIR` | `.data/storage` | Upload storage |
| `MAX_UPLOAD_BYTES` | 50 MiB | Upload cap |
| `SCAN_*` | see example | Timeouts, page count, politeness, UA |
| `ALLOW_PRIVATE_TARGETS_FOR_TESTS` | `false` | Test-only; startup fails in production |
| `OVERPASS_ENDPOINT` | public OSM endpoint | Real discovery source |
| `GOOGLE_PLACES_API_KEY` | empty | Empty means the provider reports unavailable |
| `PG_BOSS_SCHEMA` | `pgboss` | Job queue schema |
| `LOG_LEVEL` | `info` | pino level |

Production startup refuses to run with the development auth secret or with
`ALLOW_PRIVATE_TARGETS_FOR_TESTS=true`.

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

- [Architecture](docs/ARCHITECTURE.md) — layers, data model, flows, safety controls
- [Progress](docs/PROGRESS.md) — phase gates, test counts, acceptance evidence
- [Audit](docs/AUDIT.md) — requirement-by-requirement status
- [Questions](docs/QUESTIONS.md) — missing inputs and assumptions
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Deferred work](docs/DEFERRED.md)

## License

Private/internal project. No license has been granted for redistribution.
