# Audit

Requirement-by-requirement status against the brief. Statuses:

- **Met** — implemented and verified.
- **Met, with deviation** — implemented, but an environment or design choice differs
  from the literal brief; the deviation is stated.
- **Partial** — implemented with a documented gap.
- **Deferred** — not implemented; listed in [DEFERRED.md](DEFERRED.md).

## Product behaviour

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Business lead research/qualification app | Met | Full app at `/`, `/leads`, `/leads/[id]`, `/imports`, `/discovery`, `/scans`, `/duplicates`, `/settings`, `/settings/scoring` |
| 2 | Real data only; no fake leads | Met | Discovery calls live OSM Overpass; imports use uploaded files; scanner reads live sites. No generated leads |
| 3 | Demo data only in a fictional workspace | Met | `scripts/seed-demo.ts` creates `Demo (fictional)` / `demo-fictional`; settings shows a fictional-data warning; real workspaces never seeded |
| 4 | Manual outreach only; never send email/SMS/WhatsApp | Met | No outbound messaging code or provider credentials. The UI states outreach stays manual |
| 5 | Honest scan labels only | Met | `Detected`, `Not detected in checked pages`, `Unknown`, `Scan incomplete`, `Needs manual review` in status badges and scan views; failed/partial scans cannot claim absence |
| 6 | Brand/app name configurable | Met | `NEXT_PUBLIC_APP_NAME`, default `Lead Finder`; resolved in `src/lib/env.ts` and pages |
| 7 | Neutral outreach checklist; no hardcoded country legal claims | Met | `OUTREACH_CHECKLIST` in `src/lib/constants.ts` is jurisdiction-neutral; no legal advice text |
| 8 | Respect robots.txt and source terms | Met | `src/lib/scan/fetch.ts` fetches and enforces `robots.txt`; discovery uses the public Overpass API with an explicit source and rate/caching controls |
| 9 | SSRF protections mandatory | Met | `src/lib/scan/ssrf.ts` + pinned DNS + manual redirect re-validation + private-range blocking; production refuses the test escape hatch |
| 10 | Import CSV/TSV/GeoJSON/ZIP | Met | `src/lib/import/*`; Playwright preview test; Vitest import tests |
| 11 | Column mapping + preview before commit | Met | `POST /api/imports` returns mapping/warnings; UI preview; start endpoint requires confirmed mapping |
| 12 | Row-level errors, cancellation, progress | Met | `import_row_errors`, `import_jobs` counters, cancel endpoint, worker persists progress |
| 13 | Duplicate detection with review | Met | Deterministic policy in `src/lib/dedupe/decide.ts`; `/duplicates` queue; ambiguous matches require review |
| 14 | Merge and undo without data loss | Met | `mergeBusinesses`/`undoLastMerge`; notes, tags, activities, contacts, evidence, source records preserved; isolation test asserts note+tag restoration |
| 15 | Website scan with evidence per page | Met | `scan_results` + `evidence_records`; lead detail `Website scan` tab shows URL-level evidence |
| 16 | Chatbot/WhatsApp/contact/booking detection | Met | `src/lib/scan/extract.ts` + `signatures.json`; Vitest extraction tests |
| 17 | 100-point scoring profile | Met | `DEFAULT_SCORE_CONFIG` sums to 100; config validation rejects other totals; acceptance run asserted 100 |
| 18 | Failed/partial/unknown scans award no scan-dependent points | Met | Enforced in `score/engine.ts` and covered by `tests/score.test.ts` |
| 19 | Honest unknown-category reason | Met | Engine returns "not in the scoring profile; default N points" |
| 20 | Versioned profiles, preview, recalculation | Met | `score_profiles` versions; `/api/scoring` preview/save/activate/recalculate; worker job |
| 21 | Discovery with real providers and honest availability | Met | OSM available; Google Places reports unavailable without a key; no placeholder results |
| 22 | Lead workflow: status, notes, tags, follow-ups, DNC, bulk actions | Met | `src/lib/data/mutations.ts`, lead detail/table, `/api/leads/bulk` |
| 23 | Filters, facets, saved views | Met | `src/lib/data/filters.ts`, `/api/leads/facets`, `/api/saved-views` |
| 24 | CSV export | Met | `/api/leads/export`; recorded in `export_jobs`; acceptance produced 11 lines |
| 25 | Workspace settings and members | Met | `/api/workspaces` PATCH settings, add member, switch workspace; `/settings` |
| 26 | Dashboard | Met | `/` aggregates pipeline, recent activity, scan health and honest labels |

## Engineering requirements

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 27 | TypeScript strict | Met | `tsconfig.json`; `pnpm typecheck` passes |
| 28 | Next.js App Router | Met | `src/app` route groups and route handlers; Next 16 async APIs handled |
| 29 | Tailwind + shadcn/ui | Met, with deviation | Tailwind 4 and shadcn-style local primitives on Radix. Components are vendored under `src/components/ui` rather than installed via the shadcn CLI |
| 30 | TanStack Query + Table | Met | `providers.tsx`, `src/lib/client/hooks.ts`, `lead-table.tsx` |
| 31 | Zod validation | Met | All API bodies and filters; `src/lib/data/filters.ts`, route schemas |
| 32 | PostgreSQL 16 | Met, with deviation | `docker-compose.yml` pins `postgres:16-alpine`. The zero-Docker fallback uses `embedded-postgres`, which currently installs PostgreSQL 18 binaries on this machine. Schema uses no version-specific features |
| 33 | Drizzle ORM + migrations | Met | `schema.ts`, generated `0000_peaceful_outlaw_kid.sql`, `scripts/migrate.ts` |
| 34 | pg-boss + separate worker | Met | `src/lib/jobs/boss.ts`, `src/worker/index.ts`, `pnpm worker`; explicit `createQueue` for pg-boss 12 |
| 35 | pnpm | Met | `packageManager: pnpm@10.20.0`, lockfile committed |
| 36 | Vitest | Met | 8 files, 113 tests |
| 37 | Playwright | Met | 9 specs, 16 tests |
| 38 | pino logging | Met | `src/lib/logger.ts`; API errors and worker jobs log structured events |
| 39 | No `any`, `@ts-ignore`, `console.log` in app code | Met | ESLint passes; scripts/tests may log intentionally |
| 40 | Every workspace-owned table has `workspace_id NOT NULL` | Met | 22 workspace-owned tables in `schema.ts`; review of each definition |
| 41 | Scoped data access | Met | Every query/mutation takes `WorkspaceContext` and filters `workspace_id` |
| 42 | Isolation test | Met | `tests/isolation.test.ts`: cross-workspace read, update, bulk archive, dedupe, merge/undo; 9 tests |
| 43 | No secrets committed | Met | `.env` ignored; `.env.example` placeholders; production refuses dev auth secret |
| 44 | `.env.example` maintained | Met | Documents every supported variable |
| 45 | No destructive commands | Met | `db:reset` requires `--yes`/`RESET_DB_CONFIRM` and refuses production; seed only touches the demo workspace |
| 46 | Responsive 1440/1024/390, light/dark | Met | 60 screenshots; responsive Playwright spec |
| 47 | Docs | Met | README, architecture, progress, questions, audit, limitations, deferred |
| 48 | Phase gate passes | Met | typecheck + lint (0 errors) + 113 tests + build; Playwright 16/16 |
| 49 | Commit each step | Met | Logical commits for scaffold, core services, UI/API, tests, docs (see `git log`) |

## Acceptance evidence

See [PROGRESS.md](PROGRESS.md#acceptance-run) for the production-build acceptance table:
sign-in, seeded leads, import preview/start/completion, queryable imported lead, contacts,
duplicate queue, scan outcomes, 100-point profile, discovery availability, CSV export and
workspace settings all verified.

## Known warnings and deviations

1. **TanStack Table + React Compiler warning.** ESLint emits one non-blocking warning:
   `useReactTable()` returns functions the compiler cannot memoize safely. This is a
   known upstream limitation, not a correctness failure; the build and tests pass.
2. **Embedded PostgreSQL version.** The Docker path is PostgreSQL 16 as requested. The
   local fallback used during this build is an embedded distribution with a newer major
   version. Production deployment should use the compose path or any PostgreSQL 16+
   server.
3. **Missing reference inputs.** `docs/SPEC.md` and `docs/reference.png` were never
   present. See [QUESTIONS.md](QUESTIONS.md).
4. **Screenshot verification.** All 60 images were checked programmatically for correct
   viewport width and non-trivial PNG content. They were generated from the production
   build with a deterministic demo workspace.
5. **Export format.** CSV only. The brief required export, not a specific spreadsheet
   format. XLSX is deferred.
6. **Email/phone verification** is an explicit manual/evidence state, not a third-party
   deliverability or carrier lookup. The UI never claims more than it checked.

## Security review summary

| Control | Result |
| --- | --- |
| Session required for app pages and API | Enforced by page guards and `getWorkspaceContext()` |
| Cross-workspace access | Blocked at query layer; proven by tests |
| Auth rate limiting | Better Auth built-in; additional per-user limits on imports, scans, exports and mutations |
| SQL injection | Parameterised Drizzle queries; no string-concatenated user SQL |
| SSRF | Scheme allowlist, DNS resolution + private-range block, pinned DNS, redirect re-validation, per-hop checks |
| DNS rebinding | Pinned lookup used for the actual connection |
| Open redirects | Redirects are followed manually and re-validated; download filenames are generated |
| Upload abuse | MIME/extension sniffing, size cap, ZIP entry/size/ratio caps, traversal rejection |
| XSS | React escaping; no `dangerouslySetInnerHTML` in app code |
| CSRF | Same-origin JSON APIs with session cookies; mutating endpoints require JSON bodies and same-origin browser requests |
| Secret leakage | `.env` ignored; structured logs avoid secrets; production config guard |
| Outbound messaging | No implementation present |

## Verdict

All mandatory behaviours in the brief are implemented and verified. The deviations are
environmental (local embedded PostgreSQL) or explicitly documented scope choices
(vendored shadcn components, CSV-only export, missing reference files). No fake lead data
exists outside the isolated demo workspace.
