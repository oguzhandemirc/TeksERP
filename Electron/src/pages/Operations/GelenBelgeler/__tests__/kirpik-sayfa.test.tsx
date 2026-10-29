// Çok sayfalı belgede hücre kırpığı satırın KENDİ taramasından (E4 scanId): 2. sayfanın satırı 2. sayfadan.
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { CellReviewDialog } from "../CellReviewDialog";
import type { DeliveryNoteLine } from "../types";

const cropCalls = vi.fn();
vi.mock("../CellCrop", () => ({
  CellCrop: ({ scanId }: { scanId: string | null }) => {
    cropCalls(scanId);
    return <div data-testid="crop-scan">{scanId ?? "yok"}</div>;
  },
}));

const rect = { x: 10, y: 10, width: 40, height: 20 };
const line = (o: Partial<DeliveryNoteLine>): DeliveryNoteLine => ({
  id: "l1", noteId: "n1", lineNo: 1, blockNo: 1, lineKind: "TOP", senderRollNo: null, meters: "100", weightKg: null, widthCm: null,
  itemText: null, itemId: null, colorText: null, colorId: null, processText: null, confidence: 0.4, needsReview: true,
  sourceRects: { m: rect }, status: "PENDING", failReason: null, rollId: null, item: null, color: null, ...o,
});
const scans = [{ id: "s1" }, { id: "s2" }];
const render = (lines: DeliveryNoteLine[], sc = scans) =>
  renderWithProviders(<CellReviewDialog open onOpenChange={() => {}} lines={lines} scans={sc} onSave={() => Promise.resolve()} />);

describe("hücre kırpığı doğru sayfadan", () => {
  it("2. sayfanın satırı 2. sayfanın taramasını kullanır", () => {
    render([line({ scanId: "s2" })]);
    expect(screen.getByTestId("crop-scan").textContent).toBe("s2");
  });
  it("scanId yok + çok sayfa → kırpık yok (bugünkü davranış)", () => {
    render([line({ scanId: null })]);
    expect(screen.getByTestId("crop-scan").textContent).toBe("yok");
  });
  it("scanId yok + tek tarama → o tarama (bugünkü davranış)", () => {
    render([line({})], [{ id: "s1" }]);
    expect(screen.getByTestId("crop-scan").textContent).toBe("s1");
  });
});
