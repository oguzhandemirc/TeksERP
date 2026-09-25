import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { docTablesToSheets, numFmtOf, type DocTablesPayload } from "./doc-tables-export";
import { buildWorkbook } from "./xlsx-export";

/**
 * Sevk irsaliyesinin Excel'i PDF'in kolon çözücüsünden gelir (backend `/tables`).
 * Bu dosya iki şeyi kilitler: (1) dönüştürücü kolon SEÇMEZ — sunucunun verdiği
 * kolon kümesi/sırası/başlığı/değeri sayfaya birebir geçer, biçim PDF'i izler;
 * (2) sevk Excel'inin giriş noktaları elle kolon listesi KURMAZ (saha şikâyeti
 * 2026-09-25: Excel'de ambalaj no ve parti yoktu çünkü liste panelde sabitti).
 */

/** jsdom'un Blob'unda `arrayBuffer()` yok — FileReader ile okunur. */
const blobBytes = (b: Blob) =>
  new Promise<ArrayBuffer>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as ArrayBuffer);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(b);
  });

const PAYLOAD: DocTablesPayload = {
  docType: "SHIPMENT_DISPATCH",
  documentNo: "SVK-1",
  header: [
    ["SEVK İRSALİYESİ", null],
    ["SAYIN", "Örnek A.Ş."],
    ["İrsaliye No", "SVK-1"],
  ],
  tables: [
    {
      key: "cuval",
      caption: "ÇUVAL LİSTESİ",
      columns: [
        { key: "code", label: "ÇUVAL NO", align: "l", kind: { t: "text" } },
        { key: "packageNo", label: "AMBALAJ NO", align: "r", kind: { t: "int" } },
        { key: "packingGroupName", label: "SEVK PARTİSİ", align: "l", kind: { t: "text" } },
        { key: "totalMeters", label: "METRE TOPLAMI", align: "r", kind: { t: "num", dec: 2 } },
        { key: "packageCount", label: "", align: "r", kind: { t: "num", dec: 0 } },
      ],
      rows: [
        ["CV1", 1, "P-1", 212.456, 2],
        ["CV2", null, "", 40, 1],
      ],
      foot: ["TOPLAM", null, null, 252.456, 3],
    },
    {
      key: "ceki",
      caption: "ÇEKİ LİSTESİ",
      columns: [
        { key: "barcode", label: "BARKOD NO", align: "l", kind: { t: "text" } },
        { key: "batchNumber", label: "PARTİ NO", align: "l", kind: { t: "text" } },
        { key: "width", label: "EN", align: "c", kind: { t: "int", suffix: " cm" } },
        { key: "kg", label: "KG", align: "r", kind: { t: "num", dec: 2 } },
      ],
      rows: [
        ["R1", "P0925001", 330, 15.25],
        ["—", "—", "—", null],
      ],
      foot: ["TOPLAM", null, null, 15.25],
    },
  ],
  notes: ["İrsaliye açıklaması"],
};

describe("docTablesToSheets — kolonu sunucu seçer, dönüştürücü yalnız biçimler", () => {
  const sheets = docTablesToSheets(PAYLOAD, ["* brüt notu"]);

  it("her liste bir sayfa, adı listenin başlığı", () => {
    expect(sheets.map((s) => s.name)).toEqual(["ÇUVAL LİSTESİ", "ÇEKİ LİSTESİ"]);
  });

  it("kolon başlıkları ve sırası birebir (boş başlık dahil)", () => {
    expect(sheets[0]!.columns.map((c) => c.header)).toEqual(["ÇUVAL NO", "AMBALAJ NO", "SEVK PARTİSİ", "METRE TOPLAMI", ""]);
    expect(sheets[1]!.columns.map((c) => c.header)).toEqual(["BARKOD NO", "PARTİ NO", "EN", "KG"]);
  });

  it("değerler dokunulmadan geçer — sayı sayı, boş boş", () => {
    const keys = sheets[0]!.columns.map((c) => c.key);
    expect(sheets[0]!.rows.map((r) => keys.map((k) => r[k]))).toEqual([
      ["CV1", 1, "P-1", 212.456, 2],
      ["CV2", null, "", 40, 1],
    ]);
    const k2 = sheets[1]!.columns.map((c) => c.key);
    expect(sheets[1]!.rows[1]!).toEqual(Object.fromEntries(k2.map((k, i) => [k, ["—", "—", "—", null][i]])));
  });

  it("biçim PDF'i izler: metre 2 ondalık, adet gruplu, ambalaj no gruplamasız, en 'cm'", () => {
    expect(sheets[0]!.columns.map((c) => c.numFmt)).toEqual([undefined, "0", undefined, "#,##0.00", "#,##0"]);
    expect(sheets[1]!.columns[2]!.numFmt).toBe('0" cm"');
    expect(numFmtOf({ t: "num", dec: 1, suffix: " m" })).toBe('#,##0.0" m"');
    expect(sheets[1]!.columns.map((c) => c.align)).toEqual(["left", "left", "center", "right"]);
  });

  it("toplam satırı kolon sırasıyla, başlık bloğu her sayfada, notlar yalnız ilk sayfada", () => {
    const keys = sheets[0]!.columns.map((c) => c.key);
    expect(keys.map((k) => sheets[0]!.totalRow![k])).toEqual(["TOPLAM", null, null, 252.456, 3]);
    expect(sheets[0]!.preamble).toEqual([["SEVK İRSALİYESİ"], ["SAYIN", "Örnek A.Ş."], ["İrsaliye No", "SVK-1"]]);
    expect(sheets[1]!.preamble).toEqual(sheets[0]!.preamble);
    expect(sheets[0]!.notes).toEqual(["İrsaliye açıklaması", "* brüt notu"]);
    expect(sheets[1]!.notes).toBeUndefined();
  });

  it("hiç liste basılmıyorsa başlık bloklu tek sayfa (boş çalışma kitabı üretilmez)", async () => {
    const only = docTablesToSheets({ ...PAYLOAD, tables: [] });
    expect(only).toHaveLength(1);
    expect(only[0]!.columns).toEqual([]);
    await expect(buildWorkbook(only)).resolves.toBeInstanceOf(Blob);
  });

  it("başlık bloğu tabloyu aşağı iter: kolon başlığı satırı bloktan sonra, hücreler yerinde", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blobBytes(await buildWorkbook(sheets)));
    const ws = wb.worksheets[0]!;
    // 3 başlık satırı + 1 boş satır → kolon başlıkları 5. satırda.
    expect(ws.getRow(5).values).toEqual([undefined, "ÇUVAL NO", "AMBALAJ NO", "SEVK PARTİSİ", "METRE TOPLAMI", ""]);
    expect(ws.getRow(6).getCell(2).value).toBe(1);
    expect(ws.getRow(6).getCell(4).value).toBeCloseTo(212.456);
    expect(ws.getRow(6).getCell(4).numFmt).toBe("#,##0.00");
    expect(ws.getRow(7).getCell(2).value).toBeNull();
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 5 });
  });
});

describe("toplam satırının kendi biçimi ve kolonsuz liste", () => {
  const DIRECT: DocTablesPayload = {
    docType: "SUBCONTRACTOR_DIRECT_SHIP",
    documentNo: "SVK-9",
    header: [["FASONDAN SEVK İRSALİYESİ", null]],
    tables: [
      { key: "allocations", caption: "Karşılanan Siparişler (1)", columns: [], rows: [[]], foot: null },
      {
        key: "rollTable",
        caption: "Sevk Edilen Toplar (1)",
        columns: [
          { key: "seq", label: "#", align: "c", kind: { t: "int" } },
          { key: "meters", label: "METRE", align: "r", kind: { t: "num", dec: 1 } },
          { key: "kg", label: "KG", align: "r", kind: { t: "num", dec: 1 } },
        ],
        rows: [[1, 120.5, "—"]],
        foot: ["TOPLAM", 120.5, "—"],
        footKinds: [{ t: "int" }, { t: "num", dec: 1, suffix: " m" }, { t: "num", dec: 1, suffix: " kg" }],
      },
    ],
    notes: [],
  };

  it("ilk kolon başlık bloğunun en uzun etiketine yetecek genişlikte ('#' kolonu dar kalmaz)", () => {
    const withLabels = { ...DIRECT, header: [...DIRECT.header, ["Customs/Export No", "GTIP-1"] as [string, string]] };
    expect(docTablesToSheets(withLabels)[0]!.columns[0]!.width).toBe("Customs/Export No".length + 2);
  });

  it("bütün kolonları gizli liste sayfa açmaz (PDF'te tablo çizilmediği gibi)", () => {
    expect(docTablesToSheets(DIRECT).map((s) => s.name)).toEqual(["Sevk Edilen Toplar (1)"]);
  });

  it("toplam hücresi kolondan farklı biçimi taşır (metre 'm', kg 'kg')", async () => {
    const [sheet] = docTablesToSheets(DIRECT);
    expect(Object.values(sheet!.totalNumFmt!)).toEqual(["0", '#,##0.0" m"', '#,##0.0" kg"']);
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blobBytes(await buildWorkbook([sheet!])));
    const ws = wb.worksheets[0]!;
    // 1 başlık satırı + boş satır → kolon başlığı 3. satır, veri 4, toplam 5.
    expect(ws.getRow(4).getCell(2).numFmt).toBe("#,##0.0");
    expect(ws.getRow(5).getCell(2).numFmt).toBe('#,##0.0" m"');
    expect(ws.getRow(5).getCell(3).value).toBe("—");
  });
});

describe("sevk Excel'i elle kolon listesi kurmaz (tek çözücü)", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
  const exportSrc = read("pages/Operations/Shipments/shipmentDocExport.ts");
  const dialogSrc = read("pages/Operations/Shipments/ShipmentDocDialog.tsx");

  it("Excel belge ucunun tablolarından kurulur", () => {
    expect(exportSrc).toMatch(/docTablesToSheets\(/);
    expect(exportSrc).toMatch(/printedDocumentService\.getTables\(/);
  });

  it("eski fiş kurucusu YALNIZ eski-sunucu geri düşüşünde (tek çağrı)", () => {
    expect(exportSrc.match(/buildDispatchReportSheets\(/g) ?? []).toHaveLength(1);
    expect(exportSrc).toMatch(/return rep \? buildWorkbook\(buildDispatchReportSheets\(rep\)\) : null;/);
  });

  it("belge diyaloğu kendi çalışma kitabını kurmaz, ortak kurucuyu çağırır", () => {
    expect(dialogSrc).not.toMatch(/buildDispatchReportSheets|buildWorkbook\(/);
    expect(dialogSrc).toMatch(/buildDispatchWorkbook\(/);
  });
});
