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
// ⚠️ 2026-09-04: bekçi "Genel Ayarlar" yerine ÖZELLİK ANAHTARLARI ekranını
// sürüyor. Sebep taşınma: davranış bayrakları o turda kendi yüzeyine ayrıldı
// (`SettingsSurface`) ve Genel Ayarlar'da artık TEK BİR flag satırı yok —
// ölçülen kural (arama ↔ taslak) bir flag toggle'ı gerektiriyor. Kabuk ikisinde
// de AYNI bileşendir (`SettingsSurfacePage`), yani kural her iki ekranda da
// kilitli kalıyor.
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
import { FeatureFlagsPage } from "./FeatureFlagsPage";

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
const flags = {
  productionEnabled: true,
  financeEnabled: true,
  // Kirletilecek satırın SUNUCU değeri — açık başlar ki tıklama onu kapatsın
  // (taslak ≠ sunucu olsun). Eksik bırakılırsa `?? false` ile zaten kapalı
  // gelir ve "taslak oluştu" ölçümü sahte yeşile düşerdi.
  customerBranchesEnabled: true,
} as unknown as FeatureFlags;
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
  // "Modüller" sekmesinde artık ayar şifresi kartı da var; kart yalnız satıcı
  // hesabında çizilir (bu testte kimlik fabrika yöneticisi) ama modül SEVİYESİNDE
  // import edilir → mock eksik export'ta patlar.
  settingsPasswordAdminService: { status: vi.fn(), set: vi.fn(), revoke: vi.fn() },
  SETTINGS_PASSWORD_MIN_LENGTH: 8,
  SETTINGS_PASSWORD_MAX_LENGTH: 72,
  SETTINGS_PASSWORD_CHARSET: /^[\x21-\x7E]+$/,
}));

const search = () => screen.getByPlaceholderText("Ayar ara…");
const type = (text: string) => fireEvent.change(search(), { target: { value: text } });
const DIRTY_BADGE = "• Kaydedilmemiş değişiklik";

describe("Özellik Anahtarları — arama süzer, gezinmez", () => {
  beforeEach(() => {
    permissions = ["admin:settings"];
    // Bu ekranda satıcı kilidi YOK (davranış bayrakları fabrikanındır); kimlik
    // yine de kurulur, çünkü `FeatureFlagSection` onu her satırda okuyor.
    useAuthStore.setState({ isSystemAccount: false, systemAccountExists: true });
  });

  /**
   * İlk sekme "Müşteriler"; oradaki şube anahtarını çevirip taslak kirlet.
   * Anahtar iOS `Switch` (`role="switch"`, `aria-label` = başlık, 2026-09-22) — erişilebilir
   * adla bulunur, durum `aria-checked`ten okunur.
   */
  const subeAnahtari = () => screen.getByRole("switch", { name: "Müşteri şubeleri (sevk noktaları) özelliğini göster" });
  const acik = (el: HTMLElement) => el.getAttribute("aria-checked") === "true";
  const makeDirty = () => {
    renderWithProviders(<FeatureFlagsPage />);
    const toggle = subeAnahtari();
    expect(acik(toggle)).toBe(true);
    fireEvent.click(toggle);
    expect(acik(toggle)).toBe(false);
    expect(screen.getByText(DIRTY_BADGE)).toBeInTheDocument();
    return toggle;
  };

  it("⭐ arama yazmak kaydedilmemiş taslağı SİLMEZ (sekme yerinde kalır)", () => {
    makeDirty();

    // "kdv" YALNIZ Muhasebe'yi eşleştirir — Modüller şeritten düşer.
    type("kdv");
    expect(screen.getByRole("tab", { name: /Muhasebe/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Müşteriler$/i })).not.toBeInTheDocument();

    // ...ama İÇERİK hâlâ Modüller ve taslak duruyor. Eski davranışta bu iki
    // satır kırmızıydı: bölüm unmount olur, başlık ve rozet birlikte kaybolurdu.
    // ⚠️ Satırın KENDİSİ görünmez, çünkü arama SÜZMEYE devam ediyor — "taslak
    // yaşıyor mu" sorusunun kanıtı rozet ve aramayı temizleyince dönen kutudur.
    expect(screen.getByRole("heading", { name: "Müşteriler" })).toBeInTheDocument();
    expect(screen.getByText(DIRTY_BADGE)).toBeInTheDocument();

    // Aramayı temizle → satır geri gelir ve TASLAK DEĞERİYLE gelir.
    // ⚠️ Kutu YENİDEN sorgulanır: `makeDirty`in döndürdüğü düğüm bölüm unmount
    // olsa bile koparılmış hâlde `checked=false` taşımaya devam eder, yani stale
    // ref ile bakan bir kontrol regresyonda da YEŞİL kalırdı (ölçüldü).
    fireEvent.click(screen.getByLabelText("Aramayı temizle"));
    expect(
      acik(subeAnahtari()),
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
    expect(acik(toggle)).toBe(false);
    expect(screen.getByText(DIRTY_BADGE)).toBeInTheDocument();
  });

  it("aramayı temizlemek şeridi geri getirir, taslağa dokunmaz", () => {
    makeDirty();
    type("kdv");
    fireEvent.click(screen.getByLabelText("Aramayı temizle"));
    expect(screen.getByRole("tab", { name: /^Müşteriler$/i })).toBeInTheDocument();
    // ⚠️ DOM YENİDEN SORGULANIR, `makeDirty`in döndürdüğü düğüm KULLANILMAZ:
    // sekme unmount olsa o düğüm koparılmış (detached) hâlde `checked=false`
    // taşımaya devam eder ve kontrol regresyonda da YEŞİL kalırdı (bu bekçi
    // yazılırken negatif sondayla ölçüldü).
    const again = subeAnahtari();
    expect(acik(again)).toBe(false);
    expect(screen.getByText(DIRTY_BADGE)).toBeInTheDocument();
  });

  // Sekme değiştirmenin TEK yolu tıklamaktır → onay kapısı tek kapı olarak kalır.
  //
  // ⚠️ ONAY ARTIK `window.confirm` DEĞİL (2026-09-07): işletim sisteminin kendi
  // penceresi açılıyordu ("Adnan Şahin ERP" başlıklı Windows kutusu) ve saha
  // turunda "bizim uyarımız olmalı" diye bildirildi.
  //
  // ⚠️ TEK TEST, İKİ İDDİA — bilerek birleştirildi: bu dosyada render'lar test
  // arasında sökülmüyor (`makeDirty` her testte yeniden çiziyor) ve Radix
  // diyaloğu AÇILDIĞINDA arkadaki her şeyi `aria-hidden` yapıyor. İkinci bir
  // diyalog açan test yazılsaydı, bir öncekinin açık kalan diyaloğu sekmeleri
  // erişilemez kılar ve bekçi konusuyla ilgisiz bir sebeple kırmızı verirdi.
  it("sekmeye TIKLAMAK taslak varken UYGULAMA İÇİ onay sorar; iptalde sekme değişmez", () => {
    const toggle = makeDirty();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    // ⚠️ SEKME BİR KEZ YAKALANIR: `mouseDown` Radix'te sekme değişimini ZATEN
    // tetikliyor ve diyalog açılınca arkadaki her şey `aria-hidden` oluyor —
    // ikinci `getByRole("tab")` o yüzden "bulunamadı" derdi. Eski `window.confirm`
    // senkron olup DOM'a dokunmadığı için bu tuzak görünmüyordu.
    const sekme = screen.getByRole("tab", { name: /^Siparişler$/i });
    fireEvent.mouseDown(sekme);
    fireEvent.click(sekme);

    // ⭐ İşletim sistemi penceresi HİÇ açılmaz — bildirilen şikâyet buydu.
    expect(confirmSpy).not.toHaveBeenCalled();
    // Bizim diyaloğumuz açıldı.
    expect(screen.getByRole("button", { name: /Geç, kaydetme/i })).toBeInTheDocument();

    // Vazgeç → sekme değişmedi, taslak duruyor.
    fireEvent.click(screen.getByRole("button", { name: /^Vazgeç$/i }));
    expect(acik(toggle)).toBe(false);
    expect(screen.getByText(DIRTY_BADGE)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});

// =============================================================================
// REJİM — kategori kapısı (bölüm kapısı DEĞİL)
// =============================================================================
describe("Özellik Anahtarları — rejim kapısı ekranda", () => {
  it("fabrikada (finance kapalı) Muhasebe gizlenir ama Mal Kabul & Alış DURUR", () => {
    (flags as unknown as Record<string, boolean>).financeEnabled = false;
    try {
      renderWithProviders(<FeatureFlagsPage />);
      expect(screen.queryByRole("tab", { name: /^Muhasebe$/i })).not.toBeInTheDocument();
      // ⭐ 2026-09-04 — KURAL DEĞİŞTİ: "Mal Kabul & Alış" ve "İplik" sekmeleri
      // artık ÖN MUHASEBE rejimi yüzünden değil, KENDİ MODÜLLERİ (ticaret ·
      // iplik) bu kurulumda kapalı olduğu için çizilmiyor. Bu mock'ta ikisi de
      // tanımsız → kapalı. Modüller parayla satılıyor; satılmamış modülün
      // bayrağı fabrika yöneticisine "zaten içinde varmış" diye okunuyordu.
      // Geri dönüş yolu KAPANMADI: anahtarlar Sistem → Modüller ekranında ve
      // satıcı görünümünde satırlar çizilmeye devam ediyor
      // (`flag-modules.test.ts` ikisini de ölçer).
      expect(screen.queryByRole("tab", { name: /Mal Kabul & Alış/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: /^İplik$/i })).not.toBeInTheDocument();
      // Rejim anahtarlarının kendisi her zaman ulaşılabilir (geri açma yolu).
      expect(screen.getByRole("tab", { name: /^Müşteriler$/i })).toBeInTheDocument();
    } finally {
      (flags as unknown as Record<string, boolean>).financeEnabled = true;
    }
  });
});
