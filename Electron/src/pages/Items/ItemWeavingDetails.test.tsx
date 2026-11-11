// =============================================================================
// BEKÇİ — Ürün kartı "Dokuma ayrıntıları" (Seyitoğlu temel)
// NEGATİF SONDA (2026-11-11, geri alındı): null-temizle dalı silindi → §2b ❌; eşik `>=` → §3c ❌;
//   gsm-null koruması düşürüldü → §3a ❌.
// =============================================================================
// ⭐ §1 Alanlar yalnız KUMAŞTA; bölüm boşken kapalı, dolu değerle açık.
// ⭐ §2 Gövde: dolu → noktalı metin · boş + kayıtsız → anahtar YOK · boş + kayıtlı → null · iplik → anahtar YOK.
// ⭐ §3 Hesap satırı: gsm null → yok · hata/404 → yok · dolu → tr-TR satır · |fark| > %10 → uyarı.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { ItemFormDialog } from "./ItemFormDialog";
import { ComputedGsmView } from "./ItemWeavingDetails";
import type { Item, ItemComputedGsm } from "./types";

vi.mock("@/lib/picker-loader", () => ({ loadAllForPicker: () => Promise.resolve({ data: [], pagination: { page: 1, pageSize: 500, total: 0, totalPages: 1 } }) }));
vi.mock("@/components/forms/SimilarNamesWarning", () => ({ SimilarNamesWarning: () => null }));
vi.mock("@/components/RecordInfoButton", () => ({ RecordInfoButton: () => null }));
vi.mock("./AllowedColorsDialog", () => ({ AllowedColorsDialog: () => null }));
vi.mock("./AllowedPropertiesDialog", () => ({ AllowedPropertiesDialog: () => null }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useDevereEnabled: () => false, useDokumaEnabled: () => false, useKaliteGuvenceEnabled: () => false, useMaliyetEnabled: () => false }));
const computedGsm = vi.fn();
vi.mock("./service", () => ({ itemService: { computedGsm: (id: string) => computedGsm(id) } }));

const item = (over: Partial<Item>): Item =>
  ({ id: "i1", code: "STK-000001", name: "PATOS", itemType: "FABRIC", unit: "MT", isActive: true, linearDensityDen: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", ...over }) as Item;
const calc = (over: Partial<ItemComputedGsm> = {}): ItemComputedGsm => ({
  rawWidthCm: 300, warpGPerM: 120.44, weftGPerM: 135, totalGPerM: 255.44, gsm: 85.15, enteredRawGsm: null, diffPct: null, ...over,
});
const section = () => screen.getByTestId("item-weaving-details") as HTMLDetailsElement;

beforeEach(() => {
  computedGsm.mockReset();
  computedGsm.mockResolvedValue(calc({ gsm: null }));
});

describe("Dokuma ayrıntıları — alanlar ve görünürlük", () => {
  it("⭐ §1 kumaşta bölüm var, boşken KAPALI; dolu değerle AÇIK; iplikte bölüm YOK", () => {
    const { unmount } = renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({})} />);
    expect(section().open).toBe(false);
    expect(screen.getByLabelText("Ham en (cm)")).toBeInTheDocument();
    expect(screen.getByLabelText("Ham gramaj (g/m²)")).toBeInTheDocument();
    expect(screen.getByLabelText("Mamul gramaj (g/m²)")).toBeInTheDocument();
    unmount();
    const r2 = renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({ rawGsm: 85.5 })} />);
    expect(section().open).toBe(true);
    expect(screen.getByLabelText("Ham gramaj (g/m²)")).toHaveValue("85,5");
    r2.unmount();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({ itemType: "YARN", unit: "KG" })} />);
    expect(screen.queryByTestId("item-weaving-details")).toBeNull();
  });
});

describe("Dokuma ayrıntıları — istek gövdesi", () => {
  it("⭐ §2a yeni kumaş: girilen değer noktalı metin gider, boş alan anahtarı gitmez", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText(/^Ad/), "TÜL A");
    await user.type(screen.getByLabelText("Ham en (cm)"), "300,5");
    await user.type(screen.getByLabelText("Mamul gramaj (g/m²)"), "90");
    await user.click(screen.getByRole("button", { name: "Oluştur" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const body = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toMatchObject({ rawWidthCm: "300.5", finishedGsm: "90" });
    expect("rawGsm" in body).toBe(false);
  });

  it("⭐ §2b düzenleme: kayıtlı değer silinince null (temizle); hiç dolmamış alan anahtarsız", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} initial={item({ rawWidthCm: "300.00" })} />);
    await user.clear(screen.getByLabelText("Ham en (cm)"));
    await user.click(screen.getByRole("button", { name: "Güncelle" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const body = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.rawWidthCm).toBeNull();
    expect("rawGsm" in body).toBe(false);
    expect("finishedGsm" in body).toBe(false);
  });

  it("⭐ §2c sıfır reddedilir, bölüm hata ile açılır, gövde gitmez", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} initial={item({})} />);
    await user.type(screen.getByLabelText("Ham gramaj (g/m²)"), "0");
    await user.click(screen.getByRole("button", { name: "Güncelle" }));
    expect(await screen.findByText("Ham gramaj sıfırdan büyük olmalı")).toBeInTheDocument();
    expect(section().open).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("⭐ §2d iplik kartı: dokuma anahtarları hiç gitmez", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} initial={item({ itemType: "YARN", unit: "KG", rawGsm: 80 })} />);
    await user.click(screen.getByRole("button", { name: "Güncelle" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const body = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
    for (const k of ["rawWidthCm", "rawGsm", "finishedGsm"]) expect(k in body).toBe(false);
  });
});

describe("Dokuma ayrıntıları — hesaplanan gramaj", () => {
  it("⭐ §3a gsm null → satır YOK", () => {
    const { container } = render(<ComputedGsmView data={calc({ gsm: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("⭐ §3b dolu → tr-TR biçim, en çok 1 ondalık, bilinmeyen parça '—'", () => {
    render(<ComputedGsmView data={calc({ weftGPerM: null })} />);
    expect(screen.getByTestId("item-computed-gsm")).toHaveTextContent(
      "Hesaplanan: çözgü 120,4 g/m · atkı — g/m · toplam 255,4 g/m · 85,2 g/m²",
    );
  });

  it("⭐ §3c fark eşiği: %12 → uyarı, %-12 → uyarı (mutlak), %10 → uyarı YOK, %9 → YOK", () => {
    const { rerender } = render(<ComputedGsmView data={calc({ diffPct: 12.34 })} />);
    expect(screen.getByText("Girilen gramaj hesaplanandan %12,3 farklı")).toBeInTheDocument();
    rerender(<ComputedGsmView data={calc({ diffPct: -12 })} />);
    expect(screen.getByText("Girilen gramaj hesaplanandan %12 farklı")).toBeInTheDocument();
    rerender(<ComputedGsmView data={calc({ diffPct: 10 })} />);
    expect(screen.queryByText(/hesaplanandan/)).toBeNull();
    rerender(<ComputedGsmView data={calc({ diffPct: 9 })} />);
    expect(screen.queryByText(/hesaplanandan/)).toBeNull();
  });

  it("⭐ §3d düzenlemede uç çağrılır ve satır görünür; yeni kartta uç çağrılmaz", async () => {
    computedGsm.mockResolvedValue(calc({ diffPct: 15 }));
    const { unmount } = renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({ rawGsm: 98 })} />);
    expect(await screen.findByTestId("item-computed-gsm")).toBeInTheDocument();
    expect(screen.getByText("Girilen gramaj hesaplanandan %15 farklı")).toBeInTheDocument();
    expect(computedGsm).toHaveBeenCalledWith("i1");
    unmount();
    computedGsm.mockClear();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} />);
    expect(screen.getByTestId("item-weaving-details")).toBeInTheDocument();
    expect(computedGsm).not.toHaveBeenCalled();
  });

  it("⭐ §3e uç 404/hata → satır sessizce gizli (eski sunucu)", async () => {
    computedGsm.mockRejectedValue(Object.assign(new Error("Not Found"), { response: { status: 404 } }));
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({})} />);
    await waitFor(() => expect(computedGsm).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("item-computed-gsm")).toBeNull();
  });
});
