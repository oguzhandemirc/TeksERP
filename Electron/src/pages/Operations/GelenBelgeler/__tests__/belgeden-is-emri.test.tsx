// Belgeden iş emri (D4-D2): grup gövdesi yalnız bağlanabilir toplar, grup başına AYRI token (aynı grup → aynı token =
// sunucuda replay), desen arama modalı sunucu araması (>12 değer). Negatif sonda: `keyed(key)` → `token()`.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { createAttemptToken } from "@/lib/attemptToken";
import { buildGroupPayload, decisiveFailure, startGroupWorkOrders } from "../workOrderFromNote";
import { ProcessValueSearchDialog } from "../ProcessValueSearchDialog";
import { WorkOrderFromNoteDialog } from "../WorkOrderFromNoteDialog";
import type { PlanGroup, PlanRoll, PlanTarget, WorkOrderPlan } from "../types";

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock("@/services/apiClient", () => ({
  default: { get: (url: string, cfg?: unknown) => apiGet(url, cfg), post: (url: string, body?: unknown) => apiPost(url, body), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/picker-loader", () => ({
  loadAllForPicker: () => Promise.resolve({ data: [{ id: "r1", name: "Kurşun + Brode", isActive: true, steps: [{ station: { name: "Kurşun", kind: "KURSUN" } }] }] }),
}));
vi.mock("@/hooks/useFoldValues", () => ({ useFoldValues: () => ({ values: [], isLoading: false, isEmpty: true }) }));

const roll = (n: number, over: Partial<PlanRoll> = {}): PlanRoll => ({
  rollId: `r${n}`, barcode: `B${n}`, lineNo: n, senderRollNo: null, meters: "100", status: "IN_STOCK", attachable: true, liveWorkOrder: null, ...over,
});
const target = (valueId: string, valueName: string): PlanTarget => ({
  propertyId: "desen", propertyName: "Brode deseni", flagPropertyId: "brode", valueId, valueName, source: "ALIAS",
});
const group = (key: string, targets: PlanTarget[], rolls: PlanRoll[]): PlanGroup => ({
  key, patternless: targets.length === 0, targets, itemId: "i1", itemName: "Tül", processText: null, rolls,
  totalMeters: String(rolls.length * 100), attachableCount: rolls.filter((r) => r.attachable).length,
});

describe("buildGroupPayload", () => {
  it("yalnız bağlanabilir + barkodlu toplar; hedef değer ve bayrak tekilleşir", () => {
    const g = group("g1", [target("d12", "D12")], [roll(1), roll(2, { attachable: false, liveWorkOrder: { id: "w", workOrderNumber: "IE-1" } }), roll(3, { barcode: null })]);
    const p = buildGroupPayload({ group: g, targets: [...g.targets, { ...target("d13", "D13"), propertyId: "renk" }] }, "rt", "tok", null);
    expect(p.rollBarcodes).toEqual(["B1"]);
    expect(p.targetValues).toEqual([{ propertyId: "desen", valueId: "d12" }, { propertyId: "renk", valueId: "d13" }]);
    expect(p.targetPropertyIds).toEqual(["brode"]);
    expect(p).not.toHaveProperty("foldType");
  });
});

describe("startGroupWorkOrders + grup başına token", () => {
  it("iki grup iki AYRI token; aynı deneme yeniden → aynı token'lar (sunucu replay)", async () => {
    let n = 0;
    const attempt = createAttemptToken(() => `t${++n}`);
    const quickStart = vi.fn((p: { clientToken: string }) => Promise.resolve({ success: true, data: { workOrder: { workOrderNumber: p.clientToken }, attached: 1 } }));
    const inputs = [group("a", [target("d12", "D12")], [roll(1)]), group("b", [target("d13", "D13")], [roll(2)])].map((g) => ({ group: g, targets: g.targets }));
    const deps = { routeTemplateId: "rt", foldType: null, tokenFor: (k: string) => attempt.keyed(k), quickStart: quickStart as never };
    const first = await startGroupWorkOrders(inputs, deps);
    const again = await startGroupWorkOrders(inputs, deps);
    expect(first.map((o) => o.workOrderNumber)).toEqual(["t1", "t2"]);
    expect(again.map((o) => o.workOrderNumber)).toEqual(["t1", "t2"]);
  });

  it("bir grubun hatası ötekini durdurmaz; belirsiz hata kesin hatadan önce seçilir", async () => {
    const quickStart = vi.fn()
      .mockRejectedValueOnce({ response: { status: 400 } })
      .mockRejectedValueOnce(new Error("ağ"))
      .mockResolvedValueOnce({ success: true, data: { workOrder: { workOrderNumber: "IE-3" }, attached: 1 } });
    const inputs = ["a", "b", "c"].map((k, i) => ({ group: group(k, [], [roll(i)]), targets: [] }));
    const out = await startGroupWorkOrders(inputs, { routeTemplateId: "rt", foldType: null, tokenFor: (k) => k, quickStart });
    expect(out.map((o) => o.ok)).toEqual([false, false, true]);
    expect(decisiveFailure(out)?.key).toBe("b");
    expect(decisiveFailure(out.filter((o) => o.ok))).toBeUndefined();
  });
});

describe("ProcessValueSearchDialog", () => {
  beforeEach(() => apiGet.mockReset());
  it(">12 değerli katalogda arama sunucuya gider (q parametresi) ve toplamı gösterir", async () => {
    apiGet.mockImplementation((_url: string, cfg?: { params?: { q?: string } }) => {
      const q = cfg?.params?.q;
      const items = q ? [{ id: "d12", code: "D12", name: "Desen 12" }] : Array.from({ length: 50 }, (_, i) => ({ id: `d${i}`, code: `D${i}`, name: `Desen ${i}` }));
      return Promise.resolve({ data: { success: true, data: { property: { id: "desen", name: "Brode deseni" }, items, total: q ? 1 : 300, nextCursor: q ? null : "50" } } });
    });
    const onSelect = vi.fn();
    renderWithProviders(<ProcessValueSearchDialog open onOpenChange={() => {}} propertyId="desen" propertyName="Brode deseni" onSelect={onSelect} />);
    expect(await screen.findByText("300 sonuç")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Desen \d+/ }).length).toBe(50);
    fireEvent.change(screen.getByLabelText("Brode deseni ara"), { target: { value: "D12" } });
    expect(await screen.findByText("1 sonuç")).toBeTruthy();
    expect(apiGet).toHaveBeenLastCalledWith("/api/gelen-belge/islem-degerleri", { params: { propertyId: "desen", q: "D12", limit: 50 } });
    fireEvent.click(screen.getByRole("button", { name: /Desen 12/ }));
    expect(onSelect).toHaveBeenCalledWith({ id: "d12", code: "D12", name: "Desen 12" });
  });
});

describe("WorkOrderFromNoteDialog", () => {
  const plan: WorkOrderPlan = {
    noteId: "n1", noteNo: "GB-0007", status: "APPROVED", owner: { id: "c1", name: "Gülkesim Müşteri" },
    customerBatch: { key: "c1|P-77", batchNo: "P-77" }, suggestedRouteTemplateId: "r1",
    choiceProperties: [{ propertyId: "desen", propertyName: "Brode deseni", flagPropertyId: "brode", optionCount: 300 }],
    groups: [
      group("g12", [target("d12", "D12")], [roll(1), roll(2), roll(3)]),
      group("g13", [target("d13", "D13")], [roll(4), roll(5), roll(6, { attachable: false, liveWorkOrder: { id: "w9", workOrderNumber: "IE-9" } })]),
      group("none", [], [roll(7)]),
    ],
  };
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue({ data: { success: true, data: plan } });
    apiPost.mockImplementation((_u: string, body: { clientToken: string }) => Promise.resolve({ data: { success: true, data: { workOrder: { workOrderNumber: `IE-${body.clientToken.slice(0, 4)}` }, attached: 3 } } }));
  });

  it("desen grupları + desensiz grup ayrı ve varsayılan seçilmez; önerilen rota seçili; her grup kendi token'ı ve hedefiyle açılır", async () => {
    renderWithProviders(<WorkOrderFromNoteDialog noteId="n1" open onOpenChange={() => {}} />);
    expect(await screen.findByText(/GB-0007/)).toBeTruthy();
    const cards = screen.getAllByTestId("plan-group");
    expect(cards.map((c) => c.getAttribute("data-patternless"))).toEqual(["0", "0", "1"]);
    expect(screen.getByTestId("plan-customer-batch").textContent).toContain("P-77");
    await waitFor(() => expect((screen.getByLabelText("Rota şablonu") as HTMLSelectElement).value).toBe("r1"));
    fireEvent.click(screen.getByRole("button", { name: /2 iş emri aç/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    const bodies = apiPost.mock.calls.map((c) => c[1] as { clientToken: string; rollBarcodes: string[]; targetValues: unknown[] });
    expect(new Set(bodies.map((b) => b.clientToken)).size).toBe(2);
    expect(bodies[0]?.rollBarcodes).toEqual(["B1", "B2", "B3"]);
    expect(bodies[1]?.rollBarcodes).toEqual(["B4", "B5"]);
    expect(bodies[0]?.targetValues).toEqual([{ propertyId: "desen", valueId: "d12" }]);
    expect(bodies[1]?.targetValues).toEqual([{ propertyId: "desen", valueId: "d13" }]);
  });

  it("belirsiz hatada (ağ) yalnız düşen grup AYNI token'la yeniden gider (replay); açılan grup tekrar gönderilmez", async () => {
    apiPost.mockImplementationOnce((_u: string, b: { clientToken: string }) => Promise.resolve({ data: { success: true, data: { workOrder: { workOrderNumber: `IE-${b.clientToken.slice(0, 4)}` }, attached: 3 } } }));
    apiPost.mockImplementationOnce(() => Promise.reject(new Error("Network Error")));
    renderWithProviders(<WorkOrderFromNoteDialog noteId="n1" open onOpenChange={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText("Rota şablonu") as HTMLSelectElement).value).toBe("r1"));
    fireEvent.click(screen.getByRole("button", { name: /2 iş emri aç/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole("button", { name: /1 iş emri aç/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(3));
    const tokens = apiPost.mock.calls.map((c) => (c[1] as { clientToken: string; rollBarcodes: string[] }));
    expect(tokens[2]?.rollBarcodes).toEqual(["B4", "B5"]);
    expect(tokens[2]?.clientToken).toBe(tokens[1]?.clientToken);
  });
});
