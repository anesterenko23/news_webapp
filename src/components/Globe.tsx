import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { forwardRef, memo, useCallback, useEffect, useLayoutEffect, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { mesh } from 'topojson-client';
import countries from 'world-atlas/countries-50m.json';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { NewsEvent } from '../data/types';
import { latLngToVector, eventCameraPosition, sphereFitDistance } from '../lib/geo';
import { CountryHighlight } from './CountryHighlight';
import { RelationshipArcs } from './RelationshipArcs';
import { CountryTooltip, type CountryTooltipHandle } from './CountryTooltip';
import type { CountryHover } from '../lib/hover';
export { latLngToVector } from '../lib/geo';

export interface GlobeHandle { zoom: (factor: number) => void; reset: () => void; focus: (event: NewsEvent) => void }
const HOME = new THREE.Vector3(3.2, 1.9, -0.8).normalize().multiplyScalar(3.35);
const CAMERA_OPTIONS = { position: HOME.toArray(), fov: 38, near: .05, far: 120 };
const MIN_DISTANCE = 1.55;
const asset = (name: string) => `${import.meta.env.BASE_URL}textures/${name}`;
function Linework() {
  const borders = useMemo(() => {
    const topology = countries as unknown as Topology<{ countries: GeometryCollection }>;
    const outline = mesh(topology, topology.objects.countries);
    const points: number[] = [];
    for (const line of outline.coordinates) for (let i = 1; i < line.length; i++) {
      points.push(...latLngToVector(line[i - 1][1], line[i - 1][0], 1.0015).toArray(), ...latLngToVector(line[i][1], line[i][0], 1.0015).toArray());
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  }, []);
  const grid = useMemo(() => {
    const points: number[] = [];
    const segment = (a: THREE.Vector3, b: THREE.Vector3) => points.push(...a.toArray(), ...b.toArray());
    for (let lat = -75; lat <= 75; lat += 15) for (let lng = -180; lng < 180; lng += 2) segment(latLngToVector(lat, lng, 1.002), latLngToVector(lat, lng + 2, 1.002));
    for (let lng = -180; lng < 180; lng += 15) for (let lat = -90; lat < 90; lat += 2) segment(latLngToVector(lat, lng, 1.002), latLngToVector(lat + 2, lng, 1.002));
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  }, []);
  useEffect(() => () => { borders.dispose(); grid.dispose(); }, [borders, grid]);
  return <><lineSegments geometry={borders}><lineBasicMaterial color="#8eabbc" transparent opacity={0.15} depthWrite={false}/></lineSegments><lineSegments geometry={grid}><lineBasicMaterial color="#6a9cb7" transparent opacity={0.055} depthWrite={false}/></lineSegments></>;
}
const vertexShader = `varying vec2 vUv; varying vec3 vNormal; varying vec3 vPosition;
void main(){vUv=uv; vNormal=normalize(normalMatrix*normal);vec4 p=modelViewMatrix*vec4(position,1.);vPosition=p.xyz;gl_Position=projectionMatrix*p;}`;
const fragmentShader = `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D bumpMap;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

// The night atlas contains blue terrain as well as city lights. Isolate warm
// emission so increasing the lights never makes the ocean or ice glow.
float cityEmission(vec2 uv) {
  vec3 night = texture2D(nightMap, uv).rgb;
  return max(night.r - night.b - .004, 0.);
}
void main() {
  vec3 day = texture2D(dayMap, vUv).rgb;
  float land = dot(day, vec3(.299, .587, .114));
  vec3 base = mix(vec3(.018, .046, .075), vec3(.135, .205, .285), smoothstep(.09, .48, land));
  float relief = texture2D(bumpMap, vUv).r;
  base = mix(base, vec3(land * .46, land * .61, land * .78), .42);
  base = mix(base, day * vec3(.48, .58, .72), .12);
  base += relief * .025;
  vec3 n = normalize(vNormal);
  float light = max(dot(n, normalize(vec3(-.65, .85, 1.))), 0.);
  // Composer outputs sRGB; convert the art-directed surface palette to linear.
  vec3 color = pow(base * (.28 + .56 * light), vec3(2.2));

  float city = cityEmission(vUv);
  // Preserve the atlas intensity range: thresholding it into a mask makes
  // dense urban regions merge into large, overexposed patches.
  // HDR emission feeds the screen-space bloom. Only city cores exceed the
  // bloom threshold; the surface, borders and atmosphere stay crisp.
  color += vec3(1., .77, .42) * pow(city, 1.05) * 2.0;

  float rim = pow(1. - max(dot(n, normalize(-vPosition)), 0.), 4.);
  color += pow(vec3(.08, .24, .48) * rim * .62, vec3(2.2));
  gl_FragColor = vec4(color, 1.);
}`;

function Earth({ onReady }: { onReady: () => void }) {
  const [day, night, bump] = useTexture([asset('earth-day.jpg'), asset('earth-lights-8k.jpg'), asset('earth-bump.jpg')]);
  const { gl } = useThree();
  useEffect(() => {
    night.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    night.needsUpdate = true;
  }, [night, gl]);
  const uniforms = useMemo(() => ({dayMap:{value:day},nightMap:{value:night},bumpMap:{value:bump}}), [day,night,bump]);
  useEffect(onReady, [onReady]);
  return <group><mesh><sphereGeometry args={[1, 128, 96]}/><shaderMaterial uniforms={uniforms} vertexShader={vertexShader} fragmentShader={fragmentShader}/></mesh><Linework/><mesh scale={1.012}><sphereGeometry args={[1, 96, 64]}/><shaderMaterial transparent depthWrite={false} side={THREE.BackSide} blending={THREE.AdditiveBlending} vertexShader={`varying vec3 n;varying vec3 p;void main(){n=normalize(normalMatrix*normal);vec4 v=modelViewMatrix*vec4(position,1.);p=v.xyz;gl_Position=projectionMatrix*v;}`} fragmentShader={`varying vec3 n;varying vec3 p;void main(){float rim=pow(max(0.,1.+dot(normalize(n),normalize(-p))),3.);gl_FragColor=vec4(pow(vec3(.18,.41,.78),vec3(2.2)),rim*.38);}`}/></mesh></group>;
}
function Controller({ api, selected }: { api: React.ForwardedRef<GlobeHandle>; selected: NewsEvent | null }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, gl, size } = useThree();
  const lastInteraction = useRef(performance.now());
  const active = useRef(false);
  const targetDistance = useRef(HOME.length());
  const resetTarget = useRef<THREE.Vector3 | null>(null);
  const fitDistance = useRef(HOME.length());
  const previousLayout = useRef<{ id: string | undefined; width: number; height: number } | null>(null);
  const reducedMotion = useMemo(() => matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  useLayoutEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    perspective.fov = 38;
    perspective.updateProjectionMatrix();
    const fit = selected ? eventCameraPosition(selected, perspective.fov, size.width / size.height).length() : sphereFitDistance(perspective.fov, size.width / size.height);
    const previous = previousLayout.current;
    const changedEvent = previous?.id !== selected?.id;
    const resized = !previous || previous.width !== size.width || previous.height !== size.height;
    if (resized) {
      // Resize in the measured canvas coordinate system, preserving manual zoom.
      const ratio = previous ? camera.position.length() / fitDistance.current : 1;
      camera.position.setLength(fit * ratio);
      targetDistance.current = previous ? targetDistance.current / fitDistance.current * fit : fit;
      if (resetTarget.current) resetTarget.current.setLength(fit);
    }
    fitDistance.current = fit;
    if (changedEvent) {
      resetTarget.current = selected ? eventCameraPosition(selected, perspective.fov, size.width / size.height) : camera.position.clone().normalize().multiplyScalar(fit);
      targetDistance.current = fit;
    }
    previousLayout.current = { id: selected?.id, width: size.width, height: size.height };
    lastInteraction.current = performance.now();
  }, [selected, camera, size.width, size.height]);
  const zoom = useCallback((factor: number) => {
    if (resetTarget.current) targetDistance.current = camera.position.length();
    resetTarget.current = null;
    targetDistance.current = THREE.MathUtils.clamp(targetDistance.current * factor, MIN_DISTANCE, Math.max(8, fitDistance.current * 2.4));
    lastInteraction.current = performance.now();
  }, [camera]);
  useImperativeHandle(api, () => ({
    zoom,
    reset() { targetDistance.current = fitDistance.current; resetTarget.current = HOME.clone().normalize().multiplyScalar(fitDistance.current); lastInteraction.current = performance.now(); },
    focus(event) { resetTarget.current = eventCameraPosition(event, (camera as THREE.PerspectiveCamera).fov, size.width / size.height); targetDistance.current = resetTarget.current.length(); lastInteraction.current = performance.now(); }
  }), [camera, size.width, size.height, zoom]);
  useFrame((_, delta) => {
    const control = controls.current;
    if (!control) return;
    if (resetTarget.current) {
      const target = resetTarget.current;
      const blend = reducedMotion ? 1 : 1 - Math.exp(-4 * Math.min(delta, .05));
      const direction = camera.position.clone().normalize();
      const rotation = new THREE.Quaternion().setFromUnitVectors(direction, target.clone().normalize());
      rotation.slerp(new THREE.Quaternion(), 1 - blend);
      const radius = THREE.MathUtils.lerp(camera.position.length(), target.length(), blend);
      camera.position.copy(direction.applyQuaternion(rotation).multiplyScalar(radius));
      if (camera.position.distanceTo(target) < .001) resetTarget.current = null;
    } else if (!active.current) camera.position.setLength(THREE.MathUtils.damp(camera.position.length(), targetDistance.current, 7, Math.min(delta, .05)));
    const elapsed = (performance.now() - lastInteraction.current) / 1000;
    control.autoRotate = !selected && !active.current && elapsed > 3 && !resetTarget.current && !reducedMotion;
    control.autoRotateSpeed = Math.min(.18, Math.max(0, (elapsed - 3) * .045));
  });
  useEffect(() => {
    const wheel = (event: WheelEvent) => { event.preventDefault(); zoom(Math.exp(THREE.MathUtils.clamp(event.deltaY, -300, 300) * .001)); };
    gl.domElement.addEventListener('wheel', wheel, { passive: false });
    return () => gl.domElement.removeEventListener('wheel', wheel);
  }, [gl, zoom]);
  return <OrbitControls ref={controls} enablePan={false} enableZoom={false} enableDamping dampingFactor={.065} rotateSpeed={.45} minDistance={MIN_DISTANCE} maxDistance={80} onStart={() => { active.current = true; resetTarget.current = null; }} onEnd={() => { active.current = false; lastInteraction.current = performance.now(); targetDistance.current = camera.position.length(); }}/>;
}
export const GlobeScene = memo(forwardRef<GlobeHandle, { onReady: () => void; selected: NewsEvent | null }>(function GlobeScene({ onReady, selected }, ref) {
  const tooltip = useRef<CountryTooltipHandle>(null);
  const onHover = useCallback((hover: CountryHover | null) => tooltip.current?.show(hover), []);
  return <div className="globe-canvas"><Canvas camera={CAMERA_OPTIONS} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }} fallback={<div className="scene-message">WebGL is required to explore the globe.</div>}><Earth onReady={onReady}/>{selected && <><CountryHighlight event={selected} onHover={onHover}/><RelationshipArcs relationships={selected.relationships}/></>}<Controller api={ref} selected={selected}/><EffectComposer multisampling={0}><Bloom luminanceThreshold={.8} luminanceSmoothing={.25} intensity={.70} mipmapBlur radius={.55}/></EffectComposer></Canvas><CountryTooltip ref={tooltip} event={selected}/></div>;
}));
