import { describe, it, expect } from "vitest";
import { buildDispatchReportSheets } from "./accounting-export";
import type { DispatchReport } from "./types";

// Tek sevk fişi — yalnız ad rejiminin okuduğu alanlar (kalanı accounting-export.test.ts).
const report: DispatchReport = {
  header: {
    shipmentNo: "SVK-1",
    customerName: "X MÜŞTERİ",
    customerCode: "C1",
    branchName: null,
    branchCode: null,
    procedureCode: null,
    destination: "DOMESTIC",
    status: "DISPATCHED",
    date: "2026-06-28T00:00:00.000Z",
  },
  products: [],
  sacks: [],
  cekiRows: [],
  totals: { totalRolls: 3, totalMeters: 151, totalKg: 0, sackCount: 1 },
  frozen: true,
  docStatus: "ACTIVE",
  docVersion: 1,
  returns: { count: 0, meters: 0 },
};

// =============================================================================
// AD REJİMİ — Excel, irsaliyeyle AYNI adı basmalı (2026-09-10 saha bulgusu)
// -----------------------------------------------------------------------------
// Fabrikadan gelen iki dosya AYNI sevkiyata aitti: PDF'te `BS-6650 EKRU`
// (müşterinin adı), Excel'de `LİNEN EKRU` (bizim adımız). İkisi de aynı DONMUŞ
// belgeden besleniyordu — ayrışan şey KARARdı: rejimi yalnız irsaliyeyi çizen
// taraf biliyordu, Excel hiç sormuyordu. Ayarın kendi açıklaması ise "kapsam
// sevk irsaliyesi + MUHASEBE FİŞİDİR" diyor.
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-10): `r.showCustomerName` dalı kaldırılıp
//    kolon her zaman `name`e bağlanınca §2 ve §3 KIRMIZI; `docNameMode ?? VARSAYILAN`
//    yerine "her zaman müşterideki" yazılınca §1 KIRMIZI.
// =============================================================================
const adliReport = (
  docNameMode: DispatchReport["docNameMode"],
): DispatchReport => ({
  ...report,
  products: [{ name: "LİNEN EKRU 330cm.", customerName: "BS-6650 EKRU 330cm.", rollCount: 3, totalMeters: 151 }],
  cekiRows: [
    { rollId: "r1", sackCode: "CV1", barcode: "T1", desen: "LİNEN", varyant: "EKRU", customerDesen: "BS-6650", customerVaryant: null, meters: 151, kg: 0 },
  ],
  docNameMode,
});

describe("buildDispatchReportSheets — ad rejimi", () => {
  it("§1 ⭐ rejim YOKSA (eski sunucu) bugünkü davranış: yalnız BİZİM adımız", () => {
    const sheets = buildDispatchReportSheets(adliReport(undefined));
    expect(sheets[0]!.columns.map((c) => c.key)).toEqual(["name", "rollCount", "totalMeters"]);
    expect(sheets[2]!.columns.map((c) => c.key)).toEqual(["sackCode", "barcode", "desen", "varyant", "meters", "kg"]);
  });

  it("§2 ⭐ 'müşterideki' seçiliyken Excel MÜŞTERİNİN adını basar (irsaliyeyle aynı)", () => {
    const sheets = buildDispatchReportSheets(
      adliReport({ showOurName: false, showCustomerName: true, cekiShowOurName: false, cekiShowCustomerName: true, productColorSplit: false }),
    );
    expect(sheets[0]!.columns.map((c) => c.key)).toEqual(["docCustomerName", "rollCount", "totalMeters"]);
    expect(sheets[0]!.rows[0]).toMatchObject({ docCustomerName: "BS-6650 EKRU 330cm." });
    // TOPLAM etiketi ÖNDEKİ ad kolonuna yazılır; yoksa toplam satırı etiketsiz kalırdı.
    expect(sheets[0]!.totalRow).toMatchObject({ docCustomerName: "TOPLAM" });
    expect(sheets[2]!.columns.map((c) => c.key)).toEqual(["sackCode", "barcode", "docCustomerDesen", "docCustomerVaryant", "meters", "kg"]);
    expect(sheets[2]!.rows[0]).toMatchObject({ docCustomerDesen: "BS-6650" });
  });

  it("§2b ⭐ müşteri karşılığı YOKSA bizim adımız basılır (hücre boş kalmaz)", () => {
    const sheets = buildDispatchReportSheets(
      adliReport({ showOurName: false, showCustomerName: true, cekiShowOurName: false, cekiShowCustomerName: true, productColorSplit: false }),
    );
    // `customerVaryant: null` — irsaliyedeki fail-open kuralının aynısı.
    expect(sheets[2]!.rows[0]).toMatchObject({ docCustomerVaryant: "EKRU" });
  });

  it("§3 ⭐ 'ikisi de' seçiliyken İKİ ad da ayrı kolonda çıkar", () => {
    const sheets = buildDispatchReportSheets(
      adliReport({ showOurName: true, showCustomerName: true, cekiShowOurName: true, cekiShowCustomerName: true, productColorSplit: false }),
    );
    expect(sheets[0]!.columns.map((c) => c.key)).toEqual(["name", "docCustomerName", "rollCount", "totalMeters"]);
    expect(sheets[2]!.columns.map((c) => c.key)).toEqual(["sackCode", "barcode", "desen", "varyant", "docCustomerDesen", "docCustomerVaryant", "meters", "kg"]);
  });

  it("§4 çeki KENDİ rejimini izler — ürün listesinden bağımsız çevrilebilir", () => {
    const sheets = buildDispatchReportSheets(
      adliReport({ showOurName: true, showCustomerName: false, cekiShowOurName: true, cekiShowCustomerName: true, productColorSplit: false }),
    );
    expect(sheets[0]!.columns.map((c) => c.key)).toEqual(["name", "rollCount", "totalMeters"]);
    expect(sheets[2]!.columns.map((c) => c.key)).toContain("docCustomerDesen");
  });

  it("§5 kolon çizilmiyorsa satıra o anahtar EKLENMEZ", () => {
    const sheets = buildDispatchReportSheets(adliReport(undefined));
    expect(sheets[0]!.rows[0]).not.toHaveProperty("docCustomerName");
    expect(sheets[2]!.rows[0]).not.toHaveProperty("docCustomerDesen");
  });

  // ---------------------------------------------------------------------------
  // AYRIK KİP (`productColorSplit`) — irsaliyeyle HÜCRE HÜCRE aynı (2026-09-14).
  // Şikâyetin ikinci yüzü: irsaliye ayrık kipte "BS-6650 330cm." + boş renk
  // basarken fiş "BS-6650 EKRU 330cm." (bizim rengimiz yapışık) basıyordu.
  // ⭐ NEGATİF SONDA: `colorSplit` dalı kaldırılınca §6/§6b KIRMIZI; renk hücresine
  //    `?? p.name` fallback yazılınca §6b KIRMIZI; ikizsiz raporda `customerItemOnly`
  //    düşüşü kaldırılınca §7 KIRMIZI.
  // ---------------------------------------------------------------------------
  const ayrikMode = { showOurName: false, showCustomerName: true, cekiShowOurName: false, cekiShowCustomerName: true, productColorSplit: true };
  const ikizliReport = (): DispatchReport => ({
    ...adliReport(ayrikMode),
    products: [
      { name: "LİNEN EKRU 330cm.", customerName: "BS-6650 EKRU 330cm.", customerItemOnly: "BS-6650 330cm.", customerColorOnly: null, rollCount: 3, totalMeters: 151 },
      { name: "LİNEN BEJ 330cm.", customerName: "BS-6650 SAND 330cm.", customerItemOnly: "BS-6650 330cm.", customerColorOnly: "SAND", rollCount: 1, totalMeters: 40 },
    ],
  });

  it("§6 ⭐ ayrık kipte kumaş adı ve renk AYRI kolonda — irsaliyenin düzeniyle aynı", () => {
    const sheets = buildDispatchReportSheets(ikizliReport());
    expect(sheets[0]!.columns.map((c) => c.key)).toEqual(["docCustomerName", "docCustomerColor", "rollCount", "totalMeters"]);
    expect(sheets[0]!.rows[1]).toMatchObject({ docCustomerName: "BS-6650 330cm.", docCustomerColor: "SAND" });
    expect(sheets[0]!.totalRow).toMatchObject({ docCustomerName: "TOPLAM" });
  });

  it("§6b ⭐ renk karşılığı YOKSA hücre BOŞ — bizim rengimiz müşteri adına YAPIŞMAZ", () => {
    const sheets = buildDispatchReportSheets(ikizliReport());
    expect(sheets[0]!.rows[0]).toMatchObject({ docCustomerName: "BS-6650 330cm.", docCustomerColor: "" });
  });

  it("§6c bayrak KAPALIYKEN ikizler taşınsa da çıktı bugünkü birleşik dize (bayt eşitliği)", () => {
    const kapali = buildDispatchReportSheets({ ...ikizliReport(), docNameMode: { ...ayrikMode, productColorSplit: false } });
    const ikizsiz = buildDispatchReportSheets(adliReport({ ...ayrikMode, productColorSplit: false }));
    expect(kapali[0]!.columns).toEqual(ikizsiz[0]!.columns);
    expect(kapali[0]!.rows[0]).toMatchObject({ docCustomerName: "BS-6650 EKRU 330cm." });
    expect(kapali[0]!.rows[0]).not.toHaveProperty("docCustomerColor");
  });

  it("§7 eski donmuş belge ikizleri taşımıyorsa birleşik ada düşer (irsaliye gibi), renk boş", () => {
    const sheets = buildDispatchReportSheets(adliReport(ayrikMode));
    expect(sheets[0]!.rows[0]).toMatchObject({ docCustomerName: "BS-6650 EKRU 330cm.", docCustomerColor: "" });
  });

  it("§7b rejim `bizdeki` iken bayrak açık olsa da müşteri kolonu DOĞMAZ (rejim üstte)", () => {
    const sheets = buildDispatchReportSheets(adliReport({ ...ayrikMode, showOurName: true, showCustomerName: false }));
    expect(sheets[0]!.columns.map((c) => c.key)).toEqual(["name", "rollCount", "totalMeters"]);
  });
});
