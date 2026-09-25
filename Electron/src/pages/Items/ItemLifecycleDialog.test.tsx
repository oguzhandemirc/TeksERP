// =============================================================================
// BEKÇİ — "Kullanımdan kaldır" diyaloğu (URUN-YASAM-DONGUSU.md §8)
// =============================================================================
// ⭐ §1 Aktif kart, canlı kayıt var: varsayılan "Tükenene kadar"; "Pasif" kilitli ve sebebi
//    yazılı; kayıtlar TEK TEK listelenir (toplar duruma göre katlanır); onay POST /lifecycle.
// ⭐ §2 Tükenene kadar kart, kalan 0: varsayılan "Pasif".
// ⭐ §3 Benzer aktif kart yalnız bilgi satırı (birleştirme otomatik değil).
// ⭐ §4 Pasif kart: "Yeniden kullanıma al", varsayılan "Tükenene kadar'a al" (geri alma mesajının çıkış yolu).
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { ItemLifecycleDialog } from "./ItemLifecycleDialog";
import { itemService } from "./service";
import type { Item } from "./types";

vi.mock("./service", () => ({
  itemService: { lifecyclePreview: vi.fn(), transitionLifecycle: vi.fn() },
}));
const preview = vi.mocked(itemService.lifecyclePreview);
const transition = vi.mocked(itemService.transitionLifecycle);

const item = (over: Partial<Item> = {}): Item =>
  ({ id: "i1", code: "STK-1", name: "PATOS", itemType: "FABRIC", unit: "MT", isActive: true, lifecycleStatus: "ACTIVE", linearDensityDen: null, createdAt: "", updatedAt: "", ...over }) as Item;

const previewData = (liveTotal: number, lifecycleStatus: Item["lifecycleStatus"] = "ACTIVE") => ({
  success: true,
  data: {
    item: { id: "i1", code: "STK-1", name: "PATOS", lifecycleStatus: lifecycleStatus ?? "ACTIVE", mergedIntoId: null },
    to: "ARCHIVED" as const,
    canTransition: liveTotal === 0,
    liveTotal,
    references:
      liveTotal > 0
        ? [{ kind: "ROLL", label: "Canlı top", count: liveTotal, records: [{ id: "r1", title: "BRK-1", detail: "WAREHOUSE · 50 m · Ana" }] }]
        : [],
    similarActive: [{ id: "i2", code: "STK-2", name: "PATOS YENİ" }],
  },
});

beforeEach(() => {
  preview.mockReset();
  transition.mockReset();
});

describe("ItemLifecycleDialog", () => {
  it("⭐ §1 Aktif kart + canlı kayıt: Tükenene kadar varsayılan, Pasif kilitli, kayıtlar listelenir, onay geçişi yollar", async () => {
    preview.mockResolvedValue(previewData(1) as never);
    transition.mockResolvedValue({ success: true, data: item(), message: "Kart 'Tükenene kadar' durumuna alındı" } as never);
    const onClose = vi.fn();
    renderWithProviders(<ItemLifecycleDialog item={item()} onClose={onClose} />);
    const phaseOut = await screen.findByRole("radio", { name: /Tükenene kadar/ });
    expect(phaseOut).toBeChecked();
    expect(screen.getByRole("radio", { name: /Pasif/ })).toBeDisabled();
    expect(screen.getByText(/1 canlı kayıt var/)).toBeInTheDocument();
    expect(screen.getByText("Depoda · 1")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Tükenene kadar'a al" }));
    await waitFor(() => expect(transition).toHaveBeenCalledWith("i1", "PHASE_OUT", null));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("⭐ §2 Tükenene kadar kart, kalan 0: varsayılan Pasif", async () => {
    preview.mockResolvedValue(previewData(0, "PHASE_OUT") as never);
    renderWithProviders(<ItemLifecycleDialog item={item({ lifecycleStatus: "PHASE_OUT" })} onClose={() => {}} />);
    expect(await screen.findByRole("radio", { name: /Pasif/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Pasife al" })).toBeEnabled();
  });

  it("⭐ §4 Pasif kart: başlık 'Yeniden kullanıma al', varsayılan Tükenene kadar, onay PHASE_OUT yollar", async () => {
    preview.mockResolvedValue(previewData(0, "ARCHIVED") as never);
    transition.mockResolvedValue({ success: true, data: item(), message: "Kart 'Tükenene kadar' durumuna alındı" } as never);
    renderWithProviders(<ItemLifecycleDialog item={item({ lifecycleStatus: "ARCHIVED", isActive: false })} onClose={() => {}} />);
    expect(await screen.findByRole("radio", { name: /Tükenene kadar/ })).toBeChecked();
    expect(screen.getByText(/Yeniden kullanıma al — PATOS/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Aktif'e döndür/ })).toBeEnabled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Tükenene kadar'a al" }));
    await waitFor(() => expect(transition).toHaveBeenCalledWith("i1", "PHASE_OUT", null));
  });

  it("⭐ §3 benzer aktif kart yalnız bilgi satırı", async () => {
    preview.mockResolvedValue(previewData(0) as never);
    renderWithProviders(<ItemLifecycleDialog item={item()} onClose={() => {}} />);
    expect(await screen.findByText(/"PATOS YENİ" kartının kopyasıysa Birleştir/)).toBeInTheDocument();
  });
});
