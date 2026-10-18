import { useMemo, useRef } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { COUNTRIES } from '../data/countries';
import { RELATIONSHIP_STYLES, type Relationship } from '../data/types';
import { arcPoints } from '../lib/geo';
import { relationshipId, isCountryClick, type PointerStart } from '../lib/relationships';
import type { GlobeHover } from '../lib/hover';
interface Props { relationship: Relationship; selectedId?: string | null; onSelect?: (id: string) => void; onHover?: (hover: GlobeHover | null) => void }
function RelationshipArc({ relationship, selectedId, onSelect, onHover }: Props) {
  const points = useMemo(() => arcPoints(COUNTRIES[relationship.from].coordinates, COUNTRIES[relationship.to].coordinates), [relationship]);
  const { color } = RELATIONSHIP_STYLES[relationship.type];
  const id = relationshipId(relationship);
  const start = useRef<PointerStart | null>(null);
  const moved = useRef(false);
  const opacity = selectedId && selectedId !== id ? .22 : .88;
  const arrows = useMemo(() => (relationship.bidirectional ? [.25, .75] : [.72]).map((t, i) => {
    const index = Math.floor(t * (points.length - 1));
    const direction = points[index + 1].clone().sub(points[index - 1]).normalize();
    if (relationship.bidirectional && i === 0) direction.negate();
    return { position: points[index], quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction) };
  }), [points, relationship.bidirectional]);
  const move = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (event.buttons) { if (start.current && Math.hypot(event.clientX-start.current.x,event.clientY-start.current.y)>6) moved.current=true; onHover?.(null); return; }
    onHover?.({relationshipId:id,x:event.clientX,y:event.clientY});
  };
  return <group onPointerMove={onSelect ? move : undefined} onPointerOut={onSelect ? () => onHover?.(null) : undefined} onPointerDown={onSelect ? event => {event.stopPropagation(); start.current={x:event.clientX,y:event.clientY,id:event.pointerId};moved.current=false;onHover?.(null);} : undefined} onPointerUp={onSelect ? event => {event.stopPropagation();if(isCountryClick(start.current,{x:event.clientX,y:event.clientY,id:event.pointerId},moved.current))onSelect(id);start.current=null;move(event);} : undefined}>
    <Line points={points} color={color} lineWidth={selectedId === id ? 2 : 1.5} transparent opacity={opacity} dashed={relationship.type === 'conflict'} dashSize={.028} gapSize={.016}/>
    {arrows.map((arrow, i) => <mesh key={i} position={arrow.position} quaternion={arrow.quaternion}><coneGeometry args={[.008, .027, 8]}/><meshBasicMaterial color={color} transparent opacity={opacity}/></mesh>)}
    {[points[0], points[points.length - 1]].map((point, i) => <mesh key={i} position={point}><sphereGeometry args={[.006, 12, 8]}/><meshBasicMaterial color={color} transparent opacity={opacity}/></mesh>)}
  </group>;
}
export function RelationshipArcs({ relationships, selectedId, onSelect, onHover }: { relationships: readonly Relationship[]; selectedId?: string | null; onSelect?: (id:string)=>void; onHover?: (hover:GlobeHover|null)=>void }) {
  return <group>{relationships.map(link => <RelationshipArc key={relationshipId(link)} relationship={link} selectedId={selectedId} onSelect={onSelect} onHover={onHover}/>)}</group>;
}
