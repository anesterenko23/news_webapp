import type { NewsEvent } from './types';
// Illustrative scenarios only. Sources provide institutional background, not
// evidence of the fictional event described by these demo headlines.
const previewStarted = Date.now();
const ago = (hours: number) => new Date(previewStarted - hours * 3_600_000).toISOString();
const photo = (name: string) => `${import.meta.env.BASE_URL}textures/demo-${name}.jpg`;
export const DEMO_EVENTS: readonly NewsEvent[] = [
  {
    id: 'ukraine-aid', title: 'U.S. military aid to Ukraine', category: 'military',
    description: 'Illustrative U.S. military assistance to Ukraine, shown alongside the Russia–Ukraine conflict. Two independent connections appear together.',
    publishedAt: ago(2), image: photo('city'), imageAlt: 'Urban buildings — illustrative photograph',
    source: { name: 'United Nations', url: 'https://www.un.org/en/' },
    countries: ['UKR', 'USA', 'RUS'], coordinates: { lat: 51, lng: -19 },
    relationships: [{ from: 'USA', to: 'UKR', type: 'military' }, { from: 'RUS', to: 'UKR', type: 'conflict', bidirectional: true }], demo: true,
  },
  {
    id: 'china-us-trade', title: 'China and the U.S. explore trade cooperation', category: 'trade',
    description: 'An illustrative trade dialogue between two major economies. Follow a trans-Pacific connection and explore the geographical scale of their relationship.',
    publishedAt: ago(4), image: photo('trade'), imageAlt: 'Shipping containers — illustrative photograph',
    source: { name: 'World Trade Organization', url: 'https://www.wto.org/' },
    countries: ['CHN', 'USA'], coordinates: { lat: 42, lng: -175 },
    relationships: [{ from: 'CHN', to: 'USA', type: 'trade', bidirectional: true }], demo: true,
  },
  {
    id: 'russia-ukraine', title: 'Russia–Ukraine conflict: a geographic view', category: 'conflict',
    description: 'A demonstration of conflict mapping across neighbouring countries. Red outlines and an elevated arc reveal the participants while keeping the underlying terrain visible.',
    publishedAt: ago(6), image: photo('city'), imageAlt: 'Urban buildings — illustrative photograph',
    source: { name: 'United Nations', url: 'https://www.un.org/en/' },
    countries: ['RUS', 'UKR'], coordinates: { lat: 53, lng: 35 },
    relationships: [{ from: 'RUS', to: 'UKR', type: 'conflict', bidirectional: true }], demo: true,
  },
  {
    id: 'europe-diplomacy', title: 'Germany and France deepen diplomatic ties', category: 'diplomacy',
    description: 'A sample scenario for bilateral diplomatic cooperation in Europe. Select the event to focus on the two countries and their shared regional context.',
    publishedAt: ago(8), image: photo('diplomacy'), imageAlt: 'Government building — illustrative photograph',
    source: { name: 'European Union', url: 'https://european-union.europa.eu/' },
    countries: ['DEU', 'FRA'], coordinates: { lat: 49, lng: 6 },
    relationships: [{ from: 'DEU', to: 'FRA', type: 'diplomacy', bidirectional: true }], demo: true,
  },
  {
    id: 'saudi-china-energy', title: 'Saudi Arabia and China connect on energy', category: 'energy',
    description: 'An illustrative energy supply route from the Arabian Peninsula to East Asia. The yellow arc traces the relationship above the curved surface of the Earth.',
    publishedAt: ago(10), image: photo('energy'), imageAlt: 'Energy infrastructure — illustrative photograph',
    source: { name: 'International Energy Agency', url: 'https://www.iea.org/' },
    countries: ['SAU', 'CHN'], coordinates: { lat: 32, lng: 76 },
    relationships: [{ from: 'SAU', to: 'CHN', type: 'energy' }], demo: true,
  },
  {
    id: 'japan-australia', title: 'Japan and Australia explore defence cooperation', category: 'military',
    description: 'A demonstration of defence cooperation across the western Pacific. Both countries remain available for manual exploration after the camera completes its transition.',
    publishedAt: ago(12), image: photo('ocean'), imageAlt: 'Pacific coast — illustrative photograph',
    source: { name: 'Australian Department of Defence', url: 'https://www.defence.gov.au/' },
    countries: ['JPN', 'AUS'], coordinates: { lat: 6, lng: 136 },
    relationships: [{ from: 'JPN', to: 'AUS', type: 'military', bidirectional: true }], demo: true,
  },
  {
    id: 'india-europe-trade', title: 'India and Germany discuss a trade corridor', category: 'trade',
    description: 'A sample cross-regional trade connection linking Europe and South Asia. This event demonstrates how the globe frames countries separated by a substantial distance.',
    publishedAt: ago(15), image: photo('trade'), imageAlt: 'Shipping containers — illustrative photograph',
    source: { name: 'World Trade Organization', url: 'https://www.wto.org/' },
    countries: ['IND', 'DEU'], coordinates: { lat: 40, lng: 48 },
    relationships: [{ from: 'IND', to: 'DEU', type: 'trade', bidirectional: true }], demo: true,
  },
  {
    id: 'brazil-france', title: 'Brazil and France discuss climate diplomacy', category: 'diplomacy',
    description: 'An illustrative diplomatic exchange spanning the Atlantic. The purple connection brings two different regions into a single geographic perspective.',
    publishedAt: ago(18), image: photo('climate'), imageAlt: 'Wind turbines — illustrative photograph',
    source: { name: 'UN Climate Change', url: 'https://unfccc.int/' },
    countries: ['BRA', 'FRA'], coordinates: { lat: 20, lng: -27 },
    relationships: [{ from: 'BRA', to: 'FRA', type: 'diplomacy', bidirectional: true }], demo: true,
  },
];
