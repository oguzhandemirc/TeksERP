import {
  operatorColor,
  operatorInitials,
  OPERATOR_PALETTE,
  OPERATOR_NEUTRAL,
} from './operatorColor';

describe('operatorColor', () => {
  it('deterministik: aynı userId → aynı renk (birçok çağrı)', () => {
    const id = 'e3f1a2b4-1234-4abc-9def-000000000001';
    const c = operatorColor(id);
    for (let i = 0; i < 20; i++) expect(operatorColor(id)).toBe(c);
  });

  it('her zaman paletten bir renk döner', () => {
    const ids = ['a', 'bb', 'ccc', 'user-42', 'x'.repeat(50), '00000000-0000-0000-0000-000000000000'];
    for (const id of ids) {
      expect(OPERATOR_PALETTE as readonly string[]).toContain(operatorColor(id));
    }
  });

  it('boş/null/undefined → nötr gri (palet rengi sızmaz)', () => {
    expect(operatorColor(null)).toBe(OPERATOR_NEUTRAL);
    expect(operatorColor(undefined)).toBe(OPERATOR_NEUTRAL);
    expect(operatorColor('')).toBe(OPERATOR_NEUTRAL);
  });

  it('farklı kimlikler paleti makul dağıtır (>=6 farklı ton)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(operatorColor(`user-${i}`));
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it('palet 12 benzersiz ton içerir', () => {
    expect(new Set(OPERATOR_PALETTE).size).toBe(OPERATOR_PALETTE.length);
    expect(OPERATOR_PALETTE.length).toBe(12);
  });
});

describe('operatorInitials', () => {
  it('iki isim → ilk+son baş harf', () => {
    expect(operatorInitials('Ali Veli')).toBe('AV');
    expect(operatorInitials('mehmet can öz')).toBe('MÖ');
  });
  it('tek isim → ilk iki harf', () => {
    expect(operatorInitials('Ali')).toBe('AL');
  });
  it('boş/null → ?', () => {
    expect(operatorInitials('')).toBe('?');
    expect(operatorInitials('   ')).toBe('?');
    expect(operatorInitials(null)).toBe('?');
    expect(operatorInitials(undefined)).toBe('?');
  });
});
