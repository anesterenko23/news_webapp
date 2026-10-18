import { describe, expect, it } from 'vitest';
import { COUNTRIES, COUNTRY_CODES, searchCountries } from '../data/countries';
import { DEMO_EVENTS } from '../data/events';
import { countryAtUV, countryFeatures } from './countries';
import { buildRelationshipIndex, countryRelationships, isCountryClick, visibleRelationships } from './relationships';
import { cameraFocusPosition, sphereFitDistance } from './geo';

describe('Country Explorer', () => {
  it('maps every geographic feature to one catalogue country', () => {
    for (const feature of countryFeatures) {
      const name = (feature.properties as { name: string }).name;
      expect(COUNTRY_CODES.filter(code => COUNTRIES[code].mapNames.includes(name))).toHaveLength(1);
    }
  });
  it('searches aliases and ISO codes without case sensitivity', () => {
    expect(searchCountries('uSa').map(item => item.code)).toContain('USA');
    expect(searchCountries('Britain').map(item => item.code)).toContain('GBR');
    expect(searchCountries('Czech Republic').map(item => item.code)).toContain('CZE');
    expect(searchCountries('no such country')).toHaveLength(0);
  });
  it('picks territories without event evidence and island polygons', () => {
    for (const [code, lng, lat] of [['CAN',-105,57],['NZL',172,-43],['JPN',142,43],['DEU',10,51]] as const) {
      expect(countryAtUV(COUNTRY_CODES,(lng+180)/360,(lat+90)/180)).toBe(code);
    }
    expect(countryAtUV(COUNTRY_CODES,150/360,90/180)).toBeUndefined();
  });
  it('aggregates multiple events without inventing country relationships', () => {
    const index = buildRelationshipIndex(DEMO_EVENTS);
    const links = countryRelationships('DEU',index.relationships);
    expect(links.length).toBeGreaterThan(0);
    expect(links.some(link => link.relatedEventIds.length >= 3)).toBe(true);
    expect(countryRelationships('CAN',index.relationships)).toHaveLength(0);
    for (const link of index.relationships) for (const id of link.relatedEventIds) expect(index.eventRelationshipIds.get(id)).toContain(link.id);
  });
  it('keeps direction and category distinct, canonicalizes bilateral evidence', () => {
    const event = DEMO_EVENTS[0];
    const index=buildRelationshipIndex([{...event,id:'a',relationships:[{from:'USA',to:'CHN',type:'trade',bidirectional:true},{from:'USA',to:'CHN',type:'trade'},{from:'CHN',to:'USA',type:'trade'},{from:'USA',to:'CHN',type:'conflict'}]},{...event,id:'b',relationships:[{from:'CHN',to:'USA',type:'trade',bidirectional:true}]}]);
    expect(index.relationships).toHaveLength(4);
    expect(index.relationships.find(link=>link.bidirectional)?.relatedEventIds).toEqual(['a','b']);
  });
  it('caps dense graphs and lets a selected hidden relationship enter the view', () => {
    const links=Array.from({length:50},(_,i)=>({id:String(i),from:'USA',to:'CHN',type:i%2?'trade' as const:'conflict' as const,direction:'directed' as const,relatedEventIds:['a']}));
    expect(visibleRelationships(links,'all',null)).toHaveLength(6);
    expect(visibleRelationships(links,'all','49')[0].id).toBe('49');
    expect(visibleRelationships(links,'trade',null).every(link=>link.type==='trade')).toBe(true);
  });
  it('does not select a country after a drag or mismatched pointer', () => {
    const start={x:10,y:10,id:1};
    expect(isCountryClick(start,{x:12,y:12,id:1},false)).toBe(true);
    expect(isCountryClick(start,{x:30,y:10,id:1},false)).toBe(false);
    expect(isCountryClick(start,start,true)).toBe(false);
    expect(isCountryClick(start,{...start,id:2},false)).toBe(false);
  });
  it('keeps country framing large and away from the poles', () => {
    for (const code of COUNTRY_CODES) {
      const position=cameraFocusPosition({kind:'country',key:code,code},46,1.5);
      expect(position.length()).toBeCloseTo(sphereFitDistance(46,1.5,1.025,.79));
      expect(Math.abs(position.y/position.length())).toBeLessThanOrEqual(Math.sin(70*Math.PI/180)+1e-8);
    }
  });
});
