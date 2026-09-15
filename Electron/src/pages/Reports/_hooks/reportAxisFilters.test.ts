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
import type { AxisKey, Destination } from "./reportAxisFilters";
import { axisNotes, axisParams, droppedNote, filterNotes, labelsOf, parseCsv, toCsv } from "./reportAxisFilters";

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

describe("axisNotes — sayfanın süzgeç satırları (ekran = çıktı)", () => {
  const secenekler = {
    customerId: [{ id: "c1", ad: "Acme" }],
    itemId: [{ id: "i1", ad: "Poplin" }],
    reasonCode: [{ code: "STOK_YOK", ad: "Stok yok" }],
  };
  const bos: Record<AxisKey, string[]> & { destination: Destination | "" } = {
    customerId: [], itemId: [], colorId: [], subcontractorId: [], reasonCode: [], destination: "",
  };

  it("süzgeç yokken HİÇ satır yok — ek şerh de kesti cümlesi de yazılmaz", () => {
    expect(axisNotes({ eksenler: ["customerId"], destination: true, secenekler, sel: { ...bos }, dusenSatir: 5, ek: ["ABC şerhi"] })).toEqual([]);
  });

  it("etiket SÖZLÜKTEN gelir; her sayfa kendi adını uydurmaz", () => {
    const n = axisNotes({ eksenler: ["itemId"], secenekler, sel: { ...bos, itemId: ["i1"] } });
    expect(n).toEqual(["SÜZGEÇ — Kumaş: Poplin."]);
  });

  it("⭐ eksenin KENDİ şerhi taşınır: reasonCode 'yalnız PAY' · destination 'müşteri varsayılanı'", () => {
    const n = axisNotes({
      eksenler: ["reasonCode"],
      destination: true,
      secenekler,
      sel: { ...bos, reasonCode: ["STOK_YOK"], destination: "EXPORT" },
    });
    expect(n[0]).toContain("Yalnız PAYI süzer");
    expect(n[1]).toContain("İhracat");
    expect(n[1]).toContain("VARSAYILAN hedef");
  });

  it("⭐ ek şerh (ABC evreni) ve kesti cümlesi süzgeç AÇIKKEN ve SIRAYLA eklenir", () => {
    const n = axisNotes({
      eksenler: ["customerId"],
      secenekler,
      sel: { ...bos, customerId: ["c1"] },
      dusenSatir: 3,
      ek: ["ABC süzülmüş evrende"],
    });
    expect(n).toEqual(["SÜZGEÇ — Müşteri: Acme.", "ABC süzülmüş evrende", "Süzgeç 3 satırı kapsam dışında bıraktı."]);
  });
});
