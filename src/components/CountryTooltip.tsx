import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { COUNTRIES } from '../data/countries';
import { RELATIONSHIP_STYLES, type NewsEvent } from '../data/types';
import { countryRoles, tooltipPosition, type GlobeHover } from '../lib/hover';
import type { CountryRelationship } from '../lib/relationships';
export interface CountryTooltipHandle { show: (hover: GlobeHover | null) => void }
export const CountryTooltip = forwardRef<CountryTooltipHandle, { event: NewsEvent | null; explorer?: boolean; relationships?: readonly CountryRelationship[] }>(function CountryTooltip({ event, explorer = false, relationships = [] }, ref) {
  const [hover, setHover] = useState<GlobeHover | null>(null);
  const element = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ show: setHover }), []);
  useEffect(() => { setHover(null); }, [event, explorer]);
  useEffect(() => {
    const hide = () => setHover(null);
    window.addEventListener('pointerdown', hide);
    window.addEventListener('wheel', hide, { passive: true });
    window.addEventListener('resize', hide);
    return () => { window.removeEventListener('pointerdown', hide); window.removeEventListener('wheel', hide); window.removeEventListener('resize', hide); };
  }, []);
  useLayoutEffect(() => {
    if (!element.current || !hover) return;
    const rect = element.current.getBoundingClientRect();
    const position = tooltipPosition(hover.x, hover.y, rect.width, rect.height, window.innerWidth, window.innerHeight);
    element.current.style.left = `${position.left}px`; element.current.style.top = `${position.top}px`;
  }, [hover, event]);
  if (!hover) return null;
  if ('relationshipId' in hover) {
    const link = relationships.find(item => item.id === hover.relationshipId);
    if (!explorer || !link) return null;
    return <div ref={element} className="country-tooltip" role="tooltip" style={{left:hover.x,top:hover.y}}><strong>{COUNTRIES[link.from].name} {link.bidirectional ? '↔' : '→'} {COUNTRIES[link.to].name}</strong><div>{RELATIONSHIP_STYLES[link.type].label}</div><div>{link.relatedEventIds.length} related {link.relatedEventIds.length === 1 ? 'event' : 'events'}</div></div>;
  }
  if (!explorer && (!event || hover.eventId !== event.id)) return null;
  const roles = event ? countryRoles(hover.code, event) : [];
  return <div ref={element} className="country-tooltip" role="tooltip" style={{ left: hover.x, top: hover.y }}><strong>{COUNTRIES[hover.code].name}</strong>{roles.length > 0 && <ul>{roles.map((role, i) => <li key={i}><i style={{ background: RELATIONSHIP_STYLES[role.type].color }}/><span>{role.text}</span></li>)}</ul>}</div>;
});
