// =============================================================================
// BEKÇİ — AYAR EKRANINDAKİ HER SATIR KAYDET GÖVDESİNE GİRER (bileşen turu)
// =============================================================================
// Kaydet gövdesini elle kuran katman sessiz bir allowlist'tir: bir satır ekranda çizilip gövdeye
// girmezse panel "açık" gösterir, sunucu hiç duymaz. Bu bekçi `kind: "flags"` taşıyan HER
// kategoride her kontrolü değiştirip Kaydet'e basar ve gövdenin TAM o anahtar kümesi olduğunu
// ölçer (fazla anahtar da kırmızı). Gövdenin sunucu şemasınca kabulü backend bekçisindedir:
// `Teks-Erp/scripts/test_feature_flag_contract.ts` (panel `key`/`numberKey`/`enumKey`/`textKey`
// ⊆ `updateSchema`).
//
// Kayıttan sonra taslak SUNUCU CEVABINDAN kurulur: sunucu bir anahtarı yazmadıysa anahtar eski
// hâline döner ve cevapta hiç olmayan anahtar kullanıcıya hata olarak söylenir (§3, §4).
//
// NEGATİF SONDA (koşuldu, geri alındı): ① `buildFlagPatch`te `numberKeys` döngüsü susturuldu → §1
// beş kategoride kırmızı (customers · shipping · production · tezgah · finance) · ② bayrak döngüsü
// yalnız `tezgahAlarmEnabled`i atladı → §1 tezgah + §2 + §3 + §4 kırmızı · ③ `onSuccess`teki
// `syncDrafts` susturuldu → §3 kırmızı.
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { FeatureFlags } from "@/services/featureFlagService";
import { SETTINGS_CATEGORIES, type SettingsCategory } from "./settings-config";
import { unsavedFlagKeys } from "./flag-save";

let server: Partial<FeatureFlags> = {};
const update = vi.fn();
const upsert = vi.fn();
const toastError = vi.fn();

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
  // Tezgah alarmı kapısının durum ucu: ağa gitmesin (hata tostu bu testin saydığı tostlara karışır).
  const shiftStatus = { alarmEnabled: false, mode: "WARN", shiftDefined: true, currentShift: null, notice: null, enableBlockedModes: [] };
  return {
    ...actual,
    featureFlagService: {
      ...actual.featureFlagService,
      update: (p: unknown) => update(p),
      getTezgahAlarmShiftStatus: async () => ({ success: true, data: shiftStatus }),
    },
  };
});
vi.mock("@/services/systemSettingService", async () => {
  const actual = await vi.importActual<typeof import("@/services/systemSettingService")>("@/services/systemSettingService");
  return {
    ...actual,
    systemSettingService: {
      list: vi.fn().mockResolvedValue({ success: true, data: [] }),
      upsert: (...a: unknown[]) => upsert(...a),
    },
  };
});
// Lisans tavanı rozeti kendi ucunu sorar — bu bekçinin konusu değil, ağa çıkmasın.
vi.mock("@/components/license/LicenseCeilingBadge", () => ({ LicenseCeilingBadge: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (m: string) => toastError(m), warning: vi.fn() } }));

import { FeatureFlagSection } from "./FeatureFlagSection";

const flagCats = SETTINGS_CATEGORIES.filter((c) => c.kind === "flags");
const rowsOf = (c: SettingsCategory) => ({
  flags: c.flags ?? [],
  numberFlags: c.numberFlags ?? [],
  enumFlags: c.enumFlags ?? [],
  textFlags: c.textFlags ?? [],
  settingFields: c.settingFields ?? [],
});

/** Aynı rol + adla birden çok kontrol olabilir — sırayla tüketilir. */
function picker() {
  const seen = new Map<string, number>();
  return (role: string, name: string) => {
    const k = `${role}|${name}`;
    const i = seen.get(k) ?? 0;
    seen.set(k, i + 1);
    const all = screen.getAllByRole(role, { name });
    expect(all.length, `${role} "${name}" ${i + 1}. kopya yok`).toBeGreaterThan(i);
    return all[i] as HTMLElement;
  };
}

/** Sınırlar içinde, varsayılandan FARKLI bir değer (sıfır/negatif numberField'da "boş" sayılır). */
const otherNumber = (min: number, max: number, current: number) => (max !== current ? max : min);
const positiveInRange = (min: number, max: number) => (min > 0 ? min : Math.min(max, 1));
function textCandidate(def: { defaultValue: string; maxLength: number; pattern: RegExp }): string {
  const c = ["A", "X1", "1", "a", "AB-"].find((v) => v !== def.defaultValue && v.length <= def.maxLength && def.pattern.test(v));
  if (!c) throw new Error(`metin adayı yok: ${def.defaultValue}`);
  return c;
}

/** Kategorinin her kontrolünü değiştirir; beklenen PATCH anahtarlarını ve ham ayar anahtarlarını döner. */
function touchEverything(cat: SettingsCategory): { patchKeys: string[]; rawKeys: string[] } {
  const r = rowsOf(cat);
  const pick = picker();
  const patchKeys: string[] = [];
  for (const f of r.flags) {
    fireEvent.click(pick("switch", f.title));
    patchKeys.push(f.key);
  }
  // Gömülü eşik ebeveyn AÇIKKEN çizilir — bayraklar yukarıda açıldı (sunucu fotoğrafı boş = kapalı).
  for (const f of r.flags) {
    if (!f.numberField) continue;
    const nf = f.numberField;
    fireEvent.change(pick("spinbutton", nf.label), { target: { value: String(positiveInRange(nf.min, nf.max)) } });
    patchKeys.push(nf.numberKey);
  }
  for (const f of r.numberFlags) {
    fireEvent.change(pick("spinbutton", f.title), { target: { value: String(otherNumber(f.min, f.max, f.fallback)) } });
    patchKeys.push(f.key);
  }
  for (const f of r.enumFlags) {
    const other = f.options.find((o) => o.value !== f.defaultValue);
    if (!other) continue;
    if (f.display === "radio") {
      const group = pick("group", f.title);
      const radio = within(group).getAllByRole("radio").find((el) => (el as HTMLInputElement).value === other.value)!;
      fireEvent.click(radio);
    } else {
      fireEvent.change(pick("combobox", f.title), { target: { value: other.value } });
    }
    patchKeys.push(f.enumKey);
  }
  for (const f of r.textFlags) {
    fireEvent.change(pick("textbox", f.title), { target: { value: textCandidate(f) } });
    patchKeys.push(f.textKey);
  }
  const rawKeys: string[] = [];
  for (const f of r.settingFields) {
    fireEvent.change(pick("spinbutton", f.title), { target: { value: String(otherNumber(f.min, f.max, f.fallback)) } });
    rawKeys.push(f.key);
  }
  return { patchKeys, rawKeys };
}

beforeEach(() => {
  server = {};
  update.mockReset();
  update.mockImplementation(async (p: Record<string, unknown>) => ({ success: true, data: { ...server, ...p } }));
  upsert.mockReset();
  upsert.mockResolvedValue({ success: true });
  toastError.mockReset();
  localStorage.clear();
  // Satıcı kategorileri (Modüller, Demo) de yazılabilir çizilsin: sistem hesabı yok = supap açık.
  useAuthStore.setState({ isSystemAccount: false, systemAccountExists: false });
});

describe("ayar ekranı — Kaydet gövdesi", () => {
  it("zemin: ölçülecek kategori ve satır var (tarayıcı boşa düşerse vakumen yeşil kalırdı)", () => {
    expect(flagCats.length).toBeGreaterThanOrEqual(10);
    expect(flagCats.some((c) => c.id === "tezgah")).toBe(true);
    const total = flagCats.reduce((n, c) => {
      const r = rowsOf(c);
      return n + r.flags.length + r.numberFlags.length + r.enumFlags.length + r.textFlags.length + r.settingFields.length;
    }, 0);
    expect(total, `satır=${total}`).toBeGreaterThanOrEqual(90);
  });

  it.each(flagCats.map((c) => [c.id, c] as const))(
    "§1 ⭐ %s: ekrandaki HER anahtar Kaydet gövdesine girer, fazlası girmez",
    async (_id, cat) => {
      renderWithProviders(<FeatureFlagSection {...rowsOf(cat)} superadminOnly={cat.superadminOnly} />);
      // Ham ayar satırı olan kategori önce `system-settings` listesini bekler (iskelet).
      await waitFor(() => expect(document.querySelector(".skeleton-shimmer")).toBeNull());
      const { patchKeys, rawKeys } = touchEverything(cat);
      fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
      if (patchKeys.length > 0) {
        await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
        const sent = Object.keys(update.mock.calls[0]![0] as object).sort();
        expect(sent, `${cat.id}: gövde`).toEqual([...new Set(patchKeys)].sort());
      } else {
        expect(update).not.toHaveBeenCalled();
      }
      if (rawKeys.length > 0) {
        await waitFor(() => expect(upsert).toHaveBeenCalledTimes(rawKeys.length));
        expect(upsert.mock.calls.map((c) => c[0]).sort()).toEqual([...rawKeys].sort());
      }
    },
  );

  it("§2 ⭐ tezgah alarmı (2026-10-11 vakası): anahtar açılıp kaydedilince gövde `tezgahAlarmEnabled:true` taşır", async () => {
    const cat = flagCats.find((c) => c.id === "tezgah")!;
    renderWithProviders(<FeatureFlagSection {...rowsOf(cat)} />);
    fireEvent.click(screen.getByRole("switch", { name: "Tezgah alarmı" }));
    fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ tezgahAlarmEnabled: true }));
  });

  it("§3 ⭐ sunucu yazmadıysa anahtar kayıttan sonra SUNUCUNUN değerine döner (panel 'açık' diye yalan söylemez)", async () => {
    const cat = flagCats.find((c) => c.id === "tezgah")!;
    server = { tezgahAlarmEnabled: false };
    update.mockResolvedValueOnce({ success: true, data: { tezgahAlarmEnabled: false } });
    renderWithProviders(<FeatureFlagSection {...rowsOf(cat)} />);
    const sw = screen.getByRole("switch", { name: "Tezgah alarmı" });
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("switch", { name: "Tezgah alarmı" })).toHaveAttribute("aria-checked", "false"));
  });

  it("§4 ⭐ cevapta HİÇ olmayan anahtar (sunucu tanımıyor) kullanıcıya satır başlığıyla söylenir", async () => {
    const cat = flagCats.find((c) => c.id === "tezgah")!;
    update.mockResolvedValueOnce({ success: true, data: { tezgahEnabled: true } });
    renderWithProviders(<FeatureFlagSection {...rowsOf(cat)} />);
    fireEvent.click(screen.getByRole("switch", { name: "Tezgah alarmı" }));
    fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0]![0]).toMatch(/tanımıyor.*Tezgah alarmı/);
  });

  it("unsavedFlagKeys: yalnız cevapta bulunmayan anahtar (değeri farklı dönen değil)", () => {
    expect(unsavedFlagKeys({ a: true, b: 1, c: null }, { a: false, c: null })).toEqual(["b"]);
  });
});
