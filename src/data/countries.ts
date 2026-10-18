import type { Country } from './types';
import catalogue from './country-catalogue.json';
/** One atlas-backed registry for map picking, search, event codes and profiles. */
export const COUNTRIES: Record<string, Country> = catalogue;
export const COUNTRY_CODES = Object.keys(COUNTRIES);
export const COUNTRY_LIST = COUNTRY_CODES.map(code => ({ code, ...COUNTRIES[code] })).sort((a,b) => a.name.localeCompare(b.name));
export function searchCountries(query: string) {
  const term = query.trim().toLocaleLowerCase('en');
  return COUNTRY_LIST.filter(country => !term || [country.name, ...country.aliases].some(name => name.toLocaleLowerCase('en').includes(term)));
}
