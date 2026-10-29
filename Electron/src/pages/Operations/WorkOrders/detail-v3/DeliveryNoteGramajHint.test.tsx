// H9b: İE Kurşun Gramajı kartında gelen belge önerisi — öneri process-summary yanıtından okunur (ek istek YOK),
// "Uygula" mevcut PUT target-values ucuna gider, izinsiz kullanıcıda düğme yok ve ek uç çağrılmaz (403 uyarısı yok).
import { beforeEach, describe, expect, it, vi } from "vitest";
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
          values: [{ id: "v50", code: "50", name: "50 gr", sortOrder: 2, isActive: true },
                   { id: "v25", code: "25", name: "25 gr", sortOrder: 1, isActive: true }] },
      ],
    }),
  },
}));
const perms = { write: true };
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => p !== "workorder:write" || perms.write,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

import { ProcessSummaryCard } from "./ProcessSummaryCard";

const kursun = { target: null, rows: [], totals: { rollCount: 3, meters: "300.00" } };
function respond(deliveryNoteGramaj?: unknown) {
  get.mockResolvedValue({ data: { success: true, data: deliveryNoteGramaj === undefined ? { kursun } : { kursun, deliveryNoteGramaj } } });
}

describe("DeliveryNoteGramajHint (ProcessSummaryCard içinde)", () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    perms.write = true;
  });

  it("tek değerde birleşen öneriyi kapsamayla gösterir; Uygula mevcut hedef ucuna gider", async () => {
    respond({ suggested: { valueId: "v50", valueName: "50 gr" }, rollCount: 3, coveredRollCount: 3, entries: [{ valueId: "v50", valueName: "50 gr", processText: "KURŞUN 50 GR", rollCount: 3 }] });
    put.mockResolvedValue({ data: { success: true, data: { changed: true } } });
    renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} editableTarget />);
    await waitFor(() => expect(screen.getByTestId("delivery-note-gramaj")).toBeInTheDocument());
    expect(screen.getByText("50 gr")).toBeInTheDocument();
    expect(screen.getByText("(3/3 top gelen belgeli)")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Uygula" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/work-orders/wo1/target-values", { items: [{ propertyId: "gr", valueId: "v50" }] }));
  });

  it("çelişkide öneri yok, liste; Uygula yok", async () => {
    respond({ suggested: null, rollCount: 2, coveredRollCount: 2, entries: [
      { valueId: "v50", valueName: "50 gr", processText: "50 GR", rollCount: 1 },
      { valueId: null, valueName: null, processText: "ÖZEL APRE", rollCount: 1 },
    ] });
    renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} editableTarget />);
    await waitFor(() => expect(screen.getByTestId("delivery-note-gramaj")).toBeInTheDocument());
    expect(screen.getByText(/öneri verilmedi/)).toBeInTheDocument();
    expect(screen.getByText("Gramaj okunamadı")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Uygula" })).toBeNull();
    expect(screen.queryByTestId("delivery-note-variants")).toBeNull();
  });

  it("D4-D1: kurşun dışı çeşitler özellik başına bilgi satırı (Uygula yalnız kurşun); variants yoksa satır yok", async () => {
    respond({ suggested: { valueId: "v50", valueName: "50 gr" }, rollCount: 2, coveredRollCount: 2, entries: [{ valueId: "v50", valueName: "50 gr", processText: "X", rollCount: 2 }], variants: [
      { propertyId: "pB", propertyName: "Brode deseni", suggested: { valueId: "d12", valueName: "Desen D12" }, entries: [] },
      { propertyId: "pE", propertyName: "Etek tipi", suggested: null, entries: [{ valueId: "e1", valueName: "Düz", processText: "A", rollCount: 1 }, { valueId: "e2", valueName: "Dalgalı", processText: "B", rollCount: 1 }] },
    ] });
    renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} editableTarget />);
    const list = await screen.findByTestId("delivery-note-variants");
    expect(list).toHaveTextContent("Brode deseni:Desen D12");
    expect(list).toHaveTextContent("Etek tipi:öneri yok (Düz · 1 top, Dalgalı · 1 top)");
    expect(screen.getAllByRole("button", { name: "Uygula" })).toHaveLength(1);
  });

  it("izinsiz kullanıcı: öneri görünür, Uygula yok, process-summary dışında istek yok", async () => {
    perms.write = false;
    respond({ suggested: { valueId: "v50", valueName: "50 gr" }, rollCount: 3, coveredRollCount: 2, entries: [] });
    renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} editableTarget />);
    await waitFor(() => expect(screen.getByTestId("delivery-note-gramaj")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Uygula" })).toBeNull();
    expect(get.mock.calls.map((c) => c[0])).toEqual(["/api/work-orders/wo1/process-summary"]);
    expect(put).not.toHaveBeenCalled();
  });

  it("modül kapalı (anahtar yok) ya da gelen belgesiz İE (null): ipucu çizilmez", async () => {
    respond();
    const { unmount } = renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} editableTarget />);
    await waitFor(() => expect(screen.getByTestId("process-summary-card")).toBeInTheDocument());
    expect(screen.queryByTestId("delivery-note-gramaj")).toBeNull();
    unmount();
    respond(null);
    renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} editableTarget />);
    await waitFor(() => expect(screen.getByTestId("process-summary-card")).toBeInTheDocument());
    expect(screen.queryByTestId("delivery-note-gramaj")).toBeNull();
  });
});
