// =============================================================================
// BEKÇİ — "Ürünler" sayfası: ad + süzgeç şeridi (kullanıcı bulgusu 2026-09-17)
// =============================================================================
// ⭐ §1 Ad "Ürünler": aynı `Item` tablosunda kumaş · iplik · sarf birlikte; "Kumaşlar"
//    literal'i sayfa/karo/palet/katalogda (Electron/src test dışı + backend ekran
//    kataloğu · arama kovası · içe aktarma adaptörü) 0.
// ⭐ §2 Süzgeçler SUNUCUYA gider (istemcide sayfa süzülmez): Durum → isActive /
//    pendingReview (sayfa URL'si `status`), Tür → filter[itemType], Birim → filter[unit] (URL, useDataTable okur).
// ⭐ §3 Varsayılan = bugünkü davranış: pasifler gizli (isActive=true); eski "Pasifleri
//    göster" anahtarı bu sayfada YOK (aynı soruya iki kontrol olmasın).
// ⭐ §4 Tetik metni süzgecin ADINI taşır: "Tür: Tümü" → "Tür: İplik" (kullanıcı 03:27).
// =============================================================================
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ItemsPage } from "./ItemsPage";
import { ITEM_URL_FILTERS, itemStatusFilters, parseItemStatus } from "./itemsFilters";
import { labeledSelectText } from "@/components/forms/LabeledSelect";

const listCursor = vi.fn();
vi.mock("./service", () => ({ itemService: { listCursor: (...a: unknown[]) => listCursor(...a), getAll: vi.fn(), getById: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), hardRemove: vi.fn(), restore: vi.fn() } }));
vi.mock("./ItemFormDialog", () => ({ ItemFormDialog: () => null }));
vi.mock("@/components/import/ImportDialog", () => ({ ImportDialog: () => null }));
vi.mock("@/components/merge/MergeDialog", () => ({ MergeDialog: () => null }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/providers/PreferencesProvider", () => ({ usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }) }));

const page = () => Promise.resolve({ success: true, data: [], pagination: { nextCursor: null, hasMore: false, limit: 50 } });

function renderPage(url = "/definitions/items") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<ItemsPage />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
      </QueryClientProvider>
    ),
  });
}

const byKeyOptions = (k: string) => ITEM_URL_FILTERS.find((d) => d.key === k)!.options;
const lastFilters = () => (listCursor.mock.calls.at(-1)?.[0] as { filters?: Record<string, string> } | undefined)?.filters;

beforeEach(() => {
  listCursor.mockReset();
  listCursor.mockImplementation(page);
});

describe("itemsFilters (saf)", () => {
  it("⭐ Durum → backend süzgeci: aktif/pasif = isActive, onay = pendingReview (isActive'e dokunmaz), tümü = boş", () => {
    expect(itemStatusFilters("active")).toEqual({ isActive: "true" });
    expect(itemStatusFilters("inactive")).toEqual({ isActive: "false" });
    expect(itemStatusFilters("pending")).toEqual({ pendingReview: "true" });
    expect(itemStatusFilters("all")).toEqual({});
  });

  it("bilinmeyen/boş URL değeri varsayılana (active) düşer — fail-closed", () => {
    expect(parseItemStatus(null)).toBe("active");
    expect(parseItemStatus("hepsi")).toBe("active");
    expect(parseItemStatus("inactive")).toBe("inactive");
  });

  it("Tür ve Birim URL süzgeçleri BACKEND kolon adıyla (itemType · unit); 'Tümü' = ALL başta; Tür listesi ürün seçiciyle ORTAK", () => {
    const byKey = (k: string) => ITEM_URL_FILTERS.find((d) => d.key === k)!;
    expect(byKey("itemType").options.map((o) => o.value)).toEqual(["ALL", "YARN", "FABRIC", "CONSUMABLE"]);
    expect(byKey("unit").options.map((o) => o.value)).toEqual(["ALL", "MT", "KG", "ADET"]);
  });

  it("⭐ §4 tetik metni 'Ad: Değer' — ad öneki sabit, seçimsizde Tümü", () => {
    const tur = byKeyOptions("itemType");
    expect(labeledSelectText("Tür", "ALL", tur)).toBe("Tür: Tümü");
    expect(labeledSelectText("Tür", "YARN", tur)).toBe("Tür: İplik");
  });
});

describe("ItemsPage — ad + süzgeç şeridi", () => {
  it("⭐ §1/§3 başlık 'Ürünler'; varsayılan istek isActive=true; 'Pasifleri göster' anahtarı YOK", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Ürünler" })).toBeInTheDocument();
    await waitFor(() => expect(lastFilters()).toEqual({ isActive: "true" }));
    expect(screen.queryByText("Pasifleri göster")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Durum" })).toHaveTextContent("Durum: Aktif");
    expect(screen.getByRole("combobox", { name: "Tür" })).toHaveTextContent("Tür: Tümü");
    expect(screen.getByRole("combobox", { name: "Birim" })).toHaveTextContent("Birim: Tümü");
  });

  it("⭐ §2 Durum seçimi sunucuya gider: Pasif → isActive=false · Onay bekleyen → pendingReview=true · Tümü → süzgeçsiz", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(lastFilters()).toEqual({ isActive: "true" }));
    const durum = screen.getByRole("combobox", { name: "Durum" });
    await user.click(durum);
    await user.click(await screen.findByRole("option", { name: "Pasif" }));
    await waitFor(() => expect(lastFilters()).toEqual({ isActive: "false" }));
    expect(durum).toHaveTextContent("Durum: Pasif");
    await user.click(durum);
    await user.click(await screen.findByRole("option", { name: "Onay bekleyen" }));
    await waitFor(() => expect(lastFilters()).toEqual({ pendingReview: "true" }));
    await user.click(durum);
    await user.click(await screen.findByRole("option", { name: "Tümü" }));
    await waitFor(() => expect(lastFilters()).toEqual({}));
  });

  it("⭐ §2 URL'den gelen durum ilk istekte uygulanır (paylaşılabilir bağlantı)", async () => {
    renderPage("/definitions/items?status=pending");
    await waitFor(() => expect(lastFilters()).toEqual({ pendingReview: "true" }));
  });

  it("⭐ §2 Tür ve Birim: seçim → filter[itemType] / filter[unit] SUNUCUYA (Durum korunur)", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(lastFilters()).toEqual({ isActive: "true" }));
    const tur = screen.getByRole("combobox", { name: "Tür" });
    await user.click(tur);
    await user.click(await screen.findByRole("option", { name: "İplik" }));
    await waitFor(() => expect(lastFilters()).toEqual({ isActive: "true", itemType: "YARN" }));
    expect(tur).toHaveTextContent("Tür: İplik");
    const birim = screen.getByRole("combobox", { name: "Birim" });
    await user.click(birim);
    await user.click(await screen.findByRole("option", { name: "kg" }));
    await waitFor(() => expect(lastFilters()).toEqual({ isActive: "true", itemType: "YARN", unit: "KG" }));
    expect(birim).toHaveTextContent("Birim: kg");
    // Tümü'ye dönüş: URL anahtarı silinir, sunucuya gitmez
    await user.click(tur);
    await user.click(await screen.findByRole("option", { name: "Tümü" }));
    await waitFor(() => expect(lastFilters()).toEqual({ isActive: "true", unit: "KG" }));
    expect(tur).toHaveTextContent("Tür: Tümü");
  });
});

// Kaynak taraması — sayfa/karo/palet (Electron/src, test dışı) + backend katalog üçlüsü.
const SRC = resolve(process.cwd(), "src");
const BACKEND = ["src/constants/screen-catalog.ts", "src/constants/search-entities.ts", "src/services/import/adapters/item.adapter.ts"].map((p) => resolve(process.cwd(), "../Teks-Erp", p));
const TARANAN = /\.(ts|tsx)$/;
const KAPSAM_DISI = (rel: string) => /\.test\.tsx?$/.test(rel);
const ESKI_AD = /Kumaşlar/;

function dosyalar(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) dosyalar(p, out);
    else if (TARANAN.test(e.name)) out.push(p);
  }
  return out;
}

describe("kaynak taraması — 'Kumaşlar' adı geri gelmez", () => {
  it("⭐ §1 Electron/src (test dışı) + backend ekran kataloğu · arama kovası · içe aktarma adaptörü: 0", () => {
    // Backend dosyası yoksa bu bir 'ölçülemedi'dir, yeşil değil (fail-closed).
    for (const f of BACKEND) expect(existsSync(f), `backend dosyası bulunamadı: ${f}`).toBe(true);
    const ihlal: string[] = [];
    const tara = (f: string, ad: string) =>
      readFileSync(f, "utf8").split("\n").forEach((satir, i) => {
        if (ESKI_AD.test(satir)) ihlal.push(`${ad}:${i + 1}: ${satir.trim()}`);
      });
    for (const f of dosyalar(SRC)) {
      const rel = relative(SRC, f);
      if (!KAPSAM_DISI(rel)) tara(f, rel);
    }
    for (const f of BACKEND) tara(f, `Teks-Erp/${relative(resolve(process.cwd(), "../Teks-Erp"), f)}`);
    expect(ihlal, "sayfa/karo/palet/katalog adı 'Ürünler' — 'Kumaşlar' yalnız gerçekten kumaş olan yerde (sipariş/mal kabul satırı) kalır").toEqual([]);
  });
});
