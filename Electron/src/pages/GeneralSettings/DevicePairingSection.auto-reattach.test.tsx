// `device.autoReattachKnownHardware` satırı: alan yoksa (eski sunucu) backend varsayılanı gibi AÇIK görünür,
// kayıt yalnız değişen alanı gönderir, dar yazma izniyle satır salt-okunurdur (yazma yalnız admin:settings).
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

const BASLIK = "Onaylı cihaz yeniden kurulunca kendiliğinden tanınsın";
const sunucu = (over: Record<string, unknown> = {}) =>
  flags.mockReturnValue({
    isLoading: false,
    data: { data: { devicePairingRequired: true, shortCredentialApprovedDeviceOnly: false, deviceProofRequired: false, deviceUnpairedPasswordLogin: false, ...over } },
  });

beforeEach(() => {
  sunucu();
  update.mockReset().mockResolvedValue({ success: true, data: {} });
  izinler.mockReset().mockReturnValue(true);
});

describe("onaylı cihazı kendiliğinden yeniden tanıma satırı", () => {
  it("alan gelmezse açık görünür (backend varsayılanı true)", () => {
    renderWithProviders(<DevicePairingSection />);
    expect(screen.getByLabelText(BASLIK).getAttribute("aria-checked")).toBe("true");
  });

  it("sunucuda kapalı → kapalı görünür", () => {
    sunucu({ deviceAutoReattach: false });
    renderWithProviders(<DevicePairingSection />);
    expect(screen.getByLabelText(BASLIK).getAttribute("aria-checked")).toBe("false");
  });

  it("kapatıp kaydetmek yalnız deviceAutoReattach:false gönderir", async () => {
    sunucu({ deviceAutoReattach: true });
    renderWithProviders(<DevicePairingSection />);
    fireEvent.click(screen.getByLabelText(BASLIK));
    fireEvent.click(screen.getByRole("button", { name: /kaydet/i }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({ deviceAutoReattach: false });
  });

  it("admin:settings yoksa salt-okunur", () => {
    izinler.mockImplementation((l) => !l.includes("admin:settings"));
    renderWithProviders(<DevicePairingSection writePermissions={["settings:devices"]} />);
    expect(screen.queryByLabelText(BASLIK)).toBeNull();
    expect(screen.getByText(BASLIK)).toBeTruthy();
  });
});
