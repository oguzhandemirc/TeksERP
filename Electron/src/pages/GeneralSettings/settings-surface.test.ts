// =============================================================================
// BEKÇİ — AYARLARIN YÜZEYLERİ (2026-09-04 kullanıcı kararı; 2026-09-24'te
// "Genel Ayarlar" üç ekrana bölündü ve her kategori kendi iznini aldı — §6)
// =============================================================================
// İSTEK (kullanıcının kendi cümleleri): "modül flaglarını ayrı bir yere
// taşıyalım sistem menüsüne tıklayınca açılan yerde bir yerde olsun. firmadaki
// yetkilinin düzenleyebileceği flaglar ayrı bir yerde olsun. güncelleme
// denetleme ayrı bir yerde olsun. geri kalanlar durabilir. demo menüsü de
// sadece süperadmine gözüksün. ayrıca modüller menüsü de sadece süperadmine
// gözüksün."
//
// Bu dosya o kararın MEKANİK karşılığıdır ve üç arıza sınıfını kapatır:
//
//   ① SIZINTI — modül anahtarı ya da demo beyanı bir gün yeniden fabrika
//      ekranına düşerse (yeni kategori, bölüm taşıma, kopyala-yapıştır) hiçbir
//      derleme hatası olmaz; ekranı açan fabrika yöneticisi satıcı anahtarlarını
//      görür. Ölçüm: `visibleSettingsCategories(…, "settings"|"flags")` içinde
//      modül/demo anahtarı OLAMAZ.
//   ② KOPUK DERİN BAĞLANTI — palet/komut girişi kategorinin GERÇEK sayfasına
//      gitmezse kullanıcı tıklar, sayfa o sekmeyi bulamaz ve SESSİZCE ilk
//      sekmeye düşer ("Kurşun Sırası" dersinin ayar ekranındaki ikizi).
//      Ölçüm: `settingsCategoryPath` ↔ o yüzeyin route'u ↔ karo adresi.
//   ③ KİLİTLENME — modül anahtarlarının artık TEK yazma yüzeyi var; o yüzeyin
//      kimlik kapısı supapsız olursa süperadminsiz kurulum modülleri bir daha
//      açamaz. Ölçüm: karo/route kapısı ile `isSuperadminGateOpen` aynı yüklem.
//
// ⚠️ KÖRLÜK ZEMİNİ ÖNCE: bir refactor kategori listesini boşaltırsa "ihlal
// bulunamadı" ile "hiçbir şeye bakmadım" AYNI YEŞİLE çıkardı.
// =============================================================================
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SECTION_SURFACE,
  SETTINGS_CATEGORIES,
  SETTINGS_SECTIONS,
  SURFACE_LABEL,
  SURFACE_PATH,
  categorySurface,
  settingsCategoryPath,
  visibleSettingsCategories,
  type SettingsSurface,
} from "./settings-config";
import { MODULE_FLAG_KEYS } from "@/lib/module-flags";
import { systemTiles } from "@/pages/System/tile-config";
import {
  SETTINGS_COMPANY_ACCESS,
  SETTINGS_FLAGS_ACCESS,
  SETTINGS_PRINTING_ACCESS,
  SETTINGS_WORKSTATION_ACCESS,
  SYSTEM_HUB_ACCESS,
} from "@/lib/permissions";

const ROUTES_SRC = readFileSync(
  resolve(__dirname, "../../routes/content-routes.tsx"),
  "utf8",
);

/** Her yüzeyin kategori kimlikleri (sırasız). */
const idsOf = (surface: SettingsSurface) =>
  SETTINGS_CATEGORIES.filter((c) => categorySurface(c) === surface)
    .map((c) => c.id)
    .sort();

const ALL = () => true;

describe("§0 körlük zemini", () => {
  it("kategori/bölüm katalogları ve route metni okunabildi", () => {
    expect(SETTINGS_CATEGORIES.length).toBeGreaterThanOrEqual(12);
    expect(SETTINGS_SECTIONS.length).toBeGreaterThanOrEqual(5);
    expect(ROUTES_SRC.length).toBeGreaterThan(5000);
    // Üç yüzeyin üçü de DOLU — biri boşalırsa aşağıdaki "içinde yok" kontrolleri
    // vakumen yeşil kalırdı.
    for (const s of ["flags", "vendor", "printing", "workstation", "company"] as const) {
      expect(idsOf(s).length, s).toBeGreaterThan(0);
    }
  });
});

describe("§1 üç yüzeyin dağılımı", () => {
  it("⭐ satıcı yüzeyi = modül anahtarları + kurulum beyanı (demo)", () => {
    expect(idsOf("vendor")).toEqual(["demo", "modules"]);
  });

  it("fabrikanın davranış bayrakları kendi yüzeyinde", () => {
    // Sıra alfabetik; içerik "hangi kategoriler taşındı" sorusunun cevabıdır.
    expect(idsOf("flags")).toEqual([
      "customers",
      "devere",
      "dokuma",
      "finance",
      "kartela",
      "orders",
      "production",
      "shipping",
      "warehouse",
      "work-orders",
      "yarn",
    ]);
  });

  it("eski Genel Ayarlar üç ekrana bölündü (2026-09-24)", () => {
    expect(idsOf("printing")).toEqual(["devices", "label"]);
    expect(idsOf("workstation")).toEqual(["printer", "scale", "scanner", "server"]);
    expect(idsOf("company")).toEqual(["company", "session"]);
  });

  it("her bölümün yüzeyi tanımlı (yeni bölüm eklerken tablo zorunlu)", () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(SECTION_SURFACE[s.id], s.id).toBeDefined();
    }
  });
});

describe("§2 SIZINTI — satıcı anahtarları fabrika ekranlarına düşemez", () => {
  const factory = (["flags", "printing", "workstation", "company"] as const).flatMap((s) =>
    visibleSettingsCategories(ALL, s),
  );

  it("körlük zemini: fabrika yüzeylerinde satır VAR", () => {
    expect(factory.length).toBeGreaterThan(8);
    expect(factory.flatMap((c) => c.flags ?? []).length).toBeGreaterThan(15);
  });

  it("⭐ hiçbir MODÜL anahtarı fabrika ekranlarında çizilmiyor", () => {
    const sizan = factory
      .flatMap((c) => (c.flags ?? []).map((f) => ({ cat: c.id, key: f.key as string })))
      .filter((x) => MODULE_FLAG_KEYS.includes(x.key as never));
    expect(sizan.map((x) => `${x.cat}:${x.key}`)).toEqual([]);
  });

  it("⭐ demo beyanı fabrika ekranlarında çizilmiyor", () => {
    const sizan = factory
      .flatMap((c) => (c.flags ?? []).map((f) => f.key as string))
      .filter((k) => k === "demoModeEnabled");
    expect(sizan).toEqual([]);
  });

  it("satıcı yüzeyinin kategorileri KATALOGDA DURUYOR (silinmedi, taşındı)", () => {
    // Silinmiş olsalardı backend sözleşme bekçisi (`test_feature_flag_contract`
    // §14/§14b) panel tarafını boş görür ve sessizce yeşil kalırdı.
    expect(SETTINGS_CATEGORIES.find((c) => c.id === "modules")?.flags?.length).toBeGreaterThan(4);
    expect(SETTINGS_CATEGORIES.find((c) => c.id === "demo")?.flags?.length).toBe(1);
  });
});

describe("§3 KOPUK DERİN BAĞLANTI — adres tek kaynaktan", () => {
  it("her kategorinin adresi kendi yüzeyinin sayfasına gider", () => {
    for (const cat of SETTINGS_CATEGORIES) {
      const surface = categorySurface(cat);
      expect(settingsCategoryPath(cat), cat.id).toContain(SURFACE_PATH[surface]);
    }
  });

  it("sekme parametresi YALNIZ sekme şeridi olan yüzeylerde", () => {
    for (const cat of SETTINGS_CATEGORIES) {
      const path = settingsCategoryPath(cat);
      if (categorySurface(cat) === "vendor") expect(path, cat.id).not.toContain("?tab=");
      else expect(path, cat.id).toContain(`?tab=${cat.id}`);
    }
  });

  it("⭐ her yüzeyin adresi content-routes'ta GERÇEKTEN var", () => {
    for (const [surface, path] of Object.entries(SURFACE_PATH)) {
      const rel = path.replace(/^\//, "");
      expect(ROUTES_SRC.includes(`path: "${rel}"`), `${surface} → ${path}`).toBe(true);
    }
  });

  it("Sistem karoları yüzey adlarıyla birebir konuşuyor", () => {
    const byPath = new Map(systemTiles.map((t) => [t.to, t.title]));
    for (const surface of Object.keys(SURFACE_PATH) as SettingsSurface[]) {
      expect(byPath.get(SURFACE_PATH[surface]), surface).toBe(SURFACE_LABEL[surface]);
    }
  });
});

describe("§4 karolar — her yüzey ayrı yer", () => {
  it("⭐ Modüller karosu YALNIZ satıcıya (üçüncü kapı karoda)", () => {
    const t = systemTiles.find((x) => x.to === SURFACE_PATH.vendor);
    expect(t?.superadminOnly).toBe(true);
  });

  it("⭐ Özellik Anahtarları karosu satıcıya BAĞLI DEĞİL (fabrikanın ekranı)", () => {
    const t = systemTiles.find((x) => x.to === SURFACE_PATH.flags);
    expect(t?.superadminOnly).toBeUndefined();
    // Kapı: sekmelerinden birini açabilen herkes (§6 kümesi).
    expect(t?.permissionAny).toEqual(SETTINGS_FLAGS_ACCESS);
  });

  it("⭐ Güncelleme kendi karosunda ve `settings:workstation` da yetiyor", () => {
    const t = systemTiles.find((x) => x.to === "/system/update");
    expect(t?.title).toBe("Güncelleme");
    expect(t?.permissionAny).toEqual(["admin:settings", "settings:workstation"]);
    // Route AYNI çoklu kapıyı taşımalı — ayrışırsa yazıcısını kuran personel
    // karoyu/palet girişini görür ve /forbidden'a düşer.
    const idx = ROUTES_SRC.indexOf('path: "system/update"');
    const block = ROUTES_SRC.slice(idx, ROUTES_SRC.indexOf('path: "', idx + 10));
    expect(block).toContain("requireAnyPermission");
    expect(block).toContain("SETTINGS_ADMIN_PERMISSION");
    expect(block).toContain("WORKSTATION_PERMISSION");
  });

  it("Güncelleme artık ayar kategorilerinde DEĞİL (iki yer = iki gerçek)", () => {
    // ⚠️ Ölçüm dosyası DEĞİŞTİ: `WorkstationTabs.tsx` 2026-09-04'te silindi (dört
    // cihaz kategorisi raya taşındı). Kural aynı: güncelleme denetimi TEK yerde
    // (Sistem → Güncelleme) yaşar; ayar kabuğu `UpdateSection`ı çizmez.
    const shell = readFileSync(resolve(__dirname, "SettingsSurfacePage.tsx"), "utf8");
    expect(shell).not.toContain("UpdateSection");
    expect(SETTINGS_CATEGORIES.map((c) => c.id)).not.toContain("update");
    // Silinen dosya geri gelmesin: iç içe sekme kabuğu, iki ayrı kirli-taslak
    // guard'ı demekti.
    expect(existsSync(resolve(__dirname, "WorkstationTabs.tsx"))).toBe(false);
  });
});

describe("§5 KİLİTLENME — satıcı yüzeyinin kapısı SUPAPLI", () => {
  it("⭐ route kimlik kapısı supaplı yüklemi kullanıyor", () => {
    const pr = readFileSync(resolve(__dirname, "../../components/ProtectedRoute.tsx"), "utf8");
    // Supaplı yüklem = `isSuperadminGateOpen`. Supapsız bir ikizine dönülürse
    // (ör. yalnız `isSystemAccount`) süperadminsiz kurulum modülsüz kalır.
    expect(pr).toContain('from "@/lib/superadmin-gate"');
    expect(pr).toContain("isSuperadminGateOpen(");
    expect(pr).not.toContain("isSystemAccountIdentity");
  });

  it("⭐ modül anahtarlarının BAŞKA bir yazma yüzeyi kalmadı (supap tek koruma)", () => {
    // Bu kontrol §5'in ilk maddesinin GEREKÇESİDİR: ikinci bir yazma yüzeyi
    // doğarsa supap zorunlu olmaktan çıkar ve karar yeniden açılabilir.
    for (const s of ["flags", "printing", "workstation", "company"] as const) {
      expect(idsOf(s), s).not.toContain("modules");
    }
  });
});

describe("§6 EKRAN BAŞINA İZİN — her kategori kendi iznini taşır", () => {
  const SURFACE_ACCESS: Record<Exclude<SettingsSurface, "vendor">, string[]> = {
    flags: SETTINGS_FLAGS_ACCESS,
    printing: SETTINGS_PRINTING_ACCESS,
    workstation: SETTINGS_WORKSTATION_ACCESS,
    company: SETTINGS_COMPANY_ACCESS,
  };
  const factoryCats = SETTINGS_CATEGORIES.filter((c) => categorySurface(c) !== "vendor");

  it("körlük zemini: fabrika kategorileri var", () => {
    expect(factoryCats.length).toBeGreaterThanOrEqual(19);
  });

  it("⭐ her fabrika kategorisi `admin:settings` + TEK dar izin taşır", () => {
    for (const c of factoryCats) {
      expect(c.permissionAny?.[0], c.id).toBe("admin:settings");
      expect(c.permissionAny?.length, c.id).toBe(2);
    }
  });

  it("⭐ ekran kapısı = sekmelerinin izinlerinin birleşimi (fazla da eksik de yok)", () => {
    for (const [surface, access] of Object.entries(SURFACE_ACCESS)) {
      const union = [
        ...new Set(
          SETTINGS_CATEGORIES.filter((c) => categorySurface(c) === surface).flatMap((c) => c.permissionAny ?? []),
        ),
      ].sort();
      expect([...access].sort(), surface).toEqual(union);
    }
  });

  it("⭐ her yüzeyin route'u ve karosu kendi kümesini kullanır", () => {
    const names: Record<string, string> = {
      flags: "SETTINGS_FLAGS_ACCESS",
      printing: "SETTINGS_PRINTING_ACCESS",
      workstation: "SETTINGS_WORKSTATION_ACCESS",
      company: "SETTINGS_COMPANY_ACCESS",
    };
    for (const [surface, access] of Object.entries(SURFACE_ACCESS)) {
      const path = SURFACE_PATH[surface as SettingsSurface].replace(/^\//, "");
      const idx = ROUTES_SRC.indexOf(`path: "${path}"`);
      const block = ROUTES_SRC.slice(idx, ROUTES_SRC.indexOf('path: "', idx + 10));
      expect(block, surface).toContain(`requireAnyPermission={${names[surface]}}`);
      const tile = systemTiles.find((t) => t.to === SURFACE_PATH[surface as SettingsSurface]);
      expect(tile?.permissionAny, surface).toEqual(access);
    }
  });

  it("⭐ Sistem hub'ı her ayar ekranının iznini kapsar (dar izinli kişi hub'a girebilir)", () => {
    const missing = Object.values(SURFACE_ACCESS)
      .flat()
      .filter((p) => !SYSTEM_HUB_ACCESS.includes(p));
    expect(missing).toEqual([]);
  });

  it("eski Genel Ayarlar adresi yalnız yönlendirir", () => {
    const idx = ROUTES_SRC.indexOf('path: "system/settings"');
    const block = ROUTES_SRC.slice(idx, ROUTES_SRC.indexOf('path: "', idx + 10));
    expect(block).toContain("LegacySettingsRedirect");
    expect(systemTiles.some((t) => t.to === "/system/settings")).toBe(false);
  });
});
