// =============================================================================
// BEKÇİ — Ekran = Excel = PDF, ikinci tur yüzeyleri (rapor şeridi, muhasebe dökümü, stok kalemi bazında)
// =============================================================================
// ⭐ Rapor: diyalog seçimi spec'e uygulanır; Excel (`toSheets`) ve PDF (`buildReportHtml`) aynı kolonları, aynı
//    satırları, aynı metni taşır; seçilmeyen kolon ikisinde de yok; tanınmayan id fırlatır.
// ⭐ SheetSpec çıktıları: Excel GERİ OKUNUR (exceljs) — hücrenin değeri + biçimi → görünen metin = PDF hücresi.
//    Bağımsız ölçü: metre/kg PDF'te ekranın hassasiyetiyle (`upTo3Text` = formatQty), tarih fabrika saatiyle.
// Fikstür ondalıklıdır (tam sayı yuvarlama farkını gizler); tarih fabrika gününü UTC'de değiştiren saattedir.
// =============================================================================
import { describe, expect, it } from "vitest";
import { buildReportHtml, toSheets, type ReportExportSpec } from "@/pages/Reports/_components/reportExport";
import { applyReportColumns, reportColumnCatalog } from "@/pages/Reports/_components/reportExportColumns";
import { buildAccountingWorkbookSheets } from "@/pages/Operations/AccountingDispatch/accounting-export";
import type { AccountingExportData } from "@/pages/Operations/AccountingDispatch/types";
import { buildStockLineSheet } from "@/pages/Operations/Orders/stock-line-export/sheet";
import { DEFAULT_STOCK_LINE_OPTIONS } from "@/pages/Operations/Orders/stock-line-export/options";
import type { StockLineResult } from "@/pages/Operations/Orders/stock-line-export/aggregate";
import { UnknownExportColumnError } from "./export-columns";
import { fmtFactoryDateTime } from "./factory-time";
import { upTo3Text } from "./number-format";
import { buildSheetsHtml, pickSheetColumns, sheetCellText, sheetColumnCatalog } from "./sheet-export";
import { buildWorkbook, type SheetSpec } from "./xlsx-export";

const blobBytes = (b: Blob) =>
  new Promise<ArrayBuffer>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as ArrayBuffer);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(b);
  });

const textRows = (root: ParentNode, sel: string) =>
  [...root.querySelectorAll(sel)].map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim()));

/** Excel'i üretip geri okur: sayfa başına { başlıklar, satır metinleri (TOPLAM dahil) } — görünen metin. */
async function excelShown(sheets: SheetSpec[]): Promise<Array<{ headers: string[]; rows: string[][] }>> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blobBytes(await buildWorkbook(sheets)));
  return sheets.map((s, si) => {
    const ws = wb.worksheets[si]!;
    const headerNo = s.preamble?.length ? s.preamble.length + 2 : 1;
    const n = s.rows.length + (s.totalRow ? 1 : 0);
    const read = (r: number) =>
      s.columns.map((_, ci) => {
        const cell = ws.getRow(r).getCell(ci + 1);
        return sheetCellText(cell.value, cell.numFmt || undefined);
      });
    return {
      headers: s.columns.map((_, ci) => String(ws.getRow(headerNo).getCell(ci + 1).value ?? "")),
      rows: Array.from({ length: n }, (_, i) => read(headerNo + 1 + i)),
    };
  });
}

/** PDF: sayfa başına ana tablo → { başlıklar, gövde + TOPLAM satır metinleri }. */
function pdfShown(title: string, sheets: SheetSpec[]) {
  const doc = new DOMParser().parseFromString(buildSheetsHtml(title, sheets), "text/html");
  return [...doc.querySelectorAll("table")].map((t) => ({
    headers: [...t.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim()),
    rows: [...textRows(t, "tbody tr"), ...textRows(t, "tfoot tr")],
  }));
}

// --- Rapor şeridi (ReportExportBar, 19 rapor + v2 çerçeve) -----------------------

const REPORT: ReportExportSpec = {
  title: "Bekçi raporu",
  subtitle: "01.11.2026 – 22.11.2026",
  tables: [
    {
      name: "Kalemler",
      columns: [
        { header: "Kumaş", key: "k" },
        { header: "Metre", key: "m", numFmt: "0.0", align: "right" },
        { header: "Tutar", key: "t", numFmt: "#,##0.00", align: "right" },
        { header: "Oran", key: "o" },
      ],
      rows: [
        { k: "Tül & Poplin", m: 1234.56, t: 98765.432, o: 0.125 },
        { k: "Saten", m: 0.04, t: 1.005, o: 3 },
      ],
      totalRow: { k: "TOPLAM", m: 1234.6, t: 98766.437 },
    },
    { name: "Müşteriler", columns: [{ header: "Müşteri", key: "c" }, { header: "Adet", key: "n", numFmt: "0" }], rows: [{ c: "A", n: 3 }] },
  ],
};

function reportFiles(spec: ReportExportSpec) {
  const excel = toSheets(spec).map((s) => ({
    headers: s.columns.map((c) => c.header),
    rows: [...s.rows, ...(s.totalRow ? [s.totalRow] : [])].map((r) => s.columns.map((c) => sheetCellText(r[c.key], c.numFmt))),
  }));
  const doc = new DOMParser().parseFromString(buildReportHtml(spec), "text/html");
  const pdf = [...doc.querySelectorAll("section.tbl-wrap table")].map((t) => ({
    headers: [...t.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim()),
    rows: textRows(t, "tbody tr"),
  }));
  return { excel, pdf };
}

describe("Rapor şeridi — seçilen sütunlar Excel = PDF", () => {
  it("katalog her tablonun kolonunu 'Tablo · Kolon' etiketiyle taşır; hepsi ekranda görünür", () => {
    const cat = reportColumnCatalog(REPORT);
    expect(cat.map((c) => c.label)).toEqual(["Kalemler · Kumaş", "Kalemler · Metre", "Kalemler · Tutar", "Kalemler · Oran", "Müşteriler · Müşteri", "Müşteriler · Adet"]);
    expect(cat.every((c) => c.visible)).toBe(true);
  });

  it("tümü seçiliyken iki dosya hücre hücre aynı", () => {
    const { excel, pdf } = reportFiles(applyReportColumns(REPORT, reportColumnCatalog(REPORT).map((c) => c.id)));
    expect(excel).toEqual(pdf);
    expect(excel[0]!.rows[0]).toEqual(["Tül & Poplin", "1234,6", "98.765,43", "0.125"]);
  });

  it("seçilmeyen kolon iki dosyada da yok; kolonu kalmayan tablo ikisinde de basılmaz; tanınmayan id fırlatır", () => {
    const spec = applyReportColumns(REPORT, ["t0:k", "t0:m"]);
    const { excel, pdf } = reportFiles(spec);
    expect(excel).toEqual(pdf);
    expect(excel).toHaveLength(1);
    expect(excel[0]!.headers).toEqual(["Kumaş", "Metre"]);
    expect(excel[0]!.rows).toHaveLength(REPORT.tables[0]!.rows.length + 1);
    expect(() => applyReportColumns(REPORT, ["t0:k", "t9:yok"])).toThrow(UnknownExportColumnError);
  });

  it("düzen tablo bloğu da seçime girer; grafik veri tablosu kırpılmaz", () => {
    const veri = { name: "Grafik", columns: [{ header: "X", key: "x" }], rows: [{ x: 1 }] };
    const v2: ReportExportSpec = {
      ...REPORT,
      tables: [],
      bloklar: [
        { tur: "tablo", tablo: REPORT.tables[1]! },
        { tur: "grafik", baslik: "G", veri },
      ],
    };
    expect(reportColumnCatalog(v2).map((c) => c.id)).toEqual(["b0:c", "b0:n"]);
    const out = applyReportColumns(v2, ["b0:n"]);
    expect(out.bloklar).toHaveLength(2);
    expect(out.bloklar![0]).toMatchObject({ tur: "tablo", tablo: { columns: [{ key: "n" }] } });
    expect(out.bloklar![1]).toMatchObject({ tur: "grafik", veri });
  });
});

// --- Muhasebe dökümü (Sevk Edilenler "Dönem dökümü" / "Birleşik döküm") --------

const ISO = "2026-11-14T22:30:00.000Z"; // fabrika günü UTC gününden farklı (UTC+3 → 15.11 01:30)
const DATA = {
  range: { from: "2026-11-01T00:00:00.000Z", to: "2026-11-22T00:00:00.000Z", field: "dispatchedAt" },
  shipments: [
    { shipmentNo: "SVK-1", dispatchedAt: ISO, customerCode: "C1", customerName: "A", docCustomerName: "A", taxNumber: "1", branchName: "", branchCode: "", destination: "EXPORT", procedureCode: "", plateNumber: "34 AB", driverName: "", carrier: "", sackCount: 2, manualSackCount: 0, dispatchNote: "", rollCount: 5, totalMeters: 1234.567, totalKg: 200.125, invoiceNo: "", invoicedAt: null },
    { shipmentNo: "SVK-2", dispatchedAt: ISO, customerCode: "C1", customerName: "A", docCustomerName: "A", taxNumber: "1", branchName: "", branchCode: "", destination: null, procedureCode: "", plateNumber: "", driverName: "", carrier: "", sackCount: 0, manualSackCount: 0, dispatchNote: "", rollCount: 1, totalMeters: 0.5, totalKg: 0, invoiceNo: "", invoicedAt: null },
  ],
  detail: [{ shipmentNo: "SVK-1", dispatchedAt: ISO, customerName: "A", docCustomerName: "A", orderNos: "S1", itemName: "Tül", colorName: "", width: 280.5, rollCount: 5, meters: 1234.567 }],
  byCustomer: [{ customerCode: "C1", customerName: "A", docCustomerName: "A", taxNumber: "1", shipmentCount: 2, sackCount: 2, manualSackCount: 0, rollCount: 6, totalMeters: 1235.067, totalKg: 200.125 }],
  byProduct: [{ itemName: "Tül", colorName: "", width: 280.5, rollCount: 6, totalMeters: 1235.067 }],
  returns: [],
  totals: { shipmentCount: 2, sackCount: 2, manualSackCount: 0, rollCount: 6, totalMeters: 1235.067, totalKg: 200.125, returnMeters: 0 },
} as unknown as AccountingExportData;

describe("Muhasebe dökümü — Excel (geri okunan) = PDF; metre/tarih ekranla aynı", () => {
  const sheets = buildAccountingWorkbookSheets(DATA);

  it("tüm sayfalar: başlık ve hücre metinleri iki dosyada birebir; satır sayısı = yanıt", async () => {
    const excel = await excelShown(sheets);
    const pdf = pdfShown("Muhasebe", sheets);
    expect(excel).toEqual(pdf);
    expect(excel[0]!.rows).toHaveLength(DATA.shipments.length + 1);
  });

  it("metre/kg ekranın hassasiyetiyle (≤3 hane), tarih fabrika saatiyle, TOPLAM etiketi görünür kolonda", () => {
    const [list] = pdfShown("Muhasebe", sheets);
    const col = (h: string) => sheets[0]!.columns.findIndex((c) => c.header === h);
    expect(list!.rows[0]![col("Toplam Metre")]).toBe(upTo3Text(1234.567));
    expect(list!.rows[0]![col("Toplam Kg")]).toBe(upTo3Text(200.125));
    expect(list!.rows[1]![col("Toplam Metre")]).toBe(upTo3Text(0.5));
    expect(list!.rows[0]![col("Sevk Tarihi")]).toBe(fmtFactoryDateTime(ISO));
    expect(list!.rows.at(-1)![col("Sevk No")]).toBe("TOPLAM");
    expect(list!.rows.at(-1)![col("Toplam Metre")]).toBe(upTo3Text(1235.067));
  });

  it("sütun seçimi iki dosyaya aynı uygulanır; seçimsiz sayfa düşer; tanınmayan id fırlatır", async () => {
    const cat = sheetColumnCatalog(sheets);
    const ids = cat.filter((c) => c.label === "Sevk Listesi · Sevk No" || c.label === "Sevk Listesi · Toplam Metre").map((c) => c.id);
    const picked = pickSheetColumns(sheets, ids);
    expect(picked).toHaveLength(1);
    const excel = await excelShown(picked);
    expect(excel).toEqual(pdfShown("Muhasebe", picked));
    expect(excel[0]!.headers).toEqual(["Sevk No", "Toplam Metre"]);
    expect(() => pickSheetColumns(sheets, [...ids, "9:yok"])).toThrow(UnknownExportColumnError);
  });
});

// --- Siparişler — stok kalemi bazında -------------------------------------------

const STOCK: StockLineResult = {
  rows: [
    { key: "a", itemCode: "K1", itemName: "Tül", colorCode: "R1", colorName: "Beyaz", width: 280.5, unit: "MT", measured: true, ordered: 1500.255, shipped: 250.5, open: 1249.755, inProduction: 300.125, inStock: null, inStockAll: null, toProduce: 949.63, customers: ["A", "B"], orderCount: 2, lineCount: 3, nearestDeadline: null },
    { key: "b", itemCode: "K2", itemName: "Saten", colorCode: null, colorName: null, width: null, unit: "MT", measured: true, ordered: 10, shipped: 0, open: 10, inProduction: null, inStock: 0.5, inStockAll: null, toProduce: 9.5, customers: ["A"], orderCount: 1, lineCount: 1, nearestDeadline: null },
  ],
  totals: [{ unit: "MT", ordered: 1510.255, shipped: 250.5, open: 1259.755, inProduction: 300.125, inStock: 0.5, inStockAll: null, toProduce: 959.13, customerCount: 2, orderCount: 3 }],
  orderCount: 3,
  lineCount: 4,
};

describe("Stok kalemi bazında — Excel (geri okunan) = PDF", () => {
  it("aynı sayfadan iki dosya: başlık, hücre ve GENEL TOPLAM birebir; miktar ekran hassasiyetiyle", async () => {
    const sheet = buildStockLineSheet({ title: "Bekçi", result: STOCK, options: DEFAULT_STOCK_LINE_OPTIONS, scopeLines: [], notes: [] });
    const [excel] = await excelShown([sheet]);
    const [pdf] = pdfShown("Bekçi", [sheet]);
    expect(excel).toEqual(pdf);
    expect(pdf!.rows).toHaveLength(STOCK.rows.length + 1);
    const oi = sheet.columns.findIndex((c) => c.key === "ordered");
    expect(pdf!.rows[0]![oi]).toBe(upTo3Text(1500.255));
    expect(pdf!.rows.at(-1)![oi]).toBe(upTo3Text(1510.255));
  });
});
