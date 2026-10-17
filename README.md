# World Lens

Phase 1 of an interactive global news map: a standalone 3D Earth in the restrained dark style of the supplied reference. This phase deliberately contains no news feed, mock events, country selection or relationship arcs.

## Run

Requires Node.js 22.12+ (or Node.js 24).

```sh
npm ci
npm run dev
```

```sh
npm run build
npm run preview
```

In a restricted Windows sandbox where esbuild cannot inspect parent directories, use `npm run build -- --configLoader runner` and preview the built output with `npm run preview -- --configLoader runner`.

## Interaction

Drag to rotate, scroll to zoom, or use the + / − buttons. Reset returns smoothly to Europe and Africa. Rotation pauses during interaction and resumes gradually after three seconds. Reduced-motion preferences disable automatic rotation. Zoom is bounded. The layout adjusts its camera field of view for portrait displays.

## Structure

- `src/components/Globe.tsx`: independently reusable globe, surface shader, boundary/grid layers and camera controller. Exposes `zoom()` and `reset()` through its ref.
- `latLngToVector()`: shared geographic coordinate convention for future event layers.
- `src/App.tsx`: minimal responsive application shell.
- `world-atlas/countries-50m.json`: bundled Natural Earth boundaries.
- `public/textures`: local Earth assets; no runtime image API dependency. Textures are downloaded automatically by `npm ci` (internet required for initial preparation). `npm run assets` retries preparation when necessary.

Rendering uses React, TypeScript, Three.js, React Three Fiber and Drei. Pixel ratio is capped at 1.75 to limit GPU load on high-density displays. Generated line geometries are disposed on unmount; scene meshes and materials use Fiber's resource lifecycle. Textures are shared through Drei's loader cache. WebGL is required.

## Asset sources

- Earth day and elevation textures: NASA-derived imagery distributed by [webgl-earth](https://github.com/turban/webgl-earth/tree/master/images).
- Earth night imagery: [three-globe example assets](https://github.com/vasturiano/three-globe/tree/master/example/img), NASA Earth at Night imagery.
- Country boundaries: [world-atlas](https://github.com/topojson/world-atlas), derived from public-domain [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) cartography. Borders are geographic reference data and are not a statement on territorial claims.

The supplied mockup is a visual reference only; it is not included as a background or substituted for the live scene.
