import { describe, expect, it } from "vitest";
import { entryWarnings } from "./entry-warnings";

describe("entryWarnings — top girişi sunucu uyarıları (Devere Faz 4)", () => {
  it("uyarı yoksa boş dizi (bugünkü davranış: ek toast yok)", () => {
    expect(entryWarnings({})).toEqual([]);
    expect(entryWarnings({ warnings: [] })).toEqual([]);
    expect(entryWarnings(null)).toEqual([]);
  });
  it("⭐ metin sunucudan aynen; boş satır düşer", () => {
    expect(entryWarnings({ warnings: ["LV1: kalan 875 m yetmedi — 875 m yazıldı, 375 m açık (kalanı düzeltin).", " ", "T1: indirme anında tezgahta bağlı levent yoktu — çözgü tüketimi yazılmadı (elle tüketim gerekebilir)."] })).toEqual([
      "LV1: kalan 875 m yetmedi — 875 m yazıldı, 375 m açık (kalanı düzeltin).",
      "T1: indirme anında tezgahta bağlı levent yoktu — çözgü tüketimi yazılmadı (elle tüketim gerekebilir).",
    ]);
  });
});
