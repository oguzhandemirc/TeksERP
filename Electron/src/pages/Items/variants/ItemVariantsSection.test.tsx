// =============================================================================
// Ürün penceresi > Varyantlar (D3/K7): varyant kumaşa aittir. Yeni varyant kumaş kimliğiyle POST eder (İş Emri
// Şablonları aynı tabloyu okur); Örnek al yalnız POST eder, kaynağa PATCH yok; Düzenle ortak şablonu yerinde açmaz;
// T10: boya rengi seçicisi kumaşın kartela renkleriyle süzülür.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock("@/services/apiClient", () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), put: vi.fn() },
}));
const openTab = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab }) } }));
const pickerProps = vi.hoisted(() => ({ last: null as null | { allowedColorIds?: string[] | null; value: string | null } }));
vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({
  ColorPickerModal: (p: { allowedColorIds?: string[] | null; value: string | null }) => {
    pickerProps.last = p;
    return <span data-testid="color-picker">{p.value ?? "renk yok"}</span>;
  },
}));

const { ItemVariantsSection } = await import("./ItemVariantsSection");

const FABRIC = { id: "it-1", code: "D2057", name: "TÜL D2057", allowedColorIds: ["c-krem", "c-beyaz"] };
const V01 = { id: "r-1", code: "IES-001", name: "TÜL D2057 V01", variantCode: "V01", finishingRateCode: "T-1", isActive: true, color: { id: "c-krem", code: "KRM", name: "Krem" } };

beforeEach(() => {
  for (const f of [get, post, patch, openTab]) f.mockReset();
  pickerProps.last = null;
  get.mockResolvedValue({ data: { success: true, data: [V01], pagination: { total: 1 } } });
  post.mockImplementation((_u: string, body: Record<string, unknown>) => Promise.resolve({ data: { success: true, data: { ...V01, ...body, id: "r-new" } } }));
  useAuthStore.setState({ user: { userId: "u1", username: "k", permissions: ["station:read", "station:write"] } as unknown as JwtPayload });
});

describe("ItemVariantsSection", () => {
  it("⭐ liste kumaşın varyantlarını kumaş kimliğiyle okur", async () => {
    renderWithProviders(<ItemVariantsSection fabric={FABRIC} />);
    expect(await screen.findByText("TÜL D2057 V01")).toBeInTheDocument();
    expect(get.mock.calls[0]![0]).toContain("/api/product-recipes");
    expect(decodeURIComponent(get.mock.calls[0]![0] as string)).toContain("it-1");
  });

  it("⭐ Yeni varyant: kumaş kimliği + varyant kodu ile POST; renk seçici kartela renkleriyle süzülü (T10)", async () => {
    renderWithProviders(<ItemVariantsSection fabric={FABRIC} />);
    await userEvent.click(await screen.findByRole("button", { name: /Yeni varyant/ }));
    expect(pickerProps.last?.allowedColorIds).toEqual(["c-krem", "c-beyaz"]);
    await userEvent.type(screen.getByLabelText(/Varyant kodu/), "V02");
    await userEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/product-recipes", expect.objectContaining({ itemId: "it-1", variantCode: "V02", name: "TÜL D2057 V02" })));
    expect(patch).not.toHaveBeenCalled();
  });

  it("⭐ Örnek al: renk/tarife taşınır, kod boş; yalnız POST, kaynağa PATCH yok", async () => {
    renderWithProviders(<ItemVariantsSection fabric={FABRIC} />);
    await userEvent.click(await screen.findByRole("button", { name: /V01 — örnek al/ }));
    expect(screen.getByLabelText(/Varyant kodu/)).toHaveValue("");
    expect(screen.getByLabelText("Ad")).toHaveValue("TÜL D2057 V01 (kopya)");
    expect(screen.getByLabelText(/Terbiye tarifesi/)).toHaveValue("T-1");
    expect(screen.getByTestId("color-picker")).toHaveTextContent("c-krem");
    await userEvent.type(screen.getByLabelText(/Varyant kodu/), "V03");
    await userEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/product-recipes", expect.objectContaining({ variantCode: "V03", colorId: "c-krem", finishingRateCode: "T-1" })));
    const body = post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.id).toBeUndefined();
    expect(patch).not.toHaveBeenCalled();
  });

  it("Düzenle: ortak şablon yerinde açılmaz, İş Emri Şablonları ekranına götürür", async () => {
    renderWithProviders(<ItemVariantsSection fabric={FABRIC} />);
    await userEvent.click(await screen.findByRole("button", { name: /V01 — düzenle/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Kart ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith(expect.stringContaining("/definitions/product-recipes"), { forceNew: true }));
    expect(patch).not.toHaveBeenCalled();
  });

  it("yazma izni yoksa Yeni / Düzenle / Örnek al çizilmez", async () => {
    useAuthStore.setState({ user: { userId: "u1", username: "k", permissions: ["station:read"] } as unknown as JwtPayload });
    renderWithProviders(<ItemVariantsSection fabric={FABRIC} />);
    await screen.findByText("TÜL D2057 V01");
    expect(screen.queryByRole("button", { name: /Yeni varyant/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /örnek al/ })).toBeNull();
  });
});
