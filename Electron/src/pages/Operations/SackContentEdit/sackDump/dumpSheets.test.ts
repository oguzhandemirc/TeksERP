import { describe, it, expect } from "vitest";
import { buildWorkbook } from "@/lib/xlsx-export";
import { buildSackDumpSheets } from "./dumpSheets";
import { buildSackDumpHtml } from "./dumpHtml";
import { fromDumpRows, type SackDump } from "./types";
import type { SackContentDumpSack } from "../types";

function makeDump(over: Partial<SackDump> = {}): SackDump {
  return {
    sackNo: "CV3007260003",
    customerName: "ACME A.Ş.",
    branchName: "Merkez",
    branchCode: "TR-01",
    weightKg: 412.5,
    notes: null,
    shipmentNo: null,
    rolls: [
      { barcode: "T300726F0235", itemName: "PATOS", colorName: "Mavi", width: 280, qty: 700, qualityGrade: "1.KALITE" },
      { barcode: "T300726F0241", itemName: "PATOS", colorName: "Mavi", width: 280, qty: 640.5, qualityGrade: "2.KALITE" },
    ],
    swatches: [],
    ...over,
  };
}

const sheet = (sheets: ReturnType<typeof buildSackDumpSheets>, name: string) =>
  sheets.find((s) => s.name === name);

describe("buildSackDumpSheets", () => {
  it("Özet + çuval başına sayfa üretir", () => {
    const sheets = buildSackDumpSheets([
      makeDump(),
      makeDump({ sackNo: "CV3007260007", customerName: null, branchName: null, branchCode: null, weightKg: null }),
    ]);
    expect(sheets.map((s) => s.name)).toEqual(["Özet", "CV3007260003", "CV3007260007"]);
  });

  it("Özet satırları ve TOPLAM doğru toplanır", () => {
    const sheets = buildSackDumpSheets([makeDump(), makeDump({ sackNo: "CV2", weightKg: 100 })]);
    const ozet = sheet(sheets, "Özet")!;
    expect(ozet.rows).toHaveLength(2);
    expect(ozet.totalRow).toMatchObject({
      sackNo: "TOPLAM (2 çuval)",
      rollCount: 4,
      qty: 2681, // (700 + 640.5) * 2
      weightKg: 512.5,
    });
  });

  it("müşterisiz çuval Özet'te açıkça yazılır, tartılmamış kg BOŞ kalır (0 değil)", () => {
    const sheets = buildSackDumpSheets([
      makeDump({ customerName: null, branchName: null, branchCode: null, weightKg: null }),
    ]);
    expect(sheet(sheets, "Özet")!.rows[0]).toMatchObject({
      customer: "Müşterisiz (genel stok)",
      branch: "",
      weightKg: "",
    });
  });

  it("çuval sayfası top satırlarını + TOPLAM'ı sayı olarak taşır", () => {
    const sheets = buildSackDumpSheets([makeDump()]);
    const s = sheet(sheets, "CV3007260003")!;
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0]).toMatchObject({ barcode: "T300726F0235", item: "PATOS", color: "Mavi", width: 280, qty: 700 });
    expect(s.totalRow).toMatchObject({ barcode: "TOPLAM (2 top)", qty: 1340.5 });
    // Metre/kg kolonları sayı biçimli olmalı (Excel'de toplanabilsin).
    expect(s.columns.find((c) => c.key === "qty")?.numFmt).toBeTruthy();
  });

  it("boş çuvalda TOPLAM satırı basılmaz (tek başına '0' yanıltıcı)", () => {
    const sheets = buildSackDumpSheets([makeDump({ rolls: [] })]);
    expect(sheet(sheets, "CV3007260003")!.totalRow).toBeUndefined();
  });

  it("barkodsuz top 'Açık Kumaş', renksiz top 'Ham' yazılır", () => {
    const sheets = buildSackDumpSheets([
      makeDump({
        rolls: [{ barcode: null, itemName: "PATOS", colorName: null, width: null, qty: 120, qualityGrade: null }],
      }),
    ]);
    expect(sheet(sheets, "CV3007260003")!.rows[0]).toMatchObject({
      barcode: "Açık Kumaş",
      color: "Ham",
      width: "",
      quality: "",
    });
  });

  it("kartela sayfası YALNIZ kartela varsa üretilir", () => {
    expect(sheet(buildSackDumpSheets([makeDump()]), "Kartelalar")).toBeUndefined();
    const withSwatch = buildSackDumpSheets([
      makeDump({ swatches: [{ barcode: "SW-1", itemName: "PATOS", colorName: "Mavi" }] }),
    ]);
    const k = sheet(withSwatch, "Kartelalar")!;
    expect(k.rows).toEqual([{ sackNo: "CV3007260003", barcode: "SW-1", item: "PATOS", color: "Mavi" }]);
  });

  it("çuval notu varsayılan KAPALI — Özet'te not kolonu YOK", () => {
    const sheets = buildSackDumpSheets([makeDump({ notes: "iç not" })]);
    const ozet = sheet(sheets, "Özet")!;
    expect(ozet.columns.some((c) => c.key === "notes")).toBe(false);
    expect(JSON.stringify(ozet.rows)).not.toContain("iç not");
  });

  it("withNotes açıkken not kolonu eklenir", () => {
    const sheets = buildSackDumpSheets([makeDump({ notes: "iç not" })], { withNotes: true });
    const ozet = sheet(sheets, "Özet")!;
    expect(ozet.columns.some((c) => c.key === "notes")).toBe(true);
    expect(ozet.rows[0]).toMatchObject({ notes: "iç not" });
  });

  // exceljs'i GERÇEKTEN çalıştır: geçersiz sayfa adı / desteklenmeyen hücre değeri
  // yalnız tıklama anında patlardı. Boş çuval + kartela + not + mükerrer ad hepsi bir arada.
  it("üretilen sayfalar exceljs tarafından kabul edilir (gerçek .xlsx yazımı)", async () => {
    const sheets = buildSackDumpSheets(
      [
        makeDump({ notes: "iç not", swatches: [{ barcode: "SW-1", itemName: "PATOS", colorName: "Mavi" }] }),
        makeDump({ sackNo: "CV/2:9*7?[x]", rolls: [], weightKg: null, customerName: null }),
      ],
      { withNotes: true },
    );
    const blob = await buildWorkbook(sheets);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it("aynı ada düşen çuval sayfaları ayrıştırılır (exceljs mükerrer adda patlar)", () => {
    const long = "CV".padEnd(40, "9"); // 31 karaktere kırpılınca ikisi de aynı olur
    const sheets = buildSackDumpSheets([makeDump({ sackNo: long }), makeDump({ sackNo: long })]);
    const names = sheets.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n.length <= 31)).toBe(true);
  });
});

describe("buildSackDumpHtml", () => {
  it("çuval notunu varsayılan olarak BASMAZ, withNotes ile basar", () => {
    const dumps = [makeDump({ notes: "kenar hatası şüphesi" })];
    expect(buildSackDumpHtml(dumps)).not.toContain("kenar hatası şüphesi");
    expect(buildSackDumpHtml(dumps, { withNotes: true })).toContain("kenar hatası şüphesi");
  });

  it("HTML kaçışı yapar (not/ad enjeksiyonu belgeye markup sokmaz)", () => {
    const html = buildSackDumpHtml([makeDump({ customerName: "<script>x</script>" })]);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("tek çuvalda genel toplam yok, çok çuvalda var", () => {
    expect(buildSackDumpHtml([makeDump()])).not.toContain("GENEL TOPLAM");
    expect(buildSackDumpHtml([makeDump(), makeDump({ sackNo: "CV2" })])).toContain("GENEL TOPLAM");
  });

  it("tartılmamış çuval 'tartılmadı' yazar", () => {
    expect(buildSackDumpHtml([makeDump({ weightKg: null })])).toContain("tartılmadı");
  });

  it("müşterisiz çuval başlıkta açıkça belirtilir", () => {
    expect(buildSackDumpHtml([makeDump({ customerName: null })])).toContain("Müşterisiz (genel stok)");
  });
});

describe("fromDumpRows", () => {
  it("backend yanıtını normalize eder", () => {
    const rows: SackContentDumpSack[] = [
      {
        id: "s1",
        sackNo: "CV1",
        seq: null,
        weightKg: 12.5,
        notes: "not",
        customer: { id: "c1", name: "ACME" },
        branch: { id: "b1", code: "TR-01", name: "Merkez" },
        shipment: { id: "sh1", shipmentNo: "SVK-1", status: "DISPATCHED" },
        rollCount: 1,
        totalQty: 700,
        rolls: [
          { id: "r1", barcode: "B1", itemName: "PATOS", colorName: "Mavi", width: 280, qty: 700, qualityGrade: "1.KALITE" },
        ],
        swatches: [{ id: "w1", barcode: "SW1", itemName: "PATOS", colorName: null }],
      },
    ];
    expect(fromDumpRows(rows)[0]).toEqual({
      sackNo: "CV1",
      customerName: "ACME",
      branchName: "Merkez",
      branchCode: "TR-01",
      weightKg: 12.5,
      notes: "not",
      shipmentNo: "SVK-1",
      rolls: [
        { barcode: "B1", itemName: "PATOS", colorName: "Mavi", width: 280, qty: 700, qualityGrade: "1.KALITE" },
      ],
      swatches: [{ barcode: "SW1", itemName: "PATOS", colorName: null }],
    });
  });
});
