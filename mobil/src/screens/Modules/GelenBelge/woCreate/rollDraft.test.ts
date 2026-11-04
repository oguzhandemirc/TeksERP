// Toplar ayrı geldi (Gülkesim fason): belgenin top satırları → düzenlenebilir liste; kayıt kapısı + gövde parçası.
// Negatif sonda: `withRolls` kursunMeters'ı toplamdan almazsa "toplam" vakası kırmızı.
import { emptyRoll, initialRolls, ROLLS_MAX, rollIssues, rollsTotal, withRolls } from './rollDraft';

const base = { clientToken: 't1', ownerCustomerId: 'c1', kursunMeters: '999' };

describe('initialRolls', () => {
  it('⭐ docRolls varsa onlardan dolu (metre/kg/top no); 0 değerler boş', () => {
    const rows = initialRolls([
      { lineNo: 1, meters: 120.5, weightKg: 30, senderRollNo: 'T-1' },
      { lineNo: 2, meters: 0, weightKg: null, senderRollNo: null },
    ]);
    expect(rows.map(({ key: _k, ...r }) => r)).toEqual([
      { meters: 120.5, weightKg: 30, senderRollNo: 'T-1' },
      { meters: null, weightKg: null, senderRollNo: '' },
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
  it('docRolls yok / boş (eski sunucu) → 1 boş satır', () => {
    for (const d of [undefined, null, []]) {
      const rows = initialRolls(d);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ meters: null, weightKg: null, senderRollNo: '' });
    }
  });
  it('sunucu sınırı: en fazla 200 satır', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ lineNo: i + 1, meters: 10, weightKg: null, senderRollNo: null }));
    expect(initialRolls(many)).toHaveLength(ROLLS_MAX);
  });
});

describe('rollIssues / rollsTotal', () => {
  it('⭐ metresi eksik top sayılır; tamamsa engel yok', () => {
    const a = { ...emptyRoll(), meters: 100 };
    const b = emptyRoll();
    expect(rollIssues([a, b])).toEqual(['Top metresi eksik: 2. top.']);
    expect(rollIssues([a])).toEqual([]);
    expect(rollIssues([])).toEqual(['En az bir top girin.']);
  });
  it('toplam 3 hane yuvarlanır, boş metre 0 sayılır', () => {
    expect(rollsTotal([{ ...emptyRoll(), meters: 0.1 }, { ...emptyRoll(), meters: 0.2 }, emptyRoll()])).toBe(0.3);
  });
});

describe('withRolls', () => {
  it('⭐ kursunMeters = toplam, rollMode SEPARATE, rolls (kg/top no boşsa null, key gitmez)', () => {
    const body = withRolls(base, [
      { key: 'a', meters: 100, weightKg: 25.5, senderRollNo: ' T-1 ' },
      { key: 'b', meters: 50.25, weightKg: null, senderRollNo: '' },
    ]);
    expect(body).toEqual({
      ...base,
      kursunMeters: '150.25',
      rollMode: 'SEPARATE',
      rolls: [
        { meters: 100, weightKg: 25.5, senderRollNo: 'T-1' },
        { meters: 50.25, weightKg: null, senderRollNo: null },
      ],
    });
  });
});
