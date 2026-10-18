import { createRequire } from 'node:module';
interface CountryMetadata { cca2:string; cca3:string; name:{common:string;official:string}; altSpellings:string[]; capital?:string[] }
export const countryMetadata = createRequire(import.meta.url)('world-countries') as CountryMetadata[];
