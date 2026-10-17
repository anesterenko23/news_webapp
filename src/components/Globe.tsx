import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { mesh } from 'topojson-client';
import countries from 'world-atlas/countries-50m.json';
import type { Topology, GeometryCollection } from 'topojson-specification';

export interface GlobeHandle { zoom: (factor: number) => void; reset: () => void }
const HOME = new THREE.Vector3(3.2, 1.9, -0.8).normalize().multiplyScalar(3.35);
const MIN_DISTANCE = 1.55;
const MAX_DISTANCE = 5.3;
const asset = (name: string) => `${import.meta.env.BASE_URL}textures/${name}`;
/** Geographic convention used by borders, textures and future event layers. */
export function latLngToVector(lat: number, lng: number, radius = 1): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(lat), theta = THREE.MathUtils.degToRad(lng);
  return new THREE.Vector3(radius * Math.cos(phi) * Math.cos(theta), radius * Math.sin(phi), -radius * Math.cos(phi) * Math.sin(theta));
}
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
  vec3 color = base * (.28 + .56 * light);

  float city = cityEmission(vUv);
  // Preserve the atlas intensity range: thresholding it into a mask makes
  // dense urban regions merge into large, overexposed patches.
  color += vec3(.95, .74, .43) * pow(city, .92) * .70;

  float rim = pow(1. - max(dot(n, normalize(-vPosition)), 0.), 4.);
  color += vec3(.08, .24, .48) * rim * .62;
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
  return <group><mesh><sphereGeometry args={[1, 128, 96]}/><shaderMaterial uniforms={uniforms} vertexShader={vertexShader} fragmentShader={fragmentShader}/></mesh><Linework/><mesh scale={1.012}><sphereGeometry args={[1, 96, 64]}/><shaderMaterial transparent depthWrite={false} side={THREE.BackSide} blending={THREE.AdditiveBlending} vertexShader={`varying vec3 n;varying vec3 p;void main(){n=normalize(normalMatrix*normal);vec4 v=modelViewMatrix*vec4(position,1.);p=v.xyz;gl_Position=projectionMatrix*v;}`} fragmentShader={`varying vec3 n;varying vec3 p;void main(){float rim=pow(max(0.,1.+dot(normalize(n),normalize(-p))),3.);gl_FragColor=vec4(.18,.41,.78,rim*.38);}`}/></mesh></group>;
}
function Controller({ api }: { api: React.ForwardedRef<GlobeHandle> }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, gl, size } = useThree();
  useEffect(() => { const perspective = camera as THREE.PerspectiveCamera; perspective.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(19)) / Math.min(1, size.width / size.height / 1.12))); perspective.updateProjectionMatrix(); }, [camera, size.width, size.height]);
  const lastInteraction = useRef(-10);
  const active = useRef(false);
  const targetDistance = useRef(HOME.length());
  const resetTarget = useRef<THREE.Vector3 | null>(null);
  const reducedMotion = useMemo(() => matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  useImperativeHandle(api, () => ({
    zoom(factor) { targetDistance.current = THREE.MathUtils.clamp(targetDistance.current * factor, MIN_DISTANCE, MAX_DISTANCE); lastInteraction.current = performance.now(); },
    reset() { targetDistance.current = HOME.length(); resetTarget.current = HOME.clone(); lastInteraction.current = performance.now(); }
  }), []);
  useFrame((_, delta) => {
    const control = controls.current;
    if (!control) return;
    if (resetTarget.current) {
      camera.position.lerp(resetTarget.current, 1 - Math.exp(-5 * delta));
      if (camera.position.distanceTo(resetTarget.current) < .001) resetTarget.current = null;
    } else if (!active.current) camera.position.setLength(THREE.MathUtils.damp(camera.position.length(), targetDistance.current, 7, delta));
    const elapsed = (performance.now() - lastInteraction.current) / 1000;
    control.autoRotate = !active.current && elapsed > 3 && !resetTarget.current && !reducedMotion;
    control.autoRotateSpeed = Math.min(.18, Math.max(0, (elapsed - 3) * .045));

  });
  useEffect(() => {
    const wheel = (e: WheelEvent) => {e.preventDefault(); resetTarget.current = null; lastInteraction.current = performance.now(); targetDistance.current = THREE.MathUtils.clamp(targetDistance.current * Math.exp(e.deltaY * .001), MIN_DISTANCE, MAX_DISTANCE);};
    gl.domElement.addEventListener('wheel', wheel, { passive: false });
    return () => gl.domElement.removeEventListener('wheel', wheel);
  }, [gl]);
  return <OrbitControls ref={controls} enablePan={false} enableZoom={false} enableDamping dampingFactor={.065} rotateSpeed={.45} minDistance={MIN_DISTANCE} maxDistance={MAX_DISTANCE} onStart={() => {active.current = true;resetTarget.current = null;}} onEnd={() => {active.current = false;lastInteraction.current = performance.now();targetDistance.current = camera.position.length();}}/>;
}
export const Globe = forwardRef<GlobeHandle, { onReady: () => void }>(function Globe({ onReady }, ref) {
  return <div className="globe-canvas"><Canvas camera={{ position: HOME.toArray(), fov: 38, near: .05, far: 30 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }} fallback={<div className="scene-message">WebGL is required to explore the globe.</div>}><Earth onReady={onReady}/><Controller api={ref}/></Canvas></div>;
});
