# Phase 5 architecture

CollectedArticle stores publisher/URL/ID, canonical URL, original title, nullable publication date, collection date, nullable author, language, content availability (full/excerpt/metadata_only/unavailable), content hash, original feed/Content API JSON, analysisStatus/analyzedAt/analysisBatchId/analysisVersion/analysisResultId.

NewsBatch → ordered BatchArticle membership; BatchReservation.articleId primary key prevents overlapping active packages. Creation/reservation is transactional. Automatic selection uses only collected, unreserved articles. Already analyzed articles are reprocessed through Replace Analysis on their existing batch. exportJson is an immutable snapshot; exported text is exactly the stored plain text, never rewritten by the exporter.

AnalysisImport stores immutable version/checksum and the FULL original uploaded rawJson string including formatting. ImportedEvent has unique(batchId,articleId,eventKey), raw event JSON, normalized fields and participant JSON. ImportedRelationship and ImportedEventSource are relational edges and Event↔Article links. Replacement updates matching event keys, archives removals and retains every old raw analysis. The original batch snapshot and an analysis revision suffice to rebuild normalized data without external analysis calls. No headline-based event merge.

Strict JSON Schemas plus backend relational checks enforce exact batch/article coverage, unique articleIds/eventKeys, valid ISO/name correspondence, countryCode=null for non-countries, endpoint membership, consistent outcomes, reviewReason for uncertainty and existing source references. All expected results are required. Missing results return IDs and titles. Unknown fields are rejected with paths. Import Preview shows counts and additions/updates/removals/publication changes. Confirmation rechecks content checksum and current version. All records and statuses are committed in one transaction or rolled back together.

analyzed requires events; no_relevant_events requires []; needs_review requires reviewReason and may have tentative events. Confirmation publishes analyzed events as manually accepted, Unverified. needs_review stays off the globe. Schema validity is not factual verification. Backend does not infer new meaning. Organization and unknown-direction links remain in JSON/database and do not become country arcs. Atlas-unsupported countries remain preserved in analysis.

## Original Phase 5 source review (superseded by Phase 5.1)

The current multi-source registry, collector and limits are described in [Phase 5.1](multi-source-collection.md). The following records the original single-source baseline.

Enabled: GOV.UK Atom https://www.gov.uk/search/news-and-communications.atom plus https://www.gov.uk/api/content/{path}. [Content API documentation](https://content-api.publishing.service.gov.uk/) and [reuse policy](https://www.gov.uk/help/reuse-govuk-content) permit reuse under OGL, except third-party material. Publisher attribution and source URLs are retained. API HTML body is converted to plain text at collection; raw API JSON is also stored. Full-text retrieval failure leaves the actual excerpt and its status. Unknown date/author stays null. Fixed publisher host, no redirects, 4MB source limit, timeouts, DTD rejection. Dedup uses canonical URL, publisher source ID or identical nonempty content hash within one publisher. Different publishers are not collapsed. Fetch News manually gets the current first 20 feed entries; no historical backfill or scheduler.

BBC, Reuters, AP, Guardian, EC and UN are not enabled pending individual endpoint/licensing/full-text review. No arbitrary-site scraping or paywall bypass.

## Removal and migration

Removed provider adapters, inference engine, model configurations/prompts, semantic extraction mapper, AI Lab, benchmark tooling/fixtures, token/cost endpoints, inference retries and AI environment variables. No LLM dependencies. Historical domain tables and their records remain untouched by the additive migration. Historical run/usage tables exist solely for data preservation, with no running service/endpoint. Globe uses only new imported events; old AI test events are not published. Existing domain validation/canonical utilities remain as historical domain support, not active inference infrastructure.

## Limits

Only one reviewed source ships initially. JSON validation cannot prove event truth. Non-country or unknown-direction links remain off country arcs. Missing publication date displays Date unknown. Collection paginates at 100 rows; packages max 20. Network globe feed needs deployment authentication configuration; default is loopback. Original source references are retained for every imported event. Multiple-article event sources are explicit, never automatically merged.
