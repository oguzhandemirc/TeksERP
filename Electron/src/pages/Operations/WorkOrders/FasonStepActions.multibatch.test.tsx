// Negatif sonda (2026-09-26): MultiBatchDialog varsayılanı MERGE yapılınca 1. test kırmızı;
// MULTI_BATCH dalı kaldırılınca diyalog açılmaz ve 1. test kırmızı.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const bulkDispatchStep = vi.fn();
vi.mock("./service", () => ({ workOrderService: { bulkDispatchStep: (...a: unknown[]) => bulkDispatchStep(...a), transferToNextFason: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("./FasonStepRollSelectModal", () => ({
  FasonStepRollSelectModal: ({ open, onConfirm, confirmLabel }: { open: boolean; onConfirm: (ids: string[]) => void; confirmLabel: string }) =>
    open && confirmLabel === "Sevk Et" ? <button type="button" onClick={() => onConfirm(["r1", "r2"])}>sonda-gonder</button> : null,
}));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { FasonStepActions } from "./FasonStepActions";

const STEP = {
  id: "s1", stepSequence: 1, station: { id: "st", code: "BOYA", name: "Boyahane", type: "EXTERNAL" },
  plannedSubcontractorId: "f1", plannedSubcontractor: { id: "f1", name: "Boyacı" },
  currentRollList: [{ id: "r1", status: "IN_PRODUCTION" }, { id: "r2", status: "IN_PRODUCTION" }],
} as never;
const MULTI = { response: { status: 409, data: { message: "çok parti", details: { code: "MULTI_BATCH", batches: [{ id: "b1", batchNumber: "P03", oldest: true }, { id: "b2", batchNumber: "P07", oldest: false }] } } } };

async function sevkEt() {
  await userEvent.click(screen.getAllByRole("button", { name: /Sevk Et/ })[0]!);
  await userEvent.click(await screen.findByText("sonda-gonder"));
}

describe("FasonStepActions — çok partili sevk", () => {
  beforeEach(() => bulkDispatchStep.mockReset());

  it("409 MULTI_BATCH → seçim diyaloğu; dokunmadan Sevk Et AYRI sevk ister", async () => {
    bulkDispatchStep.mockRejectedValueOnce(MULTI).mockResolvedValueOnce({ success: true, message: "2 parti ayrı ayrı sevk edildi" });
    renderWithProviders(<FasonStepActions step={STEP} steps={[STEP]} workOrderId="wo-1" />);
    await sevkEt();
    expect(await screen.findByText("Ayrı sevk (2 irsaliye)")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Sevk Et" }));
    await waitFor(() => expect(bulkDispatchStep).toHaveBeenCalledTimes(2));
    expect(bulkDispatchStep.mock.calls[1]?.[0]).toMatchObject({ rollIds: ["r1", "r2"], multiBatchStrategy: "SEPARATE" });
  });

  it("birleştir açık seçim: MERGE ile yeniden gönderir", async () => {
    bulkDispatchStep.mockRejectedValueOnce(MULTI).mockResolvedValueOnce({ success: true, message: "ok" });
    renderWithProviders(<FasonStepActions step={STEP} steps={[STEP]} workOrderId="wo-1" />);
    await sevkEt();
    await userEvent.click(await screen.findByText("Birleştir (P03)"));
    await userEvent.click(screen.getByRole("button", { name: "Sevk Et" }));
    await waitFor(() => expect(bulkDispatchStep).toHaveBeenCalledTimes(2));
    expect(bulkDispatchStep.mock.calls[1]?.[0]).toMatchObject({ multiBatchStrategy: "MERGE" });
  });
});
