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
});
