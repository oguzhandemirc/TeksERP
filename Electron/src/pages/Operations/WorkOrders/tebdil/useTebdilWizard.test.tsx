import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTebdilWizard } from "./useTebdilWizard";

// Servisi tam mock'la — gerçek HTTP yok, çağrı argümanları doğrulanır.
const getSplitPreview = vi.fn();
const splitBranch = vi.fn();
const bulkDispatchStep = vi.fn();
vi.mock("../service", () => ({
  workOrderService: {
    getSplitPreview: (...a: unknown[]) => getSplitPreview(...a),
    splitBranch: (...a: unknown[]) => splitBranch(...a),
    bulkDispatchStep: (...a: unknown[]) => bulkDispatchStep(...a),
  },
}));

type Roll = { id: string; status: string; currentQty: number; currentStepId: string | null; eligible: boolean };
function preview(over: Partial<{ allowedModes: string[]; eligibleCount: number; colorStepId: string | null; rolls: Roll[] }>) {
  return {
    data: {
      allowedModes: over.allowedModes ?? ["REDYE_SAME_COLOR", "NEW_COLOR"],
      blockReason: null,
      colorStepId: over.colorStepId ?? "cs1",
      sourceTargetColorId: "c1",
      rollCount: over.rolls?.length ?? 0,
      eligibleCount: over.eligibleCount ?? 0,
      rolls: over.rolls ?? [],
    },
  };
}

function render(dispatchOnly = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useTebdilWizard({ workOrderId: "wo1", batchId: "b1", open: true, dispatchOnly }), { wrapper });
}

beforeEach(() => {
  getSplitPreview.mockReset();
  splitBranch.mockReset();
  bulkDispatchStep.mockReset();
});

describe("useTebdilWizard", () => {
  it("REDYE partisi: uygun toplar seçili + varsayılan mod REDYE + ADIM 1 geçilebilir", async () => {
    getSplitPreview.mockResolvedValue(
      preview({
        eligibleCount: 2,
        rolls: [
          { id: "r1", status: "IN_PRODUCTION", currentQty: 100, currentStepId: "s2", eligible: true },
          { id: "r2", status: "IN_PRODUCTION", currentQty: 100, currentStepId: "s2", eligible: true },
        ],
      }),
    );
    const { result } = render();
    await waitFor(() => expect(result.current.selected.size).toBe(2));
    expect(result.current.mode).toBe("REDYE_SAME_COLOR");
    expect(result.current.canLeaveStep1).toBe(true);
    expect(result.current.allSelectable).toBe(false);
  });

  it("B3: UNDYED-only partide (tümü fasonda, eligibleCount=0) tüm toplar seçilebilir, ADIM 1 TAKILMAZ", async () => {
    getSplitPreview.mockResolvedValue(
      preview({
        allowedModes: ["UNDYED_MOVE"],
        eligibleCount: 0,
        rolls: [
          { id: "r1", status: "AT_SUBCONTRACTOR", currentQty: 100, currentStepId: "s1", eligible: false },
          { id: "r2", status: "AT_SUBCONTRACTOR", currentQty: 100, currentStepId: "s1", eligible: false },
          { id: "r3", status: "AT_SUBCONTRACTOR", currentQty: 100, currentStepId: "s1", eligible: false },
        ],
      }),
    );
    const { result } = render();
    await waitFor(() => expect(result.current.selectableRolls.length).toBe(3));
    expect(result.current.allSelectable).toBe(true);
    expect(result.current.selected.size).toBe(3); // hepsi seçili → takılmaz
    expect(result.current.canLeaveStep1).toBe(true);
  });

  it("REDYE + hemen sevk: splitBranch SONRA bulkDispatchStep çağrılır (colorStep + firma)", async () => {
    getSplitPreview.mockResolvedValue(
      preview({ eligibleCount: 1, rolls: [{ id: "r1", status: "IN_PRODUCTION", currentQty: 100, currentStepId: "s2", eligible: true }] }),
    );
    splitBranch.mockResolvedValue({ data: { newBatchNumber: "P1407260001" } });
    bulkDispatchStep.mockResolvedValue({ data: { id: "d1", dispatchNo: "FS1" } });

    const { result } = render();
    await waitFor(() => expect(result.current.selected.size).toBe(1));

    act(() => result.current.setSubcontractorId("sub1"));
    expect(result.current.canSubmit).toBe(true);
    await act(async () => {
      await result.current.runMut.mutateAsync();
    });

    expect(splitBranch).toHaveBeenCalledWith(
      "wo1",
      expect.objectContaining({ batchId: "b1", mode: "REDYE_SAME_COLOR", rollIds: ["r1"] }),
    );
    expect(bulkDispatchStep).toHaveBeenCalledWith(
      expect.objectContaining({ workOrderId: "wo1", stepId: "cs1", rollIds: ["r1"], subcontractorId: "sub1" }),
    );
    expect(result.current.result?.dispatched).toBe(true);
    expect(result.current.result?.dispatchNo).toBe("FS1");
    expect(result.current.step).toBe(4);
  });

  it("REDYE + sahada okut: yalnız splitBranch, sevk YOK", async () => {
    getSplitPreview.mockResolvedValue(
      preview({ eligibleCount: 1, rolls: [{ id: "r1", status: "IN_PRODUCTION", currentQty: 100, currentStepId: "s2", eligible: true }] }),
    );
    splitBranch.mockResolvedValue({ data: { newBatchNumber: "P1407260002" } });

    const { result } = render();
    await waitFor(() => expect(result.current.selected.size).toBe(1));
    act(() => result.current.setDispatchNow(false));
    expect(result.current.canSubmit).toBe(true); // firma gerekmez
    await act(async () => {
      await result.current.runMut.mutateAsync();
    });
    expect(splitBranch).toHaveBeenCalledTimes(1);
    expect(bulkDispatchStep).not.toHaveBeenCalled();
    expect(result.current.result?.dispatched).toBe(false);
  });

  it("NEW_COLOR: yeni renk seçilmeden ADIM 2 geçilemez; splitBranch newColorId ile çağrılır", async () => {
    getSplitPreview.mockResolvedValue(
      preview({ eligibleCount: 1, rolls: [{ id: "r1", status: "IN_PRODUCTION", currentQty: 100, currentStepId: "s2", eligible: true }] }),
    );
    splitBranch.mockResolvedValue({ data: { newWorkOrderId: "wo2", newWorkOrderNumber: "IE1407260009" } });

    const { result } = render();
    await waitFor(() => expect(result.current.selected.size).toBe(1));
    act(() => result.current.setMode("NEW_COLOR"));
    expect(result.current.canLeaveStep2).toBe(false); // renk yok
    act(() => result.current.setNewColorId("c2"));
    expect(result.current.canLeaveStep2).toBe(true);

    await act(async () => {
      await result.current.runMut.mutateAsync();
    });
    expect(splitBranch).toHaveBeenCalledWith("wo1", expect.objectContaining({ mode: "NEW_COLOR", newColorId: "c2" }));
    expect(result.current.result?.newWorkOrderNumber).toBe("IE1407260009");
    expect(bulkDispatchStep).not.toHaveBeenCalled();
  });
});
