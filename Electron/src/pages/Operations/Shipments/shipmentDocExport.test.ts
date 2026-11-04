import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocTablesPayload } from "@/lib/doc-tables-export";
import type { SheetSpec } from "@/lib/xlsx-export";
import type { DispatchReport } from "@/pages/Operations/AccountingDispatch/types";

/**
 * Müşteriye giden sevk irsaliyesi Excel'i: brüt/iade dipnotu İÇ bilgidir, basılmaz
 * (muhasebe fişi korur); belgenin geçerliliğini değiştiren iptal uyarısı kalır.
 * Belge sayfası kenarlıklı ve tek sayfa genişliğine sığar.
 */

const built: SheetSpec[][] = [];
vi.mock("@/lib/xlsx-export", async (orig) => {
  const real = await orig<typeof import("@/lib/xlsx-export")>();
  return {
    ...real,
    buildWorkbook: vi.fn(async (sheets: SheetSpec[]) => {
      built.push(sheets);
      return new Blob([]);
    }),
  };
});

const getTables = vi.fn();
const getReport = vi.fn();
vi.mock("@/services/printedDocumentService", () => ({
  printedDocumentService: { getTables: (...a: unknown[]) => getTables(...a) },
}));
vi.mock("@/pages/Operations/AccountingDispatch/service", () => ({
  accountingDispatchService: {
    getReport: (...a: unknown[]) => getReport(...a),
    getDirectReport: (...a: unknown[]) => getReport(...a),
  },
}));

const { buildDispatchWorkbook } = await import("./shipmentDocExport");
const { buildDispatchReportSheets } = await import("@/pages/Operations/AccountingDispatch/accounting-export");

const PAYLOAD: DocTablesPayload = {
  docType: "SHIPMENT_DISPATCH",
  documentNo: "SVK-1",
  header: [["SEVK İRSALİYESİ", null]],
  tables: [
    {
      key: "ceki",
      caption: "ÇEKİ LİSTESİ",
      columns: [{ key: "barcode", label: "BARKOD NO", align: "l", kind: { t: "text" } }],
      rows: [["B1"]],
      foot: null,
    },
  ],
  notes: ["İrsaliye açıklaması"],
};

const REPORT = {
  header: { shipmentNo: "SVK-1", customerName: "X", customerCode: "C1", branchName: null, branchCode: null, procedureCode: null, destination: "DOMESTIC", status: "DISPATCHED", date: "2026-06-28T00:00:00.000Z" },
  products: [],
  sacks: [],
  cekiRows: [],
  totals: { totalRolls: 0, totalMeters: 0, totalKg: 0, sackCount: 0 },
  frozen: true,
  docStatus: "ACTIVE",
  docVersion: 1,
  returns: { count: 2, meters: 49 },
} as unknown as DispatchReport;

const target = { id: "s1", shipmentNo: "SVK-1", isDirect: false };

describe("sevk irsaliyesi Excel'i — müşteri belgesinde iç dipnot yok", () => {
  beforeEach(() => {
    built.length = 0;
    getTables.mockResolvedValue({ data: PAYLOAD });
  });

  it("brüt ve iade dipnotu basılmaz; belgenin kendi notu kalır", async () => {
    await buildDispatchWorkbook(target, undefined, REPORT);
    const notes = built[0]![0]!.notes ?? [];
    expect(notes).toEqual(["İrsaliye açıklaması"]);
    expect(notes.join(" ")).not.toMatch(/SEVK ANINDAKİ|brüt|iade|İade/);
  });

  it("iptal edilmiş irsaliyede İPTAL uyarısı basılır", async () => {
    await buildDispatchWorkbook(target, undefined, { ...REPORT, docStatus: "VOIDED" });
    expect((built[0]![0]!.notes ?? []).join(" ")).toContain("İPTAL");
  });

  it("muhasebe fişi brüt ve iade dipnotunu KORUR", () => {
    const notes = (buildDispatchReportSheets(REPORT)[0]!.notes ?? []).join(" ");
    expect(notes).toContain("SEVK ANINDAKİ (brüt)");
    expect(notes).toContain("DÜŞÜLMEMİŞTİR");
  });

  it("belge sayfası belge düzeninde (kenarlık + sığdırma) kurulur", async () => {
    await buildDispatchWorkbook(target, undefined, REPORT);
    expect(built[0]![0]!.documentLayout).toBe(true);
  });
});
