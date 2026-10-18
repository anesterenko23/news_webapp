import type { NewsEvent, Relationship, RelationshipType } from '../data/types';
export interface CountryRelationship extends Relationship {
  id: string;
  direction: 'directed' | 'bidirectional';
  relatedEventIds: string[];
}
export const MAX_VISIBLE_RELATIONSHIPS = 6;
export function relationshipId(link: Relationship) {
  const [from, to] = link.bidirectional ? [link.from, link.to].sort() : [link.from, link.to];
  return `${from}:${link.bidirectional ? 'both' : 'to'}:${to}:${link.type}`;
}
/** The index is derived from event evidence, never an independent truth store. */
export function buildRelationshipIndex(events: readonly NewsEvent[]) {
  const index = new Map<string, CountryRelationship>();
  const eventRelationshipIds = new Map<string, string[]>();
  for (const event of events) {
    const ids = new Set<string>();
    for (const link of event.relationships) {
      const id = relationshipId(link); ids.add(id);
      const found = index.get(id);
      if (found) { if (!found.relatedEventIds.includes(event.id)) found.relatedEventIds.push(event.id); }
      else {
        const [from, to] = link.bidirectional ? [link.from, link.to].sort() : [link.from, link.to];
        index.set(id, { ...link, from, to, id, direction: link.bidirectional ? 'bidirectional' : 'directed', relatedEventIds: [event.id] });
      }
    }
    eventRelationshipIds.set(event.id, [...ids]);
  }
  const timestamps = new Map(events.map(event => [event.id, Date.parse(event.publishedAt)]));
  const relationships = [...index.values()].sort((a, b) => b.relatedEventIds.length - a.relatedEventIds.length || Math.max(...b.relatedEventIds.map(id => timestamps.get(id) ?? 0)) - Math.max(...a.relatedEventIds.map(id => timestamps.get(id) ?? 0)) || a.id.localeCompare(b.id));
  return { relationships, byId: index, eventRelationshipIds };
}
export function countryRelationships(code: string, relationships: readonly CountryRelationship[]) {
  return relationships.filter(link => link.from === code || link.to === code);
}
export function visibleRelationships(relationships: readonly CountryRelationship[], filter: 'all' | RelationshipType, selectedId: string | null, limit = MAX_VISIBLE_RELATIONSHIPS) {
  const filtered = relationships.filter(link => filter === 'all' || link.type === filter);
  const selected = filtered.find(link => link.id === selectedId);
  return (selected ? [selected, ...filtered.filter(link => link.id !== selectedId)] : filtered).slice(0, Math.max(0, limit));
}
export interface PointerStart { x: number; y: number; id: number }
export function isCountryClick(start: PointerStart | null, end: PointerStart, moved: boolean) {
  return !!start && start.id === end.id && !moved && Math.hypot(start.x - end.x, start.y - end.y) <= 6;
}
