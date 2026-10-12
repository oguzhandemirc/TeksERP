import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";
import type { LicenseStatusSummary } from "@/types/license";

const status = vi.fn();
const detay = { tasima: null as null | { talepId: string; istendi: string; gerekce: string | null; durum?: "BEKLIYOR" | "ONAYLANDI" } };
const perms = { manage: true };
vi.mock("@/services/licenseService", () => ({
  licenseService: {
    status: () => status(),
    detail: () => Promise.resolve({ kurulum: { etkin: false }, hazir: true, tasima: detay.tasima }),
    acceptance: () => Promise.resolve({ kabul: null }),
  },
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin: false, hasPermission: () => perms.manage, hasAnyPermission: () => perms.manage }),
}));
// Kartların kendi testleri var; burada yalnız sayfanın BİLEŞİMİ (sıra, sınıfa göre görünürlük) ölçülür.
const stub = (id: string) => () => <div data-testid={id} />;
vi.mock("@/pages/System/License/LicenseAcceptanceCard", () => ({ LicenseAcceptanceCard: stub("kart-kabul") }));
vi.mock("@/pages/System/License/LicenseOfflineCard", () => ({ LicenseOfflineCard: stub("kart-karekod") }));
vi.mock("@/pages/System/License/LicenseActivateCard", () => ({ LicenseActivateCard: stub("kart-kod") }));
vi.mock("@/pages/System/License/LicenseFileUpload", () => ({ LicenseFileUpload: stub("kart-dosya") }));
vi.mock("@/pages/System/License/LicenseTransferCard", () => ({ LicenseTransferCard: stub("kart-tasima") }));
vi.mock("@/components/license/DataExportPanel", () => ({ DataExportPanel: stub("verilerimi-al") }));

const { LicenseActivationPage } = await import("./LicenseActivationPage");
const { useActivationLock } = await import("@/lib/license/activation-lock");

const base: LicenseStatusSummary = {
  ayrinti: true,
  kip: "gozlem",
  kademe: "NORMAL",
  bant: null,
  ekSureKalanGun: null,
  kisitlamaKalanGun: null,
  guncellemeIzni: true,
  sinif: null,
  lisansNo: null,
  lisansSahibi: null,
  surum: "2.15.6",
  etkinlestirmeKilidi: "ETKINLESMEDI",
};

function sirasi(ids: string[]): number[] {
  return ids.map((id) => {
    const el = screen.getByTestId(id);
    return Array.from(document.querySelectorAll("[data-testid]")).indexOf(el);
  });
}

/** G2 etkinleştirme sayfası: karekod BİRİNCİ yol; KOPYA'da "verilerimi al" + taşıma; yetkisize yalnız bilgi. */
describe("G2 etkinleştirme sayfası", () => {
  beforeEach(() => {
    status.mockReset();
    perms.manage = true;
    detay.tasima = null;
    useActivationLock.setState({ sinif: "ETKINLESMEDI" });
    useAuthStore.setState({ user: { userId: "u1", username: "yonetici", permissions: ["license:manage"] } as unknown as JwtPayload });
  });

  it("⭐ ETKINLESMEDI: sözleşme kabulü → karekod → internetle kod → dosya sırası; 'verilerimi al' ve taşıma YOK", async () => {
    status.mockResolvedValue(base);
    renderWithProviders(<LicenseActivationPage />);
    expect(await screen.findByTestId("kart-karekod")).toBeInTheDocument();
    expect(screen.getByText("Sunucu lisansı etkinleştirilmedi")).toBeInTheDocument();
    const sira = sirasi(["kart-kabul", "kart-karekod", "kart-kod", "kart-dosya"]);
    expect(sira).toEqual([...sira].sort((x, y) => x - y));
    expect(new Set(sira).size).toBe(4);
    expect(screen.queryByTestId("verilerimi-al")).toBeNull();
    expect(screen.queryByTestId("kart-tasima")).toBeNull();
    expect(screen.getByRole("button", { name: /Çıkış yap/ })).toBeInTheDocument();
  });

  it("⭐ KOPYA: uyarı + 'verilerimi al' + taşıma talebi açık", async () => {
    useActivationLock.setState({ sinif: "KOPYA" });
    status.mockResolvedValue({ ...base, etkinlestirmeKilidi: "KOPYA" });
    renderWithProviders(<LicenseActivationPage />);
    expect(await screen.findByTestId("kart-tasima")).toBeInTheDocument();
    expect(screen.getByTestId("verilerimi-al")).toBeInTheDocument();
    expect(screen.getByText(/başka bir kurulumdan taşınmış/)).toBeInTheDocument();
  });

  it("⭐ bekleyen taşıma talebi (ETKINLESMEDI): bilgi + taşıma kartı görünür, 'verilerimi al' YOK", async () => {
    detay.tasima = { talepId: "t1", istendi: "2026-10-12T08:00:00.000Z", gerekce: null, durum: "BEKLIYOR" };
    status.mockResolvedValue(base);
    renderWithProviders(<LicenseActivationPage />);
    expect(await screen.findByTestId("kart-tasima")).toBeInTheDocument();
    expect(screen.getByText("Taşıma talebiniz onay bekliyor")).toBeInTheDocument();
    expect(screen.getByText(/taşıma kodunu aşağıdaki internetle kod alanına girin/)).toBeInTheDocument();
    expect(screen.queryByTestId("verilerimi-al")).toBeNull();
  });

  it("lisans yetkisi olmayan kullanıcı: 'Yöneticinize başvurun', eylem kartı yok", async () => {
    perms.manage = false;
    status.mockResolvedValue(base);
    renderWithProviders(<LicenseActivationPage />);
    expect(await screen.findByText("Yöneticinize başvurun")).toBeInTheDocument();
    expect(screen.queryByTestId("kart-karekod")).toBeNull();
    expect(screen.queryByTestId("kart-kod")).toBeNull();
  });

  it("⭐ etkinleşince (durum YOK) sinyal söner — kabuk kendiliğinden geri gelir", async () => {
    status.mockResolvedValue({ ...base, etkinlestirmeKilidi: "YOK" });
    renderWithProviders(<LicenseActivationPage />);
    await waitFor(() => expect(useActivationLock.getState().sinif).toBe("YOK"));
  });

  it("eski backend (alan yok) kilit üretmez", async () => {
    useActivationLock.setState({ sinif: "YOK" });
    const eski: Partial<LicenseStatusSummary> = { ...base };
    delete eski.etkinlestirmeKilidi;
    status.mockResolvedValue(eski);
    renderWithProviders(<LicenseActivationPage />);
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(useActivationLock.getState().sinif).toBe("YOK");
  });
});
