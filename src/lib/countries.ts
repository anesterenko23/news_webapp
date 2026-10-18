import { feature } from 'topojson-client';
import topology from 'world-atlas/countries-50m.json';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { COUNTRIES } from '../data/countries';
export const countryFeatures = feature(topology as unknown as Topology, topology.objects.countries as unknown as GeometryCollection).features;
export function unwrapRing(ring: number[][]) {
  let previous = ring[0][0];
  return ring.map(([longitude, latitude]) => {
    let lng = longitude;
    while (lng - previous > 180) lng -= 360;
    while (lng - previous < -180) lng += 360;
    previous = lng;
    return [lng, latitude];
  });
}
export function countryFeature(code: string) {
  const matches = countryFeatures.filter(item => COUNTRIES[code].mapNames.includes((item.properties as { name?: string })?.name ?? ''));
  const coordinates = matches.flatMap(item => item.geometry.type === 'Polygon' ? [item.geometry.coordinates] : item.geometry.type === 'MultiPolygon' ? item.geometry.coordinates : []);
  return { geometry: { type: 'MultiPolygon' as const, coordinates } };
}
type Polygon = number[][][];
const polygonCache = new Map<string, Polygon[]>();
function polygonsFor(code: string): Polygon[] {
  const cached = polygonCache.get(code); if (cached) return cached;
  const geometry = countryFeature(code).geometry;
  const polygons = geometry.coordinates;
  const unwrapped = polygons.map(polygon => polygon.map(unwrapRing));
  polygonCache.set(code, unwrapped);
  return unwrapped;
}
const boundsCache = new WeakMap<number[][], { minX: number; maxX: number; minY: number; maxY: number }>();
function insideRing(lng: number, lat: number, ring: number[][]) {
  let x = lng;
  while (x - ring[0][0] > 180) x -= 360;
  while (x - ring[0][0] < -180) x += 360;
  let bounds = boundsCache.get(ring);
  if (!bounds) { bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }; for (const [px, py] of ring) { bounds.minX = Math.min(bounds.minX, px); bounds.maxX = Math.max(bounds.maxX, px); bounds.minY = Math.min(bounds.minY, py); bounds.maxY = Math.max(bounds.maxY, py); } boundsCache.set(ring, bounds); }
  if (x < bounds.minX || x > bounds.maxX || lat < bounds.minY || lat > bounds.maxY) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && x < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** UV comes from the actual front sphere hit, so rear countries never hover. */
export function countryAtUV(codes: readonly string[], u: number, v: number) {
  const lng = u * 360 - 180, lat = v * 180 - 90;
  return codes.find(code => polygonsFor(code).some(polygon => insideRing(lng, lat, polygon[0]) && !polygon.slice(1).some(hole => insideRing(lng, lat, hole))));
}
