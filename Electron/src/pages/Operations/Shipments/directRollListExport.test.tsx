// D4-KUC3a — fasondan doğrudan sevk top listesi Excel'i: kolonlar ekrandaki tabloyla AYNI liste, satır = ekrandaki top,
// toplam = sunucunun totalQty'si (ikinci toplayıcı yok).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { DirectShipmentDetail } from "./types";
import { buildDirectRollListSheet, DIRECT_ROLL_COLUMNS, directRollListFileName } from "./directRollListExport";

const DETAIL: DirectShipmentDetail = {
  id: "ds1", kind: "DIRECT", shipmentNo: "FSV-7", reason: "Müşteri istedi", totalQty: 250.5, rollCount: 3,
  shippedAt: "2026-10-31T09:00:00.000Z", createdAt: "2026-10-31T08:00:00.000Z",
  customer: { id: "c1", code: "C1", name: "Örnek Perde" }, branch: null, shippedBy: "Ali",
  dispatch: { id: "d1", dispatchNo: "FS-3", subcontractor: { id: "s1", name: "Boyahane", code: null }, workOrder: { id: "w1", workOrderNumber: "TIE-9" }, stationName: "Boya", stepSequence: 2 },
  rolls: [
    { id: "r1", barcode: "T1", itemName: "PERDE TUL", colorName: "KREM", currentQty: 120.5, width: 280, qualityGrade: "1" },
    { id: "r2", barcode: null, itemName: "PERDE TUL", colorName: null, currentQty: 80, width: null, qualityGrade: null },
    { id: "r3", barcode: "T3", itemName: "ETAMIN", colorName: "BEYAZ", currentQty: 50, width: 300, qualityGrade: "2" },
  ],
  allocations: [],
};

const getDetail = vi.fn();
vi.mock("./service", async (orig) => {
  const actual = await orig<typeof import("./service")>();
  return { ...actual, shipmentService: { ...actual.shipmentService, getDirectShipmentDetail: (...a: unknown[]) => getDetail(...a) } };
});
vi.mock("./DirectShipPrintDialog", () => ({ DirectShipPrintDialog: () => null }));

const { DirectShipmentDetailContent } = await import("./DirectShipmentDetailContent");

describe("buildDirectRollListSheet", () => {
  it("Excel kolonları ekrandaki tablonun başlıklarıyla AYNI (tek liste)", async () => {
    getDetail.mockResolvedValue({ success: true, data: DETAIL });
    renderWithProviders(<DirectShipmentDetailContent directShipmentId="ds1" />);
    const table = (await screen.findByText("T1")).closest("table")!;
    const screenHeaders = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    const excelHeaders = buildDirectRollListSheet(DETAIL).columns.map((c) => c.header);
    expect(excelHeaders).toEqual(DIRECT_ROLL_COLUMNS.map((c) => c.header));
    expect(screenHeaders).toEqual(excelHeaders);
    expect(screen.getByRole("button", { name: /Top listesi \(Excel\)/ })).toBeInTheDocument();
  });

  it("satır = ekrandaki top; barkodsuz satır 'açık kumaş'; boş en/kalite hücresi boş", () => {
    const s = buildDirectRollListSheet(DETAIL);
    expect(s.rows).toHaveLength(DETAIL.rolls.length);
    expect(s.rows[0]).toMatchObject({ barcode: "T1", item: "PERDE TUL · KREM", width: 280, qualityGrade: "1", meters: 120.5 });
    expect(s.rows[1]).toMatchObject({ barcode: "açık kumaş", item: "PERDE TUL", width: "", qualityGrade: "" });
  });

  it("TOPLAM sunucunun totalQty/rollCount'ı; kaynakta yeniden toplama yok", () => {
    const s = buildDirectRollListSheet(DETAIL);
    expect(s.totalRow).toMatchObject({ barcode: "TOPLAM (3 top)", meters: 250.5 });
    const src = readFileSync(resolve(__dirname, "directRollListExport.ts"), "utf8");
    expect(src).not.toMatch(/\.reduce\(/);
  });

  it("dosya adı sevk numarasıyla", () => {
    expect(directRollListFileName("FSV-7")).toBe("Top_Listesi_FSV-7");
  });
});
