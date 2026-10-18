# Phase 5.1 — Multi-source collection

The existing collector/batch/import/globe pipeline is extended. No model APIs or paid news services are used. Analysis, batch creation, import and publication remain manual.

## Verified sources

Live verification on 18 October 2026 used the application's Node HTTP client, parsed actual XML and stored articles with original URLs. These are **11 enabled feeds from 8 publishers**, not 11 independent publishers. Regional feeds share the publisher identity for deduplication and batch balance.

| ID | Feed | Scope | Format | Content | History |
|---|---|---|---|---|---|
| bbc-world | https://feeds.bbci.co.uk/news/world/rss.xml | Global | RSS | Excerpt | No |
| bbc-africa | https://feeds.bbci.co.uk/news/world/africa/rss.xml | Africa | RSS | Excerpt | No |
| guardian-world | https://www.theguardian.com/world/rss | Global | RSS | Excerpt | No |
| guardian-americas | https://www.theguardian.com/world/americas/rss | Americas | RSS | Excerpt | No |
| dw-world | https://rss.dw.com/rdf/rss-en-world | Global | RSS | Excerpt | No |
| aljazeera | https://www.aljazeera.com/xml/rss/all.xml | Global | RSS | Excerpt | No |
| un-news | https://news.un.org/feed/subscribe/en/news/all/rss.xml | Global | RSS | Excerpt | No |
| cna-world | https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311 | Global | RSS | Excerpt | No |
| cna-asia | https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511 | Asia-Pacific | RSS | Excerpt | No |
| npr-world | https://feeds.npr.org/1004/rss.xml | Global | RSS | Excerpt | No |
| govuk-fcdo | https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=foreign-commonwealth-development-office | Foreign affairs | Atom + JSON API | Official full text when present; excerpt fallback | Yes |

Legacy `govuk` general domestic feed remains registered but is disabled by default. Its existing articles, batch and analysis survive. France 24's official https://www.france24.com/en/rss returned valid XML in the initial probe, but repeated collector runs received responses rejected as non-feed/DTD. It is disabled by default, with its last error visible. European Parliament returned an empty HTTP 202 bot-check response; IMF returned 403. Neither is configured as an active source. No restrictions were bypassed and no guessed alternative feeds were substituted.

## Source policies

Source Details exposes official endpoint, documentation, policy, publisher and capability metadata. The registry does not assume a commercial redistribution licence. The current app is a local personal reader. [Guardian](https://www.theguardian.com/help/feeds), [CNA](https://www.channelnewsasia.com/rss) and NPR's feed explicitly limit personal/non-commercial use. [BBC's official directory](https://support.bbc.co.uk/platform/feeds/NewsFeeds.htm) links publisher terms. Other feeds retain their publisher's restrictions. No third-party article pages are scraped, and `content:encoded` is not automatically treated as full article text. Publisher attribution and original URLs survive export/import.

GOV.UK alone uses its authorized [Content API](https://content-api.publishing.service.gov.uk/) under the [reuse policy](https://www.gov.uk/help/reuse-govuk-content), with OGL attribution and exceptions for third-party material. Missing body/error falls back to the actual excerpt. Missing dates/authors remain null. Raw original feed entry/API response is retained.

## Collection engine

Fixed source registry and adapters for RSS/Atom and official GOV.UK JSON search. Fetch all enabled, a single source, or selected source IDs. Maximum 3 workers, 15-second per-request timeout, at most 1 retry for retryable failures, 4 MB response limit, global request budget, and throttling by host. Retry-After beyond the short job window is respected by stopping that source. Redirects are revalidated against registered HTTPS hosts. User-supplied URLs, credentials, non-443 ports, IP literal hosts, private/reserved DNS results, DTD/entity declarations and malformed feeds are rejected. HTML bot pages are not successful feeds. No code from an article executes; all UI text is escaped.

One failed source does not roll back successful sources. CollectionRun persists run options and per-source results; NewsSourceState persists enabled status, attempts/success/error, ETag, Last-Modified and history checkpoint. Conditional requests are committed only when the complete feed window was traversed, so hitting a max-new limit cannot hide remaining entries behind a 304. A later fetch can collect those entries. The limit applies to **new** articles; existing duplicates do not consume it. Small per-source allocations may leave part of the user's total limit unused when another feed is short; the UI reports actual totals.

A token-owned database lease prevents overlapping manual/scheduled jobs across processes. It is renewed before remote requests. After a hard crash, a new process can resume once the lease expires (up to 10 minutes). Incomplete pages are replayed safely with deduplication; completed history pages resume from persisted offsets. The next run marks abandoned running jobs interrupted. Snapshot pagination can change if the upstream index changes between requests; duplicate protection is stable, but coverage is not an immutable upstream snapshot.

## Historical collection

Only GOV.UK supports history in this version. [Documented Search API](https://docs.publishing.service.gov.uk/repos/search-api/using-the-search-api.html): `https://www.gov.uk/api/search.json`, repeated `filter_format` parameters for news/press releases/speeches, FCDO organisation filter, inclusive `filter_public_timestamp=from:YYYY-MM-DD,to:YYYY-MM-DD`, `order=-public_timestamp`, `start`, `count=50`. It filters the source's public timestamp, which can reflect an updated publication, not an immutable first-publication date. Source dates are stored as supplied.

The user controls period, maximum new articles, maximum pages and request budget; progress is complete/partial with next offset. Latest-only RSS responds **Historical collection is not supported by this source.** without pretending that current-feed filtering is archive retrieval. A live historical test for 1–7 October 2026 stored 5 articles and correctly reported partial coverage at the requested maximum.

## Storage, filtering and batches

Additive extension to CollectedArticle: sourceId, publisher, canonicalUrl, description, categoriesJson, regionsJson, primaryRegion, priorityScore, relevanceHint, extractionMethod/extractionStatus. New tables: NewsSourceState, CollectionRun, CollectorLease. New indexes support source/date, region/date, analysis/priority and publisher/hash. Existing tables, IDs, analysisStatus and immutable raw analysis versions remain intact. Before migration a database backup was taken; preservation checks compare every row in prior batch/import/event tables, not just counts.

Collection dedup uses canonical URL, publisher GUID and exact normalized nonempty content hash. Independent publishers' reporting remains separate. Canonical URL has a unique database constraint; original URL and existing per-source GUID constraints remain. Headline resemblance never merges publications/events.

GET collection filters source, multi-label region/topic hints, publication dates (UTC), processing/content status and title/description search. Sorting: international priority (default), newest/oldest publication, recent collection, source; stable pagination at 100 rows. Null publication dates sort last. Topic/region JSON filters are scans; the integration suite verifies 2,200 rows, not arbitrary production-scale performance.

Hints use title, feed description and tags only. They do not use an AI model, classify confirmed events, infer relationships or assign participants. Iran uses Middle East, Mexico uses Latin America; unrecognized geography remains Unknown. Countries merely mentioned can add region hints; publisher location is never substituted. The rules are primarily English and have false positives/negatives. Gas in tear-gas reports and musical energy were corrected after sample inspection. Non-news genre terms lower priority without deleting articles.

Automatic Create Next Batch still creates at most 20 eligible articles, excluding analyzed/reviewed/reserved ones. It orders useful topical/content candidates, then round-robins publishers among the top 500 eligible candidates. Manual checkbox selection overrides balancing. Table filters affect table selection; to export those exact rows, select their checkboxes. The existing JSON Schema 1.0, immutable batches, exact raw JSON revisions, preview, replacement and idempotent import are unchanged.

## API and UI

- GET `/api/sources`: registry + persisted status, counts and capabilities.
- POST `/api/sources/:id`: `{enabled:boolean}`; registered IDs only.
- POST `/api/collection/fetch`: optional sourceId or sourceIds, mode latest/historical, from/to, maxArticles (1–2000), maxPages (1–20), requestBudget (1–500), resume. Defaults: all enabled, latest, 200 new, 5 pages, 150 requests.
- GET `/api/collection`: existing filters plus source ID, region, topic, relevance and sort; 100 rows per page.
- GET `/api/collection/stats`: article/status/source/publisher/region/topic counters, missingness and separate published-event count.
- GET `/api/collection/runs`: latest 20 persisted job records.
- GET `/api/collection/schedule`: effective background settings.

Existing client-header, loopback/origin and network-token checks apply. News Collection adds Fetch All/Selected/Source, enable/disable and source details, collection range/mode/max, statistics, region/topic/source/date filters and sorting. No new analytical dashboard or globe redesign.

## Scheduling

Default off. Enable `COLLECTION_AUTO_ENABLED=true`; interval `COLLECTION_INTERVAL_MINUTES=30` (minimum 10), `COLLECTION_REQUEST_BUDGET=150`, `COLLECTION_MAX_ARTICLES=200`. Settings are explicit environment configuration and survive restart. The timer waits for its first interval; manual fetch is always available. No batch creation, external analysis or publication is scheduled.

## Verification

48 backend tests + 33 frontend tests and both builds. Fixtures cover parsing, JSON API, mixed-source failures, GUID/URL/content dedup, independent publishers, missing dates/content, excerpt/full distinction, more than 20 entries, history/pagination/resume/budget, source state, ETag, lease exclusion, SSRF/redirect/size controls, 2,200 rows with filters/pagination, existing 20-article import contract and end-to-end Globe API. Core tests use mocked transport/DNS and require no third-party or model APIs.

Live detailed results and the quality assessment are in the Phase 5.1 output package. The audit deliberately reports unclassified/Other and Unknown rather than pretending every collected story is a confirmed international event.
