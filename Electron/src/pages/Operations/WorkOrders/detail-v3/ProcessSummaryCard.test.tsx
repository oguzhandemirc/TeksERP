// KQ-D6 gramaj görünümü: kart sunucu özetini AYNEN basar (sapma turuncu, kâğıt/bilinmiyor gri),
// yeni İE payload'ı hedef gramajı yalnız seçiliyse taşır (istemci gövde allowlist'i).
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { buildPayload } from "../workOrderPayload";
import { workOrderFormDefaults } from "../schema";

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), put: vi.fn() } }));
vi.mock("@/pages/FabricProperties/service", () => ({
  fabricPropertyService: {
    getAll: async () => ({
      data: [
        { id: "flag", code: "KURSUN", isActive: true, valueType: "FLAG" },
        { id: "gr", code: "KURSUN_GR", isActive: true, valueType: "CHOICE", variantOfPropertyId: "flag",
          values: [{ id: "v50", code: "50", name: "50 gr", sortOrder: 2, isActive: true },
                   { id: "v25", code: "25", name: "25 gr", sortOrder: 1, isActive: true }] },
      ],
    }),
  },
}));

import { ProcessSummaryCard } from "./ProcessSummaryCard";

describe("ProcessSummaryCard", () => {
  it("hedef, satırlar ve toplam sunucu özetinden; sapma işaretli", async () => {
    get.mockResolvedValue({
      data: {
        success: true,
        data: {
          kursun: {
            target: { propertyId: "gr", valueId: "v50", valueName: "50 gr" },
            rows: [
              { valueId: "v50", valueName: "50 gr", source: "TABLET", rollCount: 14, stepCount: 14, meters: "1400.00", deviatesFromTarget: false },
              { valueId: "v25", valueName: "25 gr", source: "TABLET", rollCount: 3, stepCount: 3, meters: "300.00", deviatesFromTarget: true },
              { valueId: null, valueName: "Gramaj bilinmiyor", source: "KAGIT", rollCount: 2, stepCount: 1, meters: "200.00", deviatesFromTarget: false },
            ],
            totals: { rollCount: 19, meters: "1900.00" },
          },
        },
      },
    });
    renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} />);
    await waitFor(() => expect(screen.getByTestId("process-summary-card")).toBeInTheDocument());
    expect(get).toHaveBeenCalledWith("/api/work-orders/wo1/process-summary");
    expect(screen.getAllByText("50 gr").length).toBeGreaterThan(0);
    expect(screen.getByText("Hedeften farklı")).toBeInTheDocument();
    expect(screen.getByText("Gramaj bilinmiyor")).toBeInTheDocument();
    expect(screen.getByText("Kâğıt")).toBeInTheDocument();
    expect(screen.getAllByText("Hedeften farklı")).toHaveLength(1);
  });
});

describe("buildPayload — hedef kurşun gramajı allowlist'i", () => {
  const meta = { fasonPlans: [], customSteps: [], kursunTargetPropertyId: "gr" };
  it("seçiliyse targetValues gider", () => {
    const p = buildPayload({ ...workOrderFormDefaults, kursunTargetValueId: "v50" }, meta, false);
    expect(p.targetValues).toEqual([{ propertyId: "gr", valueId: "v50" }]);
  });
  it("seçili değilse ya da çeşit tanımlı değilse anahtar HİÇ yok", () => {
    expect("targetValues" in buildPayload({ ...workOrderFormDefaults }, meta, false)).toBe(false);
    const noProp = buildPayload({ ...workOrderFormDefaults, kursunTargetValueId: "v50" }, { ...meta, kursunTargetPropertyId: null }, false);
    expect("targetValues" in noProp).toBe(false);
  });
});
