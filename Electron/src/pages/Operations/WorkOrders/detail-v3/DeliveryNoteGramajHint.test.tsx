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
function respond(deliveryNoteGramaj?: unknown, extra: Record<string, unknown> = {}) {
  const k = { ...kursun, ...(extra.kursun as object | undefined) };
  const rest = { ...extra };
  delete rest.kursun;
  get.mockResolvedValue({ data: { success: true, data: deliveryNoteGramaj === undefined ? { kursun: k, ...rest } : { kursun: k, deliveryNoteGramaj, ...rest } } });
}
const T50 = { kursun: { target: { propertyId: "gr", valueId: "v50", valueName: "50 gr" } } };
const UNREAD = { valueId: null, valueName: null, processText: null, rollCount: 1 };
async function cardReady() {
  await waitFor(() => expect(screen.getByTestId("process-summary-card")).toBeInTheDocument());
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

// 2026-11-10: kutu yalnız eyleme değer bir şey varsa (öneri · çelişki · çoklu değer) — kural `deliveryNoteHintModel.ts`.
describe("DeliveryNoteGramajHint görünürlüğü (hedef varken)", () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    perms.write = true;
  });

  it("2026-11-10 ekran: hedef VAR + öneri yok + hiçbir şey okunamadı (+ önerisiz KAT) → kutu ÇİZİLMEZ", async () => {
    respond({ suggested: null, rollCount: 1, coveredRollCount: 1, entries: [UNREAD], variants: [
      { propertyId: "pK", propertyName: "KAT", suggested: null, entries: [UNREAD] },
    ] }, T50);
    renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} editableTarget />);
    await cardReady();
    expect(screen.queryByTestId("delivery-note-gramaj")).toBeNull();
  });

  it("hedef VAR + belge hedefle aynı → kutu yok", async () => {
    respond({ suggested: { valueId: "v50", valueName: "50 gr" }, rollCount: 1, coveredRollCount: 1, entries: [{ valueId: "v50", valueName: "50 gr", processText: "50 GR", rollCount: 1 }] }, T50);
    renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} editableTarget />);
    await cardReady();
    expect(screen.queryByTestId("delivery-note-gramaj")).toBeNull();
  });

  it("çelişki: belge 25 gr, hedef 50 gr → uyarı + Uygula; kapsama sunucunun kök sayımıyla (1/1)", async () => {
    respond({ suggested: { valueId: "v25", valueName: "25 gr" }, rollCount: 1, coveredRollCount: 1, entries: [{ valueId: "v25", valueName: "25 gr", processText: "25 GR", rollCount: 1 }] }, T50);
    put.mockResolvedValue({ data: { success: true, data: { changed: true } } });
    renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} editableTarget />);
    const c = await screen.findByTestId("delivery-note-conflict");
    expect(c).toHaveTextContent("Belgede 25 gr, hedef 50 gr(1/1 top gelen belgeli)");
    fireEvent.click(screen.getByRole("button", { name: "Uygula" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/work-orders/wo1/target-values", { items: [{ propertyId: "gr", valueId: "v25" }] }));
  });

  it("hedef VAR + kısmi çözüm hedeften farklı → çelişki uyarısı ama Uygula YOK (kısmi veri hedefi ezmez)", async () => {
    respond({ suggested: null, rollCount: 2, coveredRollCount: 2, entries: [{ valueId: "v25", valueName: "25 gr", processText: "25 GR", rollCount: 1 }, UNREAD] }, T50);
    renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} editableTarget />);
    expect(await screen.findByTestId("delivery-note-conflict")).toHaveTextContent("Belgede 25 gr, hedef 50 gr");
    expect(screen.queryByRole("button", { name: "Uygula" })).toBeNull();
  });

  it("hedef VAR + belgeler iki farklı gramaj → liste", async () => {
    respond({ suggested: null, rollCount: 2, coveredRollCount: 2, entries: [
      { valueId: "v25", valueName: "25 gr", processText: "25 GR", rollCount: 1 },
      { valueId: "v50", valueName: "50 gr", processText: "50 GR", rollCount: 1 },
    ] }, T50);
    renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} editableTarget />);
    expect(await screen.findByText(/farklı gramaj söylüyor/)).toBeInTheDocument();
    expect(screen.getByTestId("delivery-note-gramaj").dataset.kind).toBe("list");
  });

  it("desen: hedef D10, belge D12 → kutuda çelişki satırı; hedefle aynı desen satır üretmez", async () => {
    const variants = (id: string, name: string) => [{ propertyId: "pB", propertyName: "Brode deseni", suggested: { valueId: id, valueName: name }, entries: [{ valueId: id, valueName: name, processText: "X", rollCount: 1 }] }];
    const same = { suggested: { valueId: "v50", valueName: "50 gr" }, rollCount: 1, coveredRollCount: 1, entries: [{ valueId: "v50", valueName: "50 gr", processText: "X", rollCount: 1 }] };
    const vt = { variantTargets: [{ propertyId: "pB", propertyName: "Brode deseni", valueId: "d10", valueName: "Desen D10" }] };
    respond({ ...same, variants: variants("d12", "Desen D12") }, { ...T50, ...vt });
    const { unmount } = renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} editableTarget />);
    expect(await screen.findByTestId("delivery-note-variants")).toHaveTextContent("Brode deseni:Belgede Desen D12, hedef Desen D10");
    unmount();
    respond({ ...same, variants: variants("d10", "Desen D10") }, { ...T50, ...vt });
    renderWithProviders(<ProcessSummaryCard scope={{ workOrderId: "wo1" }} editableTarget />);
    await cardReady();
    expect(screen.queryByTestId("delivery-note-gramaj")).toBeNull();
  });
});
