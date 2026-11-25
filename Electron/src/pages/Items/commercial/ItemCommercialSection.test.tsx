// BEKÇİ — Ürün kartı "Ticari" sekmesi (D4 aşama a): SALT OKUNUR. Fiyat özeti okunur, düzenleme alanı yok, hiçbir
// yazma isteği atılmaz; "… ekranında aç" sekme deposuyla ilgili ekranı (ürün seçili) açar.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock("@/services/apiClient", () => ({ default: api }));
const openTab = vi.hoisted(() => vi.fn());
vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab }) } }));

import { ItemCommercialSection } from "./ItemCommercialSection";

const ITEM = { id: "11111111-1111-4111-8111-111111111111", unit: "MT" };
const priceRow = (o: Record<string, unknown>) => ({ id: String(Math.random()), itemId: ITEM.id, kind: "SALE", currency: "TRY", price: "42", createdAt: "", updatedAt: "", customerId: null, ...o });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  openTab.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === "/api/item-prices") {
      return { data: { data: [priceRow({}), priceRow({ customerId: "c1", price: "40" }), priceRow({ customerId: "c2", price: "39" })], pagination: { total: 3, page: 1, pageSize: 200, totalPages: 1 } } };
    }
    if (url === "/api/supplier-item-codes") {
      return { data: { success: true, data: [{ id: "s1", supplierId: "sup1", codeKey: "15301", rawCode: "153.01", itemId: ITEM.id, hitCount: 3, lastUsedAt: null, createdAt: "2026-11-20T10:00:00Z", updatedAt: "", supplier: { id: "sup1", name: "Korteks" }, item: { id: ITEM.id, code: "IP1", name: "İplik", itemType: "YARN" } }] } };
    }
    return { data: { success: true, data: [] } };
  });
});

describe("ItemCommercialSection — salt okunur", () => {
  it("⭐ fiyat özeti: kart varsayılanı + müşteri istisna sayısı; düzenleme alanı ve yazma isteği yok", async () => {
    renderWithProviders(<ItemCommercialSection item={ITEM} sections={{ prices: true, supplierCodes: false, labSpecs: false, ruleSets: false }} />);
    expect(await screen.findByText("Satış · TRY")).toBeInTheDocument();
    expect(screen.getByText(/42,00.*\/ m/)).toBeInTheDocument();
    expect(screen.getByText("2 müşteri")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/api/item-prices", expect.objectContaining({ params: expect.objectContaining({ "filter[itemId]": ITEM.id }) }));
    // Fiyat ürün kartından YAZILAMAZ: giriş kutusu yok, kaydet düğmesi yok, yazma ucu çağrılmaz.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("button", { name: /Kaydet|Güncelle|Ekle|Sil/ })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("⭐ 'Kalem Fiyatları ekranında aç' ürünü seçili yolla yeni sekmede açar", async () => {
    renderWithProviders(<ItemCommercialSection item={ITEM} sections={{ prices: true, supplierCodes: false, labSpecs: false, ruleSets: false }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Kalem Fiyatları ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith(`/definitions/item-prices?itemId=${ITEM.id}`, { forceNew: true }));
  });

  it("iplikte tedarikçi kalem kodları listelenir (ürün süzgeci sunucuda), satır tedarikçi kartını açar", async () => {
    renderWithProviders(<ItemCommercialSection item={ITEM} sections={{ prices: false, supplierCodes: true, labSpecs: false, ruleSets: false }} />);
    expect(await screen.findByText("153.01")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/api/supplier-item-codes", { params: { itemId: ITEM.id } });
    fireEvent.click(screen.getByRole("button", { name: "Korteks" }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith(expect.stringContaining("sup1"), { forceNew: true }));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("kalite bölümleri boşken açıklayıcı satır; uçlar ürün süzgeciyle çağrılır", async () => {
    renderWithProviders(<ItemCommercialSection item={ITEM} sections={{ prices: false, supplierCodes: false, labSpecs: true, ruleSets: true }} />);
    expect(await screen.findByText("Bu kumaşa özel müşteri şartı yok.")).toBeInTheDocument();
    expect(await screen.findByText(/Bu kumaşa özel kural seti yok/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/api/customer-lab-specs", expect.objectContaining({ params: expect.objectContaining({ itemId: ITEM.id }) }));
    expect(api.get).toHaveBeenCalledWith("/api/four-point-rules", { params: { itemId: ITEM.id } });
  });
});
