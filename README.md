# World Lens — Phase 2.1

Interactive geographic news prototype built on the original Phase 1 globe. React, TypeScript, Three.js, React Three Fiber, Drei and HDR bloom.

## Run

Requires Node.js 22.12+ or Node.js 24. Internet is needed during initial asset preparation.

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

In restricted Windows sandboxes where esbuild cannot inspect parent directories, pass `-- --configLoader runner` to test/build/preview. The built preview is independent of the development dependency optimizer.

## Explore

- The initial view has no selected event and rotates automatically. The WebGL scene always fills the entire right-hand area. The compact event card floats over its lower edge and never changes canvas dimensions.
- Select one of 24 demo stories to frame its countries, highlight their actual outlines, show all its relationships and open the details panel.
- Categories filter the feed without resetting the camera or remounting the scene. A filtered-out selection remains open until another story is selected or the panel is closed.
- Re-selecting the same story preserves the current camera position. “View on globe” deliberately recenters it.
- Drag and scroll remain available while a story is selected. Manual dragging interrupts camera travel. Auto-rotation stays paused until the story is closed, then resumes gradually after three seconds.
- Hover over a highlighted country to see its name and all its roles in the selected event. Tooltips ignore unrelated countries, hide during dragging, stay inside the viewport and never capture pointer input.
- Zoom and Reset View controls remain available. Direction arrows indicate one-way or two-way relationships; conflicts use dashed red arcs.
- On mobile the feed starts collapsed; “Latest News” opens it, and selecting a story closes it.
- Source links provide institutional background. All events, publication offsets and scenarios are illustrative; they are not claims of current news. Images are illustrative photographs.

No backend, news API, database or user account is included.

## Architecture

- `src/App.tsx`: single selected-event state, filter and mobile feed state.
- `src/components/NewsFeed.tsx`, `NewsFilters.tsx`, `NewsItem.tsx`: independent scrolling news feed and category selection.
- `src/components/NewsDetails.tsx`: selected story, participants, independent relationships and background link.
- `src/components/Globe.tsx`: original Earth materials, textures, atmosphere, city bloom, borders and controls, extended as `GlobeScene` with optional event layers. Memoized to isolate feed-only changes. Public ref exposes `zoom()`, `reset()` and `focus(event)`.
- `src/components/CountryHighlight.tsx`: country masks rasterized from Natural Earth polygons with translucent fills and exact outlines. Dateline-crossing rings are unwrapped, and polygon holes are retained.
- `src/components/RelationshipArcs.tsx`: thin great-circle arcs with elevation, directional markers and normal 3D occlusion.
- `src/components/RelationshipLegend.tsx`: shared relationship palette.
- `src/components/CountryTooltip.tsx`: a compact, cursor-following DOM tooltip; only its own state changes on pointer movement.
- `src/lib/countries.ts`: country hit testing against actual polygon rings, including holes and dateline handling.
- `src/lib/hover.ts`: relationship descriptions and viewport-clamped tooltip placement.
- `src/data/types.ts`: event contract, relationship colors and filter logic.
- `src/data/countries.ts`: geographic coordinates and ISO country identifiers, independently maintained from events.
- `src/data/events.ts`: replaceable sample catalogue; rendering logic does not depend on its IDs or headlines.
- `src/lib/geo.ts`: shared projection, spherical arcs and camera framing. Camera movement follows a spherical path, avoiding travel through the globe. A 46° field of view and projected-diameter calculation keep Earth at about 630–650 px on a 1648×928 desktop. Event framing uses a compromise country view with the same or slightly closer camera distance. Arc height and extent never influence camera distance; routes may be partially occluded or leave the frame.
- `src/lib/geo.test.ts`: data integrity, category filtering, multiple relationships, arc altitude, dateline/antipodal safety, camera framing and horizon visibility on desktop and portrait layouts. Additional tests cover full-sphere sizing and arc-independent camera scale in five real canvas sizes, country hit tests, multiple tooltip roles and edge placement (25 tests total).

Generated geometries, country-mask textures and scene resources are disposed when their layers unmount. Earth textures use the shared loader cache. Pixel ratio is capped at 1.75, night texture anisotropy at 8, and bloom uses no multisampling. WebGL is required.

## Assets

`npm ci` and the predev/prebuild hooks run `scripts/prepare-assets.mjs`. The essential 8K night atlas is committed in `public/textures/earth-lights-8k.jpg`. The script downloads other missing assets into ignored `public/textures/`. Assets are served locally at runtime; no remote photo or map requests are required while exploring. Retry with `npm run assets` if initial preparation fails.

- Earth day and elevation: NASA-derived imagery from [webgl-earth](https://github.com/turban/webgl-earth/tree/master/images).
- 8K Earth Night Map by [Solar System Scope / INOVE](https://www.solarsystemscope.com/textures/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), based on NASA imagery. The shader isolates the city emission, recolors it to warm gold and applies HDR bloom.
- Country boundaries: [world-atlas](https://github.com/topojson/world-atlas), based on public-domain [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/). Geographic reference boundaries are not a statement on territorial claims.
- Illustrative news photographs: [Unsplash](https://unsplash.com/license); image source IDs are recorded in the asset preparation script. They do not depict the fictional scenarios.
- Country flag images: [FlagCDN](https://flagcdn.com/), locally cached.

The provided mockup is a design reference, not a background image. The globe remains a real, interactive 3D scene.

## Phase 3: Country Explorer

The header switches between News and Country Explorer without remounting the WebGL canvas. Country selection is tested against the complete Natural Earth territory surface, including islands, holes and the date line. Hover outlines and names are independent of event participation. Pointer movement beyond six pixels is treated as rotation, not selection. Country selection uses geographic focus coordinates and preserves the large globe framing; arcs never cause zooming out.

The generated `src/data/country-catalogue.json` maps all 241 map features to 240 countries/territories. Standard entries use ISO alpha-3 keys; map-only entities without ISO identifiers have explicit `MAP_` keys. Search uses English names, aliases and ISO codes. Regenerate with `node scripts/prepare-countries.mjs`. Metadata derives from [world-countries / mledoze countries](https://github.com/mledoze/countries), licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); the derived catalogue retains that license. Boundary data remains Natural Earth public-domain data.

`src/lib/relationships.ts` derives a relationship index from local event evidence. Identity includes ordered endpoints, category and direction; bilateral links canonicalize endpoint order. Events can support multiple relationships and each relationship retains multiple event IDs. Country statistics and related events are derived from this index and the same event catalogue. Nothing infers geopolitical relationships from missing data.

Country graphs show at most six relationships, ordered by evidence count, then event recency. Category filters apply before the cap; the full filtered list remains accessible and selecting a hidden item pins it into the visible six. An active relationship dims the other arcs and narrows evidence in the left panel. Selecting evidence opens the existing event overlay. Countries without recorded scenarios have an explicit empty state. Mode switches clear incompatible selections while retaining the camera and News category filter.

Verification includes 33 tests covering catalogue coverage, whole-territory picking, island polygons, aliases, relationship aggregation/direction, graph caps, drag rejection and large country camera framing, alongside existing News and globe tests.

## Phase 4: AI News Intelligence Engine

The existing globe and demo feed remain unchanged. A separate Fastify / TypeScript / Prisma / SQLite backend provides manual Mistral extraction, evidence validation, duplicate candidates, review decisions and budget accounting. Open http://127.0.0.1:3001/dev/ai-lab after `npm run db:migrate` and `npm run backend:start`.

See [backend/README.md](backend/README.md) for setup, architecture, API contracts, auth, model pricing, tests and limitations. Real API evaluation details are in [backend/EVALUATION.md](backend/EVALUATION.md). API keys, raw local runs and databases are excluded from Git.
