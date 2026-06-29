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
      destination: "EXPORT",
      procedureCode: "",
      plateNumber: "",
      driverName: "",
      carrier: "",
      sackCount: 1,
      rollCount: 2,
      totalMeters: 100,
      totalKg: 50,
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

  it("3 sayfa: Ürün/Çuval/Çeki", () => {
    expect(sheets.map((s) => s.name)).toEqual(["Ürün Listesi", "Çuval Listesi", "Çeki Listesi"]);
  });

  it("Ürün sayfası kolon→veri eşlemesi + TOPLAM satırı", () => {
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

describe("buildAccountingWorkbookSheets — dönem dökümü (5 sayfa)", () => {
  const sheets = buildAccountingWorkbookSheets(data);

  it("5 sayfa: Sevk Listesi/Detay/İcmal·Müşteri/İcmal·Ürün/İade", () => {
    expect(sheets.map((s) => s.name)).toEqual([
      "Sevk Listesi",
      "Detay",
      "İcmal · Müşteri",
      "İcmal · Ürün",
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
