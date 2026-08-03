import { describe, it, expect } from "vitest";
import {
  accountingExportFileName,
  buildAccountingWorkbookSheets,
  buildDispatchReportSheets,
} from "./accounting-export";
import type { AccountingExportData, DispatchReport } from "./types";

// Tek sevk fişi (muhasebe) — backend getDispatchReport ile birebir şekil.
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
  products: [{ name: "MC 156 BEYAZ 150cm.", rollCount: 2, totalMeters: 100 }],
  sacks: [{ code: "AMB1", seq: 1, totalMeters: 100, totalKg: 50, packageCount: 2 }],
  cekiRows: [
    { rollId: "r1", sackCode: "AMB1", barcode: "B1", desen: "MC 156", varyant: "BEYAZ", meters: 60, kg: 50 },
    { rollId: "r2", sackCode: "AMB1", barcode: "B2", desen: "MC 156", varyant: "BEYAZ", meters: 40, kg: 0 },
  ],
  totals: { totalRolls: 2, totalMeters: 100, totalKg: 50, sackCount: 1 },
  frozen: true,
  docStatus: "ACTIVE",
  docVersion: 1,
  returns: { count: 0, meters: 0 },
};

const data: AccountingExportData = {
  range: { from: "2026-06-01T00:00:00.000Z", to: "2026-06-28T00:00:00.000Z", field: "dispatchedAt" },
  shipments: [
    {
      shipmentNo: "S1",
      dispatchedAt: "2026-06-10T08:00:00.000Z",
      customerCode: "C1",
      customerName: "X",
      taxNumber: "123",
      branchName: "",
      branchCode: "",
      destination: "EXPORT",
      procedureCode: "",
      plateNumber: "",
      driverName: "",
      carrier: "",
      sackCount: 1,
      rollCount: 2,
      totalMeters: 100,
      totalKg: 50,
      invoiceNo: "FTR2026000118",
      invoicedAt: "2026-06-11T09:30:00.000Z",
    },
  ],
  detail: [
    {
      shipmentNo: "S1",
      dispatchedAt: "2026-06-10T08:00:00.000Z",
      customerName: "X",
      orderNos: "O1",
      itemName: "A",
      colorName: "",
      width: 150,
      rollCount: 2,
      meters: 100,
    },
  ],
  byCustomer: [
    { customerCode: "C1", customerName: "X", taxNumber: "123", shipmentCount: 1, sackCount: 1, rollCount: 2, totalMeters: 100, totalKg: 50 },
  ],
  byProduct: [{ itemName: "A", colorName: "", width: 150, rollCount: 2, totalMeters: 100 }],
  returns: [
    { returnedAt: "2026-06-12T00:00:00.000Z", customerName: "X", fromShipmentNo: "S1", barcode: "B1", itemName: "A", colorName: "", width: 150, meters: 10, reason: "hata" },
  ],
  totals: { shipmentCount: 1, sackCount: 1, rollCount: 2, totalMeters: 100, totalKg: 50, returnMeters: 10 },
};

describe("buildDispatchReportSheets — tek sevk fişi (3 sayfa)", () => {
  const sheets = buildDispatchReportSheets(report);

  it("3 sayfa: Kumaş/Çuval/Çeki", () => {
    expect(sheets.map((s) => s.name)).toEqual(["Kumaş Listesi", "Çuval Listesi", "Çeki Listesi"]);
  });

  it("Kumaş sayfası kolon→veri eşlemesi + TOPLAM satırı", () => {
    const urun = sheets[0]!;
    expect(urun.columns.map((c) => c.key)).toEqual(["name", "rollCount", "totalMeters"]);
    expect(urun.rows).toEqual(report.products);
    expect(urun.totalRow).toMatchObject({ name: "TOPLAM", rollCount: 2, totalMeters: 100 });
  });

  it("Çuval sayfası kg/paket + TOPLAM", () => {
    const cuval = sheets[1]!;
    expect(cuval.columns.map((c) => c.key)).toEqual(["code", "totalMeters", "totalKg", "packageCount"]);
    expect(cuval.totalRow).toMatchObject({ totalMeters: 100, totalKg: 50 });
  });

  it("Çeki sayfası tüm topları satırlar (totalRow yok)", () => {
    const ceki = sheets[2]!;
    expect(ceki.rows).toHaveLength(2);
    expect(ceki.columns.map((c) => c.key)).toEqual(["sackCode", "barcode", "desen", "varyant", "meters", "kg"]);
    expect(ceki.totalRow).toBeUndefined();
  });
});

// Fasondan doğrudan sevk fişi — backend getDirectShipmentDispatchReport ile aynı şekil:
// çuval YOK (sacks:[]), kg 0, çeki satırları top-başına (sackCode "—").
const directReport: DispatchReport = {
  header: {
    shipmentNo: "DSK-1",
    customerName: "FASON MÜŞTERİ",
    customerCode: "C2",
    branchName: null,
    branchCode: null,
    procedureCode: null,
    destination: "DOMESTIC",
    status: "DISPATCHED",
    date: "2026-06-28T00:00:00.000Z",
  },
  products: [{ name: "PATOS LACIVERT 250cm.", rollCount: 2, totalMeters: 250 }],
  sacks: [],
  cekiRows: [
    { rollId: "r1", sackCode: "—", barcode: "B1", desen: "PATOS", varyant: "LACIVERT", meters: 100, kg: 0 },
    { rollId: "r2", sackCode: "—", barcode: "B2", desen: "PATOS", varyant: "LACIVERT", meters: 150, kg: 0 },
  ],
  totals: { totalRolls: 2, totalMeters: 250, totalKg: 0, sackCount: 0 },
  frozen: true,
  docStatus: "ACTIVE",
  docVersion: 1,
  returns: { count: 0, meters: 0 },
};

describe("buildDispatchReportSheets — fasondan doğrudan sevk (çuval yok)", () => {
  const sheets = buildDispatchReportSheets(directReport);

  it("yine 3 sayfa üretir; Çuval sayfası boş", () => {
    expect(sheets.map((s) => s.name)).toEqual(["Kumaş Listesi", "Çuval Listesi", "Çeki Listesi"]);
    expect(sheets[1]!.rows).toEqual([]);
  });

  it("Kumaş + Çeki dolu, TOPLAM'lar 250m / 0 kg", () => {
    expect(sheets[0]!.rows).toEqual(directReport.products);
    expect(sheets[0]!.totalRow).toMatchObject({ rollCount: 2, totalMeters: 250 });
    expect(sheets[1]!.totalRow).toMatchObject({ totalMeters: 250, totalKg: 0 });
    expect(sheets[2]!.rows).toHaveLength(2);
  });
});

// Fiş SEVK ANINI gösterir (donmuş belge); sonradan alınan iade rakamlardan
// DÜŞÜLMEZ, yalnız dipnotla bildirilir. Dipnot Excel'in İÇİNDE durmalı — dosya
// elden ele dolaşırken "501 mi 452 mi" sorusunun cevabı orada olsun.
describe("buildDispatchReportSheets — brüt/iade dipnotu", () => {
  const notesOf = (r: DispatchReport) => buildDispatchReportSheets(r)[0]!.notes ?? [];

  it("donmuş + iadesiz: yalnız 'sevk anı (brüt)' notu", () => {
    const n = notesOf(report);
    expect(n).toHaveLength(1);
    expect(n[0]).toContain("SEVK ANINDAKİ");
    expect(n.join(" ")).not.toContain("iade");
  });

  it("iade varsa adet+metraj yazar ve DÜŞÜLMEDİĞİNİ söyler", () => {
    const n = notesOf({ ...report, returns: { count: 1, meters: 49 } });
    const joined = n.join(" ");
    expect(joined).toContain("1 top");
    expect(joined).toContain("49,0 m");
    expect(joined).toContain("DÜŞÜLMEMİŞTİR");
    // Rakamlar brüt kalmalı — dipnot toplamı değiştirmez.
    expect(buildDispatchReportSheets({ ...report, returns: { count: 1, meters: 49 } })[0]!
      .totalRow).toMatchObject({ totalMeters: 100 });
  });

  it("donmamış fiş TASLAK olarak işaretlenir", () => {
    const n = notesOf({ ...report, frozen: false, docStatus: null, docVersion: null });
    expect(n[0]).toContain("TASLAK");
  });

  it("iptal edilmiş irsaliye uyarısı basılır", () => {
    const n = notesOf({ ...report, docStatus: "VOIDED" });
    expect(n.join(" ")).toContain("İPTAL");
  });

  // Alanlar HTTP'den gelir; eski yanıt / farklı üretici bunları taşımayabilir.
  // Not basılmaması kabul edilebilir — export'un ÇÖKMESİ değil.
  it("alanları taşımayan yanıtta çökmez, sessizce not basmaz", () => {
    const legacy = { ...report } as Partial<DispatchReport>;
    delete legacy.frozen;
    delete legacy.returns;
    delete legacy.docStatus;
    const sheets = buildDispatchReportSheets(legacy as DispatchReport);
    expect(sheets).toHaveLength(3);
    expect(sheets[0]!.notes).toEqual([]);
    expect(sheets[0]!.totalRow).toMatchObject({ totalMeters: 100 });
  });
});

describe("buildAccountingWorkbookSheets — dönem dökümü (5 sayfa)", () => {
  const sheets = buildAccountingWorkbookSheets(data);

  it("5 sayfa: Sevk Listesi/Detay/İcmal·Müşteri/İcmal·Kumaş/İade", () => {
    expect(sheets.map((s) => s.name)).toEqual([
      "Sevk Listesi",
      "Detay",
      "İcmal · Müşteri",
      "İcmal · Kumaş",
      "İade",
    ]);
  });

  it("Sevk Listesi: EXPORT→Yurtdışı + tarih gerçek Date + TOPLAM", () => {
    const sevk = sheets[0]!;
    const row = sevk.rows[0] as { yon: string; dispatchedAt: unknown };
    expect(row.yon).toBe("Yurtdışı");
    expect(row.dispatchedAt).toBeInstanceOf(Date);
    expect(sevk.totalRow).toMatchObject({ totalMeters: 100, totalKg: 50 });
  });

  it("Sevk Listesi: fatura izi kolonları var ve tarih gerçek Date", () => {
    const sevk = sheets[0]!;
    const keys = sevk.columns.map((c) => c.key);
    expect(keys).toContain("invoiceNo");
    expect(keys).toContain("invoicedAt");
    const row = sevk.rows[0] as { invoiceNo: string; invoicedAt: unknown };
    expect(row.invoiceNo).toBe("FTR2026000118");
    // Excel'de tarih hücresi olsun diye string DEĞİL Date basılır (dispatchedAt ile aynı).
    expect(row.invoicedAt).toBeInstanceOf(Date);
  });

  it("Sevk Listesi brüt olduğunu ve net hesabını dipnotta söyler (çift düşme koruması)", () => {
    const joined = (sheets[0]!.notes ?? []).join(" ");
    expect(joined).toContain("brüt");
    expect(joined).toContain("Net = Sevk − İade");
  });

  it("İade sayfası: tarih Date + iade metre toplamı", () => {
    const iade = sheets[4]!;
    const row = iade.rows[0] as { returnedAt: unknown };
    expect(row.returnedAt).toBeInstanceOf(Date);
    expect(iade.totalRow).toMatchObject({ meters: 10 });
  });
});

describe("accountingExportFileName", () => {
  it("tarih aralığını dosya adına yazar", () => {
    expect(accountingExportFileName(data.range)).toBe("Sevk_Edilenler_2026-06-01_2026-06-28");
  });
  it("boş aralıkta yalnız önek", () => {
    expect(accountingExportFileName({ from: null, to: null, field: null })).toBe("Sevk_Edilenler");
  });
});
