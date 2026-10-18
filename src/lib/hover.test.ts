import { describe, expect, it } from 'vitest';
import { DEMO_EVENTS } from '../data/events';
import { countryRoles, tooltipPosition } from './hover';
describe('country hover content', () => {
  it('includes every independent relationship of the hovered participant', () => {
    const event = DEMO_EVENTS[0];
    expect(countryRoles('UKR', event)).toEqual([
      { type: 'military', text: 'Military aid from United States' },
      { type: 'conflict', text: 'Conflict with Russia' },
    ]);
    expect(countryRoles('USA', event)[0].text).toBe('Military aid to Ukraine');
    expect(countryRoles('DEU', event)).toEqual([]);
  });
  it('describes a bilateral trade role independently of demonstration IDs', () => {
    const event = DEMO_EVENTS.find(event => event.id === 'india-europe-trade')!;
    expect(countryRoles('DEU', { ...event, id: 'new-provider-id', demo: false })[0].text).toBe('Trade cooperation with India');
  });
});
describe('tooltip placement', () => {
  it.each([[10,10], [389,843], [200,840], [389,400], [200,400]])('keeps tooltip within a narrow viewport at %s, %s', (x, y) => {
    const position = tooltipPosition(x, y, 260, 100, 390, 844);
    expect(position.left).toBeGreaterThanOrEqual(12);
    expect(position.top).toBeGreaterThanOrEqual(12);
    expect(position.left + 260).toBeLessThanOrEqual(378);
    expect(position.top + 100).toBeLessThanOrEqual(832);
  });
});
