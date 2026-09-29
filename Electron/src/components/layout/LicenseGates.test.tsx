import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";
import type { LicenseStatusSummary } from "@/types/license";

const status = vi.fn();
vi.mock("@/services/licenseService", () => ({
  licenseService: { status: () => status(), detail: vi.fn(), dataExport: vi.fn(), pollNow: vi.fn() },
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin: false, hasPermission: () => false, hasAnyPermission: () => false }),
}));

const { LicenseBanner } = await import("./LicenseBanner");
const { LicenseLockGate } = await import("./LicenseLockGate");
const { LicenseSuspendedPage } = await import("@/pages/LicenseSuspended/LicenseSuspendedPage");
const { useLicenseStatus } = await import("@/hooks/useLicenseStatus");
const { useLicenseSuspension } = await import("@/lib/license/suspension");

/** Sorgu ÇÖZÜLDÜ mü — "çizilmedi" iddiası ancak veri geldikten sonra anlamlıdır. */
function Loaded() {
  return <span>{useLicenseStatus()?.lisansNo ?? "bekleniyor"}</span>;
}

const base: LicenseStatusSummary = {
  ayrinti: true,
  kip: "gozlem",
  kademe: "NORMAL",
  bant: null,
  ekSureKalanGun: null,
  kisitlamaKalanGun: null,
  guncellemeIzni: true,
  sinif: "URETIM",
  lisansNo: "TKS-2026-0001",
  lisansSahibi: { musteri: "Örnek Tekstil", tesis: "Merkez" },
  surum: "2.12.0",
};

/**
 * GÖZLEM = SIFIR FARK: backend gözlemde kademeyi NORMAL ve bandı null döndürür;
 * panel ne bant ne kilit çizer. Zorlamada çizdiği her şey backend'in UYGULADIĞI
 * karardır — panel kendi kararını üretmez.
 */
describe("lisans bandı ve kilidi", () => {
  beforeEach(() => {
    status.mockReset();
    useLicenseSuspension.setState({ suspended: false });
    useAuthStore.setState({ user: { userId: "u1", username: "op", permissions: ["roll:read"] } as unknown as JwtPayload });
  });

  it("⭐ gözlem: ne bant ne kilit (hesaplanan ne olursa olsun, backend uygulananı döner)", async () => {
    status.mockResolvedValue(base);
    renderWithProviders(
      <>
        <Loaded />
        <LicenseBanner />
        <LicenseLockGate />
      </>,
    );
    await screen.findByText("TKS-2026-0001");
    expect(screen.queryByTestId("lisans-bandi")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("zorlama + bant: backend metni ve ek süre günü çizilir", async () => {
    status.mockResolvedValue({ ...base, kip: "zorla", kademe: "EK_SURE", ekSureKalanGun: 12, bant: { metin: "Lisans yenilenemedi.", ton: "uyari" } });
    renderWithProviders(<LicenseBanner />);
    expect(await screen.findByTestId("lisans-bandi")).toHaveTextContent("Lisans yenilenemedi.");
    expect(screen.getByTestId("lisans-bandi")).toHaveTextContent("Ek süre: 12 gün");
  });

  it("KISITLI: kilit açılır ve 'salt okunur devam et' ile kapanır", async () => {
    status.mockResolvedValue({ ...base, kip: "zorla", kademe: "KISITLI" });
    renderWithProviders(<LicenseLockGate />);
    expect(await screen.findByTestId("lisans-kilidi-restricted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salt okunur devam et" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("⭐ DURDURULMUS: kilit çizilmez, K5 sinyali yanar — kabuk yerine 'verilerimi al' sayfası açılır", async () => {
    status.mockResolvedValue({ ...base, kip: "zorla", kademe: "DURDURULMUS" });
    renderWithProviders(<LicenseLockGate />);
    await waitFor(() => expect(useLicenseSuspension.getState().suspended).toBe(true));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("⭐ K5 sayfası: kapatılamaz; 'verilerimi al' yetkisiz kullanıcıya yönetici girişi ister; çıkış var", async () => {
    status.mockResolvedValue({ ...base, kip: "zorla", kademe: "DURDURULMUS", bant: { metin: "Sözleşme askıda.", ton: "tehlike" } });
    renderWithProviders(<LicenseSuspendedPage />);
    expect(await screen.findByText("Sözleşme askıda.")).toBeInTheDocument();
    expect(screen.getByTestId("lisans-k5-sayfasi")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salt okunur devam et" })).toBeNull();
    expect(screen.getByText(/yönetici hesabıyla giriş yapın/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Çıkış yap/ })).toBeInTheDocument();
  });

  it("K5 kalkınca (sunucu NORMAL) sinyal söner — kabuk kendiliğinden geri gelir", async () => {
    useLicenseSuspension.setState({ suspended: true });
    status.mockResolvedValue({ ...base, kip: "zorla", kademe: "NORMAL" });
    renderWithProviders(<Loaded />);
    await waitFor(() => expect(useLicenseSuspension.getState().suspended).toBe(false));
  });

  it("oturum yoksa durum sorulmaz (kimliksize ayrıntı zaten verilmez)", async () => {
    useAuthStore.setState({ user: null });
    status.mockResolvedValue(base);
    renderWithProviders(<LicenseLockGate />);
    await new Promise((r) => setTimeout(r, 20));
    expect(status).not.toHaveBeenCalled();
  });
});
