// Muayene listesi: özet şeridi sunucu yanıtından (istemci toplamaz); süzgeç sorgu parametresine gider.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { renderWithProviders } from "@/test/render";
import { EMPTY_INSPECTION_FILTERS, type InspectionFilterState } from "./inspectionRules";

const list = vi.fn();
vi.mock("./service", () => ({ inspectionService: { list: (...a: unknown[]) => list(...a) } }));
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({ EntityPickerModal: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span> }));
vi.mock("@/components/forms/ItemPickerModal", () => ({ ItemPickerModal: () => null }));

import { InspectionList } from "./InspectionList";

const row = (id: string, extra: object = {}) => ({
  id, phase: "FINAL", revision: 1, totalPoints: 12, defectCount: 3, unplacedDefectCount: 0, pointsPer100M2: "15.40", gradeScore: "15.40",
  suggestedGradeCode: "A", gradeMismatch: false, widthCm: "160", widthSource: "ITEM_CARD", inspectedLengthM: "50", inspectedAt: "2026-10-25T08:00:00Z",
  supersededAt: null, voidedAt: null, createdAt: "2026-10-25T08:00:00Z",
  roll: { id: `r-${id}`, barcode: `TP-${id}`, qualityGrade: "A", item: { id: "i", code: "K1", name: "Poplin" } },
  station: { id: "s", name: "Kalite 1" }, inspectedBy: { id: "u1", fullName: "Ayşe Usta" }, ...extra,
});
// Sunucu toplamı (37) sayfadaki satır sayısından (2) farklı: şerit yanıttan okunuyorsa 37 görünür.
const page = (items: unknown[]) => ({ items, nextCursor: null, summary: { total: 37, avgPointsPer100M2: "18.25", mismatch: 4, widthUnknown: 2, grades: [{ code: "A", count: 30 }, { code: "B", count: 7 }] } });

function Harness() {
  const [f, setF] = useState<InspectionFilterState>(EMPTY_INSPECTION_FILTERS);
  return <InspectionList f={f} onFilters={setF} onOpen={() => {}} />;
}

describe("InspectionList", () => {
  beforeEach(() => { list.mockReset(); });
  it("özet şeridi sunucu özetinden — istemci satır saymaz", async () => {
    list.mockResolvedValue(page([row("1"), row("2", { gradeMismatch: true, widthSource: "UNKNOWN", widthCm: null })]));
    renderWithProviders(<Harness />);
    const strip = await screen.findByTestId("inspection-summary");
    expect(strip.textContent).toContain("Top37");
    expect(strip.textContent).toContain("Derece B7");
    expect(strip.textContent).toContain("Uyumsuz4");
    expect(strip.textContent).toContain("En yok2");
    expect(screen.getAllByText("Uyumsuz").length).toBeGreaterThan(1);
  });
  it("süzgeçler sorgu parametresine gider", async () => {
    list.mockResolvedValue(page([row("1")]));
    renderWithProviders(<Harness />);
    const filters = await screen.findByTestId("inspection-filters");
    fireEvent.click(within(filters).getByRole("button", { name: "Uyumsuz" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ mismatch: "1" })));
    fireEvent.click(within(filters).getByRole("button", { name: "Mamul" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "FINAL", mismatch: "1" })));
    fireEvent.click(await screen.findByRole("button", { name: "Ayşe Usta" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ inspectedById: "u1" })));
  });
  it("boş ve hata ayrı mesaj", async () => {
    list.mockResolvedValueOnce({ ...page([]), summary: { total: 0, avgPointsPer100M2: null, mismatch: 0, widthUnknown: 0, grades: [] } });
    const r = renderWithProviders(<Harness />);
    expect(await screen.findByText(/Henüz muayene yok/)).toBeTruthy();
    r.unmount();
    list.mockRejectedValueOnce(new Error("x"));
    renderWithProviders(<Harness />);
    expect(await screen.findByText("Muayeneler yüklenemedi.")).toBeTruthy();
  });
});
