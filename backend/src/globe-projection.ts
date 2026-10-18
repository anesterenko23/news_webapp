import { countryMetadata } from './countries.js';
import { readFileSync } from 'node:fs';
const alpha3 = new Map(countryMetadata.map(country=>[country.cca2,country.cca3]));
const supported = new Set(Object.keys(JSON.parse(readFileSync(new URL('../../src/data/country-catalogue.json',import.meta.url),'utf8'))));
const renderTypes: Record<string,string> = {conflict:'conflict',military_aid:'military',military_cooperation:'military',trade:'trade',trade_restrictions:'trade',sanctions:'other',diplomacy:'diplomacy',energy:'energy',humanitarian_aid:'other',international_agreement:'diplomacy',other:'other',unknown:'other'};
interface ProjectableEvent {
  id:string;eventType:string;eventStatus:string;verificationStatus:string;publicationStatus:string;
  participants:{countryCode:string}[];
  relationships:{sourceCountry:string;targetCountry:string;type:string;direction:string}[];
}
/** Selection-layer contract only. Never feeds unreviewed events into the public demo feed. */
export function globeProjection(event: ProjectableEvent) {
  const codes=event.participants.map(participant=>alpha3.get(participant.countryCode));
  return {id:event.id,previewOnly:true,countries:codes.filter((code):code is string=>!!code&&supported.has(code)),unsupportedCountries:event.participants.filter(participant=>!supported.has(alpha3.get(participant.countryCode)??'')).map(participant=>participant.countryCode),relationships:event.relationships.flatMap(link=> {
    const from=alpha3.get(link.sourceCountry),to=alpha3.get(link.targetCountry);
    return from && to && supported.has(from) && supported.has(to) ? [{from,to,type:renderTypes[link.type]??'other',bidirectional:link.direction==='bidirectional',originalType:link.type}] : [];
  }),semantics:{eventType:event.eventType,eventStatus:event.eventStatus,verificationStatus:event.verificationStatus,publicationStatus:event.publicationStatus}};
}
