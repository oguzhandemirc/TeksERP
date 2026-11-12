// =============================================================================
// BEKÇİ — EKSEN SEÇİCİSİNİN SAF YARISI: süzgeç etiketi ÇIKTIYA doğru geçer
// =============================================================================
// Makine/vardiya seçenek türeticileri ve Randıman/Pareto çıktı başlıkları emekli
// sayfalarıyla kalktı (2026-11-12); kalan saf yardımcı `optionLabel`dır.
// =============================================================================
import { describe, expect, it } from "vitest";
import { optionLabel } from "./dokumaFilters";

describe("dokuma rapor süzgeci — saf yarı", () => {
  it("etiket çözümü: bilinmeyen id ham basılır, boş seçim etiketsizdir", () => {
    const opts = [{ id: "a", label: "T-01 · Tezgah T-01" }];
    expect(optionLabel(opts, "a")).toBe("T-01 · Tezgah T-01");
    expect(optionLabel(opts, "zz")).toBe("zz");
    expect(optionLabel(opts, "")).toBeNull();
  });
});
