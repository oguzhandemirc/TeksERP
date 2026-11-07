// Kartela Kabulü — gövde tabletle aynı (`dispatchId`, irsaliye/not, top başına adet + ölçü).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const post = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: vi.fn(), post: (...a: unknown[]) => post(...a) } }));
let measure = true;
vi.mock("@/hooks/usePricingEnabled", () => ({ useKartelaMeasurementEnabled: () => measure }));

import { KartelaReceiveDialog } from "./KartelaReceiveDialog";
import { groupOutstanding } from "./kartelaActions";
import type { KartelaOutstandingItem } from "./service";

const it2 = (rollId: string): KartelaOutstandingItem => ({
  dispatchedQty: 40, dispatchedWeight: null,
  dispatch: { id: "d1", dispatchNo: "KS-1", dispatchedAt: "2026-11-01T08:00:00.000Z", subcontractor: { id: "f1", name: "Firma" } },
  roll: { id: rollId, barcode: `T${rollId}`, currentQty: 40, width: null, weightKg: null, qualityGrade: "A", markedForKartela: false,
    item: { code: "P", name: "Poplin" }, color: null, properties: [] },
});
const job = groupOutstanding([it2("1"), it2("2")])[0]!;

describe("Kartela Kabulü", () => {
  beforeEach(() => {
    post.mockReset();
  });

  it("ölçüm açık: varsayılan + tek tek istisna; adetsiz top gitmez; uçuşta tek istek", async () => {
    measure = true;
    post.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<KartelaReceiveDialog job={job} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("T1 kartela adedi"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("T1 uzunluk cm"), { target: { value: "50" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Tek tek/ })[0]!);
    fireEvent.change(screen.getByLabelText("Kartela 2 cm"), { target: { value: "45" } });
    expect(screen.getByTestId("kabul-ozet")).toHaveTextContent("1 top → 2 kartela");
    fireEvent.change(screen.getByLabelText("İrsaliye no"), { target: { value: " IR-9 " } });
    const btn = screen.getByRole("button", { name: "Kabul Et" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/kartela/receive", {
      subcontractorId: "f1", dispatchId: "d1", manifestNo: "IR-9", notes: null,
      returns: [{ rollId: "1", count: 2, bulkLengthCm: 50, bulkWeightKg: null,
        items: [{ lengthCm: null, weightKg: null }, { lengthCm: 45, weightKg: null }] }],
    });
  });

  it("ölçüm kapalı: cm/kg alanı yok, bulk null", async () => {
    measure = false;
    post.mockResolvedValue({ data: { success: true, data: { id: "k1" } } });
    const onClose = vi.fn();
    renderWithProviders(<KartelaReceiveDialog job={job} onClose={onClose} />);
    expect(screen.queryByLabelText("T1 uzunluk cm")).toBeNull();
    fireEvent.change(screen.getByLabelText("T2 kartela adedi"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Kabul Et" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toMatchObject({ returns: [{ rollId: "2", count: 3, bulkLengthCm: null, bulkWeightKg: null }] });
  });
});
