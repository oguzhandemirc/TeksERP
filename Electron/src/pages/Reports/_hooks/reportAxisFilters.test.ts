// =============================================================================
// BEKÇİ — EKSEN SÜZGECİNİN SAF YARISI (R5b-c)
// =============================================================================
// Üç iddia ölçülür: ① "Tümü" seçiliyken istekte anahtar HİÇ GİTMEZ (bugünkü
// davranış bayt bayt korunur) ② CSV ayrıştırma tek yerde ve boşluğa/tekrara
// dayanıklı ③ süzgeç satırı ÇIKTIYA giden metni üretir ve niteleyicileri
// (müşteri varsayılanı · yalnız pay) TAŞIR — kâğıtta olmayan uyarı yoktur.
//
// Negatif sondalar (bir kezlik, cp+sha256 ile geri alındı): `axisParams`ten
// boş-eksen koşulu kaldırıldı → ⭐① ❌ · `filterNotes`ten şerh eki düşürüldü → ⭐③ ❌.
// =============================================================================
import { describe, expect, it } from "vitest";
import { axisParams, droppedNote, filterNotes, labelsOf, parseCsv, toCsv } from "./reportAxisFilters";

describe("eksen süzgeci — saf yarı", () => {
  it("CSV ayrıştırma: boşluk kırpılır, tekrar elenir, sıra korunur", () => {
    expect(parseCsv("a, b ,a,,c")).toEqual(["a", "b", "c"]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv(null)).toEqual([]);
  });

  it("boş liste URL'den anahtarı SİLER (null döner)", () => {
    expect(toCsv([])).toBeNull();
    expect(toCsv([" ", ""])).toBeNull();
    expect(toCsv(["a", "b"])).toBe("a,b");
  });

  it("⭐ 'Tümü' seçiliyken istekte anahtar HİÇ GİTMEZ", () => {
    expect(axisParams({ customerId: [], itemId: [], destination: "" })).toEqual({});
    expect(axisParams({ customerId: ["c1"], destination: "EXPORT" })).toEqual({ customerId: "c1", destination: "EXPORT" });
  });

  it("etiket çözümü: id de kod da anahtar olur, bilinmeyen ham basılır", () => {
    const musteriler = [{ id: "c1", ad: "Acme" }];
    const sebepler = [{ code: "STOK_YOK", ad: "Stok yok" }];
    expect(labelsOf(musteriler, ["c1"])).toEqual(["Acme"]);
    expect(labelsOf(sebepler, ["STOK_YOK"])).toEqual(["Stok yok"]);
    expect(labelsOf(musteriler, ["zzz"])).toEqual(["zzz"]);
    expect(labelsOf(undefined, [])).toEqual([]);
  });

  it("⭐ süzgeç satırı NİTELEYİCİYİ taşır; seçim yoksa satır YOK", () => {
    const n = filterNotes([
      { eksen: "Müşteri", degerler: ["Acme"] },
      { eksen: "Sevk hedefi", degerler: ["İhracat"], serh: "Müşteri kartındaki VARSAYILAN hedef — sevkin fiili hedefi değil." },
      { eksen: "Kumaş", degerler: [] },
    ]);
    expect(n).toHaveLength(2);
    expect(n[0]).toBe("SÜZGEÇ — Müşteri: Acme.");
    expect(n[1]).toContain("VARSAYILAN hedef");
  });

  it("⭐ 'süzgeç kesti' cümlesi boş tabloyu süzülmüş tablodan ayırır", () => {
    expect(droppedNote(0)).toBeNull();
    expect(droppedNote(undefined)).toBeNull();
    expect(droppedNote(12)).toBe("Süzgeç 12 satırı kapsam dışında bıraktı.");
  });
});
