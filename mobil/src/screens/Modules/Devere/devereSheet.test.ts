// Kart genişliği SAF: yatay tablette min(%92, 780); küçük diyalog 520; telefon dikeyde ekran−32.
// Negatif sonda (2026-09-18, bir kezlik): tavan 780 → 460 yazıldı (eski dar sütun) → tablet satırları ❌.
import { devereSheetWidth, DEVERE_SHEET_MAX_WIDTH } from './devereSheet';

describe('devereSheetWidth', () => {
  it.each([
    [1280, 'md', 780], // 10" yatay tablet: tavan
    [1024, 'md', 780], // 8" yatay
    [800, 'md', 736], // %92
    [1280, 'sm', 520],
    [400, 'md', 368], // telefon dikey: ekran − 32 (%92 = 368 → aynı)
    [360, 'md', 328],
  ] as const)('%d px %s → %d', (w, size, beklenen) => {
    expect(devereSheetWidth(w, size)).toBe(beklenen);
  });
  it('tavanlar: md 780 · sm 520 — eski ~460 dar sütuna dönüş yok', () => {
    expect(DEVERE_SHEET_MAX_WIDTH.md).toBeGreaterThanOrEqual(760);
    expect(DEVERE_SHEET_MAX_WIDTH.sm).toBeGreaterThanOrEqual(480);
  });
});
