import { fmtMeters } from './meters';

describe('fmtMeters', () => {
  it('binlik ayraçlı, gereksiz ondalık yok', () => {
    expect(fmtMeters(2915)).toBe('2.915');
    expect(fmtMeters(2915.5)).toBe('2.915,5');
    expect(fmtMeters(0)).toBe('0');
  });
});
