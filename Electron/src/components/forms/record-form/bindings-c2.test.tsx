// =============================================================================
// DUMAN — ikinci dalga (C2): Rota · İş emri şablonu · Hata tipi · Desen kartı.
// Örnek al kimliksiz taslakla YALNIZ POST eder; paylaşılan kart seçiciden düzenlenmez ("Kart ekranında aç").
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import { PreferencesProvider } from "@/providers/PreferencesProvider";
import type { JwtPayload } from "@/types/auth";

const ST = { id: "st1", code: "IST-1", name: "Kalite", type: "INTERNAL", kind: "PROCESS_QC", isActive: true };
const STEP = { id: "rs1", stationId: "st1", sequence: 1, defaultNotes: null, station: ST, plannedPropertyIds: [] };
const ROUTE = { id: "r1", code: "ROT-1", name: "Ana rota", description: null, customerId: null, isFavorite: true, isActive: true, steps: [STEP] };
const DEFECT = { id: "d1", code: "HATA-1", name: "Leke", description: null, severity: null, defectGroup: null, isActive: true, isDefault: true, fixedPoints: null };
const DESIGN = { id: "w1", code: "BS-1", name: "Balık sırtı", kind: "DOBBY", shedMechanism: "DOBBY", weaveStructure: null, isActive: true, notes: "not" };
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock("@/services/apiClient", () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), put: vi.fn() },
}));
const openTab = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab }) } }));

const { EntityPickerModal } = await import("../entity-picker/EntityPickerModal");
const { useRouteRecordForm } = await import("@/pages/Routes/useRouteRecordForm");
const { routeService } = await import("@/pages/Routes/service");
const { useWeaveDesignRecordForm } = await import("@/pages/WeaveDesigns/useWeaveDesignRecordForm");
const { weaveDesignPickerService } = await import("@/pages/Items/construction-service");
const { DefectTableEditor } = await import("@/pages/Quality/Inspections/DefectTableEditor");
const { useProductRecipeRecordForm } = await import("@/pages/ProductRecipes/useProductRecipeRecordForm");
const { productRecipeService } = await import("@/pages/ProductRecipes/service");
const RECIPE = { id: "pr1", code: "REC-1", name: "Poplin beyaz", itemId: "i1", colorId: null, width: 150, foldType: null, routeId: "r1", isActive: true, properties: [] };

const listBody = (rows: unknown[]) => ({ data: { success: true, data: rows, pagination: { nextCursor: null, hasMore: false, limit: 50, page: 1, pageSize: 500, total: rows.length, totalPages: 1 } } });
const one = (row: unknown) => ({ data: { success: true, data: row } });

function RouteHarness() {
  const form = useRouteRecordForm();
  return <EntityPickerModal value={null} onChange={vi.fn()} service={routeService} recordForm={form} queryKey="t-routes" getLabel={(r) => r.name} title="Rota seç" placeholder="Rota seç" />;
}
function RecipeHarness() {
  const form = useProductRecipeRecordForm();
  return <EntityPickerModal value={null} onChange={vi.fn()} service={productRecipeService} recordForm={form} queryKey="t-recipes" getLabel={(r) => r.name} title="Şablon seç" placeholder="Şablon seç" />;
}
function WeaveHarness({ onChange }: { onChange: (id: string | null) => void }) {
  const form = useWeaveDesignRecordForm();
  return <EntityPickerModal value={null} onChange={onChange} service={weaveDesignPickerService} recordForm={form} queryKey="t-weave" getLabel={(d) => d.name} title="Desen seç" placeholder="Desen seç" />;
}

beforeEach(() => {
  for (const f of [get, post, patch, openTab]) f.mockReset();
  get.mockImplementation((url: string) => {
    if (url.startsWith("/api/routes/r1")) return Promise.resolve(one(ROUTE));
    if (url.startsWith("/api/routes")) return Promise.resolve(listBody([{ ...ROUTE, steps: undefined }]));
    if (url.startsWith("/api/weave-designs/w1")) return Promise.resolve(one(DESIGN));
    if (url.startsWith("/api/weave-designs")) return Promise.resolve(listBody([DESIGN]));
    if (url.startsWith("/api/defect-types")) return Promise.resolve(listBody([DEFECT]));
    if (url.startsWith("/api/stations")) return Promise.resolve(listBody([ST]));
    return Promise.resolve(listBody([]));
  });
  post.mockImplementation((_url: string, body: Record<string, unknown>) => Promise.resolve({ data: { success: true, data: { ...body, id: "new-1", code: "YENI" } } }));
  useAuthStore.setState({ user: { userId: "u1", username: "k", permissions: ["station:write", "quality:write", "warpspec:write"] } as unknown as JwtPayload });
});

describe("İkinci dalga seçiciler — Örnek al / Düzenle (C2)", () => {
  it("⭐ Rota: Örnek al tam rotayı (adımlarıyla) çeker, yalnız POST; kaynak rota PATCH edilmez", async () => {
    renderWithProviders(<RouteHarness />);
    await userEvent.click(screen.getByRole("button", { name: /Rota seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Ana rota — örnek al/ }));
    const form = await screen.findByRole("dialog", { name: /Yeni Üretim Rotası \(örnekten\)/ });
    expect(within(form).getByDisplayValue("Ana rota (kopya)")).toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: /Kaydet|Oluştur/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/routes", expect.objectContaining({ name: "Ana rota (kopya)", isFavorite: false })));
    const body = post.mock.calls[0]?.[1] as { steps: { create: { stationId: string }[] } };
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("code");
    expect(body.steps.create.map((s) => s.stationId)).toEqual(["st1"]);
    expect(patch).not.toHaveBeenCalled();
  });

  it("⭐ Rota: Düzenle → Üretim Rotaları ekranı yeni sekmede", async () => {
    renderWithProviders(<RouteHarness />);
    await userEvent.click(screen.getByRole("button", { name: /Rota seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Ana rota — düzenle" }));
    await userEvent.click(await screen.findByRole("button", { name: /Kart ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/routes?search=Ana%20rota", { forceNew: true }));
    expect(patch).not.toHaveBeenCalled();
  });

  it("⭐ Hata tipi (kontrol hata tablosu): Örnek al varsayılanlığı devralmaz, yalnız POST; Düzenle → Hata Tipleri", async () => {
    renderWithProviders(<DefectTableEditor rows={[{ key: "k1", defectTypeId: "", startMeter: "", size: "" } as never]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Hata türü seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Leke — düzenle" }));
    await userEvent.click(await screen.findByRole("button", { name: /Kart ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/defect-types?search=HATA-1", { forceNew: true }));
    await userEvent.click(await screen.findByRole("button", { name: /Leke — örnek al/ }));
    const form = await screen.findByRole("dialog", { name: /Yeni Hata Tipi \(örnekten\)/ });
    await userEvent.click(within(form).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/defect-types", expect.objectContaining({ name: "Leke (kopya)", isDefault: false })));
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty("code");
    expect(patch).not.toHaveBeenCalled();
  });

  it("⭐ Desen: Örnek al kaynak kartı çeker, yeni kod/adla yalnız POST, yeni kart seçili; Düzenle → desen kartı sayfası", async () => {
    const onChange = vi.fn();
    renderWithProviders(<WeaveHarness onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Desen seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Balık sırtı — düzenle" }));
    await userEvent.click(await screen.findByRole("button", { name: /Kart ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/weave-designs/w1", { forceNew: true }));
    await userEvent.click(await screen.findByRole("button", { name: /Balık sırtı — örnek al/ }));
    const dlg = await screen.findByRole("dialog", { name: /BS-1 kartından örnek al/ });
    await userEvent.type(within(dlg).getByLabelText(/Yeni desen kodu/), "BS-2");
    await userEvent.type(within(dlg).getByLabelText(/Yeni desen adı/), "Balık sırtı 2");
    await userEvent.click(within(dlg).getByRole("button", { name: "Yeni kartı oluştur" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/weave-designs", expect.objectContaining({ code: "BS-2", name: "Balık sırtı 2" })));
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty("id");
    expect(patch).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("new-1", expect.objectContaining({ id: "new-1" })));
  });

  it("⭐ İş emri şablonu: Örnek al aynı rotayı referanslar (yeni rota doğmaz, kaynak rota/şablon PATCH yok); Düzenle → şablon ekranı", async () => {
    get.mockImplementation((url: string) => {
      if (url.startsWith("/api/product-recipes/pr1")) return Promise.resolve(one(RECIPE));
      if (url.startsWith("/api/product-recipes")) return Promise.resolve(listBody([RECIPE]));
      if (url.startsWith("/api/routes/r1")) return Promise.resolve(one(ROUTE));
      if (url.startsWith("/api/stations")) return Promise.resolve(listBody([ST]));
      return Promise.resolve(listBody([]));
    });
    // Şablon formu tablo tercihlerini okur (usePreferences) → gerçek sağlayıcı.
    renderWithProviders(<PreferencesProvider><RecipeHarness /></PreferencesProvider>);
    await userEvent.click(screen.getByRole("button", { name: /Şablon seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Poplin beyaz — düzenle" }));
    await userEvent.click(await screen.findByRole("button", { name: /Kart ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/product-recipes?search=REC-1", { forceNew: true }));
    await userEvent.click(await screen.findByRole("button", { name: /Poplin beyaz — örnek al/ }));
    const form = await screen.findByRole("dialog", { name: /Şablonu \(örnekten\)/ });
    expect(within(form).getByDisplayValue("Poplin beyaz (kopya)")).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/routes\/r1/)));
    // "Rotayı Kaydet" de var → formun kendi Kaydet'i tam adla.
    await userEvent.click(within(form).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/product-recipes", expect.objectContaining({ name: "Poplin beyaz (kopya)", itemId: "i1", routeId: "r1" })));
    expect(post.mock.calls.some((c) => c[0] === "/api/routes")).toBe(false);
    expect(patch).not.toHaveBeenCalled();
  });

  it("⭐ Desen: Yeni → yeni desen kartı penceresi, yalnız POST", async () => {
    renderWithProviders(<WeaveHarness onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Desen seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Yeni Desen kartı ekle/ }));
    const dlg = await screen.findByRole("dialog", { name: /Yeni desen kartı/ });
    await userEvent.type(within(dlg).getByLabelText(/Desen kodu/), "YENI-1");
    await userEvent.type(within(dlg).getByLabelText(/Desen adı/), "Yeni desen");
    await userEvent.click(within(dlg).getByRole("button", { name: "Oluştur" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/weave-designs", expect.objectContaining({ code: "YENI-1" })));
    expect(patch).not.toHaveBeenCalled();
  });
});
