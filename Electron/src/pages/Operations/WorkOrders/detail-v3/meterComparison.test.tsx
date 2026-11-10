// İE "Metre karşılaştırması": sınıflama (gri/yeşil/amber), biçim, eski backend 404/403 sessiz, diğer hata tek toast, görünüm.
// Negatif sonda: `classifyMeterDiff`te `withinTolerance` kontrolü `longerThanDeclared`ten sonraya alınırsa 2. vaka kırmızı.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MeterComparisonView } from "./MeterComparisonCard";
import {
  classifyMeterDiff,
  defectNote,
  formatMeterDiff,
  getWorkOrderMeterComparison,
  type MeterComparison,
  type MeterComparisonParty,
} from "./meterComparison";

const mocks = vi.hoisted(() => ({ get: vi.fn(), toastError: vi.fn() }));
vi.mock("@/services/apiClient", () => ({ default: { get: mocks.get } }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

beforeEach(() => { mocks.get.mockReset(); mocks.toastError.mockReset(); });

const party = (o: Partial<MeterComparisonParty> = {}): MeterComparisonParty => ({
  partyKey: "P1", batchNo: "B-101", declaredM: 500, declaredSource: "DOCUMENT",
  kursunOutM: 540, tamburInM: 538, tamburCutM: 535, measuredMaxM: 540,
  billedM: 540, billedBasis: "MEASURED", diffM: 40, diffPct: 8,
  withinTolerance: false, longerThanDeclared: true, defectsBeyondDeclared: [], ...o,
});

describe("classifyMeterDiff", () => {
  it("ölçüm/beyan yok → none", () => expect(classifyMeterDiff(party({ diffM: null }))).toBe("none"));
  it("tolerans içi fark artı olsa da gri (negatif sonda: 'longer' DEĞİL)", () => {
    expect(classifyMeterDiff(party({ diffM: 2, withinTolerance: true, longerThanDeclared: false }))).toBe("within");
    expect(classifyMeterDiff(party({ diffM: 2, withinTolerance: true, longerThanDeclared: true }))).not.toBe("longer");
  });
  it("beyandan uzun → longer; beyandan kısa → shorter", () => {
    expect(classifyMeterDiff(party())).toBe("longer");
    expect(classifyMeterDiff(party({ diffM: -30, diffPct: -6, longerThanDeclared: false }))).toBe("shorter");
  });
});

describe("biçim", () => {
  it("fark işaretli ve yüzdeli", () => {
    expect(formatMeterDiff(40, 8)).toBe("+40 m (%8)");
    expect(formatMeterDiff(-12.5, -2.5)).toBe("−12,5 m (%2,5)");
    expect(formatMeterDiff(null, null)).toBe("—");
  });
  it("hata notu; barkodsuzda 'top'", () => {
    expect(defectNote({ rollId: "r", barcode: "T0042", startMeter: 540, rollDeclaredM: 500 })).toBe("Beyandan uzun: T0042 540. metrede hata (beyan 500 m)");
    expect(defectNote({ rollId: "r", barcode: null, startMeter: 510, rollDeclaredM: 500 })).toContain("top 510. metrede");
  });
});

describe("getWorkOrderMeterComparison", () => {
  it("tam yolu çağırır, toast'ı bastırır", async () => {
    mocks.get.mockResolvedValue({ data: { data: { tolerancePct: 0.5, parties: [], totals: {} } } });
    await getWorkOrderMeterComparison("w1");
    expect(mocks.get).toHaveBeenCalledWith("/api/work-orders/w1/meter-comparison", { suppressErrorToast: true });
  });
  it.each([404, 403])("%i → null, toast yok (eski backend / yetkisiz)", async (status) => {
    mocks.get.mockRejectedValue({ response: { status } });
    expect(await getWorkOrderMeterComparison("w1")).toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
  it("500 → null + TEK toast", async () => {
    mocks.get.mockRejectedValue({ response: { status: 500 } });
    expect(await getWorkOrderMeterComparison("w1")).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });
});

describe("MeterComparisonView", () => {
  const data: MeterComparison = {
    tolerancePct: 0.5,
    parties: [
      party({ defectsBeyondDeclared: [{ rollId: "r1", barcode: "T0042", startMeter: 540, rollDeclaredM: 500 }] }),
      party({ partyKey: "P2", batchNo: "B-102", declaredM: 300, kursunOutM: 301, tamburInM: null, tamburCutM: null, measuredMaxM: 301, billedM: 300, billedBasis: "DECLARED", diffM: 1, diffPct: 0.33, withinTolerance: true, longerThanDeclared: false }),
    ],
    totals: { declaredM: 800, measuredMaxM: 841, billedM: 840, diffM: 41 },
  };
  it("satırlar, rozetler, ton, hata notu ve toplam", () => {
    renderWithProviders(<MeterComparisonView data={data} />);
    const rows = screen.getAllByTestId("wo-meter-row");
    const [r0, r1] = [rows[0]!, rows[1]!];
    expect(rows).toHaveLength(2);
    expect(r0).toHaveAttribute("data-tone", "longer");
    expect(r1).toHaveAttribute("data-tone", "within");
    expect(within(r0).getByText("ölçülen")).toBeInTheDocument();
    expect(within(r1).getByText("beyan")).toBeInTheDocument();
    expect(within(r0).getByText("+40 m (%8)")).toBeInTheDocument();
    expect(screen.getByTestId("wo-meter-defect")).toHaveTextContent("Beyandan uzun: T0042 540. metrede hata (beyan 500 m)");
    expect(screen.getByTestId("wo-meter-total")).toHaveTextContent("840 m");
  });
});
