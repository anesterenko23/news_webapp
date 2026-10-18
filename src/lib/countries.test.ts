import { describe, expect, it } from 'vitest';
import { countryAtUV } from './countries';
const pick = (codes: string[], lng: number, lat: number) => countryAtUV(codes, (lng + 180) / 360, (lat + 90) / 180);
describe('highlighted country hit testing', () => {
  it('identifies each participant from the surface UV', () => {
    expect(pick(['DEU','FRA'], 10, 51)).toBe('DEU');
    expect(pick(['DEU','FRA'], 2, 47)).toBe('FRA');
    expect(pick(['UKR','RUS','USA'], 32, 49)).toBe('UKR');
    expect(pick(['USA'], -97, 38)).toBe('USA');
    expect(pick(['CHN'], 104, 35)).toBe('CHN');
  });
  it('does not show a tooltip for the ocean or a nonparticipant', () => {
    expect(pick(['DEU','FRA'], -30, 0)).toBeUndefined();
    expect(pick(['DEU','FRA'], 79, 22)).toBeUndefined();
  });
  it('keeps dateline-crossing Russia on both sides without selecting distant oceans', () => {
    expect(pick(['RUS'], 179, 66)).toBe('RUS');
    expect(pick(['RUS'], -175, 67)).toBe('RUS');
    expect(pick(['RUS'], -150, 0)).toBeUndefined();
  });
});
