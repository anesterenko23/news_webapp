import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { COUNTRIES } from '../data/countries';
import { RELATIONSHIP_STYLES, type NewsEvent } from '../data/types';
import { countryRoles, tooltipPosition, type CountryHover } from '../lib/hover';
export interface CountryTooltipHandle { show: (hover: CountryHover | null) => void }
/** Pointer updates only this DOM layer, never the React Three Fiber tree. */
export const CountryTooltip = forwardRef<CountryTooltipHandle, { event: NewsEvent | null }>(function CountryTooltip({ event }, ref) {
  const [hover, setHover] = useState<CountryHover | null>(null);
  const element = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ show: setHover }), []);
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
    element.current.style.left = `${position.left}px`;
    element.current.style.top = `${position.top}px`;
  }, [hover, event]);
  if (!hover || !event || hover.eventId !== event.id) return null;
  const roles = countryRoles(hover.code, event);
  if (!roles.length) return null;
  return <div ref={element} className="country-tooltip" role="tooltip" style={{ left: hover.x, top: hover.y }}><strong>{COUNTRIES[hover.code].name}</strong><ul>{roles.map((role, i) => <li key={i}><i style={{ background: RELATIONSHIP_STYLES[role.type].color }}/><span>{role.text}</span></li>)}</ul></div>;
});
