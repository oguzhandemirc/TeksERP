// =============================================================================
// BEKÇİ — KAPALI MODÜLÜN BAYRAĞI ÇİZİLMEZ (2026-09-04)
// =============================================================================
// KURAL: fabrikada KAPALI olan bir modülün ayar satırları Özellik Anahtarları
// ekranında HİÇ çizilmez; kategoriden geriye satır kalmazsa sekme de çizilmez.
// Gerekçe ticari: modüller parayla satılıyor, satılmamış modülün bayrağı
// fabrika sahibine "bu modül zaten içinde varmış" diye okunuyordu.
//
// ⚠️ BU BİR GÖRÜNÜRLÜK KURALIDIR, YETKİ DEĞİL. Backend kapıları
// (`requireXEnabled`, `flagWriteGuard`) bu turda hiç değişmedi; buradaki hiçbir
// kontrol onların yerine geçmez.
//
// ÖLÇÜLENLER:
//   §1 ZEMİN — tablo ve kategori ayrıştırması gerçekten dolu (vakumen yeşil yok)
//   §2 ⭐ TAMLIK — ekranda çizilen HER satırın tabloda bir sahibi var
//   §3 ⭐ MODÜL ŞALTERİ KENDİNİ GİZLEYEMEZ (yedi anahtar `cekirdek`)
//   §4 ⭐ `moduleKey` taşıyan kategorinin TÜM satırları o modüle ait
//   §5 ⭐ Modül kapalı → kategori düşer (iplik · ticaret · üretim)
//   §6 ⭐ Çekirdek kategori TÜM modüller kapalıyken bile durur
//   §7 ⭐ SATICI görünümü hiçbir şeyi gizlemez (geri dönüş yolu)
//   §8 ⭐ KARMA kategori: yalnız modüle ait satırlar düşer, kategori durur
//   §9 ⭐ `planlanan:*` (fason · kartela) hiçbir modül durumunda gizlenmez
//   §10 Bilinmeyen anahtarda FAIL-OPEN (gizlemek ayarı ulaşılamaz yapardı)
//   §11 ⭐ Değer sözlüğü kapalı — her sahip ya çekirdek, ya planlanan, ya da
//       `SettingsModuleState`in ÇÖZDÜĞÜ bir anahtar (yazım hatası = sessiz
//       `undefined` → `!undefined` → satır yanlışlıkla görünür/gizlenir)
//
// NEGATİF SONDA (üçü de koşuldu, dosyalar birebir geri alındı):
//   ① `isSettingRowModuleVisible` gövdesi `return true` → 3 kırmızı (§5 · §5b · §8)
//   ② `isCategoryModuleVisible`ın `kind !== "flags"` süzgeci kaldırıldı → 2
//      kırmızı (§6 · §7 — satır listesi taşımayan kategoriler "boş" sayılıp yok
//      oluyor)
//   ③ DERLEME KAPISI: `FLAG_MODULE`den bir satır silindi → `tsc` TS2741,
//      eksik anahtarı ADIYLA söyler ("Property 'kk1OnlineOnlyEnabled' is
//      missing"). Tablonun tamlığı bu yüzden teste değil derleyiciye bağlı.
// =============================================================================
import { describe, it, expect } from "vitest";
import { MODULE_FLAG_KEYS } from "@/lib/module-flags";
import { FLAG_MODULE, flagOwnerModule } from "./flag-modules";
import { SETTINGS_CATEGORIES, type SettingsCategory } from "./settings-config";
import {
  filterCategoryByModules,
  isCategoryModuleVisible,
  isSettingRowModuleVisible,
  resolveSettingsModuleState,
  type SettingsModuleState,
} from "./settings-groups";

/** Kategorinin ekranda çizilen TÜM satır anahtarları (dört liste tek küme). */
function rowKeys(cat: SettingsCategory): string[] {
  return [
    ...(cat.flags ?? []).map((f) => f.key as string),
    ...(cat.numberFlags ?? []).map((f) => f.key as string),
    ...(cat.enumFlags ?? []).map((f) => f.enumKey as string),
    ...(cat.settingFields ?? []).map((f) => f.key as string),
  ];
}

const HEPSI_ACIK: SettingsModuleState = {
  productionEnabled: true,
  financeEnabled: true,
  ticaretEnabled: true,
  iplikEnabled: true,
  depoMultiEnabled: true,
  devereEnabled: true,
};
const HEPSI_KAPALI: SettingsModuleState = {
  productionEnabled: false,
  financeEnabled: false,
  ticaretEnabled: false,
  iplikEnabled: false,
  depoMultiEnabled: false,
  devereEnabled: false,
};
/** Fabrika görünümü — satıcı değil (varsayılan oturum). */
const FABRIKA = false;
const SATICI = true;

const cat = (id: string): SettingsCategory => {
  const found = SETTINGS_CATEGORIES.find((c) => c.id === id);
  if (!found) throw new Error(`kategori yok: ${id}`);
  return found;
};

describe("modül aidiyeti — kapalı modülün bayrağı çizilmez", () => {
  // §1 — ZEMİN. Ayrıştırma bozulursa aşağıdaki her kontrol VAKUMEN yeşil kalır.
  it("§1 zemin: tablo dolu ve kategoriler satır taşıyor", () => {
    expect(Object.keys(FLAG_MODULE).length).toBeGreaterThanOrEqual(60);
    const flagCats = SETTINGS_CATEGORIES.filter((c) => c.kind === "flags");
    expect(flagCats.length).toBeGreaterThanOrEqual(8);
    expect(flagCats.reduce((n, c) => n + rowKeys(c).length, 0)).toBeGreaterThanOrEqual(30);
    // Gizlenebilir sahibi olan en az bir satır olmalı — yoksa kural ölü.
    expect(Object.values(FLAG_MODULE).filter((o) => o !== "cekirdek").length).toBeGreaterThanOrEqual(
      20,
    );
  });

  // §2 — TAMLIK. Derleyici `Record`u zaten zorluyor, ama `settingFields` başka
  // bir birlikten (`SystemSettingKey`) geliyor ve panele YENİ bir ham ayar satırı
  // eklenmesi tabloyu atlayabilirdi. Sahipsiz satır = sessizce hep görünür.
  it("§2 ⭐ ekranda çizilen HER satırın tabloda sahibi var", () => {
    const eksik: string[] = [];
    for (const c of SETTINGS_CATEGORIES) {
      for (const k of rowKeys(c)) {
        if (!(k in FLAG_MODULE)) eksik.push(`${c.id}/${k}`);
      }
    }
    expect(eksik).toEqual([]);
  });

  // §3 — Bir şalter kendi modülüne ait sayılırsa kapatıldığı an satırını gizler
  // ve bir daha AÇILAMAZ. (Bugün satıcı ekranında yaşıyorlar; kural o taşımadan
  // BAĞIMSIZ olarak dursun diye ölçülüyor.)
  it("§3 ⭐ modül şalterlerinin kendisi ASLA gizlenemez", () => {
    for (const k of MODULE_FLAG_KEYS) {
      expect(FLAG_MODULE[k], k).toBe("cekirdek");
      expect(isSettingRowModuleVisible(k, HEPSI_KAPALI, FABRIKA), k).toBe(true);
    }
  });

  // §4 — Kategori kilidi (bant + salt-okunur) ile satır aidiyeti AYRIŞMAMALI:
  // ayrışırsa bant "Ticaret kapalı" derken kategoride üretim satırı durur.
  it("§4 ⭐ moduleKey taşıyan kategorinin TÜM satırları o modüle ait", () => {
    const kilitli = SETTINGS_CATEGORIES.filter((c) => c.moduleKey);
    expect(kilitli.length).toBeGreaterThanOrEqual(3); // zemin
    for (const c of kilitli) {
      for (const k of rowKeys(c)) {
        expect(flagOwnerModule(k), `${c.id}/${k}`).toBe(c.moduleKey);
      }
    }
  });

  // §5 — Kullanıcının bildirdiği vaka: iplik kapalıyken İplik sekmesi duruyordu.
  it("§5 ⭐ modül kapalı → kategori ÇİZİLMEZ", () => {
    const iplikKapali = { ...HEPSI_ACIK, iplikEnabled: false };
    expect(isCategoryModuleVisible(cat("yarn"), HEPSI_ACIK, FABRIKA)).toBe(true);
    expect(isCategoryModuleVisible(cat("yarn"), iplikKapali, FABRIKA)).toBe(false);

    const ticaretKapali = { ...HEPSI_ACIK, ticaretEnabled: false };
    expect(isCategoryModuleVisible(cat("warehouse"), ticaretKapali, FABRIKA)).toBe(false);

    const uretimKapali = { ...HEPSI_ACIK, productionEnabled: false };
    expect(isCategoryModuleVisible(cat("work-orders"), uretimKapali, FABRIKA)).toBe(false);
  });

  // §5b — Bağımlılık zinciri TEK yerde çözülür: ticaret kapalıyken iplik "açık"
  // yazsa bile ETKİN değer kapalıdır (`resolveSettingsModuleState`). Ham değer
  // okunsaydı kurulum "iplik açık" diye sekmeyi çizerdi, backend 403 verirdi.
  it("§5b ⭐ ticaret kapalıyken iplik sekmesi de düşer (etkin değer)", () => {
    const modules = resolveSettingsModuleState({ ticaretEnabled: false, iplikEnabled: true });
    expect(isCategoryModuleVisible(cat("yarn"), modules, FABRIKA)).toBe(false);
  });

  // §6 — Çekirdek asla satılmaz: hiçbir modül açık olmasa da görünür.
  it("§6 ⭐ çekirdek kategoriler TÜM modüller kapalıyken bile çizilir", () => {
    for (const id of ["customers", "shipping"]) {
      expect(isCategoryModuleVisible(cat(id), HEPSI_KAPALI, FABRIKA), id).toBe(true);
    }
    // Satır listesi taşımayan kategoriler (cihaz/oturum/şirket/etiket) "boş"
    // sayılıp yok olmamalı — `kind` süzgecinin negatif sondası.
    for (const c of SETTINGS_CATEGORIES.filter((x) => x.kind !== "flags")) {
      expect(isCategoryModuleVisible(c, HEPSI_KAPALI, FABRIKA), c.id).toBe(true);
    }
  });

  // §7 — GERİ DÖNÜŞ YOLU. Satıcı görünümünde hiçbir satır gizlenmez; kapalı
  // modülün ayarı orada salt-okunur + bantlı çizilir. Bu ayak düşerse kapalı
  // modülün değeri HİÇBİR yüzeyde okunamaz hâle gelir.
  it("§7 ⭐ satıcı görünümü hiçbir satırı/kategoriyi gizlemez", () => {
    for (const c of SETTINGS_CATEGORIES) {
      expect(isCategoryModuleVisible(c, HEPSI_KAPALI, SATICI), c.id).toBe(true);
      const rows = filterCategoryByModules(c, HEPSI_KAPALI, SATICI);
      expect(rows.rowCount, c.id).toBe(rowKeys(c).length);
    }
    // Modül anahtarlarının EVİ (satıcı ekranı) her koşulda tam çizilir.
    expect(filterCategoryByModules(cat("modules"), HEPSI_KAPALI, FABRIKA).rowCount).toBe(
      rowKeys(cat("modules")).length,
    );
  });

  // §8 — KARMA kategori gerçek: "Üretim — Saha" sekmesinin KK1/Tambur satırları
  // üretime, Fason satırları henüz anahtarı olmayan `planlanan:fason`a ait.
  // Kategori düzeyinde karar verilseydi ya hepsi kaybolur ya hiçbiri.
  it("§8 ⭐ karma kategoride yalnız modüle ait satırlar düşer", () => {
    const c = cat("production");
    const uretimKapali = { ...HEPSI_ACIK, productionEnabled: false };
    const acik = filterCategoryByModules(c, HEPSI_ACIK, FABRIKA);
    const kapali = filterCategoryByModules(c, uretimKapali, FABRIKA);
    expect(acik.rowCount).toBe(rowKeys(c).length);
    expect(kapali.rowCount).toBeGreaterThan(0); // fason satırları kaldı
    expect(kapali.rowCount).toBeLessThan(acik.rowCount);
    expect(kapali.flags.map((f) => f.key)).not.toContain("kk1DuplicateGuardEnabled");
    expect(kapali.flags.map((f) => f.key)).toContain("fasonShrinkWarnEnabled");
    // Satırı kalan kategori ÇİZİLİR — çekirdek/planlanan satırlar ulaşılabilir kalır.
    expect(isCategoryModuleVisible(c, uretimKapali, FABRIKA)).toBe(true);
  });

  // §9 — `planlanan:*` bir yer tutucu değil BİLGİdir: anahtarı olmayan modülün
  // satırı gizlenemez (gizleyecek bayrak yok). Anahtar doğduğu gün bu kontrol,
  // taşımanın yapıldığını görünür kılar.
  it("§9 ⭐ planlanan modüller (fason · kartela) hiçbir durumda gizlenmez", () => {
    const planlanan = Object.entries(FLAG_MODULE)
      .filter(([, o]) => o.startsWith("planlanan:"))
      .map(([k]) => k);
    expect(planlanan.length).toBeGreaterThanOrEqual(4); // zemin
    for (const k of planlanan) {
      expect(flagOwnerModule(k), k).toBeNull();
      expect(isSettingRowModuleVisible(k, HEPSI_KAPALI, FABRIKA), k).toBe(true);
    }
    expect(isCategoryModuleVisible(cat("kartela"), HEPSI_KAPALI, FABRIKA)).toBe(true);
  });

  // §10 — Yön bilinçli: tanınmayan anahtarı GİZLEMEK, çalışan bir davranışın
  // ayarını hiçbir ekranda bırakmamak demektir ("açtım, kapatamıyorum").
  it("§10 bilinmeyen anahtar FAIL-OPEN (gizlenmez)", () => {
    expect(flagOwnerModule("boyleBirAyarYok")).toBeNull();
    expect(isSettingRowModuleVisible("boyleBirAyarYok", HEPSI_KAPALI, FABRIKA)).toBe(true);
  });

  // §11 — Değer sözlüğü kapalı. Yazım hatası (`iplikEnabled` → `iplikEnabled2`)
  // TS tarafından yakalanır, ama `SettingsModuleState`in ÇÖZMEDİĞİ bir anahtar
  // (yer tutucu modüller) runtime'da `undefined` okunur ve satır SESSİZCE
  // gizlenirdi.
  it("§11 ⭐ her sahip çözülebilir: cekirdek | planlanan:* | modül durumu anahtarı", () => {
    const cozulen = Object.keys(HEPSI_ACIK);
    for (const [k, owner] of Object.entries(FLAG_MODULE)) {
      const ok = owner === "cekirdek" || owner.startsWith("planlanan:") || cozulen.includes(owner);
      expect(ok, `${k} → ${owner}`).toBe(true);
    }
  });
});
