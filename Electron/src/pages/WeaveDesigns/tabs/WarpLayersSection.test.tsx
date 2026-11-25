// =============================================================================
// Ek çözgü katmanları (D3/K7): katman kumaşa aittir — ürün penceresi > Çözgü KAYNAK (sarım biçimi seçilir), desen kartı
// salt okunur özet + "Üründe aç". Çözgü kartı rejimi (devere ∨ dokuma, D4/K1) kapalıysa ürün penceresinde Çözgü
// sekmesi yok → tek yazma yeri desen kartı.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";

const regime = vi.hoisted(() => ({ on: true }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useWarpSpecEnabled: () => regime.on }));
const CONSTRUCTION = {
  groundWarp: { id: "g", code: "ZMN", name: "Zemin", endsCount: 3000 },
  warpLayers: [{ role: "LENO", beamMode: "SEPARATE_BEAM", warpSpec: { id: "w-l", code: "DNR", name: "Döner çözgü", endsCount: 200 } }],
  warnings: [],
};
vi.mock("../service", () => ({ constructionApi: { get: () => Promise.resolve(CONSTRUCTION), putWarpLayers: vi.fn() } }));
vi.mock("./WarpLayersVisual", () => ({ WarpLayersVisual: () => null }));

const { WarpLayersSection } = await import("./WarpLayersSection");
const FABRIC = { id: "it-1", code: "D2057" };

beforeEach(() => {
  regime.on = true;
  useAuthStore.setState({ user: { userId: "u1", username: "k", permissions: ["warpspec:write", "item:write"] } as unknown as JwtPayload });
});

describe("WarpLayersSection", () => {
  it("⭐ ürün penceresi (kaynak): sarım biçimi seçilebilir", async () => {
    renderWithProviders(<WarpLayersSection fabric={FABRIC} canWrite place="item" />);
    expect(await screen.findByLabelText("DNR sarım biçimi")).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: /Üründe aç/ })).toBeNull();
  });

  it("⭐ desen kartı (çözgü kartı rejimi açık): salt okunur özet + Üründe aç", async () => {
    const onOpenItem = vi.fn();
    renderWithProviders(<WarpLayersSection fabric={FABRIC} canWrite place="design" onOpenItem={onOpenItem} />);
    expect(await screen.findByTestId("beam-mode-readonly")).toHaveTextContent("Ayrı levent");
    expect(screen.queryByLabelText("DNR sarım biçimi")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Üründe aç/ }));
    expect(onOpenItem).toHaveBeenCalledTimes(1);
  });

  it("desen kartı (çözgü kartı rejimi kapalı): ürün penceresinde Çözgü sekmesi yok → burada seçilebilir", async () => {
    regime.on = false;
    renderWithProviders(<WarpLayersSection fabric={FABRIC} canWrite place="design" onOpenItem={vi.fn()} />);
    expect(await screen.findByLabelText("DNR sarım biçimi")).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: /Üründe aç/ })).toBeNull();
  });
});
