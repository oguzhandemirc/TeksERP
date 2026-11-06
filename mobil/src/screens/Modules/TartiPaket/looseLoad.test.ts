import {
  applyMode,
  buildLoadUnits,
  checkScannedRoll,
  groupByCart,
  loadLine,
  normalizeCartLabel,
  totalMeters,
  validateLoad,
  type LooseRoll,
} from './looseLoad';

const roll = (id: string, qty: number, cartLabel: string | null = null): LooseRoll => ({
  id,
  barcode: `B-${id}`,
  itemName: 'Patos',
  colorName: null,
  width: null,
  qty,
  cartLabel,
});

describe('çuvalsız sevk — saf mantık', () => {
  it('araba no boşlukları atılır, tavan 32', () => {
    expect(normalizeCartLabel('  A   12 ')).toBe('A 12');
    expect(normalizeCartLabel('x'.repeat(40))).toHaveLength(32);
  });

  it('okutma ön kontrolü: mükerrer · sevkiyatta · çuvalda · uygun', () => {
    const base = { id: 'r1', status: 'WAREHOUSE', sack: null, shipment: null } as never;
    expect(checkScannedRoll(base, ['r1'])).toEqual({ ok: false, duplicate: true, reason: 'Zaten listede' });
    expect(checkScannedRoll({ ...(base as object), shipment: { id: 's' } } as never, [])).toMatchObject({ ok: false, duplicate: false });
    const inSack = checkScannedRoll({ ...(base as object), sack: { id: 'k', sackNo: 'CV-1' } } as never, []);
    expect(inSack.ok).toBe(false);
    expect(!inSack.ok && inSack.reason).toContain('CV-1');
    expect(checkScannedRoll(base, [])).toEqual({ ok: true });
  });

  it('arabaya göre gruplar ekleme sırasını korur, metre toplanır', () => {
    const g = groupByCart([roll('1', 10, 'A-15'), roll('2', 5, 'A-12'), roll('3', 2.5, 'A-15')]);
    expect(g.map((x) => x.label)).toEqual(['A-15', 'A-12']);
    expect(g[0].meters).toBe(12.5);
    expect(totalMeters([roll('1', 0.1), roll('2', 0.2)])).toBe(0.3);
  });

  it('doğrulama: boş liste ve arabasız top engellenir', () => {
    expect(validateLoad('BULK', [])).toBe('Önce top okutun');
    expect(validateLoad('BULK', [roll('1', 1)])).toBeNull();
    expect(validateLoad('CART', [roll('1', 1)])).toContain('Arabası seçilmemiş');
    expect(validateLoad('CART', [roll('1', 1, 'A-1')])).toBeNull();
  });

  it('irsaliye satırı metni (kullanıcı kararı 4)', () => {
    expect(loadLine('BULK', null, 12)).toBe('Dökme – 12 top');
    expect(loadLine('CART', 'A-12', 5)).toBe('Araba A-12 – 5 top');
  });

  it('yük birimleri: dökme tek birim, araba başına bir birim', () => {
    const rolls = [roll('1', 1, 'A'), roll('2', 1, 'B'), roll('3', 1, 'A')];
    expect(buildLoadUnits('BULK', rolls)).toEqual([{ kind: 'BULK', rollIds: ['1', '2', '3'] }]);
    expect(buildLoadUnits('CART', rolls)).toEqual([
      { kind: 'CART', label: 'A', rollIds: ['1', '3'] },
      { kind: 'CART', label: 'B', rollIds: ['2'] },
    ]);
  });

  it('kip değişimi: dökmede araba düşer, arabada arabasızlar aktif arabaya', () => {
    const rolls = [roll('1', 1, 'A'), roll('2', 1)];
    expect(applyMode(rolls, 'BULK', 'X').every((r) => r.cartLabel === null)).toBe(true);
    expect(applyMode(rolls, 'CART', 'X').map((r) => r.cartLabel)).toEqual(['A', 'X']);
  });
});
