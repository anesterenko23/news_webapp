import fs from 'node:fs';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
const require = createRequire(import.meta.url);
const world = require('world-countries');
const topology = JSON.parse(fs.readFileSync(new URL('../node_modules/world-atlas/countries-50m.json', import.meta.url)));
const features = feature(topology, topology.objects.countries).features;
const anchors = { USA:[38,-97], UKR:[49,32], RUS:[56,38], CHN:[35,104], DEU:[51,10], FRA:[47,2], SAU:[24,45], JPN:[36,138], AUS:[-25,134], IND:[22,79], BRA:[-14,-52] };
const aliases = { USA:['US','USA','America','United States of America'], GBR:['UK','Britain','Great Britain','United Kingdom'], KOR:['South Korea','Republic of Korea'], PRK:['North Korea'], CZE:['Czech Republic'], ARE:['UAE','United Arab Emirates'], RUS:['Russian Federation'], CIV:['Ivory Coast'], COD:['DR Congo','Democratic Republic of Congo'], VAT:['Vatican City'] };
const result = {};
for (const item of features) {
  const name = item.properties.name;
  const match = world.find(country => country.ccn3 && Number(country.ccn3) === Number(item.id)) ?? world.find(country => country.name.common.toLowerCase() === name.toLowerCase() || country.altSpellings.some(alt => alt.toLowerCase() === name.toLowerCase()));
  const code = match?.cca3 ?? `MAP_${name.toUpperCase().replace(/[^A-Z]/g,'_')}`;
  if (result[code]) { result[code].mapNames.push(name); continue; }
  let coordinates = match?.latlng;
  if (!coordinates) {
    const polygons = item.geometry.type === 'Polygon' ? [item.geometry.coordinates] : item.geometry.coordinates;
    const ring = [...polygons].sort((a,b)=>b[0].length-a[0].length)[0][0];
    const sum=ring.reduce((s,p)=>[s[0]+p[1],s[1]+p[0]], [0,0]);
    coordinates=[sum[0]/ring.length,sum[1]/ring.length];
  }
  const anchor = anchors[code] ?? coordinates;
  result[code] = { id: String(item.id ?? name), mapName:name, mapNames:[name], alpha2:match?.cca2 ?? null, alpha3:match?.cca3 ?? null, name:match?.name.common ?? name, region:match?.region ?? 'Geographic territory', flag:match?.cca2.toLowerCase() ?? '', coordinates:{lat:anchor[0],lng:anchor[1]}, focusCoordinates:{lat:coordinates[0],lng:coordinates[1]}, aliases:[...new Set([...(match?.altSpellings ?? []),...(aliases[code] ?? []),...(match ? [match.name.official, match.cca2, match.cca3] : []),name])] };
}
fs.writeFileSync(new URL('../src/data/country-catalogue.json', import.meta.url), JSON.stringify(result,null,2)+'\n');
console.log(`Prepared ${Object.keys(result).length} map countries and territories`);
