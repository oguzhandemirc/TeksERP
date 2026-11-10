// Cari kartı "Alıcılar" (2026-11-10): liste · birleştirme önizlemesi HER topu listeler, sevkliler sayıyla ·
// pasife alma 409'u engelleyen topları tek tek çizer + birleştir çıkışı · ad çakışması çakışan alıcıyı hedef seçer ·
// yazma izni yoksa eylem yok · 409 çözümleyici.
// Negatif sonda (2026-11-10): önizleme listesi `.slice(0, 5)` ile kesilince §2 ❌; 409 kutusundaki top listesi
// kaldırılınca §3 ❌; ad çakışmasında `conflictId` yerine null geçirilince §4 ❌ — hepsi geri alındı.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { renderWithProviders } from "@/test/render";
import { CustomerConsigneesPanel } from "./CustomerConsigneesPanel";
import { consigneeService, type ConsigneeRow } from "./consigneeService";
import { consigneeIssueOf } from "./consigneeErrors";

let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/labelTemplateService", () => ({
  labelTemplateService: { list: vi.fn(async () => ({ data: [{ id: "t-en", name: "Final EN/US", kind: "ROLL_FINISHED", isActive: true }] })) },
}));
vi.mock("./consigneeService", () => ({
  consigneeService: { list: vi.fn(), rename: vi.fn(), deactivate: vi.fn(), activate: vi.fn(), setTemplate: vi.fn(), mergePreview: vi.fn(), merge: vi.fn() },
}));
const svc = vi.mocked(consigneeService);

const row = (id: string, name: string, over: Partial<ConsigneeRow> = {}): ConsigneeRow => ({
  id, customerId: "c1", name, isActive: true, labelTemplateId: null, labelTemplate: null, lastUsedAt: null, liveRollCount: 0, ...over,
});
const rolls = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, barcode: `TOP${i}`, meters: 10 + i, status: "WAREHOUSE", printed: i === 0 }));
const conflict = (details: Record<string, unknown>) =>
  new AxiosError("409", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 409, statusText: "Conflict", headers: {}, config: { headers: new AxiosHeaders() }, data: { message: "Çakışma cümlesi", details },
  });

beforeEach(() => {
  vi.clearAllMocks();
  perms = ["customer:read", "customer:write"];
  svc.list.mockResolvedValue([row("a", "ALICI A", { liveRollCount: 7 }), row("b", "ALICI B", { labelTemplate: { id: "t-en", name: "Final EN/US" }, labelTemplateId: "t-en" })]);
});

describe("CustomerConsigneesPanel", () => {
  it("§1 liste: ad, canlı top sayısı, alıcı şablonu", async () => {
    renderWithProviders(<CustomerConsigneesPanel customerId="c1" />);
    const a = await screen.findByTestId("consignee-row-a");
    expect(a.textContent).toContain("ALICI A");
    expect(a.textContent).toContain("7 canlı top");
    expect(within(a).getByTestId("consignee-template").textContent).toContain("Müşterinin şablonu");
    expect(within(screen.getByTestId("consignee-row-b")).getByTestId("consignee-template").textContent).toContain("Final EN/US");
  });

  it("§2 birleştirme önizlemesi her topu listeler, sevkliler sayıyla; onay hedefe gider", async () => {
    svc.mergePreview.mockResolvedValue({ source: { id: "a", name: "ALICI A" }, target: { id: "b", name: "ALICI B", isActive: true }, rolls: rolls(7), untouchedRollCount: 3 });
    svc.merge.mockResolvedValue({} as never);
    renderWithProviders(<CustomerConsigneesPanel customerId="c1" />);
    await userEvent.click(within(await screen.findByTestId("consignee-row-a")).getByTestId("consignee-merge"));
    await userEvent.click(screen.getByTestId("consignee-merge-target-b"));
    await waitFor(() => expect(screen.getAllByTestId("consignee-merge-roll")).toHaveLength(7));
    expect(svc.mergePreview).toHaveBeenCalledWith("a", "b");
    expect(screen.getByTestId("consignee-merge-untouched").textContent).toContain("3 sevk edilmiş");
    await userEvent.click(screen.getByTestId("consignee-merge-confirm"));
    await waitFor(() => expect(svc.merge).toHaveBeenCalledWith("a", "b"));
  });

  it("§3 pasife alma 409: engelleyen her top çizilir, birleştir çıkışı diyaloğu açar", async () => {
    svc.deactivate.mockRejectedValue(conflict({ code: "CONSIGNEE_IN_USE", rolls: rolls(6) }));
    renderWithProviders(<CustomerConsigneesPanel customerId="c1" />);
    await userEvent.click(within(await screen.findByTestId("consignee-row-a")).getByTestId("consignee-toggle"));
    const box = await screen.findByTestId("consignee-blocking-rolls");
    expect(box.querySelectorAll("li")).toHaveLength(6);
    await userEvent.click(screen.getByTestId("consignee-issue-merge"));
    expect(screen.getByTestId("consignee-merge-dialog")).toBeTruthy();
  });

  it("§4 ad çakışması: çakışan alıcı hedef olarak seçili açılır", async () => {
    svc.rename.mockRejectedValue(conflict({ code: "CONSIGNEE_NAME_TAKEN", conflictId: "b" }));
    svc.mergePreview.mockResolvedValue({ source: { id: "a", name: "ALICI A" }, target: { id: "b", name: "ALICI B", isActive: true }, rolls: [], untouchedRollCount: 0 });
    renderWithProviders(<CustomerConsigneesPanel customerId="c1" />);
    const a = await screen.findByTestId("consignee-row-a");
    await userEvent.click(within(a).getByTestId("consignee-rename"));
    await userEvent.clear(screen.getByTestId("consignee-rename-input"));
    await userEvent.type(screen.getByTestId("consignee-rename-input"), "ALICI B");
    await userEvent.click(screen.getByTestId("consignee-rename-save"));
    await userEvent.click(await screen.findByTestId("consignee-issue-merge"));
    await waitFor(() => expect(svc.mergePreview).toHaveBeenCalledWith("a", "b"));
  });

  it("§5 yazma izni yoksa eylem düğmesi yok, şablon adı düz metin", async () => {
    perms = ["customer:read"];
    renderWithProviders(<CustomerConsigneesPanel customerId="c1" />);
    const b = await screen.findByTestId("consignee-row-b");
    expect(within(b).queryByTestId("consignee-merge")).toBeNull();
    expect(within(b).queryByTestId("consignee-template")).toBeNull();
    expect(b.textContent).toContain("Final EN/US");
  });
});

describe("consigneeIssueOf", () => {
  it("§6 tanınan iki 409 + diğer", () => {
    expect(consigneeIssueOf(conflict({ code: "CONSIGNEE_IN_USE", rolls: rolls(2) }))).toMatchObject({ kind: "in-use", message: "Çakışma cümlesi" });
    expect(consigneeIssueOf(conflict({ code: "CONSIGNEE_NAME_TAKEN", conflictId: "x" }))).toEqual({ kind: "name-taken", message: "Çakışma cümlesi", conflictId: "x" });
    expect(consigneeIssueOf(conflict({ code: "CONSIGNEE_CHANGED" })).kind).toBe("other");
    expect(consigneeIssueOf(new Error("x"))).toEqual({ kind: "other", message: "İşlem yapılamadı." });
  });
});
