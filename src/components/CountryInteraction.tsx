import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { COUNTRY_CODES } from '../data/countries';
import { countryAtUV, countryFeature, unwrapRing } from '../lib/countries';
import { latLngToVector } from '../lib/geo';
import type { GlobeHover } from '../lib/hover';
import { isCountryClick, type PointerStart } from '../lib/relationships';
function HoverOutline({ code }: { code: string }) {
  const geometry = useMemo(() => {
    const points: number[] = [];
    for (const polygon of countryFeature(code).geometry.coordinates) for (const raw of polygon) {
      const ring = unwrapRing(raw);
      for (let i = 1; i < ring.length; i++) points.push(...latLngToVector(ring[i-1][1], ring[i-1][0], 1.007).toArray(), ...latLngToVector(ring[i][1], ring[i][0], 1.007).toArray());
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  }, [code]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <lineSegments geometry={geometry}><lineBasicMaterial color="#a7cce8" transparent opacity={.75} depthWrite={false}/></lineSegments>;
}
export function CountryInteraction({ onSelect, onHover }: { onSelect: (code: string) => void; onHover: (hover: GlobeHover | null) => void }) {
  const { gl } = useThree();
  const [hovered, setHovered] = useState<string | null>(null);
  const start = useRef<PointerStart | null>(null);
  const moved = useRef(false);
  const clear = () => { setHovered(null); onHover(null); gl.domElement.style.cursor = ''; };
  useEffect(() => () => { gl.domElement.style.cursor = ''; onHover(null); }, [gl, onHover]);
  const at = (event: ThreeEvent<PointerEvent>) => event.uv ? countryAtUV(COUNTRY_CODES, event.uv.x, event.uv.y) : undefined;
  const move = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (event.buttons) {
      if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 6) moved.current = true;
      clear(); gl.domElement.style.cursor = 'grabbing'; return;
    }
    const code = at(event);
    setHovered(code ?? null);
    gl.domElement.style.cursor = code ? 'pointer' : '';
    onHover(code && event.pointerType !== 'touch' ? { code, x: event.clientX, y: event.clientY } : null);
  };
  return <group>
    <mesh scale={1.006} onPointerMove={move} onPointerOut={clear} onPointerDown={event => {
      event.stopPropagation(); start.current = event.button === 0 ? { x:event.clientX, y:event.clientY, id:event.pointerId } : null; moved.current = false; clear();
    }} onPointerUp={event => {
      event.stopPropagation(); const code = at(event);
      const valid = isCountryClick(start.current, { x:event.clientX, y:event.clientY, id:event.pointerId }, moved.current);
      start.current = null;
      if (valid && code) onSelect(code);
      move(event);
    }}><sphereGeometry args={[1,128,96]}/><meshBasicMaterial transparent opacity={0} colorWrite={false} depthWrite={false}/></mesh>
    {hovered && <HoverOutline code={hovered}/>}
  </group>;
}
