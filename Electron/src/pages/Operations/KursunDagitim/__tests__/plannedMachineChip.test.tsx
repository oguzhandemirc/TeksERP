// Plan makinesi çipi ekranın dağıtım sorgusunu gözler; queryFn'siz gözlemci sorgu seçeneklerini ezip invalidate
// tazelemesini "No queryFn" hatasına düşürüyordu (QA 2026-11-03). Çip son gözlemci olsa da tazeleme çalışmalı.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DISTRIBUTION_QUERY_KEY, useKursunDistribution } from "../useKursunDistribution";
import { PlannedMachineChip } from "../PlannedMachineChip";
import type { KursunDistributionRowBase } from "../types";

const getDistribution = vi.fn();
vi.mock("../service", () => ({ kursunDagitimService: { getDistribution: () => getDistribution() } }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasAnyPermission: () => true }) }));

const ROW = { workOrderId: "w1", workOrderStepId: "s1", plannedMachineId: null, plannedMachineName: null } as unknown as KursunDistributionRowBase;

function Host() {
  const q = useKursunDistribution();
  return q.query.data ? <PlannedMachineChip row={ROW} /> : null;
}

describe("PlannedMachineChip", () => {
  it("çip gözlemcisi varken invalidate tazelemesi queryFn ile koşar", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    getDistribution.mockResolvedValue({ data: { machines: [{ id: "m1", name: "K-1" }] } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><Host /></QueryClientProvider>);
    expect(await screen.findByTestId("planned-machine-chip")).toBeInTheDocument();
    await qc.invalidateQueries({ queryKey: ["kursun-bypass"] });
    await waitFor(() => expect(getDistribution).toHaveBeenCalledTimes(2));
    expect(qc.getQueryState(DISTRIBUTION_QUERY_KEY)?.error ?? null).toBeNull();
    expect(err.mock.calls.flat().join(" ")).not.toMatch(/No queryFn/);
    err.mockRestore();
  });
});
