# Known limitations

These are deliberate boundaries or environment constraints, not hidden defects. Where a
limitation affects a user decision, the UI is expected to say so honestly.

## Scanning

1. **No headless browser.** The scanner reads server-rendered HTML. A chat widget or
   WhatsApp button injected only by client-side JavaScript may not be seen. The result is
   reported as `Not detected in checked pages` or `Unknown`, never as a definitive
   absence outside a successful scan.
2. **Bounded page coverage.** Default `SCAN_MAX_PAGES=4`. The scanner prioritises the
   homepage and a few likely contact/about pages. Deep sites can hide details elsewhere.
3. **Bot protection and paywalls.** Cloudflare/WAF challenges, consent walls, CAPTCHAs,
   region blocks and login-only pages yield `partial`/`failed` scans. The app does not
   bypass them.
4. **`robots.txt` is respected.** Disallowed paths are skipped. A site that disallows its
   own homepage cannot be inspected, and the scan is honestly incomplete.
5. **Caching.** Results are reused for `SCAN_CACHE_DAYS` (default 7). A site can change
   between scans; use "Scan again" to force a fresh check.
6. **Per-process politeness state.** The per-host delay, robots cache and retry state are
   in memory. Running multiple worker processes can increase aggregate request rate to a
   host; the global queue still batches, but there is no shared rate limiter.
7. **No form submission.** Contact forms are detected, never filled in or submitted.
8. **No authenticated areas, no file downloads, no JavaScript execution.**

## Discovery

9. **Source coverage varies.** OpenStreetMap is community-maintained and incomplete in
   some areas/categories. The app does not fill gaps with invented records.
10. **Google Places is optional.** Without `GOOGLE_PLACES_API_KEY` the provider reports
    unavailable. When enabled, its terms and billing apply to your key.
11. **Google budget is advisory.** `GOOGLE_PLACES_DAILY_BUDGET` is shown in the provider
    description, but the current implementation does not persist a daily counter across
    processes. Treat it as documentation, not enforcement. See
    [DEFERRED.md](DEFERRED.md).
12. **Source terms are your responsibility.** The app sets a descriptive user agent,
    caches responses, and does not scrape aggressively, but you must confirm that each
    source's terms allow your use.

## Deduplication and normalisation

13. **Heuristics, not truth.** Duplicate decisions use phone, registrable domain, name
    similarity, street and distance. Ambiguous matches go to review; merges are
    reversible.
14. **Name similarity is locale-sensitive.** `pg_trgm` similarity works differently across
    scripts and transliterations. Non-Latin names may need manual review.
15. **Phone parsing needs a country hint.** International `+` numbers are reliable.
    National-format numbers without a country/region may stay invalid rather than be
    guessed.
16. **No fuzzy address geocoding.** Street comparison is normalised text; there is no
    external geocoder beyond what the source provides.

## Data and scoring

17. **Email/phone "verified" is manual.** The button records that a human verified the
    contact. It does not perform SMTP, carrier or deliverability checks.
18. **Scores are only as good as evidence.** Imported data without a scan can score
    contact/industry points but cannot earn scan-dependent points.
19. **Category list is fixed.** The profile has 18 categories plus "other". A custom
    taxonomy is not exposed in the UI.
20. **Profile changes are workspace-wide.** Recalculation can be expensive for very large
    lists; it runs as a job, not inline.

## Operations

21. **Local disk storage.** Uploads live in `STORAGE_DIR`. There is no S3 adapter; a
    multi-instance deployment needs shared storage.
22. **Synchronous CSV export.** The export is generated in the request and held in memory.
    Very large exports can hit time/memory limits; `export.generate` is reserved but not
    used yet.
23. **In-memory rate limits.** Limits are per process. Multiple web instances do not share
    counters.
24. **No built-in backup or retention.** PostgreSQL backups, upload cleanup and evidence
    retention are deployment responsibilities.
25. **Single region / no HA.** No replication, failover or queue sharding is configured.
26. **Live events use PostgreSQL `LISTEN/NOTIFY`.** Payloads over ~8 KB are truncated by
    design; clients refetch data after the signal. This is not a durable event log.
27. **One worker type.** Worker concurrency and scan concurrency are global settings; there
    is no per-workspace resource isolation.

## UI and testing

28. **English only.** No i18n framework or translated copy.
29. **Chromium-only browser tests.** Playwright runs Chromium. Firefox/WebKit are not in
    the matrix.
30. **No visual regression or automated accessibility audit.** Screenshots verify layout
    at three widths and two themes; they are not pixel-diff baselines. Keyboard focus and
    contrast were designed for but not machine-audited.
31. **One non-blocking lint warning.** TanStack Table's `useReactTable` cannot be safely
    memoized by the React Compiler. ESLint reports a warning; build and tests pass.
32. **Screenshots depend on the demo seed.** Running `pnpm screenshots` requires a
    production server and a freshly seeded demo workspace.

## Environment

33. **PostgreSQL version.** The Docker path pins PostgreSQL 16. The zero-Docker fallback
    used during this build installs a newer embedded major version. The schema and queries
    are compatible with 16+.
34. **`embedded-postgres` is a development convenience.** It is not intended as a
    production database.
35. **No Docker was available during the build.** The compose file was authored and
    reviewed but not executed on this machine; the equivalent schema and migrations were
    verified against the embedded instance.

## AI planning and maps

39. **Gemini, xAI Grok and Groq are optional assistants, not data sources.** They receive
    the user's message and return either a validated search plan (`intent`, city, an
    optional country, categories, a limit, a target provider) or plain-text guidance in
    `answer`. They cannot add businesses, contacts or websites. Without a key, the
    assistant says so and manual discovery remains available.
40. **Plans and advice can be imperfect.** The app validates and normalises the model's
    output (category aliases, 1-8 categories, 1-200 results). A missing city or an
    unsupported category produces a clarification reply, not a search. Advice is general:
    a plan may still be too broad or miss a niche category, and guidance cannot know a
    specific business's site or needs. Review the filters before running. A missing country
    is accepted and searched as a city name.
41. **Public Overpass is a shared, best-effort service.** It can take 30–60 seconds, return
    502 "at capacity", time out, or rate-limit. Discovery therefore reads the Nominatim POI
    index first and only tries Overpass when that index has no matches. Both are free,
    keyless community services; failures are reported honestly and nothing is saved.
42. **Map positions are source coordinates.** Leaflet/OpenStreetMap markers show where the
    source placed a business; they are not verified addresses. Tiles require internet
    access and are subject to the OpenStreetMap tile usage policy. Up to 200 mapped results
    are shown per run.
43. **Nominatim is rate-limited and keyword-based.** Geocoding and POI queries share a one
    request/second, per-process throttle with caching. Exact tag queries such as
    `[amenity=dentist]` are used inside the city box; categories without a reliable tag fall
    back to free-text search. Coverage is community-maintained and can be thinner in some
    areas. Set `GEOCODE_USER_AGENT` to a real contact before public use.
44. **Google Places result caps apply.** Text Search returns at most 20 places per request;
    the app does not paginate for more. Its terms and billing are the key owner's
    responsibility.
45. **AI model names and availability change.** Gemini retired `gemini-2.5-flash` for new
    keys during this build, newer Flash models can return 503 under load, and Groq's
    account-specific model list varies. Defaults are configurable via `GEMINI_MODEL`,
    `GROK_MODEL` and `GROQ_MODEL`; `auto` falls back to another configured planner and says
    so in the chat reply. General guidance and missing-city clarifications are returned
    immediately, so they do not trigger a provider retry. An explicitly selected planner
    that fails reports the upstream error rather than silently switching.
46. **Advice is not verified business intelligence.** The assistant can suggest categories,
    explain how scoring works and describe honest scan labels, but it cannot know whether a
    particular business has a website, chatbot, phone number or need. Chat replies are
    capped at 1,600 characters and should be treated as general guidance, not lead data.

## Product boundary

36. **No outreach is sent.** There is no email, SMS or WhatsApp integration, by design.
    Adding one would require a new compliance and consent review.
37. **No CRM sync.** CSV is the only export format. There are no webhooks or third-party
    CRM connectors.
38. **Demo workspace records are fictional.** They must never be contacted; the settings
    screen displays this warning.
