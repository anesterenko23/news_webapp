import { countryMetadata } from './countries.js';
const normalize=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const aliases=new Map<string,string>();
for(const country of countryMetadata)if(country.cca2!=='XK')for(const name of [country.cca2,country.cca3,country.name.common,country.name.official,...country.altSpellings])aliases.set(normalize(name),country.cca2);
for(const [name,code]of Object.entries({'UK':'GB','United Kingdom':'GB','USA':'US','United States':'US','South Korea':'KR'}))aliases.set(normalize(name),code);
export function resolveCountry(value:string){return aliases.get(normalize(value));}
export const ORGANIZATIONS:Record<string,string>={UN:'United Nations',EU:'European Union',NATO:'NATO',OSCE:'Organization for Security and Co-operation in Europe',WHO:'World Health Organization',WTO:'World Trade Organization',ASEAN:'Association of Southeast Asian Nations',AU:'African Union',G7:'Group of Seven',G20:'Group of Twenty',ICC:'International Criminal Court'};
export function isOrganization(value:string){return Object.entries(ORGANIZATIONS).some(([id,name])=>normalize(value)===normalize(id)||normalize(value)===normalize(name));}
