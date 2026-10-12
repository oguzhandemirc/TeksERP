import { describe, it, expect, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";
import type { LicenseStatusSummary } from "@/types/license";

const status = vi.fn();
vi.mock("@/services/licenseService", () => ({
  licenseService: { status: () => status(), detail: vi.fn(), dataExport: vi.fn(), pollNow: vi.fn() },
}));

const { LicenseBanner, BANNER_ROTATE_MS } = await import("./LicenseBanner");

const base: LicenseStatusSummary = {
  ayrinti: true,
  kip: "zorla",
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

function login() {
  useAuthStore.setState({ user: { userId: "u1" } as unknown as JwtPayload });
}

describe("LicenseBanner — tek alanda sıralı dönüş (K6)", () => {
  it("birden çok bant TEK alanda sırayla döner (şiddet sırası), 1/N göstergesiyle", async () => {
    login();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      status.mockResolvedValue({
        ...base,
        bant: { metin: "Birinci mesaj.", ton: "uyari" },
        bantlar: [{ metin: "Birinci mesaj.", ton: "uyari" }, { metin: "İkinci mesaj.", ton: "bilgi" }],
      });
      renderWithProviders(<LicenseBanner />);
      expect(await screen.findByTestId("lisans-bandi")).toHaveTextContent("Birinci mesaj.");
      expect(screen.getByTestId("lisans-bandi-sira")).toHaveTextContent("1/2");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BANNER_ROTATE_MS + 50);
      });
      expect(screen.getByTestId("lisans-bandi")).toHaveTextContent("İkinci mesaj.");
      expect(screen.getByTestId("lisans-bandi-sira")).toHaveTextContent("2/2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("tek mesajda gösterge ve dönüş yok; eski backend (yalnız `bant`) aynı çizilir", async () => {
    login();
    status.mockResolvedValue({ ...base, bant: { metin: "Tek mesaj.", ton: "bilgi" } });
    renderWithProviders(<LicenseBanner />);
    expect(await screen.findByTestId("lisans-bandi")).toHaveTextContent("Tek mesaj.");
    expect(screen.queryByTestId("lisans-bandi-sira")).toBeNull();
  });

  it("K9: gözlem kipinde backend bilgi bandı (bakım hatırlatması) verirse çizilir", async () => {
    login();
    status.mockResolvedValue({ ...base, kip: "gozlem", bant: { metin: "Bakım süreniz 10 gün sonra bitiyor.", ton: "bilgi" } });
    renderWithProviders(<LicenseBanner />);
    expect(await screen.findByTestId("lisans-bandi")).toHaveTextContent("Bakım süreniz 10 gün sonra bitiyor.");
  });

  it("geçici açılış: backend bandı yokken bilgi bandı + kalan gün rozeti", async () => {
    login();
    status.mockResolvedValue({ ...base, gecici: { bitis: "2026-11-10T23:59:59.999Z", kalanGun: 29, kodSonu: "AB12" } });
    renderWithProviders(<LicenseBanner />);
    const band = await screen.findByTestId("lisans-bandi");
    expect(band).toHaveTextContent("geçici açılış koduyla");
    expect(band).toHaveTextContent("…AB12");
    expect(band).toHaveTextContent("Geçici kod: 29 gün");
  });

  it("geçici açılış: backend bandı (≤7 g uyarısı) varken panel ikinci metin üretmez, yalnız gün rozeti", async () => {
    login();
    const uyari = { metin: "Geçici açılış kodu 5 gün sonra bitiyor.", ton: "uyari" as const };
    status.mockResolvedValue({ ...base, kademe: "UYARI", bant: uyari, bantlar: [uyari], gecici: { bitis: "2026-10-17T23:59:59.999Z", kalanGun: 5, kodSonu: "AB12" } });
    renderWithProviders(<LicenseBanner />);
    const band = await screen.findByTestId("lisans-bandi");
    expect(band).toHaveTextContent("5 gün sonra bitiyor");
    expect(band).not.toHaveTextContent("geçici açılış koduyla");
    expect(band).toHaveTextContent("Geçici kod: 5 gün");
    expect(screen.queryByTestId("lisans-bandi-sira")).toBeNull();
  });

  it("geçici açılış: gözlem kipinde bant çizilmez (sıfır fark)", async () => {
    login();
    status.mockResolvedValue({ ...base, kip: "gozlem", gecici: { bitis: "2026-11-10T23:59:59.999Z", kalanGun: 29, kodSonu: "AB12" } });
    status.mockClear();
    renderWithProviders(<LicenseBanner />);
    await vi.waitFor(() => expect(status).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByTestId("lisans-bandi")).toBeNull();
  });
});
