# Deferred work

Items intentionally left out of this build. Each has a reason and a suggested trigger for
picking it up.

## Data import and export

| Item | Why deferred | Trigger |
| --- | --- | --- |
| XLSX / Google Sheets export | CSV covers the stated need and keeps the export dependency-free | Users need formatting, multiple sheets or formulas |
| Background large exports | Current synchronous CSV is fine for thousands of rows; `export.generate` queue already exists | Exports exceed memory/time limits |
| Excel/ODS import | CSV/TSV/GeoJSON/ZIP cover the common list formats | A user provides spreadsheets that cannot be saved as CSV |
| Import resume after worker crash | pg-boss retries the job; row progress is persisted but a retry starts the file again with idempotent dedupe | Very large files where reprocessing is expensive |
| Saved column-mapping templates | Guessed mapping plus manual confirmation is enough for now | Repeated files from the same provider |

## Scanning and discovery

| Item | Why deferred | Trigger |
| --- | --- | --- |
| Headless-browser scanning | Adds a heavy Chromium dependency and new SSRF/abuse surface; static HTML covers most sites honestly | Many target sites are JS-only and results are too often "unknown" |
| Scheduled rescans | Manual "Scan again" and cache expiry work; scheduling needs quota/backoff policy | Users need freshness SLAs |
| Persistent Google Places daily budget counter | Provider availability and the configured cap are shown, but no durable usage counter exists | Google is enabled in production |
| Additional discovery providers (Yelp, Bing, directories) | Each source has separate terms, keys and rate limits | OSM/Google coverage is insufficient |
| Custom category taxonomy | Fixed keys keep scoring and filters deterministic | A customer needs domain-specific categories |
| Sitemap-driven deeper crawling | Bounded page count is deliberate for politeness | Sites with important details deep in the hierarchy |
| PDF/brochure parsing | Out of scope and a new parser safety surface | Leads publish contact info only in PDFs |

## Deduplication and contact quality

| Item | Why deferred | Trigger |
| --- | --- | --- |
| Email deliverability / SMTP verification | The app is manual-outreach only; verification is a human assertion | Users want bounce risk estimates |
| Phone carrier/WhatsApp presence check | Would require third-party APIs and consent considerations | WhatsApp qualification becomes a hard requirement |
| Automatic merge thresholds per workspace | Global deterministic policy is safer | Teams need different risk tolerance |
| Address geocoding and canonicalisation | Source coordinates are used when present; no external geocoder | Address-based dedupe proves unreliable |
| Duplicate merge preview UI with field-level selection | Current merge keeps the chosen lead and preserves linked records; field-by-field selection is a larger UX | Users need to cherry-pick individual fields |

## Platform and operations

| Item | Why deferred | Trigger |
| --- | --- | --- |
| S3-compatible storage | Local disk is sufficient for a single node | Multi-instance or ephemeral filesystem deployment |
| Redis/shared rate limiting | In-memory limits are adequate for one web process | Horizontal scaling |
| SSO / magic-link auth | Email + password with first-run setup is sufficient | Organization-wide rollout |
| Role management UI (promote/demote/remove members) | Owners can add members and roles exist in the schema; editing is not exposed | Team grows beyond a few trusted users |
| Audit-log UI | Activities and merge history are stored and shown in context; no global audit screen | Compliance review |
| Webhooks / CRM connectors | No integration target was specified | A specific CRM is chosen |
| Backup/retention automation | Deployment-specific | Production launch |
| i18n / RTL | English-only UI | Non-English market |
| Firefox/WebKit test matrix | Chromium covers the primary path | Cross-browser support becomes a requirement |
| Visual regression baselines | Screenshots are manual review artifacts | UI changes become frequent |
| Automated accessibility audit (axe) | Basic semantics and keyboard support are present | Accessibility compliance is required |
| Mobile app / PWA install | Responsive web UI covers mobile widths | Offline/mobile workflow is required |
| Durable event log | PostgreSQL `LISTEN/NOTIFY` is a live signal, not storage; clients refetch | Event replay or integrations |
| Per-workspace scan concurrency | Global limits are simpler and safer | Noisy-neighbour problems |
| Usage metering/billing | Self-hosted internal tool | Commercial SaaS launch |

## Product boundary (not planned)

These are explicitly out of scope and should not be added without a new compliance
review:

- Sending email, SMS or WhatsApp from the app.
- Automating contact-form submission.
- Authenticated scraping or bypassing bot protections.
- Purchasing or trading personal data.
- Any claim of legal compliance for a specific country.

## Suggested next milestones

1. **Harden production deployment:** compose stack, S3 storage, shared rate limiting,
   backups, log aggregation.
2. **Improve scan coverage:** optional headless browser with the same SSRF and robots
   controls, plus scheduled rescans.
3. **Operational visibility:** global audit log, export history UI, worker health panel.
4. **Commercial readiness:** usage metering, tenant administration, SSO, i18n.
