import type { Country } from './types';
/** ISO 3166 numeric IDs match the Natural Earth / world-atlas topology. */
export const COUNTRIES: Record<string, Country> = {
  USA: { id: '840', name: 'United States', flag: 'us', coordinates: { lat: 38, lng: -97 } },
  UKR: { id: '804', name: 'Ukraine', flag: 'ua', coordinates: { lat: 49, lng: 32 } },
  RUS: { id: '643', name: 'Russia', flag: 'ru', coordinates: { lat: 56, lng: 38 } },
  CHN: { id: '156', name: 'China', flag: 'cn', coordinates: { lat: 35, lng: 104 } },
  DEU: { id: '276', name: 'Germany', flag: 'de', coordinates: { lat: 51, lng: 10 } },
  FRA: { id: '250', name: 'France', flag: 'fr', coordinates: { lat: 47, lng: 2 } },
  SAU: { id: '682', name: 'Saudi Arabia', flag: 'sa', coordinates: { lat: 24, lng: 45 } },
  JPN: { id: '392', name: 'Japan', flag: 'jp', coordinates: { lat: 36, lng: 138 } },
  AUS: { id: '036', name: 'Australia', flag: 'au', coordinates: { lat: -25, lng: 134 } },
  IND: { id: '356', name: 'India', flag: 'in', coordinates: { lat: 22, lng: 79 } },
  BRA: { id: '076', name: 'Brazil', flag: 'br', coordinates: { lat: -14, lng: -52 } },
};
