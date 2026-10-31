// =============================================================================
// BEKÇİ — Desen kartı Maliyet sekmesi (SY-A3): §1 her bağlı kumaş için `/api/cost/preview` ÇAĞRILIR (itemId ile)
//   ve ekrandaki "≈ X USD/m" sayısı SUNUCU yanıtının alanıdır (istemci hesaplamaz) · §2 kur yoksa sıfır değil
//   "kuru yok" · §3 önizleme hatası uydurma sayı basmaz · §4 bağlı kumaş yoksa sorgu atılmaz
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const previewCost = vi.fn();
vi.mock("@/pages/Cost/Items/service", async (orig) => ({
  ...(await orig<typeof import("@/pages/Cost/Items/service")>()),
  previewCost: (...a: unknown[]) => previewCost(...a),
}));
import { CostTab } from "./CostTab";

const FABRIC = { id: "it-1", code: "TUL-01", name: "Tül 01", weftSpecId: null, weaveDesignId: "wd-1" };
const preview = (sonuc: Record<string, unknown> | null, eksikler: string[] = []) => ({ sonuc, eksikler });

beforeEach(() => { previewCost.mockReset(); });

describe("CostTab — sayı yalnız sunucudan", () => {
  it("§1 ⭐ kumaş başına /api/cost/preview itemId ile çağrılır; basılan sayı yanıttaki standartDovizM", async () => {
    previewCost.mockResolvedValue(preview({ standartTlM: "99.00", sunumDovizi: "USD", standartDovizM: "1.2345" }));
    renderWithProviders(<CostTab fabrics={[FABRIC]} />);
    await waitFor(() => expect(screen.getByTestId("cost-it-1")).toHaveTextContent(/1,2345 USD\/m/));
    expect(previewCost).toHaveBeenCalledWith({ itemId: "it-1" });
  });
  it("§2 sunum dövizi kuru yoksa sıfır basılmaz, 'kuru yok' yazılır", async () => {
    previewCost.mockResolvedValue(preview({ standartTlM: "99.00", sunumDovizi: "USD", standartDovizM: null }));
    renderWithProviders(<CostTab fabrics={[FABRIC]} />);
    await waitFor(() => expect(screen.getByTestId("cost-it-1")).toHaveTextContent("USD kuru yok"));
  });
  it("§3 önizleme hatası → 'Önizleme alınamadı', uydurma sayı yok", async () => {
    previewCost.mockRejectedValue(new Error("500"));
    renderWithProviders(<CostTab fabrics={[FABRIC]} />);
    await waitFor(() => expect(screen.getByTestId("cost-it-1")).toHaveTextContent("Önizleme alınamadı"), { timeout: 5000 });
  });
  it("§4 bağlı kumaş yoksa sorgu atılmaz", () => {
    renderWithProviders(<CostTab fabrics={[]} />);
    expect(screen.getByText("Bu desene bağlı kumaş yok.")).toBeInTheDocument();
    expect(previewCost).not.toHaveBeenCalled();
  });
});
