// =============================================================================
// BEKÇİ — EKSEN SÜZGECİNİN SAF YARISI (R5b-c)
// =============================================================================
// Üç iddia ölçülür: ① "Tümü" seçiliyken istekte anahtar HİÇ GİTMEZ (bugünkü
// davranış bayt bayt korunur) ② CSV ayrıştırma tek yerde ve boşluğa/tekrara
// dayanıklı ③ süzgeç satırı ÇIKTIYA giden metni üretir ve niteleyicileri
// (bugünkü cari/şube yönü · yalnız pay) TAŞIR — kâğıtta olmayan uyarı yoktur.
//
// Negatif sondalar (bir kezlik, cp+sha256 ile geri alındı): `axisParams`ten
// boş-eksen koşulu kaldırıldı → ⭐① ❌ · `filterNotes`ten şerh eki düşürüldü → ⭐③ ❌.
// =============================================================================
import { describe, expect, it } from "vitest";
import type { AxisKey, Destination } from "./reportAxisFilters";
import { beamLotNotes, axisNotes, axisParams, droppedNote, filterNotes, labelsOf, parseCsv, toCsv, unappliedAxes, unappliedNote } from "./reportAxisFilters";

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
      { eksen: "Cari/şube yönü (bugünkü)", degerler: ["İhracat"], serh: "Siparişin BUGÜNKÜ cari/şube yönü (şube yönü, boşsa carinin) — sevkin donmuş yönü değil; kart değişince geçmiş raporun kümesi de değişir." },
      { eksen: "Kumaş", degerler: [] },
    ]);
    expect(n).toHaveLength(2);
    expect(n[0]).toBe("SÜZGEÇ — Müşteri: Acme.");
    expect(n[1]).toContain("BUGÜNKÜ cari/şube yönü");
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
    customerId: [], itemId: [], colorId: [], subcontractorId: [], reasonCode: [], cariId: [], destination: "",
  };

  it("süzgeç yokken HİÇ satır yok — ek şerh de kesti cümlesi de yazılmaz", () => {
    expect(axisNotes({ eksenler: ["customerId"], destination: true, secenekler, sel: { ...bos }, dusenSatir: 5, ek: ["ABC şerhi"] })).toEqual([]);
  });

  it("etiket SÖZLÜKTEN gelir; her sayfa kendi adını uydurmaz", () => {
    const n = axisNotes({ eksenler: ["itemId"], secenekler, sel: { ...bos, itemId: ["i1"] } });
    expect(n).toEqual(["SÜZGEÇ — Kumaş: Poplin."]);
  });

  it("⭐ eksenin KENDİ şerhi taşınır: reasonCode 'yalnız PAY' · destination 'bugünkü cari/şube yönü'", () => {
    const n = axisNotes({
      eksenler: ["reasonCode"],
      destination: true,
      secenekler,
      sel: { ...bos, reasonCode: ["STOK_YOK"], destination: "EXPORT" },
    });
    expect(n[0]).toContain("Yalnız PAYI süzer");
    expect(n[1]).toContain("İhracat");
    expect(n[1]).toContain("BUGÜNKÜ cari/şube yönü");
  });

  it("⭐ sevk raporunda yön ekseni SEVKİYATIN donmuş yönüdür — etiket ve şerh sipariş yönünden ayrı", () => {
    const n = axisNotes({ eksenler: [], destination: "shipment", secenekler, sel: { ...bos, destination: "EXPORT" } });
    expect(n[0]).toContain("Sevkiyat yönü (sevk anında)");
    expect(n[0]).toContain("SEVK ANINDA donmuş");
    expect(n[0]).not.toContain("BUGÜNKÜ cari/şube");
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

describe("beamLotNotes — levent/lot şerhleri", () => {
  it("süzgeç yokken satır YOK", () => {
    expect(beamLotNotes({})).toEqual([]);
    expect(beamLotNotes({ beamLabel: null, lotNo: "" })).toEqual([]);
  });

  it("⭐ lot ekseninin LEVENT üzerinden süzdüğü yazılı ('bu lotun topları' değil)", () => {
    const n = beamLotNotes({ lotNo: "LOT-9" });
    expect(n[0]).toContain("İplik lotu: LOT-9");
    expect(n[0]).toContain("LEVENT üzerinden süzer");
  });

  it("⭐ eşleşen levent SIFIRSA boşluğun sebebi yazılır (hata değil, sonuç)", () => {
    const n = beamLotNotes({ lotNo: "YOK", suzgec: { lotNo: "YOK", levent: 0, dusenSatir: 12 } });
    expect(n.some((x) => x.includes("Eşleşen levent YOK"))).toBe(true);
    expect(n.some((x) => x.includes("12 satırı kapsam dışında"))).toBe(true);
  });

  it("levent sayısı ve düşen satır sunucunun YANKISINDAN gelir, sayfadan değil", () => {
    const n = beamLotNotes({ beamLabel: "L-77", suzgec: { warpBeamId: "b1", levent: 3, dusenSatir: 0 } });
    expect(n[0]).toBe("SÜZGEÇ — Levent: L-77.");
    expect(n[1]).toBe("Süzgeç 3 leventle eşleşti.");
    expect(n).toHaveLength(2);
  });
});

describe("sunucu yankısı — seçili eksen uygulanmadıysa şerh söyler (d9 L4)", () => {
  it("⭐ yankı yok → seçili her eksen 'uygulanmadı'; yankı var → yalnız eksik olan; seçim yoksa boş", () => {
    const sel = { customerId: ["c1"], itemId: [], destination: "EXPORT" as const };
    expect(unappliedAxes(sel, ["customerId", "itemId", "destination"], undefined)).toEqual(["customerId", "destination"]);
    expect(unappliedAxes(sel, ["customerId", "itemId", "destination"], { customerId: ["c1"] })).toEqual(["destination"]);
    expect(unappliedAxes(sel, ["customerId", "itemId", "destination"], { customerId: ["c1"], destination: "EXPORT" })).toEqual([]);
    expect(unappliedAxes({ customerId: [], itemId: [], destination: "" }, ["customerId"], undefined)).toEqual([]);
  });
  it("axisNotes: yankı verildi ve eksik → uyarı satırı sona eklenir; yankı anahtarı hiç geçilmedi → eski çıktı bayt bayt", () => {
    const secenekler = { customerId: [{ id: "c1", ad: "Müşteri A" }] };
    const sel = { customerId: ["c1"], itemId: [], colorId: [], subcontractorId: [], reasonCode: [], cariId: [], destination: "" as const };
    const eski = axisNotes({ eksenler: ["customerId"], secenekler, sel });
    expect(eski).toEqual(["SÜZGEÇ — Müşteri: Müşteri A."]);
    expect(axisNotes({ eksenler: ["customerId"], secenekler, sel, uygulanan: { customerId: ["c1"] } })).toEqual(eski);
    expect(axisNotes({ eksenler: ["customerId"], secenekler, sel, uygulanan: null })).toEqual([...eski, unappliedNote(["Müşteri"])]);
    expect(axisNotes({ eksenler: ["customerId"], secenekler, sel, uygulanan: undefined })).toEqual(eski);
  });
});
