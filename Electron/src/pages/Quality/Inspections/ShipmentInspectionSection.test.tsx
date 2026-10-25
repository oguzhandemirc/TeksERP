// Sevk detayı "Muayene" bölümü: etiket/sonuç/toplam sunucudan okunur (istemci hesaplamaz);
// modül kapalı ya da izin yoksa bölüm çizilmez ve istek atılmaz.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const shipmentSummary = vi.fn();
let visible = true;
vi.mock("./service", () => ({ inspectionService: { shipmentSummary: (...a: unknown[]) => shipmentSummary(...a) } }));
vi.mock("./RollInspectionCard", () => ({ useInspectionsVisible: () => visible }));
vi.mock("./InspectionReportDialog", () => ({ InspectionReportDialog: () => null }));

import { ShipmentInspectionSection } from "./ShipmentInspectionSection";

const base = { itemName: "Poplin", colorName: "Bej", meters: 100, widthCm: 150, widthSource: "ITEM_CARD", inspectedLengthM: 100, unplacedDefectCount: 0, scoreUnit: "M2", inspectorName: null, stationName: null, deviceName: null, inspectedAt: "2026-10-25T08:00:00Z", ruleKey: "k" };
const none = { inspectionId: null, phase: null, inspectedAt: null, widthCm: null, widthSource: null, inspectedLengthM: null, defectCount: null, unplacedDefectCount: null, totalPoints: null, pointsPer100M2: null, score: null, scoreUnit: null, label: null, accepted: null, factoryGrade: null, ruleKey: null };
// Toplamlar satırlardan BİLEREK farklı (geçti 7): şerit sunucu toplamını okuyorsa 7 görünür.
const summary = {
  header: { shipmentId: "s1", shipmentNo: "SVK-1", customerId: "c", customerName: "Müşteri", customerCode: "M1", date: "2026-10-25T08:00:00Z", orderNos: "" },
  rules: [],
  rows: [
    { ...base, sequence: 1, rollId: "r1", barcode: "TP-1", inspectionId: "i1", phase: "FINAL", defectCount: 2, totalPoints: 6, pointsPer100M2: 4, score: 4, label: "İYİ", accepted: true, result: "PASS", factoryGrade: "A" },
    { ...base, sequence: 2, rollId: "r2", barcode: "TP-2", inspectionId: "i2", phase: "RAW", defectCount: 5, totalPoints: 20, pointsPer100M2: 13.33, score: 13.33, label: "RET", accepted: false, result: "FAIL", factoryGrade: "B" },
    { ...base, ...none, sequence: 3, rollId: "r3", barcode: "TP-3", result: "NONE" },
  ],
  totals: { rollCount: 3, inspectedCount: 2, uninspectedCount: 1, passCount: 7, failCount: 1, noScoreCount: 0, totalMeters: 300, defectCount: 7, totalPoints: 26, unplacedDefectCount: 0, avgPointsPer100M2: 8.67 },
  notes: { unplacedRollCount: 0, widthSources: { ITEM_CARD: 2 } },
};

describe("ShipmentInspectionSection", () => {
  beforeEach(() => { shipmentSummary.mockReset(); visible = true; });
  it("dolu + muayenesiz karışık: sonuç rozetleri ve sunucu toplamı", async () => {
    shipmentSummary.mockResolvedValue(summary);
    renderWithProviders(<ShipmentInspectionSection shipmentId="s1" shipmentNo="SVK-1" />);
    expect(await screen.findByText("GEÇTİ")).toBeTruthy();
    expect(screen.getByText("KALDI")).toBeTruthy();
    const strip = screen.getByLabelText("Muayene özeti");
    expect(strip.textContent).toContain("Muayene edilen 2 / 3");
    expect(strip.textContent).toContain("Geçti 7");
    const r3 = screen.getByText("TP-3").closest("tr")!;
    expect(within(r3).getByText("Muayene yok")).toBeTruthy();
    expect(within(r3).getAllByText("—").length).toBeGreaterThan(3);
    expect(shipmentSummary).toHaveBeenCalledWith("s1");
    expect((screen.getByRole("button", { name: /Muayene raporu/ }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("modül kapalı / izin yok: çizilmez, istek atılmaz", () => {
    visible = false;
    const { container } = renderWithProviders(<ShipmentInspectionSection shipmentId="s1" shipmentNo="SVK-1" />);
    expect(container.textContent).toBe("");
    expect(shipmentSummary).not.toHaveBeenCalled();
  });
});
