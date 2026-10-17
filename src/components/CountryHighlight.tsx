import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { feature } from 'topojson-client';
import topology from 'world-atlas/countries-50m.json';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { COUNTRIES } from '../data/countries';
import { RELATIONSHIP_STYLES, type NewsEvent } from '../data/types';
import { latLngToVector } from '../lib/geo';

const countryFeatures = feature(topology as unknown as Topology, topology.objects.countries as unknown as GeometryCollection).features;
// Unwrap dateline rings before rasterizing; shifted copies handle both map edges.
function unwrap(ring: number[][]) {
  let previous = ring[0][0];
  return ring.map(([longitude, latitude]) => {
    let lng = longitude;
    while (lng - previous > 180) lng -= 360;
    while (lng - previous < -180) lng += 360;
    previous = lng;
    return [lng, latitude];
  });
}
export function CountryHighlight({ event }: { event: NewsEvent }) {
  const layers = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4096; canvas.height = 2048;
    const context = canvas.getContext('2d')!;
    const lines: { geometry: THREE.BufferGeometry; color: string }[] = [];
    for (const code of event.countries) {
      const country = COUNTRIES[code];
      const participant = countryFeatures.find(item => Number(item.id) === Number(country.id));
      if (!participant?.geometry || !('coordinates' in participant.geometry)) continue;
      const relationship = event.relationships.find(link => link.to === code) ?? event.relationships.find(link => link.from === code);
      const color = RELATIONSHIP_STYLES[relationship?.type ?? 'other'].color;
      const polygons = participant.geometry.type === 'Polygon' ? [participant.geometry.coordinates] : participant.geometry.type === 'MultiPolygon' ? participant.geometry.coordinates : [];
      const vertices: number[] = [];
      context.fillStyle = color;
      for (const polygon of polygons) {
        const rings = polygon.map(ring => unwrap(ring));
        for (const shift of [-360, 0, 360]) {
          context.beginPath();
          for (const ring of rings) {
            ring.forEach(([lng, lat], i) => {
              const x = (lng + shift + 180) / 360 * canvas.width;
              const y = (90 - lat) / 180 * canvas.height;
              if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
            });
            context.closePath();
          }
          context.fill('evenodd');
        }
        for (const ring of rings) for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1], b = ring[i];
          const steps = Math.max(1, Math.ceil(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))));
          for (let j = 0; j < steps; j++) {
            const start = j / steps, end = (j + 1) / steps;
            vertices.push(...latLngToVector(a[1] + (b[1] - a[1]) * start, a[0] + (b[0] - a[0]) * start, 1.004).toArray(), ...latLngToVector(a[1] + (b[1] - a[1]) * end, a[0] + (b[0] - a[0]) * end, 1.004).toArray());
          }
        }
      }
      lines.push({ color, geometry: new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)) });
    }
    const texture = new THREE.CanvasTexture(canvas);
    return { texture, lines };
  }, [event]);
  useEffect(() => () => { layers.texture.dispose(); layers.lines.forEach(line => line.geometry.dispose()); }, [layers]);
  return <group>
    <mesh scale={1.0025} renderOrder={1}><sphereGeometry args={[1, 128, 96]}/><shaderMaterial transparent depthWrite={false} uniforms={{ mask: { value: layers.texture } }} vertexShader={'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}'} fragmentShader={'uniform sampler2D mask;varying vec2 vUv;void main(){vec4 c=texture2D(mask,vUv);if(c.a<.01)discard;gl_FragColor=vec4(pow(c.rgb,vec3(2.2)),c.a*.18);}'}/></mesh>
    {layers.lines.map((line, i) => <lineSegments key={i} geometry={line.geometry} renderOrder={2}><lineBasicMaterial color={line.color} transparent opacity={.9} depthWrite={false}/></lineSegments>)}
  </group>;
}
