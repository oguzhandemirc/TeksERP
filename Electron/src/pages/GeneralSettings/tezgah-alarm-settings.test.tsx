// Genel Ayarlar › Tezgah izleme: alarm bayrağı, sebepsiz duruşta alarm (+ zorunlu süre), vardiya yokken alarm
// kipi, üstlenilmiş alarm iletimi ve tekrar çalma aralığı — varsayılanları bugünkü davranışı söyler, sade
// Türkçe; satırlar ekranda çizilir ve tek Kaydet ile aynı PATCH'e gider (sözleşme bekçisi: test_feature_flag_contract).
// Negatif sondalar (2026-10-12, geri alındı): açma kilidi silindi → REQUIRE_SHIFT testi ❌ · zorunlu süre kapısı
// silindi → Kaydet testi ❌ · kilit taslak yerine kayıtlı kipe baktı → REQUIRE_SHIFT testi ❌.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import { SETTINGS_CATEGORIES } from "./settings-config";

const flags = vi.fn();
const shiftStatus = vi.fn();
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => flags(),
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin: false, hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: () => ({ dokumaEnabled: true, machineStopEnabled: true }),
}));
vi.mock("@/services/featureFlagService", async (orig) => {
  const actual = await orig<typeof import("@/services/featureFlagService")>();
  return { ...actual, featureFlagService: { ...actual.featureFlagService, getTezgahAlarmShiftStatus: () => shiftStatus() } };
});

import { FeatureFlagSection } from "./FeatureFlagSection";

const tezgah = SETTINGS_CATEGORIES.find((c) => c.id === "tezgah")!;
const flagsOf = (c: typeof tezgah) => ("flags" in c && c.flags) || [];
const numbersOf = (c: typeof tezgah) => ("numberFlags" in c && c.numberFlags) || [];
const enumsOf = (c: typeof tezgah) => ("enumFlags" in c && c.enumFlags) || [];

const sunucu = (over: Record<string, unknown> = {}) =>
  flags.mockReturnValue({
    isLoading: false,
    data: {
      data: {
        tezgahAlarmEnabled: true,
        tezgahAlarmUnclassifiedTargetMinutes: null,
        tezgahAlarmUnclassifiedEnabled: false,
        tezgahAlarmEscalateWhenAcked: true,
        tezgahAlarmRenotifyMinutes: 10,
        tezgahEscalationGraceMinutes: 0,
        tezgahAlarmNoShiftMode: "WARN",
        ...over,
      },
    },
  });
const durum = (over: Record<string, unknown> = {}) =>
  shiftStatus.mockResolvedValue({
    success: true,
    data: { alarmEnabled: true, mode: "WARN", shiftDefined: true, currentShift: null, notice: null, enableBlockedModes: [], ...over },
  });
const ciz = () =>
  renderWithProviders(<FeatureFlagSection flags={flagsOf(tezgah)} numberFlags={numbersOf(tezgah)} enumFlags={enumsOf(tezgah)} />);
const kaydet = () => screen.getByRole("button", { name: "Kaydet" }) as HTMLButtonElement;

beforeEach(() => {
  sunucu();
  durum();
  useAuthStore.setState({ isSystemAccount: false, systemAccountExists: true });
});

describe("tezgah alarmı ayar satırları", () => {
  it("⭐ kategori alarm ayarlarını taşır; varsayılanlar bugünkü davranış (alarm KAPALI, sebepsiz KAPALI, iletim AÇIK, 10 dk, kip WARN)", () => {
    const f = flagsOf(tezgah);
    const alarm = f.find((x) => x.key === "tezgahAlarmEnabled");
    expect(alarm?.defaultOn).toBe(false);
    expect(alarm?.numberField).toBeUndefined();
    expect(alarm?.gate).toBeDefined();
    expect(alarm?.desc).toMatch(/Kapalıyken \(varsayılan\)/);
    const sebepsiz = f.find((x) => x.key === "tezgahAlarmUnclassifiedEnabled");
    expect(sebepsiz?.defaultOn).toBe(false);
    expect(sebepsiz?.numberField).toMatchObject({ numberKey: "tezgahAlarmUnclassifiedTargetMinutes", required: true, showWhenOff: true });
    expect(f.find((x) => x.key === "tezgahAlarmEscalateWhenAcked")?.defaultOn).toBe(true);
    const renotify = numbersOf(tezgah).find((x) => x.key === "tezgahAlarmRenotifyMinutes");
    expect(renotify).toMatchObject({ fallback: 10, min: 1, max: 120 });
    expect(renotify?.desc).toMatch(/varsayılan 10 dk/);
    const kip = enumsOf(tezgah).find((x) => x.enumKey === "tezgahAlarmNoShiftMode");
    expect(kip).toMatchObject({ title: "Vardiya yokken alarm", defaultValue: "WARN", display: "radio" });
    expect(kip?.options.map((o) => `${o.value}:${o.label}`)).toEqual([
      "WARN:Uyar (vardiyada çal)",
      "ALWAYS:Vardiya yoksa da çal (7/24)",
      "REQUIRE_SHIFT:Vardiya olmadan açılamasın",
    ]);
  });

  it("satırlar ekranda: bayrak, sebepsiz duruşta alarm + süre, vardiya kipi (üç seçenek), iletim, tekrar aralığı", () => {
    ciz();
    expect(screen.getByText("Tezgah alarmı")).toBeTruthy();
    expect(screen.getByText("Sebepsiz duruşta alarm")).toBeTruthy();
    expect(screen.getByText("Üstlenilmiş alarm da patrona iletilsin")).toBeTruthy();
    expect(screen.getByText("Alarm tekrar çalma aralığı")).toBeTruthy();
    expect(screen.getByText("Vardiya yokken alarm")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect((screen.getByRole("radio", { name: /Uyar \(vardiyada çal\)/ }) as HTMLInputElement).checked).toBe(true);
  });
});

describe("sebepsiz duruşta alarm", () => {
  it("kapalıyken süre alanı çizilir ama PASİF; kayıtlı süre korunur", () => {
    sunucu({ tezgahAlarmUnclassifiedEnabled: false, tezgahAlarmUnclassifiedTargetMinutes: 15 });
    ciz();
    const input = screen.getByLabelText("Sebebi girilmemiş duruşun hedef süresi") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.value).toBe("15");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("⭐ açıp süreyi boş bırakınca kırmızı ipucu ve Kaydet KAPALI; süre girince Kaydet açılır", () => {
    ciz();
    fireEvent.click(screen.getByRole("switch", { name: "Sebepsiz duruşta alarm" }));
    const input = screen.getByLabelText("Sebebi girilmemiş duruşun hedef süresi") as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toMatch(/Süre girilmeden/);
    expect(kaydet().disabled).toBe(true);
    fireEvent.change(input, { target: { value: "20" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(kaydet().disabled).toBe(false);
  });
});

describe("vardiya yokken alarm — açma kilidi ve şerit", () => {
  it("⭐ REQUIRE_SHIFT seçilip vardiya tanımı yokken alarm anahtarını AÇMAK pasif + neden + Vardiya Tanımları bağlantısı", async () => {
    sunucu({ tezgahAlarmEnabled: false });
    durum({ alarmEnabled: false, shiftDefined: false, enableBlockedModes: ["REQUIRE_SHIFT"] });
    ciz();
    const anahtar = () => screen.getByRole("switch", { name: "Tezgah alarmı" }) as HTMLButtonElement;
    await waitFor(() => expect(shiftStatus).toHaveBeenCalled());
    expect(anahtar().disabled).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: /Vardiya olmadan açılamasın/ }));
    await waitFor(() => expect(anahtar().disabled).toBe(true));
    const neden = screen.getByTestId("tezgah-alarm-block-reason");
    expect(neden.textContent).toMatch(/Vardiya tanımlı değil/);
    expect(neden.querySelector("a")?.getAttribute("href")).toBe("/definitions/shift-definitions");
    fireEvent.click(screen.getByRole("radio", { name: /Uyar \(vardiyada çal\)/ }));
    await waitFor(() => expect(anahtar().disabled).toBe(false));
  });

  it("açık alarm kilitlenmez (kapatmak serbest)", async () => {
    sunucu({ tezgahAlarmEnabled: true, tezgahAlarmNoShiftMode: "REQUIRE_SHIFT" });
    durum({ mode: "REQUIRE_SHIFT", shiftDefined: false, enableBlockedModes: ["REQUIRE_SHIFT"], notice: "NO_SHIFT_DEFINED" });
    ciz();
    await screen.findByTestId("tezgah-alarm-block-reason");
    expect((screen.getByRole("switch", { name: "Tezgah alarmı" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("⭐ şerit KAYITLI durumu anlatır: tanımsız / şu an yok cümlesi + bağlantı; notice yoksa şerit yok", async () => {
    durum({ notice: "NO_SHIFT_DEFINED", shiftDefined: false });
    const { unmount } = ciz();
    const serit = await screen.findByTestId("alarm-shift-strip");
    expect(serit.textContent).toMatch(/Vardiya tanımlı değil — tezgah alarmı çalmaz/);
    expect(serit.querySelector("a")?.getAttribute("href")).toBe("/definitions/shift-definitions");
    unmount();
    durum({ notice: "NO_SHIFT_NOW" });
    const r2 = ciz();
    expect((await screen.findByTestId("alarm-shift-strip")).textContent).toMatch(/Şu an vardiya yok/);
    r2.unmount();
    durum({ notice: null });
    ciz();
    await waitFor(() => expect(shiftStatus).toHaveBeenCalled());
    expect(screen.queryByTestId("alarm-shift-strip")).toBeNull();
  });
});
