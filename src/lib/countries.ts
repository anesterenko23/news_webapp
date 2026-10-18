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
type Polygon = number[][][];
const polygonCache = new Map<string, Polygon[]>();
function polygonsFor(code: string): Polygon[] {
  const cached = polygonCache.get(code); if (cached) return cached;
  const geometry = countryFeatures.find(item => Number(item.id) === Number(COUNTRIES[code].id))?.geometry;
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const unwrapped = polygons.map(polygon => polygon.map(unwrapRing));
  polygonCache.set(code, unwrapped);
  return unwrapped;
}
function insideRing(lng: number, lat: number, ring: number[][]) {
  let x = lng;
  while (x - ring[0][0] > 180) x -= 360;
  while (x - ring[0][0] < -180) x += 360;
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
