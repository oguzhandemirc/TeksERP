// =============================================================================
// CIRCIR — yerleşik tarih girdisi (`type="date"|"datetime-local"|"month"`) sayısı TABANDAN aşağı iner, çıkamaz
// =============================================================================
// İki sonda (2026-09-17, kırmızı görüldü): ① herhangi bir dosyaya `<input type="date" />` eklenince "artmadı" ❌;
// ② bir dosya DatePickerInput'a çevrilince "taban düşer" — sayı TABAN'ın altına iner ve bu test TABAN'ı düşürmeyi
// ister (bilgi satırı). Son parti: TABAN = 0.
import { describe, it, expect } from "vitest";
import path from "node:path";
import { nativeDateInputHits, yorumlariSoy, NATIVE_DATE_INPUT_RE } from "../date-input-kaynak";

/** TABAN — parti parti düşer: 59 (ilk ölçüm 2026-09-17, yorumsuz; ham grep 76 idi) → … → 0. Sayı düşünce buraya YAZ (cırcır iki yönlü). */
export const TABAN = 48;

const SRC = path.resolve(__dirname, "../..");

describe("takvim girdisi cırcırı", () => {
  const hits = nativeDateInputHits(SRC);
  const toplam = hits.reduce((s, h) => s + h.count, 0);

  it(`⭐ yerleşik tarih girdisi ARTMADI — ${toplam} ≤ TABAN ${TABAN}`, () => {
    expect(toplam, hits.map((h) => `${h.file}:${h.count}`).join("\n")).toBeLessThanOrEqual(TABAN);
  });

  it("⭐ cırcır iki yönlü: sayı TABAN'ın altına indiyse TABAN düşürülür (borç görünür kalmasın)", () => {
    expect(toplam, `taban ${TABAN} → ${toplam}: TABAN sabitini ${toplam} yap`).toBe(TABAN);
  });

  it("sayaç yorumu saymaz, JSX'i sayar", () => {
    expect(yorumlariSoy('/** `<input type="date">` */ const a = 1;').match(NATIVE_DATE_INPUT_RE)).toBeNull();
    expect(yorumlariSoy('// <input type="date">\nconst a = 1;').match(NATIVE_DATE_INPUT_RE)).toBeNull();
    expect('<Input type="date" />'.match(NATIVE_DATE_INPUT_RE)).toHaveLength(1);
    expect("<input type='datetime-local' />".match(NATIVE_DATE_INPUT_RE)).toHaveLength(1);
  });
});
