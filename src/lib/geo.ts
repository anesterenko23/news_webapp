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
/** Short great-circle path, lifted above the sphere; also safe at antipodes. */
export function arcPoints(from: Coordinates, to: Coordinates, segments = 96) {
  const a = coordinateVector(from), b = coordinateVector(to);
  const angle = a.angleTo(b);
  const axis = new THREE.Vector3().crossVectors(a, b);
  if (axis.lengthSq() < 1e-10) axis.crossVectors(a, Math.abs(a.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
  axis.normalize();
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = i / segments;
    return a.clone().applyAxisAngle(axis, angle * t).multiplyScalar(1.009 + Math.sin(Math.PI * t) * (.05 + angle * .14));
  });
}
/** Fit all relationship endpoints in the usable area, including horizon clearance. */
export function eventCameraPosition(event: NewsEvent, verticalFov: number, aspect: number) {
  const direction = coordinateVector(event.coordinates);
  const angles = event.countries.map(code => direction.angleTo(coordinateVector(COUNTRIES[code].coordinates)));
  const extent = Math.min(THREE.MathUtils.degToRad(78), Math.max(...angles, .14));
  const vertical = THREE.MathUtils.degToRad(verticalFov / 2);
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  const usable = Math.min(vertical, horizontal) * .76;
  const distance = Math.max(2.6, Math.cos(extent) + Math.sin(extent) / Math.tan(usable), 1 / Math.cos(extent) + .15);
  return direction.multiplyScalar(Math.min(5.3, distance));
}
