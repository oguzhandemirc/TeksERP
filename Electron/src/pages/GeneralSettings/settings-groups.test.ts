// =============================================================================
// BEKÇİ — Genel Ayarlar'ın bölümlemesi, rejim süzgeci ve araması
// =============================================================================
// ⭐ İKİ EN KRİTİK KONTROL:
//
// ① "modules kategorisinin rejim kapısı YOK". Kapılı olsaydı `financeEnabled`
//    kapatıldığı an onu geri açacak anahtar da kaybolurdu — panelden AÇILAMAYAN
//    değil, KAPATTIKTAN SONRA GERİ AÇILAMAYAN bir ayar (2026-08-05
//    `kk1DuplicateGuardEnabled` dersinin arayüz ikizi).
//
// ② "kapı BÖLÜMDE değil KATEGORİDE". Bölüm bir yerleşim öğesidir; kapıyı oraya
//    koymak, aynı başlığı paylaşan rejimsiz sekmeleri de götürür. 2026-08-15
//    bulgusu: "Depo & Muhasebe" başlığı `financeEnabled` ile kapılıydı ve Mal
//    Kabul'ün üç ayarı (ekranın kendisi rejimden BAĞIMSIZ çalışıyor) bayrak
//    kapanınca ulaşılamaz hâle geliyordu. Hangi kategorinin kapılanabileceğini
//    ÖLÇEN mekanik bekçi backend'dedir:
//    `Teks-Erp/scripts/test_feature_flag_contract.ts` §14 — burada kilitlenen
//    şey yalnız kapının KATEGORİDE yaşadığı.
//
// ⚠️ Üçüncü kural: ARAMA SÜZER, GEZİNMEZ (`resolveActiveSettingsCategory`).
//
// ⚠️ KÖRLÜK ZEMİNİ: kategori/bölüm/bayrak sayılarının alt sınırı vardır. Bir
// refactor `SETTINGS_CATEGORIES`i boşaltırsa "ihlal bulunamadı" ile "hiçbir şeye
// bakılmadı" aynı yeşile çıkar.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  SETTINGS_AUDIENCES,
  SETTINGS_CATEGORIES,
  SETTINGS_SECTIONS,
  type SettingsCategory,
} from "./settings-config";
import {
  emptySettingsHit,
  flattenSettingsGroups,
  groupSettingsCategories,
  isCategoryVisible,
  isSettingRowVisible,
  normalizeSettingsSearch,
  resolveActiveSettingsCategory,
  resolveSettingsRegime,
  searchSettings,
  settingsCategoryVisibleWhen,
  settingsHitCount,
} from "./settings-groups";

const FACTORY = { productionEnabled: true, financeEnabled: false };
const TRADE = { productionEnabled: false, financeEnabled: true };
const BOTH = { productionEnabled: true, financeEnabled: true };

const allFlags = SETTINGS_CATEGORIES.flatMap((c) => c.flags ?? []);
const allNumberFlags = SETTINGS_CATEGORIES.flatMap((c) => c.numberFlags ?? []);
const allSettingFields = SETTINGS_CATEGORIES.flatMap((c) => c.settingFields ?? []);

describe("körlük zemini", () => {
  it("katalog dolu (kategori/bölüm/bayrak alt sınırları)", () => {
    expect(SETTINGS_CATEGORIES.length).toBeGreaterThanOrEqual(12);
    expect(SETTINGS_SECTIONS.length).toBeGreaterThanOrEqual(4);
    expect(allFlags.length).toBeGreaterThanOrEqual(25);
    expect(allSettingFields.length).toBeGreaterThanOrEqual(3);
  });
});

describe("bölümleme — her kategori TAM BİR bölümde", () => {
  it("her kategorinin bölümü tanımlı bir bölümdür", () => {
    const ids = new Set(SETTINGS_SECTIONS.map((s) => s.id));
    const orphans = SETTINGS_CATEGORIES.filter((c) => !ids.has(c.section));
    expect(orphans.map((c) => c.id)).toEqual([]);
  });

  it("bölüm kimlikleri benzersiz", () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("kategori kimlikleri benzersiz", () => {
    const ids = SETTINGS_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("boş bölüm yok — her bölümün en az bir kategorisi var", () => {
    const empty = SETTINGS_SECTIONS.filter(
      (s) => !SETTINGS_CATEGORIES.some((c) => c.section === s.id),
    );
    expect(empty.map((s) => s.id)).toEqual([]);
  });

  it("her bayrak anahtarı katalogda TEK KEZ geçer (çift satır = iki taslak, biri sessizce kaybolur)", () => {
    const keys = allFlags.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    const fieldKeys = allSettingFields.map((f) => f.key);
    expect(new Set(fieldKeys).size).toBe(fieldKeys.length);
    const numKeys = allNumberFlags.map((f) => f.key);
    expect(new Set(numKeys).size).toBe(numKeys.length);
  });
});

describe("⭐ rejim kapısı — anahtarın kendisi asla kapının arkasında olamaz", () => {
  const modules = SETTINGS_CATEGORIES.find((c) => c.id === "modules");

  it("modules KATEGORİSİNİN rejim kapısı YOK", () => {
    expect(modules).toBeDefined();
    expect(modules?.regime).toBeUndefined();
  });

  it("rejim anahtarlarının ikisi de modules kategorisinde yaşıyor", () => {
    const inModules = (modules?.flags ?? []).map((f) => f.key as string);
    expect(inModules).toContain("productionEnabled");
    expect(inModules).toContain("financeEnabled");
  });

  it("her rejimde modules kategorisi çizilir (fabrika · ticaret · ikisi birden)", () => {
    for (const regime of [FACTORY, TRADE, BOTH]) {
      const ids = flattenSettingsGroups(groupSettingsCategories(SETTINGS_CATEGORIES, regime)).map(
        (c) => c.id,
      );
      expect(ids).toContain("modules");
    }
  });

  // ⭐ KAPI BÖLÜMDE OLAMAZ — 2026-08-15 bulgusunun doğrudan bekçisi. Bölüm bir
  // yerleşim öğesidir; `SettingsSection`e `regime` alanı geri eklenirse bu
  // kontrol o gün kırmızı verir (tip düzeyinde de: alan artık yok).
  it("hiçbir BÖLÜM rejim kapısı taşımaz (kapı kategoridedir)", () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(Object.keys(s).sort(), `${s.id}`).toEqual(["id", "label"]);
    }
  });

  // ⭐ Mal Kabul'ün ayarları HER REJİMDE ulaşılabilir. Ekranın kapısı
  // `financeEnabled` DEĞİLDİR (2026-09-02'den beri `requireTicaretEnabled`) ve
  // enforcement koşuyor; gizlenirlerse "açtım, kapatamıyorum" çıkmazı doğar.
  // Kategori bir gün `ticaretEnabled` ile kapılanacaksa o ayrı bir karardır
  // (P5) — bu pakette hiçbir kategorinin rejimi değişmedi.
  it("depo/satın alma kategorisi rejimden BAĞIMSIZ (kapatılamaz ayar çıkmazı)", () => {
    const warehouse = SETTINGS_CATEGORIES.find((c) => c.id === "warehouse");
    expect(warehouse?.regime).toBeUndefined();
    for (const regime of [FACTORY, TRADE, BOTH]) {
      const ids = flattenSettingsGroups(groupSettingsCategories(SETTINGS_CATEGORIES, regime)).map(
        (c) => c.id,
      );
      expect(ids, JSON.stringify(regime)).toContain("warehouse");
    }
  });

  // `productionEnabled` bugün hiçbir kategoriyi kapılamaz. GEREKÇE 2026-09-02'de
  // DEĞİŞTİ: backend'de artık `requireProductionEnabled` diye gerçek bir kapı VAR,
  // ama bu kategorilerdeki ayarların yönettiği davranışların bir kısmı o kapının
  // ARKASINDA DEĞİL (`/api/rolls` bilinçli kapısız) — yani bayrak kapalıyken de
  // koşuyorlar. Kategorileri kapatmak ayrı bir paketin işi (P5).
  it("üretim/kalite kategorileri rejimden BAĞIMSIZ (yüzeyleri de öyle)", () => {
    for (const id of ["work-orders", "production", "kartela"]) {
      expect(SETTINGS_CATEGORIES.find((c) => c.id === id)?.regime, id).toBeUndefined();
    }
    const ids = flattenSettingsGroups(groupSettingsCategories(SETTINGS_CATEGORIES, TRADE)).map(
      (c) => c.id,
    );
    expect(ids).toEqual(expect.arrayContaining(["work-orders", "production", "kartela"]));
  });

  it("fabrikada (finance kapalı) YALNIZ muhasebe kategorisi gizlenir", () => {
    const factoryIds = flattenSettingsGroups(
      groupSettingsCategories(SETTINGS_CATEGORIES, FACTORY),
    ).map((c) => c.id);
    const allIds = SETTINGS_CATEGORIES.map((c) => c.id);
    expect(allIds.filter((id) => !factoryIds.includes(id))).toEqual(["finance"]);
  });

  it("ticarette muhasebe kategorisi açılır", () => {
    const ids = flattenSettingsGroups(groupSettingsCategories(SETTINGS_CATEGORIES, TRADE)).map(
      (c) => c.id,
    );
    expect(ids).toContain("finance");
  });

  it("içi tamamen rejimle boşalan bölümün BAŞLIĞI da çizilmez", () => {
    const onlyFinance = SETTINGS_CATEGORIES.filter((c) => c.id === "finance");
    expect(groupSettingsCategories(onlyFinance, FACTORY)).toEqual([]);
    expect(groupSettingsCategories(onlyFinance, TRADE).map((g) => g.section.id)).toEqual(["trade"]);
  });

  it("isCategoryVisible kapısız kategoride her zaman true", () => {
    const cat = (regime?: "financeEnabled" | "productionEnabled") =>
      ({ ...SETTINGS_CATEGORIES[0]!, regime }) as SettingsCategory;
    expect(isCategoryVisible(cat(undefined), FACTORY)).toBe(true);
    expect(isCategoryVisible(cat("financeEnabled"), FACTORY)).toBe(false);
    expect(isCategoryVisible(cat("financeEnabled"), TRADE)).toBe(true);
  });

  // Palet yüklemi KOPYALANMAZ, kategoriden TAŞINIR: ayrışsaydı palet fabrikada
  // gizli olan `?tab=finance`e derin bağlantı verirdi.
  it("komut paleti yüklemi kategori kapısıyla birebir", () => {
    for (const c of SETTINGS_CATEGORIES) {
      const when = settingsCategoryVisibleWhen(c);
      if (!c.regime) {
        expect(when, c.id).toBeUndefined();
      } else {
        expect(when?.(FACTORY), c.id).toBe(FACTORY[c.regime]);
        expect(when?.(TRADE), c.id).toBe(TRADE[c.regime]);
      }
    }
  });

  it("bayrak yüklenmemişken backend varsayılanına düşülür (fabrikada titreme yok)", () => {
    expect(resolveSettingsRegime(undefined)).toEqual(FACTORY);
    expect(resolveSettingsRegime({})).toEqual(FACTORY);
    expect(resolveSettingsRegime({ financeEnabled: true })).toEqual(BOTH);
  });

  it("boş kategori listesinde bölüm başlığı üretilmez", () => {
    expect(groupSettingsCategories([], BOTH)).toEqual([]);
  });

  it("izinle daralmış listede yalnız kalan kategorinin bölümü çizilir", () => {
    const only = SETTINGS_CATEGORIES.filter((c) => c.id === "system");
    const groups = groupSettingsCategories(only, BOTH);
    expect(groups.map((g) => g.section.id)).toEqual(["printing"]);
  });
});

// =============================================================================
// ⭐ ARAMA SÜZER, GEZİNMEZ
// =============================================================================
// 2026-08-15 bulgusu: aktif sekme arama ile SÜZÜLMÜŞ listeden çözülüyordu.
// Kullanıcı bir toggle'ı çevirip (taslak, henüz Kaydet'e basılmadı) arama
// kutusuna yazınca kategorisi şeritten düşüyor, `active` başka bir sekmeye
// kayıyor, Radix eski içeriği UNMOUNT ediyor ve taslak sessizce yok oluyordu.
// `handleTabChange`'deki "kaydedilmemiş değişiklik var" onayı bu yolda HİÇ
// çalışmaz: o yalnız Radix `onValueChange` ile, yani kullanıcı bir sekmeye
// TIKLADIĞINDA koşar.
describe("⭐ aktif sekme çözümü — arama gezindirmez", () => {
  const ids = SETTINGS_CATEGORIES.map((c) => c.id);

  it("geçerli ?tab= korunur", () => {
    expect(resolveActiveSettingsCategory(SETTINGS_CATEGORIES, "customers")).toBe("customers");
  });

  it("parametre yoksa / tanınmıyorsa ilk kategoriye düşülür", () => {
    expect(resolveActiveSettingsCategory(SETTINGS_CATEGORIES, null)).toBe(ids[0]);
    expect(resolveActiveSettingsCategory(SETTINGS_CATEGORIES, "yok-boyle-sekme")).toBe(ids[0]);
    expect(resolveActiveSettingsCategory([], "customers")).toBeUndefined();
  });

  it("arama aktif sekmeyi DEĞİŞTİRMEZ (taslak kaybı yok)", () => {
    // "kdv" yalnız Muhasebe'yi eşleştirir; kullanıcı Müşteriler sekmesindeydi.
    const hits = searchSettings(SETTINGS_CATEGORIES, "kdv") ?? [];
    const matched = new Set(hits.map((h) => h.categoryId));
    expect(matched.has("customers")).toBe(false);
    expect(matched.size).toBeGreaterThan(0);

    // Doğru çözüm TAM listeden yapılır → sekme yerinde kalır.
    expect(resolveActiveSettingsCategory(SETTINGS_CATEGORIES, "customers")).toBe("customers");

    // Regresyonun ta kendisi: arama listesinden çözülseydi sekme kayardı.
    const railOnly = SETTINGS_CATEGORIES.filter((c) => matched.has(c.id));
    expect(resolveActiveSettingsCategory(railOnly, "customers")).not.toBe("customers");
  });

  it("eşleşme sıfırken bile aktif sekme korunur (boş şeritte 'düşülecek' sekme yok)", () => {
    const hits = searchSettings(SETTINGS_CATEGORIES, "zzzyokboylebirsey") ?? [];
    expect(hits).toEqual([]);
    expect(resolveActiveSettingsCategory(SETTINGS_CATEGORIES, "customers")).toBe("customers");
    // Arama listesinden çözülseydi `undefined` olurdu: içerik alanı komple boşalır.
    expect(resolveActiveSettingsCategory([], "customers")).toBeUndefined();
  });

  it("aktif sekmede eşleşme yoksa o sekme BOŞ isabet alır (dolu liste yalanı yok)", () => {
    const hits = searchSettings(SETTINGS_CATEGORIES, "kdv") ?? [];
    const byId = new Map(hits.map((h) => [h.categoryId, h]));
    const forCustomers = byId.get("customers") ?? emptySettingsHit("customers");
    expect(isSettingRowVisible(forCustomers, "customerBranchesEnabled")).toBe(false);
  });
});

describe("satır meta verisi — tamlık", () => {
  it("her bayrakta başlık + TEK cümle özet + varsayılan + kitle var", () => {
    for (const f of allFlags) {
      expect(f.title.trim().length, `${f.key} başlık`).toBeGreaterThan(0);
      expect(f.summary.trim().length, `${f.key} özet`).toBeGreaterThan(0);
      // Özet SATIRDA basılır — uzun gerekçe `desc`te kalmalı, yoksa sadeleştirme
      // amacı kaybolur ve satır yine bir paragrafa döner.
      expect(f.summary.length, `${f.key} özet uzunluğu`).toBeLessThanOrEqual(160);
      expect(typeof f.defaultOn, `${f.key} varsayılan`).toBe("boolean");
      expect(f.audience.length, `${f.key} kitle`).toBeGreaterThan(0);
      for (const a of f.audience) expect(SETTINGS_AUDIENCES).toContain(a);
    }
  });

  it("özet, uzun açıklamanın kopyası değil (kısa olmak zorunda)", () => {
    for (const f of allFlags) {
      expect(f.summary.length, `${f.key}`).toBeLessThan(f.desc.length);
    }
  });

  it("sayısal alanların kitlesi ve sınırları tutarlı", () => {
    for (const f of [...allNumberFlags, ...allSettingFields]) {
      expect(f.audience.length, `${f.key} kitle`).toBeGreaterThan(0);
      expect(f.min, `${f.key} sınır`).toBeLessThan(f.max);
      expect(f.fallback, `${f.key} varsayılan alt sınır`).toBeGreaterThanOrEqual(f.min);
      expect(f.fallback, `${f.key} varsayılan üst sınır`).toBeLessThanOrEqual(f.max);
    }
  });

  it("ham system-setting alanları denetim açıklaması taşır", () => {
    for (const f of allSettingFields) {
      expect(f.savedDesc.trim().length, `${f.key}`).toBeGreaterThan(0);
    }
  });
});

describe("arama — saf fonksiyon", () => {
  it("boş sorgu ARAMA YAPILMADI demektir (null), boş sonuç değil", () => {
    expect(searchSettings(SETTINGS_CATEGORIES, "")).toBeNull();
    expect(searchSettings(SETTINGS_CATEGORIES, "   ")).toBeNull();
  });

  it("Türkçe katlama: İ/ı ailesi ve ş/ğ/ü/ö/ç ASCII'ye iner", () => {
    expect(normalizeSettingsSearch("İŞ EMRİ")).toBe("is emri");
    expect(normalizeSettingsSearch("Iş")).toBe("is");
    expect(normalizeSettingsSearch("Çuval Ölçü Güvenlik")).toBe("cuval olcu guvenlik");
  });

  it("başlıksız yazımla da bulur (kullanıcı 'is emri' yazar)", () => {
    const hits = searchSettings(SETTINGS_CATEGORIES, "is emri");
    expect(hits?.map((h) => h.categoryId)).toContain("work-orders");
  });

  it("kategori adı eşleşince o kategorinin TÜM satırları gösterilir", () => {
    const hits = searchSettings(SETTINGS_CATEGORIES, "muhasebe") ?? [];
    const finance = hits.find((h) => h.categoryId === "finance");
    expect(finance?.wholeCategory).toBe(true);
    expect(isSettingRowVisible(finance, "financeAutoAllocateOnPaymentEnabled")).toBe(true);
  });

  // ⚠️ SONDA KELİMESİ ÖZENLE SEÇİLİR: kategorinin `keywords` listesinde GEÇEN
  // bir kelime (örn. "kdv" → Muhasebe) kategori kimliğini eşleştirir ve
  // `wholeCategory` doğru olarak true döner — o durumda bu kural ölçülemez.
  it("satır adı eşleşince YALNIZ o satır gösterilir", () => {
    const hits = searchSettings(SETTINGS_CATEGORIES, "tümden") ?? [];
    const production = hits.find((h) => h.categoryId === "production");
    expect(production).toBeDefined();
    expect(production?.wholeCategory).toBe(false);
    expect(production?.flagKeys).toEqual(["tamburUndoFullSameDayOnly"]);
    expect(isSettingRowVisible(production, "tamburUndoFullSameDayOnly")).toBe(true);
    expect(isSettingRowVisible(production, "rawWidthEnabled")).toBe(false);
  });

  it("kategori anahtar kelimesi eşleşirse (kdv) o kategori sonuçlara girer", () => {
    const hits = searchSettings(SETTINGS_CATEGORIES, "kdv") ?? [];
    const finance = hits.find((h) => h.categoryId === "finance");
    expect(finance).toBeDefined();
    expect(finance?.numberFlagKeys).toContain("financeDefaultVatRate");
  });

  it("ham system-setting alanı da aranır (tolerans yüzeyi kaybolmasın)", () => {
    const hits = searchSettings(SETTINGS_CATEGORIES, "tolerans") ?? [];
    const orders = hits.find((h) => h.categoryId === "orders");
    expect(orders?.settingFieldKeys).toContain("shipping.toleranceMeters");
  });

  it("eşleşmeyen sorgu boş dizi döner", () => {
    expect(searchSettings(SETTINGS_CATEGORIES, "zzzyokboylebirsey")).toEqual([]);
  });

  it("arama yokken (hit undefined) her satır görünür", () => {
    expect(isSettingRowVisible(undefined, "herhangiBirAnahtar")).toBe(true);
  });

  it("BOŞ isabet, arama altındaki isabetsiz kategorinin satırlarını gizler", () => {
    const empty = emptySettingsHit("finance");
    expect(isSettingRowVisible(empty, "financeBlockNegativeCashEnabled")).toBe(false);
    expect(settingsHitCount(empty)).toBe(0);
    // ⚠️ `undefined` ile karıştırma: o "arama YAPILMADI" demek ve her satırı gösterir.
    expect(isSettingRowVisible(undefined, "financeBlockNegativeCashEnabled")).toBe(true);
  });

  it("eşleşme sayacı yalnız satır isabetlerini sayar", () => {
    const hits = searchSettings(SETTINGS_CATEGORIES, "tümden") ?? [];
    const production = hits.find((h) => h.categoryId === "production")!;
    expect(settingsHitCount(production)).toBe(1);
  });

  it("arama izinle süzülmüş listeye uygulanır (görünmeyen kategori sonuçta çıkmaz)", () => {
    const narrow: SettingsCategory[] = SETTINGS_CATEGORIES.filter((c) => c.id === "system");
    const hits = searchSettings(narrow, "muhasebe");
    expect(hits).toEqual([]);
  });
});
