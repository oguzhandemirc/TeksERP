import { canUnlinkOrderLine } from './canUnlinkOrderLine';

// Backend kuralının istemci aynası (2026-08-21): siparişe özel iş emrinin SON bağı
// artık kaldırılabilir — iş emri STOK üretimine döner. Tek engel: hedef kumaş yoksa.
// Ayna sertleşirse operatör meşru işi yapamaz; gevşerse 400 yer ve sebebi toast'ta görür.

describe('canUnlinkOrderLine', () => {
  it('ORDER_PRODUCTION + tek bağ + hedef kumaş var → kaldırılabilir, STOK uyarısı', () => {
    const v = canUnlinkOrderLine('ORDER_PRODUCTION', 1, true);
    expect(v.allowed).toBe(true);
    expect(v.becomesStock).toBe(true);
    expect(v.reason).toBeNull();
  });

  it('ORDER_PRODUCTION + tek bağ + hedef kumaş YOK → engel, sebep hedef kumaşı söyler', () => {
    const v = canUnlinkOrderLine('ORDER_PRODUCTION', 1, false);
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('hedef kumaş');
    expect(v.becomesStock).toBe(false);
  });

  it('ORDER_PRODUCTION + birden çok bağ → kaldırılabilir, STOK uyarısı YOK', () => {
    const v = canUnlinkOrderLine('ORDER_PRODUCTION', 2, false);
    expect(v.allowed).toBe(true);
    expect(v.becomesStock).toBe(false);
  });

  it('STOCK_PRODUCTION tek bağla kaldırılabilir, tip zaten stok (uyarı yok)', () => {
    const v = canUnlinkOrderLine('STOCK_PRODUCTION', 1, false);
    expect(v.allowed).toBe(true);
    expect(v.becomesStock).toBe(false);
  });

  it('tip bilinmiyorsa engellenmez — son sözü backend söyler', () => {
    expect(canUnlinkOrderLine(undefined, 1).allowed).toBe(true);
    expect(canUnlinkOrderLine(null, 1).allowed).toBe(true);
  });

  it('hedef kumaş bilgisi verilmezse varsayılan "var" (engellemez)', () => {
    expect(canUnlinkOrderLine('ORDER_PRODUCTION', 1).allowed).toBe(true);
  });
});
