// =============================================================================
// BEKÇİ — Fason seçici kategori süzgeci (2026-11-19)
// ① kod çözülür + kategoride fason var → liste SUNUCUDA `filter[categoryId]` ile; "Tümünü göster" süzgeci kaldırır
// ② kategoride aktif fason yok → süzgeçsiz + "atanmış fason yok" uyarısı (kilitlemez)
// ③ kod tanımlı değil → süzgeçsiz + "kodlu kategori tanımlı değil" uyarısı
// ④ kategori beklenmiyor → bugünkü davranış: süzgeç yok, şerit yok, kategori kataloğu çekilmez
// ⑤ categoryId verilmişse (rota adımı) kod değil id kullanılır
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { SubcontractorCategoryPicker } from "./SubcontractorCategoryPicker";

const subGetAll = vi.fn();
const listCursor = vi.fn();
const catGetAll = vi.fn();
vi.mock("@/pages/Subcontractors/service", () => ({
  subcontractorService: {
    getAll: (...a: unknown[]) => subGetAll(...a),
    listCursor: (...a: unknown[]) => listCursor(...a),
    getById: vi.fn(),
  },
}));
vi.mock("@/pages/SubcontractorCategories/service", () => ({
  subcontractorCategoryService: { getAll: (...a: unknown[]) => catGetAll(...a) },
}));

const CATS = [
  { id: "cat-boya", code: "BOYA", name: "Boyahane" },
  { id: "cat-dev", code: "DEVERE", name: "Devere" },
];
const pageOf = (rows: unknown[], total = rows.length) =>
  Promise.resolve({ success: true, data: rows, pagination: { page: 1, pageSize: 1, total, totalPages: 1 } });
const cursorOf = (rows: unknown[]) =>
  Promise.resolve({ success: true, data: rows, pagination: { nextCursor: null, hasMore: false, limit: 50, totalEstimate: rows.length } });
const lastFilters = () => (listCursor.mock.calls.at(-1)?.[0] as { filters: Record<string, string> }).filters;

beforeEach(() => {
  subGetAll.mockReset();
  listCursor.mockReset();
  catGetAll.mockReset();
  catGetAll.mockImplementation(() => pageOf(CATS));
  listCursor.mockImplementation(() => cursorOf([{ id: "s1", name: "Devereci A", code: "F1", categories: [] }]));
});

const openPicker = async () => {
  await userEvent.click(screen.getByRole("button", { name: /Devereci seç/ }));
};
const renderPicker = (p: { categoryCode?: string; categoryId?: string | null }) =>
  renderWithProviders(
    <SubcontractorCategoryPicker value={null} onChange={vi.fn()} queryKey="t" getLabel={(s) => s.name} title="Devereci seç" placeholder="Devereci seç" {...p} />,
  );

describe("SubcontractorCategoryPicker", () => {
  it("⭐ ① DEVERE kodu çözülür, kategoride fason var → categoryId ile süzülür; Tümünü göster → süzgeç kalkar", async () => {
    subGetAll.mockImplementation(() => pageOf([{ id: "s1" }], 3));
    renderPicker({ categoryCode: "DEVERE" });
    await waitFor(() => expect(subGetAll).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", categoryId: "cat-dev" } })));
    await openPicker();
    expect(await screen.findByText(/kategorisindeki fasoncular/)).toBeInTheDocument();
    await waitFor(() => expect(lastFilters()).toEqual({ isActive: "true", categoryId: "cat-dev" }));
    await userEvent.click(screen.getByRole("switch", { name: "Tümünü göster" }));
    await waitFor(() => expect(lastFilters()).toEqual({ isActive: "true" }));
    expect(screen.getByText("Tüm fasoncular gösteriliyor")).toBeInTheDocument();
  });

  it("⭐ ② kategoride aktif fason yok → süzgeçsiz liste + 'atanmış fason yok' uyarısı", async () => {
    subGetAll.mockImplementation(() => pageOf([], 0));
    renderPicker({ categoryCode: "DEVERE" });
    await waitFor(() => expect(subGetAll).toHaveBeenCalled());
    await openPicker();
    expect(await screen.findByText(/Bu kategoriye \(Devere\) atanmış fason yok/)).toBeInTheDocument();
    expect(screen.getByText(/Fasoncular sayfasından kategori atayın/)).toBeInTheDocument();
    await waitFor(() => expect(lastFilters()).toEqual({ isActive: "true" }));
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("⭐ ③ kod tanımlı değil → süzgeçsiz + 'kodlu kategori tanımlı değil' uyarısı, sayım sorgusu yok", async () => {
    catGetAll.mockImplementation(() => pageOf([CATS[0]]));
    renderPicker({ categoryCode: "DEVERE" });
    await waitFor(() => expect(catGetAll).toHaveBeenCalled());
    await openPicker();
    expect(await screen.findByText(/"DEVERE" kodlu fason kategorisi tanımlı değil/)).toBeInTheDocument();
    await waitFor(() => expect(lastFilters()).toEqual({ isActive: "true" }));
    expect(subGetAll).not.toHaveBeenCalled();
  });

  it("④ kategori beklenmiyor → bugünkü davranış: süzgeç yok, şerit yok, katalog çekilmez", async () => {
    renderPicker({ categoryId: null });
    await openPicker();
    await waitFor(() => expect(listCursor).toHaveBeenCalled());
    expect(lastFilters()).toEqual({ isActive: "true" });
    expect(catGetAll).not.toHaveBeenCalled();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("⑤ categoryId verilir (rota adımı) → id ile süzülür, ad katalogdan", async () => {
    subGetAll.mockImplementation(() => pageOf([{ id: "s1" }], 1));
    renderPicker({ categoryId: "cat-boya" });
    await openPicker();
    expect(await screen.findByText("Boyahane")).toBeInTheDocument();
    await waitFor(() => expect(lastFilters()).toEqual({ isActive: "true", categoryId: "cat-boya" }));
  });
});
