// `device.unpairedPasswordLogin` satırı: uyarı yalnız ayar (taslak) açıkken görünür, kayıt yalnız değişen
// alanı gönderir, dar yazma izniyle satır salt-okunurdur (yazma yalnız admin:settings).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const flags = vi.fn();
const update = vi.fn();
const izinler = vi.fn<(list: string[]) => boolean>();
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => flags(),
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true, hasAnyPermission: (l: string[]) => izinler(l) }),
}));
vi.mock("@/services/featureFlagService", () => ({
  featureFlagService: { update: (body: unknown) => update(body) },
}));

import { DevicePairingSection } from "./DevicePairingSection";

const BASLIK = "Onaysız tabletler kullanıcı adı ve şifreyle girebilsin";
const sunucu = (over: Record<string, unknown> = {}) =>
  flags.mockReturnValue({
    isLoading: false,
    data: {
      data: {
        devicePairingRequired: true,
        shortCredentialApprovedDeviceOnly: false,
        deviceProofRequired: false,
        deviceUnpairedPasswordLogin: false,
        ...over,
      },
    },
  });
const uyari = () => screen.queryByTestId("unpaired-password-login-warning");

beforeEach(() => {
  sunucu();
  update.mockReset().mockResolvedValue({ success: true, data: {} });
  izinler.mockReset().mockReturnValue(true);
});

describe("onaysız tablet parola girişi satırı", () => {
  it("kapalı → uyarı yok; taslakta açılınca uyarı PIN/kart/liste kapalı ve pasifleştirme yolunu söyler", () => {
    renderWithProviders(<DevicePairingSection />);
    expect(uyari()).toBeNull();
    fireEvent.click(screen.getByLabelText(BASLIK));
    const metin = uyari()?.textContent ?? "";
    expect(metin).toMatch(/yalnız kullanıcı adı \+ şifreyle girer/);
    expect(metin).toMatch(/hızlı PIN, personel kartı ve personel\s+listesi kapalı/);
    expect(metin).toMatch(/makine atfı boş/);
    expect(metin).toMatch(/pasifleştirin — onayı geri almak yetmez/);
  });

  it("sunucuda açık → uyarı görünür", () => {
    sunucu({ deviceUnpairedPasswordLogin: true });
    renderWithProviders(<DevicePairingSection />);
    expect(uyari()).not.toBeNull();
  });

  it("kaydet yalnız değişen alanı gönderir", async () => {
    renderWithProviders(<DevicePairingSection />);
    fireEvent.click(screen.getByLabelText(BASLIK));
    fireEvent.click(screen.getByRole("button", { name: /kaydet/i }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({ deviceUnpairedPasswordLogin: true });
  });

  it("admin:settings yoksa satır salt-okunur (anahtar çizilmez)", () => {
    izinler.mockImplementation((l) => !l.includes("admin:settings"));
    sunucu({ deviceUnpairedPasswordLogin: true });
    renderWithProviders(<DevicePairingSection writePermissions={["settings:devices"]} />);
    expect(screen.queryByLabelText(BASLIK)).toBeNull();
    expect(screen.getByText(BASLIK)).toBeTruthy();
  });
});
