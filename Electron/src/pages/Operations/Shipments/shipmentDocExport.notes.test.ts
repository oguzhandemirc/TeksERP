import { describe, expect, it, vi, beforeEach } from "vitest";

// İrsaliye Excel'i (panel 1.3.9): brüt/iade dipnotu basılmaz, iptal uyarısı kalır.
const getTables = vi.fn();
const getReport = vi.fn();
vi.mock("@/services/printedDocumentService", () => ({ printedDocumentService: { getTables: (...a: unknown[]) => getTables(...a) } }));
vi.mock("@/pages/Operations/AccountingDispatch/service", () => ({
  accountingDispatchService: { getReport: (...a: unknown[]) => getReport(...a), getDirectReport: (...a: unknown[]) => getReport(...a) },
}));
const sheetsSeen: Array<Array<{ notes?: string[] }>> = [];
vi.mock("@/lib/xlsx-export", async (orig) => {
  const real = await orig<typeof import("@/lib/xlsx-export")>();
  return { ...real, buildWorkbook: (s: Array<{ notes?: string[] }>) => (sheetsSeen.push(s), Promise.resolve(new Blob())) };
});

import { buildDispatchWorkbook, dispatchDocNotes } from "./shipmentDocExport";
import { dispatchReportNotes } from "@/pages/Operations/AccountingDispatch/accounting-export";
import type { DispatchReport } from "@/pages/Operations/AccountingDispatch/types";

const tables = {
  docType: "SHIPMENT_DISPATCH",
  documentNo: "SVK-1",
  header: [["SEVK İRSALİYESİ", null]],
  tables: [{ key: "t", caption: "LİSTE", columns: [{ key: "a", label: "A", align: "l", kind: { t: "text" } }], rows: [["x"]], foot: null }],
  notes: ["İrsaliye açıklaması"],
};
const report = (p: Partial<DispatchReport>) =>
  ({ frozen: true, docStatus: "ACTIVE", returns: { count: 2, meters: 50 }, ...p }) as DispatchReport;
const target = { id: "s1", shipmentNo: "SVK-1", isDirect: false };

describe("irsaliye Excel dipnotları", () => {
  beforeEach(() => {
    sheetsSeen.length = 0;
    getTables.mockResolvedValue({ data: tables });
  });

  it("brüt ve iade notu basılmaz; belgenin kendi notu kalır", async () => {
    await buildDispatchWorkbook(target, undefined, report({}));
    const notes = sheetsSeen[0]![0]!.notes ?? [];
    expect(notes).toEqual(["İrsaliye açıklaması"]);
    expect(notes.join("\n")).not.toMatch(/brüt|iade/i);
  });

  it("iptal edilmiş irsaliyede İPTAL uyarısı kalır", async () => {
    await buildDispatchWorkbook(target, undefined, report({ docStatus: "VOIDED" }));
    expect(sheetsSeen[0]![0]!.notes).toEqual(["İrsaliye açıklaması", "* DİKKAT: Bu sevkiyatın irsaliyesi İPTAL edilmiştir."]);
    expect(dispatchDocNotes(null)).toEqual([]);
  });

  it("muhasebe fişi dipnotları KORUNUR (brüt + iade)", () => {
    const n = dispatchReportNotes(report({})).join("\n");
    expect(n).toMatch(/brüt/);
    expect(n).toMatch(/iade alınmıştır/);
  });
});
