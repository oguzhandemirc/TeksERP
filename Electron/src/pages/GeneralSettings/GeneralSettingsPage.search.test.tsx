// =============================================================================
// BEKÇİ — "ARAMA SÜZER, GEZİNMEZ" (davranış, saf fonksiyon değil)
// =============================================================================
// VAKA (2026-08-15): aktif sekme, arama ile SÜZÜLMÜŞ kategori listesinden
// çözülüyordu. Kullanıcı bir toggle'ı çevirip (taslak — Kaydet'e BASMADAN) sol
// raydaki arama kutusuna yazınca kendi kategorisi şeritten düşüyor, `active`
// başka bir sekmeye kayıyor, Radix eski `TabsContent`i UNMOUNT ediyor ve
// `FeatureFlagSection.flagDraft` (yerel `useState`) sessizce yok oluyordu.
//
// ⚠️ "Kaydedilmemiş değişiklik var" ONAYI BU YOLDA ÇALIŞMAZ ve çalışamaz: o
// onay Radix `onValueChange` ile, yani kullanıcı bir sekmeye TIKLADIĞINDA koşar;
// `value` prop'unun TÜRETİLMİŞ olarak değişmesi onu hiç çağırmaz. Yani sorun
// "uyarı çıkmıyor" değil, uyarının devreye girebileceği bir yol olmamasıydı.
//
// NEDEN BİLEŞEN TESTİ: kural saf katmanda da kilitli
// (`settings-groups.test.ts` → `resolveActiveSettingsCategory`), ama saf
// fonksiyon ÇAĞIRANIN yanlış listeyi geçmesini engelleyemez — hatanın tamamı
// zaten çağrı yerindeydi. Buradaki bekçi gerçek ekranı sürer.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { FeatureFlags } from "@/services/featureFlagService";
import { GeneralSettingsPage } from "./GeneralSettingsPage";

let permissions: string[] = ["admin:settings"];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    user: null,
    permissions,
    isAdmin: permissions.includes("admin:settings"),
    hasPermission: (p: string) => permissions.includes(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => permissions.includes(p)),
    hasAllPermissions: (ps: string[]) => ps.every((p) => permissions.includes(p)),
  }),
}));

// ⚠️ REJİM AÇIK verilir (`financeEnabled: true`): sonda kelimesi ("kdv") yalnız
// Muhasebe kategorisini eşleştiriyor ve o kategori fabrikada zaten gizli olurdu
// — kapalı rejimde şerit boşalır, aktif sekme de zaten değişmezdi, yani bekçi
// ölçmek istediği şeyi ölçemez (KÖR SONDA).
const flags = { productionEnabled: true, financeEnabled: true } as unknown as FeatureFlags;
vi.mock("@/hooks/usePricingEnabled", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/usePricingEnabled")>(
    "@/hooks/usePricingEnabled",
  );
  return {
    ...actual,
    FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
    useFeatureFlags: () => ({ data: { success: true, data: flags }, isLoading: false }),
  };
});
// Sayfa kabuğunun (PageHeader → favoriler/yoğunluk) provider bağımlılıkları —
// bu bekçinin konusu değil.
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
    reorderFavorites: vi.fn(),
  }),
}));
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }),
}));
vi.mock("@/services/systemSettingService", () => ({
  systemSettingService: { list: vi.fn().mockResolvedValue({ success: true, data: [] }), upsert: vi.fn() },
  SETTING_KEYS: {},
}));

const search = () => screen.getByPlaceholderText("Ayar ara…");
const type = (text: string) => fireEvent.change(search(), { target: { value: text } });
const DIRTY_BADGE = "• Kaydedilmemiş değişiklik";

describe("Genel Ayarlar — arama süzer, gezinmez", () => {
  beforeEach(() => {
    permissions = ["admin:settings"];
    // ⚠️ 2026-09-03: "Modüller" kategorisi artık `superadminOnly` — satıcı
    // (süperadmin) hesabı YOKSA fabrika yöneticisi yazmaya devam eder (emniyet
    // supabı). Bu bekçinin konusu ARAMA ↔ TASLAK ilişkisi; kilit ölçümü ayrı
    // dosyada (`FeatureFlagSection.superadmin.test.tsx`). Burada fabrikanın
    // BUGÜNKÜ hâli kurulur: sistem hesabı henüz doğmamış → toggle yazılabilir.
    useAuthStore.setState({ isSystemAccount: false, systemAccountExists: false });
  });

  /**
   * İlk sekme "Modüller"; oradaki üretim anahtarını çevirip taslak kirlet.
   *
   * ⚠️ Kutu BAŞLIK METNİNDEN bulunur, erişilebilir addan değil: `FlagToggle`
   * `<label>`ı `htmlFor`/`id` ile bağlamıyor ve sarmalayıcı etiketin metni
   * (başlık + özet + rozet) ad hesabına girmiyor — `getByRole("checkbox", {name})`
   * burada boş döner.
   */
  const makeDirty = () => {
    renderWithProviders(<GeneralSettingsPage />);
    const toggle = screen
      .getByText("Üretim modülünü aç")
      .closest("label")!
      .querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
    expect(screen.getByText(DIRTY_BADGE)).toBeInTheDocument();
    return toggle;
  };

  it("⭐ arama yazmak kaydedilmemiş taslağı SİLMEZ (sekme yerinde kalır)", () => {
    makeDirty();

    // "kdv" YALNIZ Muhasebe'yi eşleştirir — Modüller şeritten düşer.
    type("kdv");
    expect(screen.getByRole("tab", { name: /Muhasebe/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Modüller$/i })).not.toBeInTheDocument();

    // ...ama İÇERİK hâlâ Modüller ve taslak duruyor. Eski davranışta bu iki
    // satır kırmızıydı: bölüm unmount olur, başlık ve rozet birlikte kaybolurdu.
    // ⚠️ Satırın KENDİSİ görünmez, çünkü arama SÜZMEYE devam ediyor — "taslak
    // yaşıyor mu" sorusunun kanıtı rozet ve aramayı temizleyince dönen kutudur.
    expect(screen.getByRole("heading", { name: "Modüller" })).toBeInTheDocument();
    expect(screen.getByText(DIRTY_BADGE)).toBeInTheDocument();

    // Aramayı temizle → satır geri gelir ve TASLAK DEĞERİYLE gelir.
    // ⚠️ Kutu YENİDEN sorgulanır: `makeDirty`in döndürdüğü düğüm bölüm unmount
    // olsa bile koparılmış hâlde `checked=false` taşımaya devam eder, yani stale
    // ref ile bakan bir kontrol regresyonda da YEŞİL kalırdı (ölçüldü).
    fireEvent.click(screen.getByLabelText("Aramayı temizle"));
    expect(
      (
        screen
          .getByText("Üretim modülünü aç")
          .closest("label")!
          .querySelector("input[type=checkbox]") as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it("arama SÜZMEYE devam eder: eşleşmeyen aktif sekme satırlarını çizmez", () => {
    makeDirty();
    type("kdv");
    // Satırlar gizlenir ve bu SÖYLENİR — "dolu liste" yalanı yok.
    expect(screen.getByText("Bu bölümde arama ile eşleşen ayar yok.")).toBeInTheDocument();
    // Kaydet çubuğu taslak yüzünden DURUR (aksi halde değişiklik sessizce ölürdü).
    expect(screen.getByText(DIRTY_BADGE)).toBeInTheDocument();
  });

  it("hiç eşleşme yokken de aktif sekme ve taslak korunur", () => {
    const toggle = makeDirty();
    type("zzzyokboylebirsey");
    // İKİ AYRI cümle var ve karıştırılmamalı: şeritteki "…ile eşleşen ayar yok."
    // (hiç kategori kalmadı) ve içerikteki "Bu bölümde…" (aktif sekmede isabet
    // yok). İkincisi, sekmenin hâlâ ÇİZİLİYOR olduğunun kanıtı.
    expect(screen.getByText("Bu bölümde arama ile eşleşen ayar yok.")).toBeInTheDocument();
    expect(screen.getByText(/“zzzyokboylebirsey” ile eşleşen ayar yok/)).toBeInTheDocument();
    expect(toggle.checked).toBe(false);
    expect(screen.getByText(DIRTY_BADGE)).toBeInTheDocument();
  });

  it("aramayı temizlemek şeridi geri getirir, taslağa dokunmaz", () => {
    makeDirty();
    type("kdv");
    fireEvent.click(screen.getByLabelText("Aramayı temizle"));
    expect(screen.getByRole("tab", { name: /^Modüller$/i })).toBeInTheDocument();
    // ⚠️ DOM YENİDEN SORGULANIR, `makeDirty`in döndürdüğü düğüm KULLANILMAZ:
    // sekme unmount olsa o düğüm koparılmış (detached) hâlde `checked=false`
    // taşımaya devam eder ve kontrol regresyonda da YEŞİL kalırdı (bu bekçi
    // yazılırken negatif sondayla ölçüldü).
    const again = screen
      .getByText("Üretim modülünü aç")
      .closest("label")!
      .querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(again.checked).toBe(false);
    expect(screen.getByText(DIRTY_BADGE)).toBeInTheDocument();
  });

  // Sekme değiştirmenin TEK yolu tıklamaktır → onay kapısı tek kapı olarak kalır.
  it("sekmeye TIKLAMAK taslak varken onay sorar; iptal edilirse sekme değişmez", () => {
    const toggle = makeDirty();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Müşteriler/i }));
    fireEvent.click(screen.getByRole("tab", { name: /Müşteriler/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(toggle.checked).toBe(false);
    expect(screen.getByText(DIRTY_BADGE)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});

// =============================================================================
// REJİM — kategori kapısı (bölüm kapısı DEĞİL)
// =============================================================================
describe("Genel Ayarlar — rejim kapısı ekranda", () => {
  it("fabrikada (finance kapalı) Muhasebe gizlenir ama Depo & Satın Alma DURUR", () => {
    (flags as unknown as Record<string, boolean>).financeEnabled = false;
    try {
      renderWithProviders(<GeneralSettingsPage />);
      expect(screen.queryByRole("tab", { name: /^Muhasebe$/i })).not.toBeInTheDocument();
      // ⭐ Mal Kabul ekranı rejimsiz çalışıyor → ayarları da ulaşılabilir kalmalı.
      expect(screen.getByRole("tab", { name: /Depo & Satın Alma/i })).toBeInTheDocument();
      // Rejim anahtarlarının kendisi her zaman ulaşılabilir (geri açma yolu).
      expect(screen.getByRole("tab", { name: /^Modüller$/i })).toBeInTheDocument();
    } finally {
      (flags as unknown as Record<string, boolean>).financeEnabled = true;
    }
  });
});
