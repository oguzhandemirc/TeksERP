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
const actual = vi.fn();
vi.mock("@/pages/Cost/Items/service", () => ({ costItemService: { detail: (...a: unknown[]) => detail(...a), weavingOrderActual: (...a: unknown[]) => actual(...a) } }));

import { WeavingCostSection } from "./WeavingCostSection";

const line = (sira: number, bilesen: string, tutarTlM: string) => ({ sira, bilesen, etiket: bilesen, iplikId: null, miktar: null, birim: null, birimFiyatTl: null, tutarTlM });

beforeEach(() => {
  moduleOpen = true;
  perms = ["cost:read"];
  detail.mockReset();
  actual.mockReset();
});

type ActualRowInput = { anahtar: string; ad: string; standartTlM: string | null; gercekTlM: string | null; kaynak: string | null; tahmini?: boolean; eksik?: string[] };
const actualRow = ({ tahmini = false, eksik = [], ...rest }: ActualRowInput) => ({ ...rest, tahmini, eksik });

describe("WeavingCostSection — gerçekleşen (devere maliyet dilim 2-3)", () => {
  it("⭐ iş emri verilince satırlar sunucu metniyle: standart ↔ gerçekleşen, kaynak, tahmini rozeti; ölçülemeyen 'eksik' (0 değil)", async () => {
    detail.mockResolvedValue({ aktifSurum: null });
    actual.mockResolvedValue({
      isEmriId: "w1", isEmriNo: "W-1", devamEdiyor: false, topMetre: "100",
      satirlar: [
        actualRow({ anahtar: "TEZGAH", ad: "Tezgâh (dokuma)", standartTlM: "3", gercekTlM: "2.5", kaynak: "koşum süresi × tezgâh saat ücreti" }),
        actualRow({ anahtar: "DEVERE", ad: "Devere (çözgü sarımı)", standartTlM: null, gercekTlM: "5.25", kaynak: "tarife (tahmini)", tahmini: true }),
        actualRow({ anahtar: "COZGU_IPLIGI", ad: "Çözgü ipliği", standartTlM: "4", gercekTlM: null, kaynak: null, eksik: ["çözgü ipliği fiyatı yok"] }),
        actualRow({ anahtar: "ATKI_IPLIGI", ad: "Atkı ipliği (norm miktar)", standartTlM: "3", gercekTlM: null, kaynak: "müşteri ipliği (maliyetimize girmez)" }),
      ],
      notlar: ["Devere için standart maliyette ayrı kalem seçilemiyor; karşılaştırma yapılmaz."],
    });
    renderWithProviders(<WeavingCostSection itemId="i1" weavingOrderId="w1" />);
    expect(await screen.findAllByTestId("wo-actual-row")).toHaveLength(4);
    expect(actual).toHaveBeenCalledWith("w1");
    expect(screen.getByTestId("wo-actual-DEVERE")).toHaveTextContent("5,25 TL/m");
    expect(screen.getAllByTestId("wo-actual-estimated")).toHaveLength(1);
    expect(screen.getByTestId("wo-actual-COZGU_IPLIGI")).toHaveTextContent("eksik");
    expect(screen.getByText("eksik: çözgü ipliği fiyatı yok")).toBeInTheDocument();
    // Müşteri ipliği: sayı yok, eksik de değil → "—" (0 ya da "eksik" yazılmaz), kaynak bilgiyi söyler.
    expect(screen.getByTestId("wo-actual-ATKI_IPLIGI")).toHaveTextContent("—");
    expect(screen.getByText("müşteri ipliği (maliyetimize girmez)")).toBeInTheDocument();
    expect(screen.getByTestId("wo-actual-notes")).toHaveTextContent("ayrı kalem seçilemiyor");
    expect(screen.getByText("Maliyet")).toBeInTheDocument();
  });

  it("cost:read yok → gerçekleşen sorgusu da atılmaz", () => {
    perms = [];
    renderWithProviders(<WeavingCostSection itemId="i1" weavingOrderId="w1" />);
    expect(actual).not.toHaveBeenCalled();
  });

  it("eski sunucu (uç yok) → 'okunamadı', standart bölüm yine çizilir", async () => {
    detail.mockResolvedValue({ aktifSurum: null });
    actual.mockRejectedValue(new Error("404"));
    renderWithProviders(<WeavingCostSection itemId="i1" weavingOrderId="w1" />);
    expect(await screen.findByText("Gerçekleşen maliyet okunamadı.")).toBeInTheDocument();
    expect(await screen.findByText("Bu ürünün kayıtlı standart maliyeti yok.")).toBeInTheDocument();
  });
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

  it("'Maliyet kartına git' kart kenarına yapışmaz: kendi satır kutusunda (.order) durur", async () => {
    detail.mockResolvedValue({ aktifSurum: null });
    renderWithProviders(<WeavingCostSection itemId="i1" />);
    const link = await screen.findByTestId("wo-cost-link");
    expect(link).toHaveAttribute("href", expect.stringContaining("/cost/items/i1"));
    expect(link.parentElement).toHaveClass("order");
  });
});
