import type { NewsEvent, RelationshipType } from '../data/types';
import { COUNTRIES } from '../data/countries';
export interface CountryHover { code: string; eventId: string; x: number; y: number }
export function countryRoles(code: string, event: NewsEvent): { type: RelationshipType; text: string }[] {
  return event.relationships.filter(link => link.from === code || link.to === code).map(link => {
    const outgoing = link.from === code;
    const partner = COUNTRIES[outgoing ? link.to : link.from].name;
    const text = link.type === 'trade' ? `Trade cooperation with ${partner}`
      : link.type === 'diplomacy' ? `Diplomatic cooperation with ${partner}`
      : link.type === 'conflict' ? `Conflict with ${partner}`
      : link.type === 'military' ? link.bidirectional ? `Military cooperation with ${partner}` : `Military aid ${outgoing ? 'to' : 'from'} ${partner}`
      : link.type === 'energy' ? link.bidirectional ? `Energy cooperation with ${partner}` : `Energy ${outgoing ? 'supply to' : 'imports from'} ${partner}`
      : `Connection with ${partner}`;
    return { type: link.type, text };
  });
}
export function tooltipPosition(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const gap = 15, margin = 12;
  const left = x + gap + width > viewportWidth - margin ? x - width - gap : x + gap;
  const top = y + gap + height > viewportHeight - margin ? y - height - gap : y + gap;
  return { left: Math.max(margin, Math.min(left, viewportWidth - width - margin)), top: Math.max(margin, Math.min(top, viewportHeight - height - margin)) };
}
