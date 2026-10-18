# Manual news backend

Configuration: DATABASE_URL, HOST, PORT, NODE_ENV, ADMIN_API_TOKEN. No AI keys required. Back up SQLite before npm run db:migrate. All mutations require X-World-Lens-Client: collection. Network mode requires Authorization: Bearer ADMIN_API_TOKEN. HTML is a public shell; network data endpoints remain authenticated.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /collection | News Collection, Batch History, Import Preview |
| GET | /api/sources | Enabled source / terms |
| POST | /api/collection/fetch | {sourceId:"govuk"}; up to 20 entries |
| GET | /api/collection | source,status,contentStatus,search,from,to,offset filters |
| GET | /api/collection/:id | Original stored content and source JSON |
| POST | /api/batches | {} auto-selection or {articleIds:[...]} |
| GET | /api/batches | History and counts |
| GET | /api/batches/:id | Articles and analysis revision references |
| GET | /api/batches/:id/export | Exact immutable export snapshot |
| POST | /api/import/preview | {rawJson,mode:"import" or "replace"} |
| POST | /api/import/confirm | {rawJson,mode,confirm:true,baseVersion,checksum} from preview |
| GET | /api/analyses/:id/raw | Exact original uploaded JSON |
| GET | /api/schemas/export | JSON Export Schema 1.0 |
| GET | /api/schemas/import | JSON Import Schema 1.0 |
| GET | /api/analysis-prompt | Permanent external ChatGPT prompt |
| GET | /api/globe/events | Published manual imports only |
| GET | /api/events | Same manual feed |
| GET | /api/countries/:code/events | ISO-2 or atlas ISO-3 filter |

Import is atomic. Checksums use deterministic object-key ordering; formatting differences do not duplicate records. Array order is significant. Changed analysis requires Replace Analysis. baseVersion and checksum are checked on confirmation. Event identity is batchId + articleId + eventKey. Removed events are archived. Additional sourceArticleIds must exist in this batch and include the owning article. No title-similarity merging. Original imported JSON revisions remain immutable.

## Phase 5.1 collection extension

See [full multi-source documentation](../docs/multi-source-collection.md). POST /api/collection/fetch now accepts sourceId/sourceIds, mode latest/historical, from/to, maxArticles, maxPages, requestBudget and resume. GET /api/sources includes persisted capabilities/status; POST /api/sources/:id toggles enabled. New GET /api/collection/stats, /api/collection/runs, /api/collection/schedule. Collection adds region/topic/relevance filters and sort priority/newest/oldest/collected/source. Automatic collection defaults false; COLLECTION_INTERVAL_MINUTES=30, COLLECTION_REQUEST_BUDGET=150, COLLECTION_MAX_ARTICLES=200. No analysis or publication is scheduled.
