import { canUnlinkOrderLine } from './canUnlinkOrderLine';

// Backend kuralının istemci aynası: siparişe özel iş emrinin SON bağı kaldırılamaz.
// Ayna gevşerse operatör tuşa basar, 400 yer ve sebebi ancak toast'ta görür.

describe('canUnlinkOrderLine', () => {
  it('ORDER_PRODUCTION + tek bağ → kaldırılamaz, sebep dolu', () => {
    const v = canUnlinkOrderLine('ORDER_PRODUCTION', 1);
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('son bağı');
  });

  it('ORDER_PRODUCTION + birden çok bağ → kaldırılabilir', () => {
    expect(canUnlinkOrderLine('ORDER_PRODUCTION', 2).allowed).toBe(true);
  });

  it('STOCK_PRODUCTION tek bağla bile kaldırılabilir (tip yalanlanmıyor)', () => {
    expect(canUnlinkOrderLine('STOCK_PRODUCTION', 1).allowed).toBe(true);
  });

  it('tip bilinmiyorsa engellenmez — son sözü backend söyler', () => {
    expect(canUnlinkOrderLine(undefined, 1).allowed).toBe(true);
    expect(canUnlinkOrderLine(null, 1).allowed).toBe(true);
  });

  it('bağ yoksa (0) engel yok — zaten gösterilecek satır olmaz', () => {
    expect(canUnlinkOrderLine('ORDER_PRODUCTION', 0).allowed).toBe(false);
  });
});
