export type RelationshipType = 'conflict' | 'trade' | 'diplomacy' | 'military' | 'energy' | 'other';
export type NewsCategory = Exclude<RelationshipType, 'other'>;
export type NewsFilter = 'all' | NewsCategory;
export interface Coordinates { lat: number; lng: number }
export interface Country { id: string; name: string; flag: string; coordinates: Coordinates }
export interface Relationship { from: string; to: string; type: RelationshipType; bidirectional?: boolean }
export interface NewsEvent {
  id: string;
  title: string;
  description: string;
  category: NewsCategory;
  publishedAt: string;
  image: string;
  imageAlt: string;
  source: { name: string; url: string };
  countries: string[];
  relationships: Relationship[];
  coordinates: Coordinates;
  demo: boolean;
}
export const RELATIONSHIP_STYLES: Record<RelationshipType, { label: string; color: string }> = {
  conflict: { label: 'Conflict', color: '#f45149' },
  trade: { label: 'Trade', color: '#3dc69b' },
  diplomacy: { label: 'Diplomacy', color: '#9d76ef' },
  military: { label: 'Military aid', color: '#45acff' },
  energy: { label: 'Energy', color: '#f2cc5d' },
  other: { label: 'Other', color: '#8e9aaa' },
};
export const NEWS_FILTERS: { id: NewsFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'conflict', label: 'Conflicts' },
  { id: 'trade', label: 'Trade' }, { id: 'diplomacy', label: 'Diplomacy' },
  { id: 'energy', label: 'Energy' }, { id: 'military', label: 'Military' },
];
export function filterEvents(events: readonly NewsEvent[], filter: NewsFilter) {
  return filter === 'all' ? events : events.filter(event => event.category === filter);
}
export function publishedLabel(iso: string) {
  const hours = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 3_600_000));
  return hours < 1 ? 'Just now' : hours < 24 ? `${hours} ${hours === 1 ? 'hour' : 'hours'} ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
