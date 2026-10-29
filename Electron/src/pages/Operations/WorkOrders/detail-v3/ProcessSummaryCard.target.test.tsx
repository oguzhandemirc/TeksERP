// K1: hedef kaldırma yükü özellik kapsamlıdır — `[]` backend'de eski sözleşme "hepsini kaldır" sayılır
// ve öteki özelliğin hedefini de düşürür; bu yüzden panel `{propertyId, valueId:null}` gönderir.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const get = vi.fn();
const put = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) } }));
vi.mock("@/pages/FabricProperties/service", () => ({
  fabricPropertyService: {
    getAll: async () => ({
      data: [
        { id: "flag", code: "KURSUN", isActive: true, valueType: "FLAG" },
        { id: "gr", code: "KURSUN_GR", isActive: true, valueType: "CHOICE", variantOfPropertyId: "flag",
          values: [{ id: "v50", code: "50", name: "50 gr", sortOrder: 2, isActive: true }] },
      ],
    }),
  },
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }),
}));

import { ProcessSummaryCard } from "./ProcessSummaryCard";

describe("ProcessSummaryCard — hedefi kaldırma", () => {
  it("'Hedef yok' kaydı yalnız o özelliği kaldırır: items=[{propertyId, valueId:null}], [] DEĞİL", async () => {
    get.mockResolvedValue({ data: { success: true, data: { kursun: {
      target: { propertyId: "gr", valueId: "v50", valueName: "50 gr" }, rows: [], totals: { rollCount: 0, meters: "0" },
    } } } });
    put.mockResolvedValue({ data: { success: true, data: { changed: true } } });
    renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} editableTarget />);
    fireEvent.click(await screen.findByRole("button", { name: "Hedefi değiştir" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Hedef yok" }));
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith("/api/work-orders/wo1/target-values", { items: [{ propertyId: "gr", valueId: null }] });
  });
});
