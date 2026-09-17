// =============================================================================
// BEKÇİ — Ürün kartı: izinli renk/özellik YALNIZ KUMAŞTA (kullanıcı kararı 2026-09-17)
// =============================================================================
// ⭐ §1 Tür Kumaş → "İzinli Renkler / Özellikler" alanları var; İplik/Sarf → YOK.
// ⭐ §2 Create'te tür İplik'e çevrilince değerler boşalır ve payload anahtarı gitmez.
// ⭐ §3 Eski iplik kartında liste kalmışsa formda tek satır NOT (sessiz düzeltme değil),
//    kaydedince payload `[]` ile kaldırır.
// =============================================================================
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { ItemFormDialog } from "./ItemFormDialog";
import type { Item } from "./types";

vi.mock("@/lib/picker-loader", () => ({ loadAllForPicker: () => Promise.resolve({ data: [], pagination: { page: 1, pageSize: 500, total: 0, totalPages: 1 } }) }));
vi.mock("@/components/forms/SimilarNamesWarning", () => ({ SimilarNamesWarning: () => null }));
vi.mock("@/components/RecordInfoButton", () => ({ RecordInfoButton: () => null }));
vi.mock("./AllowedColorsDialog", () => ({ AllowedColorsDialog: () => null }));
vi.mock("./AllowedPropertiesDialog", () => ({ AllowedPropertiesDialog: () => null }));

const COLORS = "İzinli Renkler (opsiyonel)";
const PROPS = "İzinli Özellikler (opsiyonel)";

const item = (over: Partial<Item>): Item =>
  ({ id: "i1", code: "STK-000001", name: "PATOS", itemType: "FABRIC", unit: "MT", isActive: true, linearDensityDen: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", ...over }) as Item;

describe("ItemFormDialog — izinli renk/özellik yalnız kumaşta", () => {
  it("⭐ §1 kumaş kartında alanlar var; iplik kartında YOK", () => {
    const { unmount } = renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({ itemType: "FABRIC" })} />);
    expect(screen.getByText(COLORS)).toBeInTheDocument();
    expect(screen.getByText(PROPS)).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
    unmount();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({ itemType: "YARN", unit: "KG" })} />);
    expect(screen.queryByText(COLORS)).toBeNull();
    expect(screen.queryByText(PROPS)).toBeNull();
    expect(screen.queryByRole("note")).toBeNull(); // liste yoksa not da yok
  });

  it("⭐ §2 create: tür İplik'e çevrilince alanlar kaybolur, payload'da allowedColorIds YOK", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    expect(screen.getByText(COLORS)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Ad/), "İPLİK 150D");
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "İplik" }));
    await waitFor(() => expect(screen.queryByText(COLORS)).toBeNull());
    expect(screen.queryByText(PROPS)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Oluştur" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.itemType).toBe("YARN");
    expect("allowedColorIds" in payload).toBe(false);
    expect("allowedPropertyIds" in payload).toBe(false);
  });

  it("⭐ §3 eski iplik kartında liste kalmışsa NOT görünür; Güncelle → payload [] ile kaldırır", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const stale = item({ itemType: "YARN", unit: "KG", allowedColors: [{ colorId: "c1", color: { id: "c1", code: "KRM", name: "Krem", hex: null } }] });
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} initial={stale} />);
    expect(screen.queryByText(COLORS)).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("İplik kartında renk/özellik listesi tutulmaz, kaydedince kaldırılır.");
    await user.click(screen.getByRole("button", { name: "Güncelle" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ allowedColorIds: [], allowedPropertyIds: [] });
  });
});
