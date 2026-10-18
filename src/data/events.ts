import type { NewsEvent } from './types';
// Illustrative scenarios only. Sources provide institutional background, not
// evidence of the fictional event described by these demo headlines.
const previewStarted = Date.now();
const ago = (hours: number) => new Date(previewStarted - hours * 3_600_000).toISOString();
const photo = (name: string) => `${import.meta.env.BASE_URL}textures/demo-${name}.jpg`;
const BASE_EVENTS: readonly NewsEvent[] = [
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

// Additional illustrative scenarios exercise the same feed and data contract at
// 24 rows; they are not live updates or reports of actual events.
const EXTRA_SCENARIOS: [number, string, string][] = [
  [0, 'Air defence coordination for Ukraine', 'A demo of air defence assistance and its wider regional conflict context.'],
  [1, 'U.S.–China dialogue on supply chains', 'An illustrative trade dialogue about supply-chain cooperation across the Pacific.'],
  [2, 'Humanitarian access in the Russia–Ukraine conflict', 'A sample geographic view of the countries involved in humanitarian access discussions.'],
  [3, 'France and Germany coordinate regional policy', 'A demonstration of diplomatic coordination between two European neighbours.'],
  [4, 'Saudi–China energy supply planning', 'An illustrative energy supply relationship linking the Arabian Peninsula and East Asia.'],
  [5, 'Japan–Australia maritime cooperation', 'A sample defence partnership focused on the western Pacific and nearby sea routes.'],
  [6, 'India–Germany industrial trade dialogue', 'An illustrative exchange on industrial trade between Europe and South Asia.'],
  [7, 'Brazil–France environmental cooperation', 'A sample diplomatic connection for cooperation on environmental questions.'],
  [0, 'U.S.–Ukraine assistance logistics', 'An illustrative assistance logistics scenario, alongside the regional conflict relationship.'],
  [1, 'China–U.S. talks on trade standards', 'A sample trade cooperation scenario demonstrating a trans-Pacific geographic connection.'],
  [2, 'Russia–Ukraine conflict: regional context', 'A demonstration of conflict geography, with a raised connection between the participating countries.'],
  [3, 'German–French diplomatic consultation', 'An illustrative bilateral consultation in the shared European geographic context.'],
  [4, 'Saudi–China long-term energy cooperation', 'A demonstration of an energy supply connection between two distant regions.'],
  [5, 'Australia and Japan discuss defence training', 'An illustrative military cooperation scenario connecting the two Pacific partners.'],
  [6, 'India–Germany transport and trade links', 'A sample trade corridor discussion across the European and South Asian regions.'],
  [7, 'France–Brazil climate dialogue', 'An illustrative diplomatic exchange on climate cooperation across the Atlantic.'],
];
export const DEMO_EVENTS: readonly NewsEvent[] = [
  ...BASE_EVENTS,
  ...EXTRA_SCENARIOS.map(([base, title, description], index) => ({
    ...BASE_EVENTS[base], id: `demo-scenario-${index + 9}`, title, description,
    publishedAt: ago(20 + index), demo: true,
  })),
];
