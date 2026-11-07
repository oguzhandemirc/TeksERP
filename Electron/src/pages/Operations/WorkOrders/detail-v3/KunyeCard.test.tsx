// Prova 11-06 (madde 12): künyede hedef gramaj görünür; rotasız İE panelde tabletle AYNI adı taşır.
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { SCAN_ROUTE_NAME } from "../oie/nav";

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), put: vi.fn() } }));
vi.mock("@/pages/FabricProperties/service", () => ({
  fabricPropertyService: {
    getAll: async () => ({
      data: [
        { id: "flag", code: "KURSUN", isActive: true, valueType: "FLAG" },
        { id: "gr", code: "KURSUN_GR", isActive: true, valueType: "CHOICE", variantOfPropertyId: "flag",
          values: [{ id: "v50", code: "50", name: "50 gr", sortOrder: 1, isActive: true }] },
      ],
    }),
  },
}));

import { KunyeCard, kunyeRouteLabel } from "./KunyeCard";
import type { WorkOrder } from "../types";

describe("kunyeRouteLabel", () => {
  it("şablon adı > rotasız (tabletle aynı ad) > özel rota", () => {
    expect(kunyeRouteLabel({ routeTemplate: { id: "r", code: null, name: "Kurşun + Tambur" }, scanRouted: true })).toBe("Kurşun + Tambur");
    expect(kunyeRouteLabel({ routeTemplate: null, scanRouted: true })).toBe(SCAN_ROUTE_NAME);
    expect(kunyeRouteLabel({ routeTemplate: null, scanRouted: false })).toBe("Özel rota");
    expect(kunyeRouteLabel({ routeTemplate: null })).toBe("Özel rota");
  });
});

describe("KunyeCard — gramaj", () => {
  it("kurşun çeşidi tanımlıysa hedef gramaj künyede", async () => {
    get.mockResolvedValue({
      data: { success: true, data: { kursun: { target: { propertyId: "gr", valueId: "v50", valueName: "50 gr" }, rows: [], totals: { rollCount: 0, meters: "0" } } } },
    });
    const wo = {
      id: "wo1", workOrderNumber: "IE0611260008", type: "CUSTOMER_GOODS_SERVICE", width: null, foldType: null,
      createdAt: "2026-11-06T10:00:00Z", routeTemplate: null, scanRouted: true, targetItem: null, targetColor: null, targetProperties: [],
    } as unknown as WorkOrder;
    renderWithProviders(<KunyeCard wo={wo} />);
    await waitFor(() => expect(screen.getByText("50 gr")).toBeInTheDocument());
    expect(screen.getByText("Gramaj")).toBeInTheDocument();
    expect(screen.getByText(SCAN_ROUTE_NAME)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/work-orders/wo1/process-summary");
  });
});
