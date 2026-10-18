import type { NewsEvent, Relationship } from './types';
export type ViewMode = 'news' | 'explorer';
export interface GlobeSelection {
  id: string;
  countries: string[];
  relationships: readonly Relationship[];
  primaryCountry?: string;
}
export type CameraFocus = { key: string } & (
  { kind: 'event'; event: NewsEvent } |
  { kind: 'country'; code: string } |
  { kind: 'relationship'; relationship: Relationship }
);
