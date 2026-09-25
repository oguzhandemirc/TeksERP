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

type Sheet = ReturnType<typeof buildSackDumpSheets>[number];
/** Satırın/toplamın BAŞLIK adına göre değeri (anahtarlar kolon sırasıdır). */
const cell = (s: Sheet, row: Record<string, unknown> | undefined, header: string): unknown =>
  row?.[s.columns.find((c) => c.header === header)!.key];

describe("buildSackDumpSheets", () => {
  it("Özet YALNIZ çok çuvallı dökümde (PDF'teki ÖZET gibi) + çuval başına sayfa", () => {
    const sheets = buildSackDumpSheets([
      makeDump(),
      makeDump({ sackNo: "CV3007260007", customerName: null, branchName: null, branchCode: null, weightKg: null }),
    ]);
    expect(sheets.map((s) => s.name)).toEqual(["Özet", "CV3007260003", "CV3007260007"]);
    expect(buildSackDumpSheets([makeDump()]).map((s) => s.name)).toEqual(["CV3007260003"]);
  });

  it("Özet satırları ve TOPLAM doğru toplanır", () => {
    const ozet = sheet(buildSackDumpSheets([makeDump(), makeDump({ sackNo: "CV2", weightKg: 100 })]), "Özet")!;
    expect(ozet.rows).toHaveLength(2);
    expect(cell(ozet, ozet.totalRow, "Çuval No")).toBe("TOPLAM (2 çuval)");
    expect(cell(ozet, ozet.totalRow, "Top")).toBe(4);
    expect(cell(ozet, ozet.totalRow, "Metre")).toBe(2681); // (700 + 640.5) * 2
    expect(cell(ozet, ozet.totalRow, "Kg")).toBe(512.5);
  });

  it("müşterisiz çuval Özet'te açıkça yazılır, tartılmamış kg 'tartılmadı' (0 değil)", () => {
    const ozet = sheet(
      buildSackDumpSheets([makeDump(), makeDump({ sackNo: "CV2", customerName: null, branchName: null, branchCode: null, weightKg: null })]),
      "Özet",
    )!;
    expect(cell(ozet, ozet.rows[1], "Müşteri")).toBe("Müşterisiz (genel stok)");
    expect(cell(ozet, ozet.rows[1], "Şube")).toBe("—");
    expect(cell(ozet, ozet.rows[1], "Kg")).toBe("tartılmadı");
  });

  it("çuval sayfası top satırlarını + TOPLAM'ı sayı olarak taşır; tam sayıda ondalık ayırıcı yok", () => {
    const s = sheet(buildSackDumpSheets([makeDump()]), "CV3007260003")!;
    expect(s.rows).toHaveLength(2);
    expect(cell(s, s.rows[0], "Barkod")).toBe("T300726F0235");
    expect(cell(s, s.rows[0], "En")).toBe(280);
    expect(cell(s, s.rows[0], "Metre")).toBe(700);
    expect(cell(s, s.totalRow, "Barkod")).toBe("TOPLAM (2 top)");
    expect(cell(s, s.totalRow, "Metre")).toBe(1340.5);
    const fmt = s.columns.find((c) => c.header === "Metre")!.numFmt as (v: unknown) => string | undefined;
    // "#,##0.###" 700'ü "700," gösterirdi — PDF "700" basar.
    expect([fmt(700), fmt(640.5), fmt("—")]).toEqual(["#,##0", "#,##0.0##", undefined]);
  });

  it("boş çuvalda TOPLAM satırı basılmaz, PDF'teki 'Çuval boş' yazılır", () => {
    const s = sheet(buildSackDumpSheets([makeDump({ rolls: [] })]), "CV3007260003")!;
    expect(s.totalRow).toBeUndefined();
    expect(s.notes).toEqual(["Çuval boş — top yok."]);
  });

  it("barkodsuz top 'Açık Kumaş', renksiz top 'Ham', boş en/kalite '—'", () => {
    const s = sheet(
      buildSackDumpSheets([
        makeDump({ rolls: [{ barcode: null, itemName: "PATOS", colorName: null, width: null, qty: 120, qualityGrade: null }] }),
      ]),
      "CV3007260003",
    )!;
    expect([cell(s, s.rows[0], "Barkod"), cell(s, s.rows[0], "Renk"), cell(s, s.rows[0], "En"), cell(s, s.rows[0], "Kalite")]).toEqual([
      "Açık Kumaş",
      "Ham",
      "—",
      "—",
    ]);
  });

  it("kartela tablosu YALNIZ kartela varsa, çuvalın kendi sayfasında ve ad rejimiyle", () => {
    expect(sheet(buildSackDumpSheets([makeDump()]), "CV3007260003")!.subTables).toBeUndefined();
    const sw = [{ barcode: "SW-1", itemName: "PATOS", colorName: "Mavi", musteriItemName: "BS-1", musteriColorName: null }];
    const ikisi = sheet(buildSackDumpSheets([makeDump({ swatches: sw })]), "CV3007260003")!.subTables![0]!;
    expect(ikisi.title).toBe("KARTELALAR · 1");
    expect(ikisi.rows).toEqual([["SW-1", "PATOS", "Mavi", "BS-1", ""]]);
    // Eskiden Excel kartela sayfası rejimi YOK sayıyordu (hep bizim adımız).
    const musteri = sheet(buildSackDumpSheets([makeDump({ swatches: sw })], { nameMode: "musterideki" }), "CV3007260003")!.subTables![0]!;
    expect(musteri.columns.map((c) => c.header)).toEqual(["Barkod", "Müşteri kumaş", "Müşteri renk"]);
    expect(musteri.rows).toEqual([["SW-1", "BS-1", ""]]);
  });

  it("çuval notu varsayılan KAPALI; withNotes açıkken çuvalın başlığında", () => {
    expect(JSON.stringify(buildSackDumpSheets([makeDump({ notes: "iç not" })]))).not.toContain("iç not");
    const s = buildSackDumpSheets([makeDump({ notes: "iç not" })], { withNotes: true })[0]!;
    expect(s.preamble).toContainEqual(["Not", "iç not"]);
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

  it("tek çuvalda ÖZET yok, çok çuvalda ÖZET tablosu + TOPLAM var (Excel'deki gibi)", () => {
    expect(buildSackDumpHtml([makeDump()])).not.toContain("ÖZET");
    const cok = buildSackDumpHtml([makeDump(), makeDump({ sackNo: "CV2" })]);
    expect(cok).toContain("ÖZET");
    expect(cok).toContain("TOPLAM (2 çuval)");
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
        // ⭐ Üç-ad alanları: backend göndermezse `null`/`false` olur — eski
        //    backend'e karşı çalışan panel çökmez, kolonlar boş basılır.
        {
          barcode: "B1", itemName: "PATOS", colorName: "Mavi", width: 280, qty: 700,
          qualityGrade: "1.KALITE",
          musteriItemName: null, musteriColorName: null,
          etiketAd: null, etiketBasildi: false, etiketBayat: false,
        },
      ],
      swatches: [{ barcode: "SW1", itemName: "PATOS", colorName: null, musteriItemName: null, musteriColorName: null }],
    });
  });
});
