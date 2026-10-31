import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildWorkbook } from "@/lib/xlsx-export";
import { buildRollListSheet, DRAFT_MARK, rollListFileName, type ShipmentRollList } from "./rollListExport";

/** D4-J6 — sevk top listesi Excel'i: satır = sunucunun çeki satırı, toplam = sunucunun toplamı. */

const blobBytes = (b: Blob) =>
  new Promise<ArrayBuffer>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as ArrayBuffer);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(b);
  });

const LIST: ShipmentRollList = {
  shipmentNo: "SVK-42",
  customerName: "Örnek Perde",
  date: "2026-10-31T09:00:00.000Z",
  frozen: true,
  rows: [
    { barcode: "T1", customerRollNo: "MT-17", customerCode: "MK-1", desen: "PERDE TUL", varyant: "KREM", processText: "KURŞUN 50G", meters: 120.5 },
    { barcode: "T2", customerRollNo: null, customerCode: null, desen: "PERDE TUL", varyant: "", processText: null, meters: 80.25 },
    { barcode: "T3", customerRollNo: "MT-18", customerCode: null, desen: "ETAMIN", varyant: "BEYAZ", processText: null, meters: 99.75 },
  ],
  totals: { rollCount: 3, totalMeters: 300.5 },
};

describe("buildRollListSheet", () => {
  it("satır sayısı = top sayısı; toplam metre sunucunun toplamı", () => {
    const s = buildRollListSheet(LIST);
    expect(s.rows).toHaveLength(LIST.totals.rollCount);
    const sum = s.rows.reduce((a, r) => a + (r.meters as number), 0);
    expect(sum).toBeCloseTo(LIST.totals.totalMeters, 6);
    expect(s.totalRow?.meters).toBe(LIST.totals.totalMeters);
  });

  it("müşteri kodu / top no olmayan topta hücre boş", () => {
    const s = buildRollListSheet(LIST);
    expect(s.rows[1]).toMatchObject({ customerCode: "", customerRollNo: "", processText: "" });
    expect(s.rows[0]).toMatchObject({ barcode: "T1", customerRollNo: "MT-17", customerCode: "MK-1", shipmentNo: "SVK-42" });
  });

  it("kolonlar: barkod, müşteri top no, müşteri kodu, desen, metre, sevk no/tarih", () => {
    const headers = buildRollListSheet(LIST).columns.map((c) => c.header);
    for (const h of ["Barkod", "Müşteri Top No", "Müşteri Kodu", "Desen", "Metre", "Sevk No", "Sevk Tarihi"]) expect(headers).toContain(h);
  });

  it("gerçek .xlsx: veri satırı sayısı top sayısına eşit, boş kod hücresi boş", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blobBytes(await buildWorkbook([buildRollListSheet(LIST)])));
    const ws = wb.worksheets[0]!;
    const values: unknown[][] = [];
    ws.eachRow((row) => values.push((row.values as unknown[]).slice(1)));
    const barcodes = values.map((v) => v[0]).filter((v) => typeof v === "string" && /^T\d$/.test(v));
    expect(barcodes).toEqual(["T1", "T2", "T3"]);
    const t2 = values.find((v) => v[0] === "T2")!;
    expect(t2[2] == null || t2[2] === "").toBe(true);
  });

  it("dışa aktarım yeniden toplamaz — toplam satırı sunucu totals'ından (ikinci toplayıcı yok)", () => {
    const src = readFileSync(resolve(__dirname, "rollListExport.ts"), "utf8");
    expect(src).toContain("list.totals.totalMeters");
    expect(src).not.toMatch(/\.reduce\(/);
  });

  it("donmamış (sevk edilmemiş) liste TASLAK işaretli; tarih başlığı Oluşturma Tarihi", () => {
    const draft = buildRollListSheet({ ...LIST, frozen: false });
    expect(String(draft.preamble?.[0]?.[0])).toContain(DRAFT_MARK);
    expect(draft.preamble?.[2]?.[0]).toBe("Oluşturma Tarihi");
    expect(draft.columns.map((c) => c.header)).not.toContain("Sevk Tarihi");
    expect(rollListFileName("SVK-42", false)).toBe("Top_Listesi_SVK-42_TASLAK");
    const frozen = buildRollListSheet(LIST);
    expect(String(frozen.preamble?.[0]?.[0])).not.toContain(DRAFT_MARK);
    expect(rollListFileName("SVK-42", true)).toBe("Top_Listesi_SVK-42");
  });
});
