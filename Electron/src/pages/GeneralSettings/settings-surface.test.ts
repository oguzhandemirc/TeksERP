// =============================================================================
// BEKÇİ — AYARLARIN ÜÇ YÜZEYİ (2026-09-04 kullanıcı kararı)
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
import { readFileSync } from "node:fs";
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
    for (const s of ["settings", "flags", "vendor"] as const) {
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

  it("“geri kalanlar durabilir” — Genel Ayarlar'da kalanlar", () => {
    expect(idsOf("settings")).toEqual([
      "company",
      "devices",
      "label",
      "session",
      "system",
    ]);
  });

  it("her bölümün yüzeyi tanımlı (yeni bölüm eklerken tablo zorunlu)", () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(SECTION_SURFACE[s.id], s.id).toBeDefined();
    }
  });
});

describe("§2 SIZINTI — satıcı anahtarları fabrika ekranlarına düşemez", () => {
  const factory = [
    ...visibleSettingsCategories(ALL, "settings"),
    ...visibleSettingsCategories(ALL, "flags"),
  ];

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
    expect(byPath.get(SURFACE_PATH.settings)).toBe(SURFACE_LABEL.settings);
    expect(byPath.get(SURFACE_PATH.flags)).toBe(SURFACE_LABEL.flags);
    expect(byPath.get(SURFACE_PATH.vendor)).toBe(SURFACE_LABEL.vendor);
  });
});

describe("§4 karolar — üç ayrı yer", () => {
  it("⭐ Modüller karosu YALNIZ satıcıya (üçüncü kapı karoda)", () => {
    const t = systemTiles.find((x) => x.to === SURFACE_PATH.vendor);
    expect(t?.superadminOnly).toBe(true);
  });

  it("⭐ Özellik Anahtarları karosu satıcıya BAĞLI DEĞİL (fabrikanın ekranı)", () => {
    const t = systemTiles.find((x) => x.to === SURFACE_PATH.flags);
    expect(t?.superadminOnly).toBeUndefined();
    // Kapı `admin:settings` (karo kendi iznini taşımıyorsa hub varsayılanı) —
    // route ile hizası `tile-route-permission.test`te ölçülüyor.
    expect(t?.permission ?? "admin:settings").toBe("admin:settings");
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

  it("Güncelleme artık “Bu Bilgisayar” sekmelerinde DEĞİL (iki yer = iki gerçek)", () => {
    const ws = readFileSync(resolve(__dirname, "WorkstationTabs.tsx"), "utf8");
    expect(ws).not.toContain('id: "update"');
    expect(ws).not.toContain("UpdateSection");
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
    expect(idsOf("settings")).not.toContain("modules");
    expect(idsOf("flags")).not.toContain("modules");
  });
});
