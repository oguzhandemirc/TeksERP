// Gövde no esnek eşleşme (devere S3) — sunucu `Teks-Erp/src/utils/beam-body-no.ts` ile bayt-aynı (bekçi `test_govde_no_esnek` §0).
import { beamBodyNoKey, beamBodyNoLooseMatch } from './beamBodyNo';

describe('beamBodyNoKey', () => {
  it.each([
    ['LG-012', 'lg12'],
    ['lg 12', 'lg12'],
    [' 0012 ', '12'],
    ['0', '0'],
    ['A1-007', 'a17'],
    ['LG.12/B', 'lg12b'],
  ])('%s → %s', (raw, key) => expect(beamBodyNoKey(raw)).toBe(key));
});

describe('beamBodyNoLooseMatch', () => {
  it.each([
    ['012', '12', true],
    ['lg 12', 'LG-12', true],
    ['LG-012', 'LG-12', true],
    ['12', 'LG-0012', true],
    ['012', 'LG-12', true],
    ['12', 'LG-112', false],
    ['LG-12', '12', false],
    ['MX-12', 'LG-12', false],
    ['', 'LG-12', false],
    ['TSTGN1234 42', 'TSTGN1234-0042', true],
  ])('%s ↔ %s = %s', (input, bodyNo, ok) => expect(beamBodyNoLooseMatch(input, bodyNo)).toBe(ok));
});
