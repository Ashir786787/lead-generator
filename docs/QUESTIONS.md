# Questions and assumptions

The brief referred to `docs/SPEC.md` and `docs/reference.png`. Neither file was present
in the workspace at any point during the build, and the repository started empty. The
implementation therefore follows the written brief plus the documented defaults below.
If the missing files become available, compare them against this list first.

## Unresolved inputs

| Input | Status | Effect |
| --- | --- | --- |
| `docs/SPEC.md` | **Missing** | The written brief was used as the source of truth for scope, data rules, phases and acceptance. |
| `docs/reference.png` | **Missing** | Visual design follows the brief (warm off-white, forest green, amber, responsive, light/dark) rather than a pixel reference. |

**Question:** can you provide these two files? If they contain requirements that differ
from the defaults below, the affected areas should be revised and the audit re-run.

## Product and branding

1. **App name** — default `Lead Finder`, configurable via `NEXT_PUBLIC_APP_NAME`.
   Should the shipped name or logo be different?
2. **Demo credentials** — fixed at `demo@leadfinder.example` /
   `demo-password-123` for local review only. Should these be randomised or omitted from
   documentation in a public release?
3. **Language** — UI copy is English. Is another locale required?

## Scope and data

4. **Country / legal claims** — the brief asked for no hardcoded country legal claims.
   The product contains a neutral outreach checklist and no jurisdiction-specific legal
   advice. Is a specific jurisdiction's compliance guidance expected later?
5. **Lead categories** — the fixed category keys are restaurant, cafe, clinic, dentist,
   salon, spa, gym, hotel, real estate, law firm, accounting, education, ecommerce,
   retail, automotive, construction, travel and other. Are these the right buckets for
   the target market?
6. **Scoring weights** — the default profile totals 100 with industry fit 30, website
   inspected 15, no chatbot 20, WhatsApp-without-chatbot 5, contact channels 20 and
   inquiry interaction 10. Should any weight change for the first real campaign?
7. **Expected volume** — the UI and export are designed for thousands of leads per
   workspace. Is a materially larger dataset (hundreds of thousands) expected? That would
   justify server-side export jobs and additional indexes.

## Sources and scanning

8. **Google Places** — the provider is implemented but reports unavailable until
   `GOOGLE_PLACES_API_KEY` is set. Do you have a key and a budget policy to enable it?
9. **OpenStreetMap** — the public Overpass endpoint is the default. For heavy use, a
   self-hosted or commercial Overpass instance is advisable. Do you have one? If you have
   a reliable mirror URL, add it to `OVERPASS_ENDPOINTS`.
10. **Gemini / Grok / Groq** — all three planners are implemented. Gemini and Groq were
    configured and verified live during the build; xAI Grok remains available but needs a
    `GROK_API_KEY`. Which accounts should be the long-term defaults, and is there a spend
    cap or preferred model? `auto` currently prefers Groq (fastest), then Gemini, then
    Grok, and falls back when one fails.
11. **Map preview** — the app uses Leaflet with public OpenStreetMap tiles and Nominatim
    geocoding. For high-traffic deployment, should tiles/geocoding move to a paid provider
    or a self-hosted instance? Set `GEOCODE_USER_AGENT` to a real contact either way.
12. **Scan depth** — default is 4 pages per site, 7-day cache, 1 request/second/host.
    Should the scanner look at more pages (for example team/about/contact) or fewer?
13. **Outreach** — the app intentionally contains no email/SMS/WhatsApp sending. Confirm
    this remains a hard boundary (it is implemented as one).
14. **Robots policy** — disallowed paths are skipped and the scan is marked partial or
    incomplete. Should the product instead refuse to scan any site whose `robots.txt`
    disallows the homepage?

## Operations

13. **Deployment** — is the target a Docker host with a separate worker process, or a
    platform with managed PostgreSQL? The worker must run as its own long-lived process.
14. **Storage** — uploads are stored on local disk (`STORAGE_DIR`). Is S3-compatible
    object storage required for production?
15. **Backups / retention** — no retention policy is implemented for import files, scan
    evidence or export rows. What retention period is required?
16. **Multi-user roles** — the schema has membership roles and `/settings` can add a
    member; role editing/removal is not exposed yet. Should role administration ship now?
17. **Auth providers** — email + password only. Is SSO or magic-link login required?

## Defaults chosen in the absence of a spec

| Area | Default |
| --- | --- |
| Auth | Email + password; first-run setup; signup disabled unless `ALLOW_SIGNUP=true` |
| Demo data | Only in the `Demo (fictional)` workspace via `pnpm seed:demo` |
| Scanner | SSRF protection always on; test escape hatch never allowed in production |
| Scoring | 100-point profile above; failed/partial scans award no scan-dependent points |
| Export | CSV generated synchronously and recorded in `export_jobs` |
| Duplicates | Review before merge; merge is reversible; no automatic destructive merge |
| Jobs | pg-boss with explicit queue creation; worker separate from web process |
| Storage | Local disk under `.data/storage` |
| Theme | Light/dark/system stored in `localStorage` under `lf-theme` |
| Screenshots | Production build, demo workspace only, 1440/1024/390, light/dark |

## How to answer

Any answer that changes a default should be paired with a scope note (which phases and
acceptance checks are affected). Missing answers do not block local use; the defaults are
functional and documented.
