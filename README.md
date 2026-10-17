# World Lens — Phase 2

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

- The initial view has no selected event and rotates automatically.
- Select one of eight demo stories to frame its countries, highlight their actual outlines, show all its relationships and open the details panel.
- Categories filter the feed without resetting the camera or remounting the scene. A filtered-out selection remains open until another story is selected or the panel is closed.
- Re-selecting the same story preserves the current camera position. “View on globe” deliberately recenters it.
- Drag and scroll remain available while a story is selected. Manual dragging interrupts camera travel. Auto-rotation stays paused until the story is closed, then resumes gradually after three seconds.
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
- `src/data/types.ts`: event contract, relationship colors and filter logic.
- `src/data/countries.ts`: geographic coordinates and ISO country identifiers, independently maintained from events.
- `src/data/events.ts`: replaceable sample catalogue; rendering logic does not depend on its IDs or headlines.
- `src/lib/geo.ts`: shared projection, spherical arcs and camera framing. Camera movement follows a spherical path, avoiding travel through the globe.
- `src/lib/geo.test.ts`: data integrity, category filtering, multiple relationships, arc altitude, dateline/antipodal safety, camera framing and horizon visibility on desktop and portrait layouts.

Generated geometries, country-mask textures and scene resources are disposed when their layers unmount. Earth textures use the shared loader cache. Pixel ratio is capped at 1.75, night texture anisotropy at 8, and bloom uses no multisampling. WebGL is required.

## Assets

`npm ci` and the predev/prebuild hooks run `scripts/prepare-assets.mjs`. The essential 8K night atlas is committed in `public/textures/earth-lights-8k.jpg`. The script downloads other missing assets into ignored `public/textures/`. Assets are served locally at runtime; no remote photo or map requests are required while exploring. Retry with `npm run assets` if initial preparation fails.

- Earth day and elevation: NASA-derived imagery from [webgl-earth](https://github.com/turban/webgl-earth/tree/master/images).
- 8K Earth Night Map by [Solar System Scope / INOVE](https://www.solarsystemscope.com/textures/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), based on NASA imagery. The shader isolates the city emission, recolors it to warm gold and applies HDR bloom.
- Country boundaries: [world-atlas](https://github.com/topojson/world-atlas), based on public-domain [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/). Geographic reference boundaries are not a statement on territorial claims.
- Illustrative news photographs: [Unsplash](https://unsplash.com/license); image source IDs are recorded in the asset preparation script. They do not depict the fictional scenarios.
- Country flag images: [FlagCDN](https://flagcdn.com/), locally cached.

The provided mockup is a design reference, not a background image. The globe remains a real, interactive 3D scene.
