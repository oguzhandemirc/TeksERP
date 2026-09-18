// Kart genişliği SAF: yatay tablette min(%92, 780); küçük diyalog 520; telefon dikeyde ekran−32.
// (Devere'nin `devereSheetWidth` testinden taşındı — iskelet genel `ModuleSheet` oldu.)
// Negatif sonda (2026-09-18, bir kezlik, 87abea91): tavan 780 → 460 yazıldı (eski dar sütun) → tablet satırları ❌.
import { moduleSheetWidth, MODULE_SHEET_MAX_WIDTH } from './ModuleSheet';

describe('moduleSheetWidth', () => {
  it.each([
    [1280, 'md', 780], // 10" yatay tablet: tavan
    [1024, 'md', 780], // 8" yatay
    [800, 'md', 736], // %92
    [1280, 'sm', 520],
    [400, 'md', 368], // telefon dikey: ekran − 32 (%92 = 368 → aynı)
    [360, 'md', 328],
  ] as const)('%d px %s → %d', (w, size, beklenen) => {
    expect(moduleSheetWidth(w, size)).toBe(beklenen);
  });
  it('tavanlar: md 780 · sm 520 — eski ~460 dar sütuna dönüş yok', () => {
    expect(MODULE_SHEET_MAX_WIDTH.md).toBeGreaterThanOrEqual(760);
    expect(MODULE_SHEET_MAX_WIDTH.sm).toBeGreaterThanOrEqual(480);
  });
});
