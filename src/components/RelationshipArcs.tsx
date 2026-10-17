import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { COUNTRIES } from '../data/countries';
import { RELATIONSHIP_STYLES, type Relationship } from '../data/types';
import { arcPoints } from '../lib/geo';
function RelationshipArc({ relationship }: { relationship: Relationship }) {
  const points = useMemo(() => arcPoints(COUNTRIES[relationship.from].coordinates, COUNTRIES[relationship.to].coordinates), [relationship]);
  const { color } = RELATIONSHIP_STYLES[relationship.type];
  const arrows = useMemo(() => (relationship.bidirectional ? [.25, .75] : [.72]).map((t, i) => {
    const index = Math.floor(t * (points.length - 1));
    const direction = points[index + 1].clone().sub(points[index - 1]).normalize();
    if (relationship.bidirectional && i === 0) direction.negate();
    return { position: points[index], quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction) };
  }), [points, relationship.bidirectional]);
  return <group>
    <Line points={points} color={color} lineWidth={1.5} transparent opacity={.95} dashed={relationship.type === 'conflict'} dashSize={.028} gapSize={.016}/>
    {arrows.map((arrow, i) => <mesh key={i} position={arrow.position} quaternion={arrow.quaternion}><coneGeometry args={[.008, .027, 8]}/><meshBasicMaterial color={color}/></mesh>)}
    {[points[0], points[points.length - 1]].map((point, i) => <mesh key={i} position={point}><sphereGeometry args={[.006, 12, 8]}/><meshBasicMaterial color={color}/></mesh>)}
  </group>;
}
export function RelationshipArcs({ relationships }: { relationships: readonly Relationship[] }) {
  return <group>{relationships.map(link => <RelationshipArc key={`${link.from}-${link.to}-${link.type}`} relationship={link}/>)}</group>;
}
