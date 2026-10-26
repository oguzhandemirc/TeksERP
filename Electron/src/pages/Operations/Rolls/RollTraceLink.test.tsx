import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const openTab = vi.fn();
let allowed = true;
vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab }) } }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => allowed && p === "report:production" }),
}));

import { RollTraceLink, travelerTraceTarget, TRAVELER_TRACE_PATH } from "./RollTraceLink";

describe("RollTraceLink — top kartından Top İzleme'ye (KÜÇÜK-F / R0-GECIS bulgusu)", () => {
  beforeEach(() => {
    openTab.mockClear();
    allowed = true;
  });

  it("topun id'siyle izleme sekmesini açar; TravelerTracePage `useScanSeed(\"rollId\")` bunu okur", async () => {
    render(<RollTraceLink rollId="r-1" />);
    fireEvent.click(screen.getByTestId("roll-trace-link"));
    await vi.waitFor(() => expect(openTab).toHaveBeenCalled());
    expect(openTab).toHaveBeenCalledWith(TRAVELER_TRACE_PATH, { state: { rollId: "r-1" } });
  });

  it("report:production izni yoksa çizilmez (rapor rotası zaten aynı izinle kapılı)", () => {
    allowed = false;
    render(<RollTraceLink rollId="r-1" />);
    expect(screen.queryByTestId("roll-trace-link")).toBeNull();
  });

  it("hedef yolu rota tablosundaki traveler-trace ile aynı", () => {
    expect(travelerTraceTarget("x")).toEqual({ to: "/reports/production/traveler-trace", state: { rollId: "x" } });
  });
});
