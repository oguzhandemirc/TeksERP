// =============================================================================
// BEKÇİ — filtre şeridinin kapsamı
// =============================================================================
// ⭐ "NE BEKLİYORUM?" SEKMESİNDE ARAMA/DURUM/TARİH ÇİZİLMEZ. Bu üç kutu o
//    sekmeyi besleyen `open-lines` ucunda YOKTUR; çizili bırakılırlarsa kullanıcı
//    yazar, liste değişmez ve ekran "bozuk" görünür — hata da log da çıkmadan.
// ⭐ TEDARİKÇİ İKİ SEKMEDE DE ÇİZİLİR: iki uç da o süzgeci tanıyor ve "şu
//    tedarikçiden ne bekliyorum" iki görünümde de aynı sorudur.
// =============================================================================
import { describe, it, expect } from "vitest";
import { poFilterControls } from "./filterScope";

describe("poFilterControls", () => {
  it("Siparişler sekmesinde tüm kutular çizilir", () => {
    expect(poFilterControls("orders")).toEqual({
      search: true,
      status: true,
      dateRange: true,
      supplier: true,
    });
  });

  it("⭐ 'Ne bekliyorum?' sekmesinde ÖLÜ kutular çizilmez", () => {
    const c = poFilterControls("open-lines");
    expect(c.search).toBe(false);
    expect(c.status).toBe(false);
    expect(c.dateRange).toBe(false);
  });

  it("⭐ tedarikçi daraltması İKİ sekmede de durur", () => {
    expect(poFilterControls("orders").supplier).toBe(true);
    expect(poFilterControls("open-lines").supplier).toBe(true);
  });
});
