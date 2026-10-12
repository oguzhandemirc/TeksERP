// Kısa kimlik kuralı açık + cihaz kanıtı kapalı → panel kapının başlıkla aşılabileceğini söyler
// (fabrikada kural kanıtı zorlamaz; uyarı iki ayarın taslağından türer).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const flags = vi.fn();
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => flags(),
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true, hasAnyPermission: () => true }),
}));

import { DevicePairingSection } from "./DevicePairingSection";

const sunucu = (over: Record<string, unknown> = {}) =>
  flags.mockReturnValue({
    isLoading: false,
    data: {
      data: {
        devicePairingRequired: false,
        shortCredentialApprovedDeviceOnly: false,
        deviceProofRequired: false,
        ...over,
      },
    },
  });
const uyari = () => screen.queryByTestId("short-credential-proof-warning");

beforeEach(() => sunucu());

describe("kısa kimlik kuralı ↔ cihaz kanıtı uyarısı", () => {
  it("kural açık, kanıt kapalı → uyarı görünür", () => {
    sunucu({ shortCredentialApprovedDeviceOnly: true, devicePairingRequired: true });
    renderWithProviders(<DevicePairingSection />);
    expect(uyari()?.textContent).toMatch(/cihaz kanıtı kapalıyken bu kapı başlıkla aşılabilir/i);
    expect(uyari()?.textContent).toMatch(/Cihaz kanıtı ayarını açın/);
  });

  it("kural açık, kanıt açık → uyarı yok", () => {
    sunucu({ shortCredentialApprovedDeviceOnly: true, devicePairingRequired: true, deviceProofRequired: true });
    renderWithProviders(<DevicePairingSection />);
    expect(uyari()).toBeNull();
  });

  it("kural kapalı → uyarı yok; taslakta açılınca belirir", () => {
    renderWithProviders(<DevicePairingSection />);
    expect(uyari()).toBeNull();
    const kutu = screen.getByLabelText("Hızlı PIN ve personel kartı yalnız onaylı cihazdan");
    fireEvent.click(kutu);
    expect(uyari()).not.toBeNull();
  });
});
