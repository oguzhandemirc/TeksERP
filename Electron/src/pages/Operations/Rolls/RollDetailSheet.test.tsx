// Top kartı başlığı: TEK "İz sür" — yazılı, outline düğme (kullanıcı 2026-11-10: iki tane vardı, biri link gibiydi).
// Negatif sonda (2026-11-10): kimlik kartına `<TraceLink recordNo={r.barcode} />` geri konunca §1 ❌ (2 adet).
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { Null, ROLL } = vi.hoisted(() => ({ Null: () => null, ROLL: {
  id: "r1", barcode: "T1", itemId: "i", colorId: null, initialQty: 100, currentQty: 80, weightKg: null, width: null,
  status: "WAREHOUSE", qualityGrade: null, form: "TOP", entrySource: "SEMI_FINISHED", parentRollId: null, parentReceiptId: null,
  packageId: null, grossWeightKg: null, netWeightKg: null, packagingDate: null, createdAt: "2026-11-09T07:00:00Z", updatedAt: "2026-11-09T07:00:00Z",
  item: { id: "i", code: "K", name: "Tül Kumaş" },
} }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true }) }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useEmanetEnabled: () => true, useFeatureFlags: () => ({ data: { data: { financeEnabled: false } } }) }));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: unknown }) => children }));
vi.mock("./service", () => ({
  rollService: {
    getById: () => Promise.resolve({ data: { ...ROLL, ownerCustomer: { id: "c", name: "HHL MC" } } }),
    getHistory: () => Promise.resolve({ data: { roll: { id: "r1", barcode: "T1", status: "WAREHOUSE" }, events: [] } }),
  },
}));
vi.mock("@/components/labels/RollLabelDialog", () => ({ RollLabelDialog: Null }));
vi.mock("./RollEditDialog", () => ({ RollEditDialog: Null }));
vi.mock("./RescueStuckDialog", () => ({ RescueStuckDialog: Null }));
vi.mock("./RollQtyAdjustDialog", () => ({ RollQtyAdjustDialog: Null }));
vi.mock("./RollLabelTextsCard", () => ({ RollLabelTextsCard: Null }));
vi.mock("@/pages/Quality/LabTests/LabTestsCard", () => ({ LabTestsCard: Null }));
vi.mock("@/pages/Quality/Inspections/RollInspectionCard", () => ({ RollInspectionCard: Null }));
vi.mock("@/components/print/PrintHistoryLink", () => ({ PrintHistoryLink: Null }));


import { RollDetailSheet } from "./RollDetailSheet";
import type { Roll } from "./types";

describe("RollDetailSheet başlığı", () => {
  it("§1 tek 'İz sür' — yazılı, outline düğme; sahiplik satırı en üstte", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RollDetailSheet roll={ROLL as unknown as Roll} open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("roll-owner-consigned")).toBeTruthy());
    expect(screen.getAllByText("İz sür")).toHaveLength(1);
    const btn = screen.getByTestId("roll-trace-link");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.className).toContain("border-input");
  });
});
