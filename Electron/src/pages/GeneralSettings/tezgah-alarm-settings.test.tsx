// Genel Ayarlar › Tezgah izleme: alarm bayrağı (+ sebepsiz duruş hedefi), üstlenilmiş alarm iletimi
// ve tekrar çalma aralığı satırları — varsayılanları bugünkü davranışı söyler, sade Türkçe; satırlar
// ekranda çizilir ve tek Kaydet ile aynı PATCH'e gider (sözleşme bekçisi: test_feature_flag_contract).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import { SETTINGS_CATEGORIES } from "./settings-config";

const flags = vi.fn();
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => flags(),
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));

import { FeatureFlagSection } from "./FeatureFlagSection";

const tezgah = SETTINGS_CATEGORIES.find((c) => c.id === "tezgah")!;
const flagsOf = (c: typeof tezgah) => ("flags" in c && c.flags) || [];
const numbersOf = (c: typeof tezgah) => ("numberFlags" in c && c.numberFlags) || [];

beforeEach(() => {
  flags.mockReturnValue({
    isLoading: false,
    data: {
      data: {
        tezgahAlarmEnabled: true,
        tezgahAlarmUnclassifiedTargetMinutes: null,
        tezgahAlarmEscalateWhenAcked: true,
        tezgahAlarmRenotifyMinutes: 10,
        tezgahEscalationGraceMinutes: 0,
      },
    },
  });
  useAuthStore.setState({ isSystemAccount: false, systemAccountExists: true });
});

describe("tezgah alarmı ayar satırları", () => {
  it("⭐ kategori üç alarm ayarını taşır; varsayılanlar bugünkü davranış (alarm KAPALI, iletim AÇIK, 10 dk)", () => {
    const f = flagsOf(tezgah);
    const alarm = f.find((x) => x.key === "tezgahAlarmEnabled");
    expect(alarm?.defaultOn).toBe(false);
    expect(alarm?.numberField?.numberKey).toBe("tezgahAlarmUnclassifiedTargetMinutes");
    expect(alarm?.desc).toMatch(/Kapalıyken \(varsayılan\)/);
    expect(f.find((x) => x.key === "tezgahAlarmEscalateWhenAcked")?.defaultOn).toBe(true);
    const renotify = numbersOf(tezgah).find((x) => x.key === "tezgahAlarmRenotifyMinutes");
    expect(renotify).toMatchObject({ fallback: 10, min: 1, max: 120 });
    expect(renotify?.desc).toMatch(/varsayılan 10 dk/);
  });

  it("satırlar ekranda: bayrak, sebepsiz duruş hedefi (boş uyarısıyla), iletim, tekrar aralığı", () => {
    renderWithProviders(<FeatureFlagSection flags={flagsOf(tezgah)} numberFlags={numbersOf(tezgah)} />);
    expect(screen.getByText("Tezgah alarmı")).toBeTruthy();
    expect(screen.getByText("Üstlenilmiş alarm da patrona iletilsin")).toBeTruthy();
    expect(screen.getByText("Alarm tekrar çalma aralığı")).toBeTruthy();
    expect(screen.getByText("Sebebi girilmemiş duruşun hedef süresi")).toBeTruthy();
    expect(screen.getByText(/sebebi henüz girilmemiş duruş alarm üretmez/)).toBeTruthy();
  });
});
