// =============================================================================
// DUMAN — bağlanan seçiciler (Hizmet kartı · Renk): Örnek al gerçek formu "(örnekten)" + "(kopya)" ile açar,
// kayıt YALNIZ POST (oluştur); PATCH yok. Düzenle ortak kartta "Kart ekranında aç"a gider.
// Ürün · Cari: satırda Düzenle → kart ekranı (ortak kart yerinde düzenlenmez); izin yokken eylem yok.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";

const SVC = { id: "s1", code: "HZM-0001", name: "Kurşun", unit: "MT", isActive: true };
const ITEM = { id: "i1", code: "KUM1", name: "Poplin", itemType: "FABRIC", unit: "MT", isActive: true, allowedColors: [], allowedProperties: [] };
const CARI = { id: "cu1", code: "MUS-1", name: "Aras Tekstil", isActive: true, isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: false };
const COLOR = { id: "c1", code: "RNK-0001", name: "Lacivert", hex: "#112244", isActive: true, sortOrder: 1 };
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const put = vi.fn();
vi.mock("@/services/apiClient", () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), put: (...a: unknown[]) => put(...a) },
}));
const openTab = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab }) } }));

const { ServiceItemSelect } = await import("../ServiceItemSelect");
const { ColorPickerModal } = await import("../color-picker/ColorPickerModal");
const { ItemSelect } = await import("../ItemSelect");
const { SupplierPickerModal } = await import("../SupplierPickerModal");

const listBody = (rows: unknown[]) => ({ data: { success: true, data: rows, pagination: { nextCursor: null, hasMore: false, limit: 50, page: 1, pageSize: 500, total: rows.length, totalPages: 1 } } });

beforeEach(() => {
  for (const f of [get, post, patch, put, openTab]) f.mockReset();
  get.mockImplementation((url: string) => {
    if (url.startsWith("/api/service-items") && !url.includes("process")) return Promise.resolve(listBody([SVC]));
    if (url.startsWith("/api/colors")) return Promise.resolve(listBody([COLOR]));
    if (url.startsWith("/api/items")) return Promise.resolve(listBody([ITEM]));
    if (url.startsWith("/api/customers")) return Promise.resolve(listBody([CARI]));
    return Promise.resolve(listBody([]));
  });
  post.mockImplementation((_url: string, body: Record<string, unknown>) => Promise.resolve({ data: { success: true, data: { ...body, id: "new-1", code: "YENI" } } }));
  useAuthStore.setState({ user: { userId: "u1", username: "k", permissions: ["item:write", "property:write", "customer:write"] } as unknown as JwtPayload });
});

describe("Bağlanan seçiciler — Örnek al / Düzenle", () => {
  it("⭐ Hizmet kartı: Örnek al formu doldurur, kayıt yalnız POST, yeni kart seçili; PATCH yok", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ServiceItemSelect value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Hizmet kartı seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Kurşun — örnek al/ }));
    const form = await screen.findByRole("dialog", { name: /Yeni Hizmet Kartı \(örnekten\)/ });
    expect(within(form).getByLabelText(/^Ad/)).toHaveValue("Kurşun (kopya)");
    await userEvent.click(within(form).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/service-items", expect.objectContaining({ name: "Kurşun (kopya)" })));
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty("id");
    expect(patch).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("new-1", expect.objectContaining({ id: "new-1" })));
  });

  it("⭐ Hizmet kartı: Düzenle ortak kartta formu açmaz → Hizmet Kartları ekranı yeni sekmede", async () => {
    renderWithProviders(<ServiceItemSelect value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Hizmet kartı seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Kurşun — düzenle" }));
    await userEvent.click(await screen.findByRole("button", { name: /Kart ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/services?search=HZM-0001", { forceNew: true }));
    expect(patch).not.toHaveBeenCalled();
  });

  it("⭐ Renk: Örnek al formu doldurur, kayıt yalnız POST; PATCH yok", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ColorPickerModal value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Renk seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Lacivert — örnek al/ }));
    const form = await screen.findByRole("dialog", { name: /Yeni Renk \(örnekten\)/ });
    expect(within(form).getByLabelText(/^Ad/)).toHaveValue("Lacivert (kopya)");
    await userEvent.click(within(form).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/colors", expect.objectContaining({ name: "Lacivert (kopya)", hex: "#112244" })));
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty("code");
    expect(patch).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("new-1"));
  });

  it("⭐ izin yoksa renk seçicide Düzenle/Örnek al çizilmez", async () => {
    useAuthStore.setState({ user: { userId: "u1", username: "k", permissions: ["item:read"] } as unknown as JwtPayload });
    renderWithProviders(<ColorPickerModal value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Renk seç/ }));
    await screen.findByText("Lacivert");
    expect(screen.queryByRole("button", { name: /örnek al/ })).toBeNull();
  });

  it("⭐ Ürün seçici: Düzenle → Ürünler ekranı yeni sekmede; PATCH yok", async () => {
    renderWithProviders(<ItemSelect value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getAllByRole("button")[0]!);
    await userEvent.click(await screen.findByRole("button", { name: "Poplin — düzenle" }));
    await userEvent.click(await screen.findByRole("button", { name: /Kart ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/items?search=KUM1", { forceNew: true }));
    expect(screen.getByRole("button", { name: /Poplin — örnek al/ })).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it("⭐ Cari seçici: cari satırında Düzenle → cari kart ekranı; PATCH yok", async () => {
    renderWithProviders(<SupplierPickerModal open onOpenChange={vi.fn()} onPick={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Aras Tekstil — düzenle" }));
    await userEvent.click(await screen.findByRole("button", { name: /Kart ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/cariler/cu1", { forceNew: true }));
    expect(patch).not.toHaveBeenCalled();
  });
});
