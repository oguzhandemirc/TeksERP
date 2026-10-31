// SY-D4 BEKÇİ — dokuma iş emri "Maliyet (standart)" bölümü: izin/modül yoksa sorgu ATILMAZ (koşulsuz 403 yok);
// varsa kayıtlı sürümün toplamı + yalnız dokuma satırları (atkı ücreti dahil) sunucu metniyle çizilir.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

let moduleOpen = true;
vi.mock("@/hooks/usePricingEnabled", async (orig) => ({
  ...(await orig<typeof import("@/hooks/usePricingEnabled")>()),
  useMaliyetEnabled: () => moduleOpen,
}));
let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
const detail = vi.fn();
vi.mock("@/pages/Cost/Items/service", () => ({ costItemService: { detail: (...a: unknown[]) => detail(...a) } }));

import { WeavingCostSection } from "./WeavingCostSection";

const line = (sira: number, bilesen: string, tutarTlM: string) => ({ sira, bilesen, etiket: bilesen, iplikId: null, miktar: null, birim: null, birimFiyatTl: null, tutarTlM });

beforeEach(() => {
  moduleOpen = true;
  perms = ["cost:read"];
  detail.mockReset();
});

describe("WeavingCostSection", () => {
  it("⭐ cost:read yok → sorgu atılmaz, bölüm çizilmez", () => {
    perms = [];
    const { container } = renderWithProviders(<WeavingCostSection itemId="i1" />);
    expect(container).toBeEmptyDOMElement();
    expect(detail).not.toHaveBeenCalled();
  });

  it("maliyet modülü kapalı → sorgu atılmaz", () => {
    moduleOpen = false;
    renderWithProviders(<WeavingCostSection itemId="i1" />);
    expect(detail).not.toHaveBeenCalled();
  });

  it("kayıtlı sürüm → toplam + yalnız dokuma satırları (atkı ücreti dahil)", async () => {
    detail.mockResolvedValue({
      aktifSurum: { surumNo: 2, standartTlM: "21.4000", satirlar: [line(1, "WARP_YARN", "5.0000"), line(2, "WEAVING_PICK", "11.9000"), line(3, "OVERHEAD", "1.0000")] },
    });
    renderWithProviders(<WeavingCostSection itemId="i1" />);
    expect(await screen.findByTestId("wo-cost-total")).toHaveTextContent("21,4 TL/m");
    const rows = screen.getAllByTestId("wo-cost-line");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Dokuma (atkı ücreti)");
    expect(detail).toHaveBeenCalledWith("i1");
  });

  it("sürüm yok → 'kayıtlı standart maliyeti yok' (0 yazılmaz)", async () => {
    detail.mockResolvedValue({ aktifSurum: null });
    renderWithProviders(<WeavingCostSection itemId="i1" />);
    expect(await screen.findByText("Bu ürünün kayıtlı standart maliyeti yok.")).toBeInTheDocument();
  });
});
