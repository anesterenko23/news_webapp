import * as THREE from 'three';
import type { Coordinates, NewsEvent } from '../data/types';
import { COUNTRIES } from '../data/countries';
/** World-atlas, texture UVs and event layers share this geographic convention. */
export function latLngToVector(lat: number, lng: number, radius = 1): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(lat), theta = THREE.MathUtils.degToRad(lng);
  return new THREE.Vector3(radius * Math.cos(phi) * Math.cos(theta), radius * Math.sin(phi), -radius * Math.cos(phi) * Math.sin(theta));
}
export function coordinateVector(point: Coordinates, radius = 1) {
  return latLngToVector(point.lat, point.lng, radius);
}
/** A raised arch, with more clearance for long routes and a restrained cap. */
export function arcHeight(angle: number) {
  return Math.min(.55, .10 + angle * .20);
}
/** Solve projected sphere diameter as a fraction of the smaller canvas axis. */
export function sphereFitDistance(verticalFov: number, aspect: number, radius = 1.025, coverage = aspect < .8 ? .90 : .77) {
  const vertical = THREE.MathUtils.degToRad(verticalFov / 2);
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(.05, aspect));
  const tangent = Math.tan(Math.min(vertical, horizontal));
  return radius * Math.sqrt(1 + 1 / Math.pow(tangent * coverage, 2));
}
/** Short great-circle path, lifted above the sphere; also safe at antipodes. */
export function arcPoints(from: Coordinates, to: Coordinates, segments = 96) {
  const a = coordinateVector(from), b = coordinateVector(to);
  const angle = a.angleTo(b);
  const axis = new THREE.Vector3().crossVectors(a, b);
  if (axis.lengthSq() < 1e-10) axis.crossVectors(a, Math.abs(a.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
  axis.normalize();
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = i / segments;
    return a.clone().applyAxisAngle(axis, angle * t).multiplyScalar(1.009 + Math.sin(Math.PI * t) * arcHeight(angle));
  });
}
/** A compromise surface view; arc height and extent never change camera scale. */
export function eventViewDirection(event: NewsEvent) {
  const points = event.countries.map(code => coordinateVector(COUNTRIES[code].coordinates));
  const candidates = [coordinateVector(event.coordinates), points.reduce((sum, point) => sum.add(point), new THREE.Vector3())];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) candidates.push(points[i].clone().add(points[j]));
  const valid = candidates.filter(point => point.lengthSq() > 1e-8).map(point => point.normalize());
  return valid.reduce((best, candidate) => {
    const extent = Math.max(...points.map(point => candidate.angleTo(point)));
    const bestExtent = Math.max(...points.map(point => best.angleTo(point)));
    return extent < bestExtent ? candidate : best;
  });
}
export function eventCameraPosition(event: NewsEvent, verticalFov: number, aspect: number) {
  const direction = eventViewDirection(event);
  const extent = Math.max(...event.countries.map(code => direction.angleTo(coordinateVector(COUNTRIES[code].coordinates))));
  // Nearby participants get a gentle approach; wide pairs keep the large base
  // view. Never zoom out to frame the whole route, including its hidden part.
  const coverage = aspect < .8 ? (extent < 1 ? .92 : .90) : (extent < 1 ? .79 : .77);
  return direction.multiplyScalar(sphereFitDistance(verticalFov, aspect, 1.025, coverage));
}
