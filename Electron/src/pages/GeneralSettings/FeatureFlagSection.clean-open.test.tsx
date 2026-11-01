// =============================================================================
// BEKÇİ — SEKME AÇILIŞINDA FORM TEMİZ; "GERİ AL" TEMİZLER (2026-11-01 Muhasebe vakası)
// =============================================================================
// Muhasebe sekmesi dokunulmadan "Kaydedilmemiş değişiklik" gösteriyordu: gömülü sayı alanının
// (`numberField`) sunucu değeri 0 iken taslak "0" → `parseNumberDraft` → null (boş = kural inert)
// okunur, sunucu tarafı ise ham 0 kalırdı; null !== 0 → kalıcı kirli, Geri al da aynı "0"ı geri
// yazdığı için temizlemezdi. Sunucu değeri artık taslakla AYNI kodlayıcıdan geçer (`serverNumberOf`).
//
// Fotoğraf backend'in boş kurulum cevabını taklit eder: sayılar 0 (`readTolerancePct`,
// `readFinanceWithholdingFlags` varsayılanı), enum'lar varsayılan, bayraklar kapalı.
//
// NEGATİF SONDA (koşuldu, geri alındı): `serverNumberOf` ham `server?.[k] ?? null` döndürdü →
// §1 customers · shipping · production · tezgah · finance + §2 kırmızı (aynı desen, sunucu 0 iken).
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { FeatureFlags } from "@/services/featureFlagService";
import { SETTINGS_CATEGORIES, type SettingsCategory } from "./settings-config";

let server: Partial<FeatureFlags> = {};

vi.mock("@/hooks/usePricingEnabled", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/usePricingEnabled")>("@/hooks/usePricingEnabled");
  return {
    ...actual,
    FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
    useFeatureFlags: () => ({ isLoading: false, data: { success: true, data: server } }),
  };
});
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock("@/services/featureFlagService", async () => {
  const actual = await vi.importActual<typeof import("@/services/featureFlagService")>("@/services/featureFlagService");
  const shiftStatus = { alarmEnabled: false, mode: "WARN", shiftDefined: true, currentShift: null, notice: null, enableBlockedModes: [] };
  return {
    ...actual,
    featureFlagService: {
      ...actual.featureFlagService,
      update: vi.fn(),
      getTezgahAlarmShiftStatus: async () => ({ success: true, data: shiftStatus }),
      get: async () => ({ success: true, data: server }),
    },
  };
});
vi.mock("@/services/systemSettingService", async () => {
  const actual = await vi.importActual<typeof import("@/services/systemSettingService")>("@/services/systemSettingService");
  return {
    ...actual,
    systemSettingService: { list: vi.fn().mockResolvedValue({ success: true, data: [] }), upsert: vi.fn() },
  };
});
vi.mock("@/components/license/LicenseCeilingBadge", () => ({ LicenseCeilingBadge: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { FeatureFlagSection } from "./FeatureFlagSection";

const flagCats = SETTINGS_CATEGORIES.filter((c) => c.kind === "flags");
const rowsOf = (c: SettingsCategory) => ({
  flags: c.flags ?? [],
  numberFlags: c.numberFlags ?? [],
  enumFlags: c.enumFlags ?? [],
  textFlags: c.textFlags ?? [],
  settingFields: c.settingFields ?? [],
});

/** Boş kurulumda backend'in döndürdüğü fotoğraf: gömülü sayılar 0, enum/metin/sayı varsayılan. */
function emptyInstallSnapshot(cat: SettingsCategory): Partial<FeatureFlags> {
  const s: Record<string, unknown> = {};
  for (const f of cat.flags ?? []) {
    s[f.key] = false;
    if (f.numberField) s[f.numberField.numberKey] = 0;
  }
  for (const f of cat.numberFlags ?? []) s[f.key] = f.fallback;
  for (const f of cat.enumFlags ?? []) s[f.enumKey] = f.defaultValue;
  for (const f of cat.textFlags ?? []) s[f.textKey] = f.defaultValue;
  return s as Partial<FeatureFlags>;
}

const DIRTY = /Kaydedilmemiş değişiklik/;

async function renderCat(cat: SettingsCategory) {
  renderWithProviders(<FeatureFlagSection {...rowsOf(cat)} superadminOnly={cat.superadminOnly} />);
  await waitFor(() => expect(document.querySelector(".skeleton-shimmer")).toBeNull());
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ isSystemAccount: false, systemAccountExists: false });
});

describe("ayar sekmesi — açılışta temiz form", () => {
  it("zemin: Muhasebe sekmesinde sunucusu 0 dönen gömülü sayı alanı var (vaka yüzeyi kaybolursa vakumen yeşil kalırdı)", () => {
    const fin = flagCats.find((c) => c.id === "finance")!;
    expect(fin.flags?.some((f) => f.numberField?.numberKey === "financeWithholdingNumerator")).toBe(true);
  });

  it.each(flagCats.map((c) => [c.id, c] as const))("§1 ⭐ %s: boş kurulum fotoğrafıyla açılınca kirli değil", async (_id, cat) => {
    server = emptyInstallSnapshot(cat);
    await renderCat(cat);
    expect(screen.queryByText(DIRTY)).toBeNull();
  });

  it("§2 ⭐ Muhasebe: tevkifat payı değişince kirli, Geri al temizler", async () => {
    const cat = flagCats.find((c) => c.id === "finance")!;
    server = emptyInstallSnapshot(cat);
    await renderCat(cat);
    expect(screen.queryByText(DIRTY)).toBeNull();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Tevkifat payı" }), { target: { value: "5" } });
    expect(screen.getByText(DIRTY)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Geri al/ }));
    await waitFor(() => expect(screen.queryByText(DIRTY)).toBeNull());
  });

  it("§3 sunucu pozitif değer taşıyorsa açılış temiz", async () => {
    const cat = flagCats.find((c) => c.id === "finance")!;
    server = { ...emptyInstallSnapshot(cat), financeWithholdingNumerator: 5, financeInvoiceQtyTolerancePct: 2.5 };
    await renderCat(cat);
    expect(screen.queryByText(DIRTY)).toBeNull();
  });
});
