// =============================================================================
// BEKÇİ — "BU BİLGİSAYAR" RAYA TAŞINDI (iç içe sekme YOK)
// =============================================================================
// İSTEK (kullanıcının kendi cümleleri, 2026-09-04): "bu bilgisayardaki yazıcı,
// kantar, sunucu vb bunları ayır. bir menü altında ayrı sekmeler olmasın. genel
// ayarlar içinde yandaki menüde yapabilirsin."
//
// ÖNCESİ: tek kategori (`id: "system"`, `kind: "workstation"`) ve içinde dört
// alt sekme (`WorkstationTabs`). Bunun üç ölçülebilir bedeli vardı:
//   ① ADRESSİZ ALT SEÇİM — `?tab=system` hangi cihazı açacağını söylemiyordu;
//      palet/derin bağlantı "Yazıcı"ya gidemiyordu.
//   ② İKİ KİRLİ-TASLAK GUARD'I — iç sekme kendi `SettingsDirtyProvider`ını
//      kurup üste de iletiyordu; aynı onay iki katmanda yaşıyordu.
//   ③ İKİ GEZİNME YÜZEYİ — sol ray zaten bir menü; ikinci bir şerit onu tekrar
//      ediyordu.
//
// BU DOSYANIN KAPATTIĞI ARIZA SINIFLARI:
//   §1 yerleşim — dört kategori, dört `kind`, tek bölüm; `workstation` kindi
//      geri gelirse (kopyala-yapıştır) kırmızı.
//   §2 İZİN HİZASI — dördü de `settings:workstation` taşımak ZORUNDA (biri
//      unutulursa yerel donanımını kuran personel o sekmeyi göremez) ve bu izin
//      bölüm DIŞINA sızamaz (sızarsa dar izin sistem-geneli bir ayarı açar).
//   §3 ORTAM KAPISI — "Sunucu Adresi" web'de çizilmez; kapı sayfa İLE paletin
//      ORTAK yükleminde (`visibleSettingsCategories`) olmak zorunda.
//   §4 SESSİZ DÜŞÜŞ — eski `?tab=system` yer imi "Yazıcı"ya yönlenir; takma ad
//      hedefi katalogda gerçekten var.
//   §5 ÇİZİM DALI — katalogdaki HER `kind` için kabukta bir dal var (yeni
//      kategori eklenip dalı unutulursa sekme AÇILIR AMA BOŞ kalır: derleme
//      düşmez, hiçbir test kırmızı olmaz).
//
// ⚠️ KÖRLÜK ZEMİNİ ÖNCE: bir refactor bölümü boşaltırsa "ihlal yok" ile
// "hiçbir şeye bakmadım" aynı yeşile çıkardı.
//
// NEGATİF SONDA (koşuldu, hepsi geri alındı):
//   • `server` kategorisinden `desktopOnly` düşürüldü → §3 kırmızı (2).
//   • `scanner`dan `permissionAny` düşürüldü → §2 kırmızı (2).
//   • `SETTINGS_TAB_ALIASES` boşaltıldı → §4 kırmızı (1).
//   • Kabuktaki `cat.kind === "scale"` dalı silindi → §5 kırmızı (1).
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SETTINGS_ADMIN_PERMISSION,
  SETTINGS_CATEGORIES,
  SETTINGS_TAB_ALIASES,
  WORKSTATION_PERMISSION,
  WORKSTATION_SECTION,
  categorySurface,
  settingsCategoryPath,
  visibleSettingsCategories,
  workstationEntryPath,
} from "./settings-config";
import {
  groupSettingsCategories,
  resolveActiveSettingsCategory,
  resolveSettingsRegime,
} from "./settings-groups";

const SHELL_SRC = readFileSync(resolve(__dirname, "SettingsSurfacePage.tsx"), "utf8");
const HUB_SRC = readFileSync(resolve(__dirname, "../Settings/SettingsPage.tsx"), "utf8");

const REGIME = resolveSettingsRegime(undefined);
const local = () => SETTINGS_CATEGORIES.filter((c) => c.section === WORKSTATION_SECTION);

/** Yalnız `settings:workstation` taşıyan personel. */
const NARROW = (perms: string[]) => perms.includes(WORKSTATION_PERMISSION);
/** Tam yetkili. */
const ALL = () => true;

describe("§0 körlük zemini", () => {
  it("bölüm DOLU ve kategoriler okunabildi", () => {
    expect(local().length).toBe(4);
    expect(SHELL_SRC.length).toBeGreaterThan(2000);
    expect(HUB_SRC.length).toBeGreaterThan(2000);
  });
});

describe("§1 yerleşim — dört kategori, iç içe sekme yok", () => {
  it("⭐ 'Bu Bilgisayar' bölümü tam olarak dört yerel kategori", () => {
    expect(local().map((c) => c.id)).toEqual(["printer", "scale", "scanner", "server"]);
  });

  it("⭐ her kategorinin KENDİ `kind`i var (tek gövde + alt sekme değil)", () => {
    const kinds = local().map((c) => c.kind);
    expect(kinds).toEqual(["printer", "scale", "scanner", "server"]);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("⭐ `workstation` KİNDİ katalogdan tamamen kalktı", () => {
    expect(SETTINGS_CATEGORIES.map((c) => c.kind)).not.toContain("workstation");
    // Kabuk da iç içe sekme kabuğunu ÇİZMİYOR. ⚠️ Düz metin araması yapılmaz:
    // dosyada kararın gerekçesini anlatan bir YORUM var ve tarihçeyi silmek
    // pahasına yeşil kalmak istemiyoruz — ölçülen şey import ve JSX kullanımı.
    expect(SHELL_SRC).not.toContain('from "./WorkstationTabs"');
    expect(SHELL_SRC).not.toContain("<WorkstationTabs");
  });

  it("dördü de kendi ekranında — Bu Bilgisayar (Özellik Anahtarları'na kaymadı)", () => {
    for (const c of local()) expect(categorySurface(c), c.id).toBe("workstation");
  });

  it("dar izinli personelin rayı TEK bölüm — seçilecek başka başlık yok", () => {
    const groups = groupSettingsCategories(
      visibleSettingsCategories(NARROW, "workstation", true),
      REGIME,
    );
    expect(groups.map((g) => g.section.id)).toEqual([WORKSTATION_SECTION]);
    expect(groups[0]?.categories.map((c) => c.id)).toEqual([
      "printer",
      "scale",
      "scanner",
      "server",
    ]);
  });
});

describe("§2 izin hizası — dar izin bölümün İÇİNDE kalır", () => {
  it("⭐ dördü de `admin:settings` ∨ `settings:workstation` taşıyor", () => {
    for (const c of local()) {
      expect(c.permissionAny, c.id).toEqual([SETTINGS_ADMIN_PERMISSION, WORKSTATION_PERMISSION]);
    }
  });

  it("⭐ `settings:workstation` bölüm DIŞINA sızmadı", () => {
    const sizan = SETTINGS_CATEGORIES.filter(
      (c) => c.section !== WORKSTATION_SECTION && (c.permissionAny ?? []).includes(WORKSTATION_PERMISSION),
    );
    expect(sizan.map((c) => c.id)).toEqual([]);
  });

  it("⭐ dar izinli personel sistem-geneli HİÇBİR kategoriyi görmüyor", () => {
    const ids = visibleSettingsCategories(NARROW, undefined, true).map((c) => c.id);
    expect(ids).toEqual(["printer", "scale", "scanner", "server"]);
  });

  it("`admin:settings` dördünü DE görmeye devam ediyor (daralma yok)", () => {
    const ids = visibleSettingsCategories(
      (p) => p.includes(SETTINGS_ADMIN_PERMISSION),
      "workstation",
      true,
    ).map((c) => c.id);
    for (const c of local()) expect(ids, c.id).toContain(c.id);
  });
});

describe("§3 ortam kapısı — sunucu adresi yalnız masaüstünde", () => {
  it("⭐ web'de 'Sunucu Adresi' çizilmez", () => {
    const web = visibleSettingsCategories(ALL, "workstation", false).map((c) => c.id);
    expect(web).not.toContain("server");
  });

  it("⭐ masaüstünde çizilir ve DÜŞEN TEK ŞEY odur", () => {
    const desktop = visibleSettingsCategories(ALL, "workstation", true).map((c) => c.id);
    const web = visibleSettingsCategories(ALL, "workstation", false).map((c) => c.id);
    expect(desktop).toContain("server");
    expect(desktop.filter((id) => !web.includes(id))).toEqual(["server"]);
  });

  it("donanım kategorileri ortam kapısı TAŞIMAZ (kendi mesajlarını basarlar)", () => {
    for (const id of ["printer", "scale", "scanner"]) {
      expect(SETTINGS_CATEGORIES.find((c) => c.id === id)?.desktopOnly, id).toBeUndefined();
    }
  });

  it("kapı ORTAK yüklemde — palet de aynı listeyi görür", () => {
    // `visibleSettingsCategories` sayfanın da paletin de tek kaynağı; ayrı bir
    // sayfa-içi süzgeç olsaydı palet web'de ölü bir girişi göstermeye devam ederdi.
    expect(visibleSettingsCategories(ALL, undefined, false).map((c) => c.id)).not.toContain(
      "server",
    );
  });
});

describe("§4 sessiz düşüş — eski `?tab=system` yer imi", () => {
  // Tüm kategoriler: "Bu Bilgisayar" ekranında yazıcı zaten ilk sekme olduğundan
  // orada ölçmek takma adı SINAMAZDI.
  const cats = visibleSettingsCategories(ALL, undefined, true);

  it("⭐ eski kimlik 'Yazıcı'ya yönlenir (ilk sekmeye DÜŞMEZ)", () => {
    expect(resolveActiveSettingsCategory(cats, "system")).toBe("printer");
    // Körlük zemini: yönlendirme olmasaydı listenin ilk sekmesine düşerdi.
    expect(cats[0]?.id).not.toBe("printer");
  });

  it("⭐ her takma adın hedefi katalogda GERÇEKTEN var", () => {
    const ids = new Set(SETTINGS_CATEGORIES.map((c) => c.id));
    for (const [from, to] of Object.entries(SETTINGS_TAB_ALIASES)) {
      expect(ids.has(to), `${from} → ${to}`).toBe(true);
      // Eski kimlik yeniden bir kategoriye verilirse takma ad onu gölgelerdi.
      expect(ids.has(from), `${from} hâlâ katalogda`).toBe(false);
    }
  });

  it("hedef GÖRÜNMÜYORSA takma ad zorlamaz (boş ekran yerine normal düşüş)", () => {
    const withoutPrinter = cats.filter((c) => c.id !== "printer");
    expect(resolveActiveSettingsCategory(withoutPrinter, "system")).toBe(withoutPrinter[0]?.id);
  });

  it("bilinmeyen parametre eskisi gibi ilk sekmeye düşer", () => {
    expect(resolveActiveSettingsCategory(cats, "yok-boyle-bir-sey")).toBe(cats[0]?.id);
  });
});

describe("§5 çizim dalı — katalogdaki her `kind` kabukta çiziliyor", () => {
  it("⭐ her `kind` için kabukta bir dal var", () => {
    const kinds = [...new Set(SETTINGS_CATEGORIES.map((c) => c.kind))];
    expect(kinds.length).toBeGreaterThan(4);
    for (const k of kinds) {
      expect(SHELL_SRC.includes(`cat.kind === "${k}"`), k).toBe(true);
    }
  });

  it("⭐ dört yerel bölüm bileşeni kabuğa DOĞRUDAN bağlı", () => {
    for (const comp of [
      "LabelPrinterDeviceSettings",
      "ScaleDeviceSettings",
      "ScannerSettingsSection",
      "ApiEndpointSection",
    ]) {
      expect(SHELL_SRC.includes(`<${comp} />`), comp).toBe(true);
    }
  });
});

describe("§6 hub kartı — adres tek kaynaktan", () => {
  it("⭐ 'Bu Bilgisayar' kartı elle `?tab=` yazmıyor", () => {
    expect(HUB_SRC).not.toContain("?tab=");
    expect(HUB_SRC).toContain("workstationEntryPath()");
  });

  it("⭐ giriş adresi bölümün İLK kategorisinin gerçek adresi", () => {
    expect(workstationEntryPath()).toBe(settingsCategoryPath(local()[0]!));
    expect(workstationEntryPath()).toBe("/system/workstation?tab=printer");
  });
});
