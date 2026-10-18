# World Lens — Phase 5.1

Interactive news globe and Country Explorer with a manual intelligence pipeline:

International RSS/Atom / official Content API → News Collection → JSON batch (1–20 articles) → external ChatGPT → validated import → globe.

No model clients, inference, API keys, cost tracking or AI Lab are part of the running application.

## Run

Node 22.18+. Run npm ci, copy backend/.env.example to backend/.env, then npm run db:migrate. Start npm run backend:dev and npm run dev in two terminals. Open http://127.0.0.1:5173/ and choose News Collection. Backend collection is also at http://127.0.0.1:3001/collection. Network mode requires a 32-character ADMIN_API_TOKEN; local defaults use loopback and origin checks.

1. Fetch News and select publications, or Create Batch (20) for the oldest unprocessed articles.
2. Export JSON from Batch History; repeat downloads return the stored snapshot.
3. Download the permanent ChatGPT prompt and send it with the export to external ChatGPT.
4. Upload the returned JSON, Validate & Preview, inspect counts/errors, Confirm Import.
5. Imported events appear on the globe. needs_review remains off the globe. Published does not mean independently verified.
6. Correct analysis using Replace Analysis on its original batch. Review added/updated/removed events and confirm. Previous original JSON versions remain downloadable in View Batch.

[Architecture / limits](docs/manual-pipeline.md) · [Permanent ChatGPT prompt](docs/chatgpt-analysis-prompt.txt) · [API](backend/README.md)

## Checks

npm run test:backend; npm test -- --configLoader runner; npm run backend:build; npm run build -- --configLoader runner.

The additive migration preserves all historical domain data. Old test events are not automatically published. Globe materials, textures, territory picking and camera framing are retained.

## Multi-source collection (Phase 5.1)

News Collection supports Fetch All / Selected / Source, enable/disable, historical GOV.UK retrieval, source status, region/topic/relevance filters and priority sorting. Default sources: 11 verified feeds from 8 publishers; general GOV.UK and unstable France 24 are disabled by default. Original articles and the existing 20-article analysis contract are preserved. Automatic collection stays OFF unless COLLECTION_AUTO_ENABLED=true is explicitly configured.

[Sources, API, scheduling, migration and limits](docs/multi-source-collection.md). Topic/region hints are deterministic organizational aids, not confirmed events or relationships.
