// =============================================================================
// BEKÇİ — Kumaş Özellikleri ağaç listesi (K21, kullanıcı: "listede her şey aynı seviyede")
// =============================================================================
// ⭐ §1 Sıra SUNUCUDAN: liste `sortBy=hierarchy` ister (istemci yeniden sıralamaz); başlık tıklaması ezer.
// ⭐ §2 Çeşit satırı girintili + "Kurşunlu'nun çeşidi"; ebeveynde "1 çeşit" rozeti.
// ⭐ §3 Bağlam satırı (`listContext`) soluk + açıklama; eşleşen satır soluk değil.
// ⭐ §4 Daraltma: ebeveyn düğmesi çeşidi gizler (varsayılan açık), tekrar basınca açar.
// ⭐ §5 Ebeveyn formu salt-okuma "Çeşitleri"; tıklayınca çeşidin formu (onOpenProperty).
// §6 Tamlayan eki ünlü uyumuyla; varsayılan değer çipi işaretli.
// ⭐ §7 Gizli çeşit "tümünü seç"e girmez; seçiliyken daraltılırsa seçimden düşer (yıkıcı birleştir/sil görünmeyeni kapsamaz).
// =============================================================================
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { FabricProperty } from "./types";

const listCursor = vi.fn();
const getAll = vi.fn();
vi.mock("./service", () => ({
  fabricPropertyService: { listCursor: (...a: unknown[]) => listCursor(...a), getAll: (...a: unknown[]) => getAll(...a), getById: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), hardRemove: vi.fn(), restore: vi.fn() },
}));
const formSpy = vi.fn();
vi.mock("./FabricPropertyFormDialog", () => ({ FabricPropertyFormDialog: (p: { open: boolean; initial: FabricProperty | null }) => (formSpy(p), null) }));
vi.mock("@/components/import/ImportDialog", () => ({ ImportDialog: () => null }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/providers/PreferencesProvider", () => ({ usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }) }));
vi.mock("@/components/forms/SimilarNamesWarning", () => ({ SimilarNamesWarning: () => null }));
vi.mock("@/components/forms/PropertyStationsField", () => ({ PropertyStationsField: () => null }));

const { FabricPropertiesPage } = await import("./FabricPropertiesPage");
const { VariantsReadonlyField } = await import("./VariantsReadonlyField");
const { genitive, hierarchyRowClass } = await import("./hierarchy");

const prop = (p: Partial<FabricProperty> & Pick<FabricProperty, "id" | "name">): FabricProperty => ({
  code: p.id.toUpperCase(), category: null, description: null, color: null, sortOrder: 10, isActive: true,
  valueType: "FLAG", createdAt: "", updatedAt: "", variantOfPropertyId: null, stationCapabilities: [], ...p,
});
const KURSUNLU = prop({ id: "kursunlu", name: "Kurşunlu", variant: { id: "gramaj", code: "GRAMAJ", name: "KURŞUN GRAMAJI", isActive: true }, listLevel: 0 });
const GRAMAJ = prop({
  id: "gramaj", name: "KURŞUN GRAMAJI", valueType: "CHOICE", variantOfPropertyId: "kursunlu",
  variantOf: { id: "kursunlu", code: "KURSUNLU", name: "Kurşunlu" }, listLevel: 1,
  values: [
    { id: "v1", code: "25", name: "25 gr", sortOrder: 1, isActive: true, isDefault: true },
    { id: "v2", code: "50", name: "50 gr", sortOrder: 2, isActive: true },
  ],
});
const YANMAZ = prop({ id: "yanmaz", name: "Yanmazlık", listLevel: 0 });
const resp = (data: FabricProperty[]) => Promise.resolve({ success: true, data, pagination: { nextCursor: null, hasMore: false, limit: 50 } });

function renderPage(url = "/definitions/fabric-properties") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<FabricPropertiesPage />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
      </QueryClientProvider>
    ),
  });
}
const rowOf = (id: string) => screen.getByTestId(`ad-${id}`).closest("tr")!;
const names = () => screen.getAllByTestId(/^ad-/).map((el) => el.getAttribute("data-testid")!.slice(3));

beforeEach(() => {
  listCursor.mockReset();
  getAll.mockReset();
  formSpy.mockReset();
  listCursor.mockImplementation(() => resp([YANMAZ, KURSUNLU, GRAMAJ]));
  getAll.mockImplementation(() => Promise.resolve({ success: true, data: [YANMAZ, KURSUNLU, GRAMAJ], pagination: { page: 1, pageSize: 500, total: 3, totalPages: 1 } }));
});

describe("Kumaş Özellikleri ağaç listesi", () => {
  it("⭐ §1 sıra sunucudan: sortBy=hierarchy istenir, satırlar yanıt sırasında; başlık tıklaması ezer", async () => {
    renderPage();
    await screen.findByTestId("ad-gramaj");
    expect(listCursor.mock.calls[0]?.[0]).toMatchObject({ sortBy: "hierarchy" });
    expect(names()).toEqual(["yanmaz", "kursunlu", "gramaj"]);
    renderPage("/definitions/fabric-properties?sortBy=name&sortOrder=asc");
    await waitFor(() => expect(listCursor.mock.calls.some((c) => (c[0] as { sortBy?: string }).sortBy === "name")).toBe(true));
  });

  it("⭐ §2 çeşit girintili + 'Kurşunlu'nun çeşidi'; ebeveynde '1 çeşit' rozeti", async () => {
    renderPage();
    const child = await screen.findByTestId("ad-gramaj");
    expect(child.className).toContain("pl-5");
    expect(within(child).getByText("Kurşunlu'nun çeşidi")).toBeTruthy();
    expect(screen.getByTestId("ad-kursunlu").className).not.toContain("pl-5");
    expect(within(screen.getByTestId("ad-kursunlu")).getByText("1 çeşit")).toBeTruthy();
    expect(within(screen.getByTestId("ad-yanmaz")).queryByText(/çeşit/)).toBeNull();
  });

  it("⭐ §3 bağlam satırı soluk + açıklamalı, eşleşen satır değil", async () => {
    listCursor.mockImplementation(() => resp([{ ...KURSUNLU, listContext: true }, GRAMAJ]));
    renderPage("/definitions/fabric-properties?search=gramaj");
    await screen.findByTestId("ad-gramaj");
    expect(rowOf("kursunlu").className).toContain("opacity-50");
    expect(within(rowOf("kursunlu")).getByText(/bağlamı/)).toBeTruthy();
    expect(rowOf("gramaj").className).not.toContain("opacity-50");
  });

  it("⭐ §4 daraltma: varsayılan açık, düğme çeşidi gizler ve geri açar", async () => {
    renderPage();
    await screen.findByTestId("ad-gramaj");
    expect(rowOf("gramaj").className).not.toContain("hidden");
    await userEvent.click(screen.getByRole("button", { name: "Çeşitleri gizle" }));
    expect(rowOf("gramaj").className).toContain("hidden");
    expect(rowOf("kursunlu").className).not.toContain("hidden");
    await userEvent.click(screen.getByRole("button", { name: "Çeşitleri göster" }));
    expect(rowOf("gramaj").className).not.toContain("hidden");
  });

  it("⭐ §5 ebeveyn formu 'Çeşitleri' salt-okuma; tıklayınca çeşidin TAM kaydı açılır", async () => {
    const onOpen = vi.fn();
    render(<VariantsReadonlyField property={KURSUNLU} allProperties={[KURSUNLU, GRAMAJ]} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "KURŞUN GRAMAJI" }));
    expect(onOpen).toHaveBeenCalledWith(GRAMAJ);
    const { container } = render(<VariantsReadonlyField property={YANMAZ} allProperties={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("⭐ §7 gizli çeşit 'tümünü seç'e girmez; seçiliyken daraltılınca seçimden düşer", async () => {
    renderPage();
    await screen.findByTestId("ad-gramaj");
    const box = (id: string) => within(rowOf(id)).queryByRole("checkbox", { name: "Seç" });
    // Seçili çeşit daraltılınca seçimden düşer.
    await userEvent.click(box("gramaj")!);
    expect(box("gramaj")!.getAttribute("data-state")).toBe("checked");
    await userEvent.click(screen.getByRole("button", { name: "Çeşitleri gizle" }));
    expect(box("gramaj")).toBeNull();
    // Daraltılmışken "tümünü seç" yalnız görünen satırları seçer.
    await userEvent.click(screen.getByRole("checkbox", { name: "Tümünü seç" }));
    expect(box("kursunlu")!.getAttribute("data-state")).toBe("checked");
    await userEvent.click(screen.getByRole("button", { name: "Çeşitleri göster" }));
    expect(box("gramaj")!.getAttribute("data-state")).toBe("unchecked");
  });

  it("§6 tamlayan eki + satır sınıfı + varsayılan çip işaretli", async () => {
    expect(genitive("Kurşunlu")).toBe("Kurşunlu'nun");
    expect(genitive("Yanmazlık")).toBe("Yanmazlık'ın");
    expect(genitive("Brode")).toBe("Brode'nin");
    expect(genitive("Kırçıllı Gül")).toBe("Kırçıllı Gül'ün");
    expect(hierarchyRowClass(GRAMAJ, new Set(["kursunlu"]))).toBe("hidden");
    expect(hierarchyRowClass(GRAMAJ, new Set())).toBeUndefined();
    renderPage();
    await screen.findByTestId("ad-gramaj");
    expect(within(rowOf("gramaj")).getByText("★ 25")).toBeTruthy();
    expect(within(rowOf("gramaj")).getByText("50")).toBeTruthy();
  });
});
