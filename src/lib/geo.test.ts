import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEMO_EVENTS } from '../data/events';
import { COUNTRIES } from '../data/countries';
import { filterEvents, RELATIONSHIP_STYLES } from '../data/types';
import { arcPoints, coordinateVector, eventCameraPosition, sphereFitDistance, arcHeight } from './geo';

describe('event catalogue and filters', () => {
  it('has 24 distinct, explicitly labelled demo events with valid relationships', () => {
    expect(DEMO_EVENTS).toHaveLength(24);
    expect(new Set(DEMO_EVENTS.map(event => event.id)).size).toBe(24);
    for (const event of DEMO_EVENTS) {
      expect(event.demo).toBe(true);
      expect(Number.isFinite(Date.parse(event.publishedAt))).toBe(true);
      if (event.source) expect(new URL(event.source.url).protocol).toBe('https:');
      for (const code of event.countries) expect(COUNTRIES[code]).toBeDefined();
      for (const link of event.relationships) {
        expect(event.countries).toContain(link.from);
        expect(event.countries).toContain(link.to);
        expect(RELATIONSHIP_STYLES[link.type]).toBeDefined();
      }
    }
  });
  it('filters primary categories without changing the source or active event', () => {
    const active = DEMO_EVENTS[0];
    expect(filterEvents(DEMO_EVENTS, 'all')).toBe(DEMO_EVENTS);
    expect(filterEvents(DEMO_EVENTS, 'trade')).toHaveLength(6);
    expect(filterEvents(DEMO_EVENTS, 'conflict')).toHaveLength(3);
    expect(filterEvents(DEMO_EVENTS, 'energy')).toHaveLength(3);
    expect(filterEvents(DEMO_EVENTS, 'military')).toHaveLength(6);
    expect(filterEvents(DEMO_EVENTS, 'diplomacy')).toHaveLength(6);
    expect(active.relationships.map(link => link.type)).toEqual(['military', 'conflict']);
  });
});
describe('spherical relationship geometry', () => {
  it('keeps every sampled arc above the globe and connects the actual endpoints', () => {
    for (const event of DEMO_EVENTS) for (const link of event.relationships) {
      const from = COUNTRIES[link.from].coordinates, to = COUNTRIES[link.to].coordinates;
      const points = arcPoints(from, to);
      expect(points[0].clone().normalize().distanceTo(coordinateVector(from))).toBeLessThan(1e-6);
      expect(points.at(-1)!.clone().normalize().distanceTo(coordinateVector(to))).toBeLessThan(1e-6);
      for (const point of points) expect(point.length()).toBeGreaterThan(1.008);
      expect(points[48].length()).toBeGreaterThan(points[0].length());
    }
  });
  it('handles date-line, coincident and antipodal endpoints without NaNs or jumps', () => {
    const dateLine = arcPoints({ lat: 0, lng: 179 }, { lat: 0, lng: -179 });
    expect(dateLine[48].clone().normalize().dot(coordinateVector({ lat: 0, lng: 180 }))).toBeCloseTo(1, 6);
    for (const pair of [[{ lat: 0, lng: 0 }, { lat: 0, lng: 180 }], [{ lat: 30, lng: 10 }, { lat: 30, lng: 10 }]]) {
      const points = arcPoints(pair[0], pair[1]);
      expect(points.every(point => point.toArray().every(Number.isFinite))).toBe(true);
      expect(points.at(-1)!.clone().normalize().distanceTo(coordinateVector(pair[1]))).toBeLessThan(1e-6);
    }
  });
});
describe('event framing', () => {
  it.each([[38, 1.6], [38, 1], [93, .52]])('frames all endpoints for FOV %s and aspect %s', (fov, aspect) => {
    const halfFov = THREE.MathUtils.degToRad(fov / 2);
    const halfAngle = Math.min(halfFov, Math.atan(Math.tan(halfFov) * aspect));
    for (const event of DEMO_EVENTS) {
      const camera = eventCameraPosition(event, fov, aspect);
      const direction = camera.clone().normalize();
      expect(camera.length()).toBeGreaterThanOrEqual(sphereFitDistance(fov, aspect) - 1e-6);
      expect(camera.length()).toBeLessThanOrEqual(30);
      for (const code of event.countries) {
        const point = coordinateVector(COUNTRIES[code].coordinates);
        const cosine = direction.dot(point);
        expect(cosine).toBeGreaterThan(1 / camera.length());
        const projected = Math.sqrt(1 - cosine * cosine) / (camera.length() - cosine);
        expect(projected).toBeLessThan(Math.tan(halfAngle) * .85);
      }
    }
  });
});

describe('container-based globe fitting', () => {
  it.each([[1440, 800], [570, 290], [390, 450], [390, 760], [1024, 230]])('fits the complete atmosphere in a %sx%s canvas', (width, height) => {
    const halfVertical = THREE.MathUtils.degToRad(19);
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * width / height);
    const halfAngle = Math.min(halfVertical, halfHorizontal);
    const distance = sphereFitDistance(38, width / height);
    expect(Math.asin(1.025 / distance)).toBeLessThan(halfAngle);
    for (const event of DEMO_EVENTS) {
      const camera = eventCameraPosition(event, 38, width / height);
      expect(Math.asin(1.025 / camera.length())).toBeLessThan(halfAngle);
      const direction = camera.clone().normalize();
      for (const link of event.relationships) for (const point of arcPoints(COUNTRIES[link.from].coordinates, COUNTRIES[link.to].coordinates)) {
        const axial = point.dot(direction);
        const radial = Math.sqrt(Math.max(0, point.lengthSq() - axial * axial));
        expect(radial / (camera.length() - axial)).toBeLessThan(Math.tan(halfAngle));
      }
    }
  });
  it('raises longer routes further while bounding their maximum elevation', () => {
    expect(arcHeight(.2)).toBeGreaterThan(.10);
    expect(arcHeight(1.5)).toBeGreaterThan(arcHeight(.2));
    expect(arcHeight(Math.PI)).toBeLessThanOrEqual(.55);
  });
});
