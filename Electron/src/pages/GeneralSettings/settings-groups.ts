// =============================================================================
// GENEL AYARLAR — BÖLÜMLEME · REJİM SÜZGECİ · ARAMA (saf katman)
// =============================================================================
// NEDEN SAF FONKSİYON: bu üç kural da bir bileşenin içindeki `&&` zinciri olarak
// bırakılabilirdi ve tersine çevrilmesi HİÇBİR TESTİ KIRMAZDI. Projenin yazılı
// deseni bu yüzden saf yüklem: `yarn-regime.ts`, `resolveRollTabs`,
// `orders-regime.ts`, `stockCount-regime.ts`. Bekçi: `settings-groups.test.ts`.
//
// ⚠️ BU BİR YETKİ DUVARI DEĞİLDİR. Ayarlar sayfasının kapısı İZİNDİR
// (`visibleSettingsCategories` + route `requireAnyPermission`) ve gerçek sed
// BACKEND'dedir (`PATCH /api/feature-flags` → `admin:settings`). Buradaki kural
// yalnız "hangi bölüm çizilsin" sorusunu yanıtlar.
// =============================================================================

import { MODULE_LABELS } from "@/lib/module-flags";
import {
  SETTINGS_SECTIONS,
  type SettingsCategory,
  type SettingsModuleKey,
  type SettingsSection,
} from "./settings-config";

/**
 * Rejim durumu — `GET /api/feature-flags` yanıtından çözülür.
 *
 * ⚠️ VARSAYILANLAR BACKEND'İNKİYLE AYNI OLMAK ZORUNDA (`productionEnabled`
 * default AÇIK, `financeEnabled` default KAPALI). Panelin her yerindeki yazım
 * da budur (`?? true` / `?? false`); ayrışırsa fabrika, bayrak yüklenene kadar
 * ticaret bölümünü bir an görür ve "sıfır fark" vaadi gözle görülür biçimde
 * bozulur.
 */
export interface SettingsRegime {
  productionEnabled: boolean;
  financeEnabled: boolean;
}

/** Bayraklar henüz yüklenmemişken backend varsayılanlarına düşen çözücü. */
export function resolveSettingsRegime(
  flags: Partial<SettingsRegime> | undefined | null,
): SettingsRegime {
  return {
    productionEnabled: flags?.productionEnabled ?? true,
    financeEnabled: flags?.financeEnabled ?? false,
  };
}

/**
 * Kategori çizilsin mi?
 *
 * ⚠️ KAPI KATEGORİDEDİR, BÖLÜMDE DEĞİL. Bölüm bir yerleşim öğesidir ve tek bir
 * başlık altında rejime bağlı olan ile olmayan sekmeler yan yana durabilir
 * ("Depo & Muhasebe" → Muhasebe kapılı, Depo & Satın Alma değil). Kapıyı başlığa
 * koymak kapsamı yerleşim tercihine bağlar; 2026-08-15'te tam bu yüzden Mal
 * Kabul'ün üç ayarı `financeEnabled` kapatılınca ulaşılamaz hâle gelmişti.
 *
 * ⚠️ Rejim ANAHTARLARINI taşıyan kategorinin (`modules`) kapısı YOKTUR ve
 * olamaz — kapılı olsaydı `financeEnabled` kapatıldığı an ön muhasebe bir daha
 * açılamazdı. Kural veriyle sağlanır ve bekçi bunu ayrıca doğrular.
 */
export function isCategoryVisible(category: SettingsCategory, regime: SettingsRegime): boolean {
  if (!category.regime) return true;
  return regime[category.regime];
}

// -----------------------------------------------------------------------------
// MODÜL DURUMU — KİLİT (gizleme DEĞİL)
// -----------------------------------------------------------------------------

/**
 * Kilit kararının okuduğu modül fotoğrafı.
 *
 * ⚠️ `SettingsRegime`DEN AYRI BİR TİP ve bu bilinçli: rejim GİZLER, bu KİLİTLER.
 * Tek tipte birleştirmek `settingsCategoryVisibleWhen`in (komut paleti derin
 * bağlantısı) bir gün kilitlenen kategoriyi de GİZLEMESİNE davetiye olurdu —
 * palet, kilitli bir sekmeyi göstermeye devam etmek ZORUNDA (kullanıcı ayarın
 * hangi değerde donduğunu oradan görüyor).
 *
 * ⚠️ `iplikEnabled` ETKİN değerdir (`ticaret && iplik`) — zincir tek yerde
 * çözülür. Ham değer okunsaydı ticaret kapalı + iplik açık bir kurulumda karo
 * gizli, ayar sekmesi düzenlenebilir olurdu: aynı soruya iki cevap.
 */
export interface SettingsModuleState {
  productionEnabled: boolean;
  financeEnabled: boolean;
  ticaretEnabled: boolean;
  iplikEnabled: boolean;
  depoMultiEnabled: boolean;
}

/**
 * Bayraklar yüklenmemişken BACKEND VARSAYILANLARINA düşen çözücü.
 *
 * ⚠️ YÖNLER FARKLI ve hepsi backend ile aynı: `production.enabled` AÇIK
 * (`readProductionEnabled`ın "satır yoksa TRUE" sigortası), diğerleri KAPALI.
 * Tek bir `?? false` yazılsaydı fabrikada "İş Emirleri" sekmesi bayrak
 * yüklenene kadar KİLİTLİ görünür, sonra açılırdı — kullanıcı bir saniyeliğine
 * "modülüm kapalı" yalanını okur.
 */
export function resolveSettingsModuleState(
  flags: Partial<SettingsModuleState> | undefined | null,
): SettingsModuleState {
  const ticaretEnabled = flags?.ticaretEnabled ?? false;
  return {
    productionEnabled: flags?.productionEnabled ?? true,
    financeEnabled: flags?.financeEnabled ?? false,
    ticaretEnabled,
    // ETKİN değer — bağımlılık burada, TEK yerde çözülür.
    iplikEnabled: ticaretEnabled && (flags?.iplikEnabled ?? false),
    depoMultiEnabled: flags?.depoMultiEnabled ?? false,
  };
}

/**
 * Bu kategorinin satırları modül kapalı olduğu için DONDU mu?
 *
 * ⚠️ GÖRÜNÜRLÜĞÜ ETKİLEMEZ. `groupSettingsCategories` ve
 * `settingsCategoryVisibleWhen` bu fonksiyonu ÇAĞIRMAZ; çağırsalardı kilit
 * sessizce gizlemeye dönerdi (bekçi bunu ayrıca ölçüyor).
 */
export function isCategoryModuleClosed(
  category: SettingsCategory,
  modules: SettingsModuleState,
): boolean {
  if (!category.moduleKey) return false;
  return !modules[category.moduleKey];
}

/** Kilit bandında geçen Türkçe modül adı (backend `MODULE_LABELS` aynası). */
export function settingsModuleLabel(key: SettingsModuleKey): string {
  return MODULE_LABELS[key];
}

export interface SettingsSectionGroup {
  section: SettingsSection;
  categories: SettingsCategory[];
}

/**
 * İzinle SÜZÜLMÜŞ kategorileri önce REJİMLE eler, sonra bölümlere dağıtır; içi
 * boş kalan bölümü hiç döndürmez (boş başlık, olmayan bir şeyi vaat eder).
 * Sıra `SETTINGS_SECTIONS`ten gelir — kategori dizisinin sırası değil.
 */
export function groupSettingsCategories(
  categories: SettingsCategory[],
  regime: SettingsRegime,
): SettingsSectionGroup[] {
  const visible = categories.filter((c) => isCategoryVisible(c, regime));
  return SETTINGS_SECTIONS.map((section) => ({
    section,
    categories: visible.filter((c) => c.section === section.id),
  })).filter((g) => g.categories.length > 0);
}

/** Bölümlenmiş listeyi düz kategori dizisine indirger (aktif sekme çözümü için). */
export function flattenSettingsGroups(groups: SettingsSectionGroup[]): SettingsCategory[] {
  return groups.flatMap((g) => g.categories);
}

/**
 * Bu kategoriyi rejimle süzen yüklem — KOMUT PALETİ için.
 *
 * ⚠️ SAYFA İLE PALET AYNI KURALI KULLANMAK ZORUNDA. Palet, ayarlar ekranında
 * rejimle gizlenmiş bir sekmeye derin bağlantı verirse kullanıcı `?tab=finance`
 * ile gider, sayfa sessizce ilk sekmeye düşer ve sebebini hiçbir yerde göremez —
 * "Kurşun Sırası" dersinin ayar ekranındaki ikizi. Kural KOPYALANMAZ, buradan
 * TAŞINIR (`OperationsTile.visibleWhen` ile aynı desen).
 *
 * Kapısız kategoride `undefined` döner → giriş koşulsuz görünür.
 */
export function settingsCategoryVisibleWhen(
  category: SettingsCategory,
): ((regime: SettingsRegime) => boolean) | undefined {
  const key = category.regime;
  if (!key) return undefined;
  return (regime) => regime[key];
}

/**
 * AKTİF SEKME — hangi kategori çizilecek.
 *
 * ⚠️⚠️ BURAYA ARAMAYLA SÜZÜLMÜŞ LİSTE GEÇİLMEZ. `categories` yalnız İZİN + REJİM
 * ile süzülmüş TAM listedir. Arama sonucu geçilirse yazmak isteyen kullanıcının
 * kutuya dokunması aktif sekmeyi DEĞİŞTİRİR: Radix kapalı sekmeyi unmount eder,
 * o bölümün taslağı (`FeatureFlagSection.flagDraft`) sessizce çöpe gider ve
 * `handleTabChange`'deki "kaydedilmemiş değişiklik var" onayı HİÇ ÇALIŞMAZ —
 * o onay yalnız Radix `onValueChange` ile, yani kullanıcı bir sekmeye
 * TIKLADIĞINDA koşar; `value` prop'unun türetilmiş olarak değişmesi onu çağırmaz
 * (2026-08-15 bulgusu).
 *
 * KURAL: **ARAMA SÜZER, GEZİNMEZ.** Şerit yalnız eşleşen kategorileri (+ isabet
 * sayacını) gösterir, içerik yalnız eşleşen satırları çizer; eşleşme aktif
 * sekmede yoksa o sekme "bu bölümde arama ile eşleşen ayar yok" der. Böylece
 * sekme değiştiren TEK yol kullanıcının tıklaması olur ve onay kapısı tek kapı
 * olarak kalır.
 */
export function resolveActiveSettingsCategory(
  categories: SettingsCategory[],
  param: string | null,
): string | undefined {
  return categories.some((c) => c.id === param) ? param! : categories[0]?.id;
}

// -----------------------------------------------------------------------------
// ARAMA
// -----------------------------------------------------------------------------

/**
 * Türkçe-duyarlı katlama. `toLowerCase()` TEK BAŞINA YETMEZ: "İş Emri" yazan
 * başlık ile "is emri" yazan kullanıcı eşleşmez ("İ" küçüldüğünde iki kod
 * noktalı `i̇` olur). Aramada aksan/nokta ayrımı bir KİMLİK değil gürültüdür —
 * bu yüzden i-ailesi ve ş/ğ/ü/ö/ç ASCII karşılığına indirgenir.
 *
 * ⚠️ Bu katlama YALNIZ ARAMA içindir. Kod/kimlik karşılaştırmasında kullanma
 * (2026-08-02 etiket `showIf` dersi: kimlik metni yerelleştirilmez).
 */
const TR_FOLD: Record<string, string> = {
  "İ": "i",
  I: "i",
  "ı": "i",
  "Ş": "s",
  "ş": "s",
  "Ğ": "g",
  "ğ": "g",
  "Ü": "u",
  "ü": "u",
  "Ö": "o",
  "ö": "o",
  "Ç": "c",
  "ç": "c",
};

export function normalizeSettingsSearch(text: string): string {
  return text
    .replace(/[İIıŞşĞğÜüÖöÇç]/g, (c) => TR_FOLD[c] ?? c)
    .toLowerCase()
    .trim();
}

/**
 * Bir kategorideki eşleşme fotoğrafı.
 *
 * `wholeCategory` = eşleşme kategorinin KENDİ kimliğinden geldi (başlık,
 * açıklama ya da anahtar kelime) → içindeki satırların hepsi gösterilir.
 * Aksi halde yalnız eşleşen satırlar çizilir; "Muhasebe" arayan kullanıcı
 * kategorinin tamamını, "kdv" arayan yalnız o satırı görür.
 */
export interface SettingsSearchHit {
  categoryId: string;
  wholeCategory: boolean;
  flagKeys: string[];
  numberFlagKeys: string[];
  /** Kapalı kümeli (enum) satırların anahtarları — ayrı küme, çünkü panel
   *  onları AYRI bir listede çizer ve `flagKeys`e karıştırmak sayaç/görünürlük
   *  yüklemlerini boolean satırlar hakkında yalan söyletirdi. */
  enumFlagKeys: string[];
  settingFieldKeys: string[];
}

function hit(haystack: string | undefined, q: string): boolean {
  return haystack ? normalizeSettingsSearch(haystack).includes(q) : false;
}

/**
 * Arama sonucu. Sorgu boşsa `null` döner — "hiçbir şey eşleşmedi" ile "arama
 * yapılmadı" AYNI ŞEY DEĞİLDİR; boş dizi döndürülseydi arayüz boş sorguda tüm
 * ekranı boşaltırdı.
 */
export function searchSettings(
  categories: SettingsCategory[],
  query: string,
): SettingsSearchHit[] | null {
  const q = normalizeSettingsSearch(query);
  if (!q) return null;

  const hits: SettingsSearchHit[] = [];
  for (const cat of categories) {
    const wholeCategory =
      hit(cat.label, q) || hit(cat.description, q) || hit(cat.keywords, q);

    const flagKeys = (cat.flags ?? [])
      .filter(
        (f) => hit(f.title, q) || hit(f.summary, q) || hit(f.desc, q) || hit(f.group, q),
      )
      .map((f) => f.key as string);
    const numberFlagKeys = (cat.numberFlags ?? [])
      .filter((f) => hit(f.title, q) || hit(f.desc, q))
      .map((f) => f.key as string);
    const enumFlagKeys = (cat.enumFlags ?? [])
      .filter(
        (f) =>
          hit(f.title, q) ||
          hit(f.summary, q) ||
          hit(f.desc, q) ||
          f.options.some((o) => hit(o.label, q) || hit(o.hint, q)),
      )
      .map((f) => f.enumKey as string);
    const settingFieldKeys = (cat.settingFields ?? [])
      .filter((f) => hit(f.title, q) || hit(f.desc, q))
      .map((f) => f.key as string);

    if (
      wholeCategory ||
      flagKeys.length ||
      numberFlagKeys.length ||
      enumFlagKeys.length ||
      settingFieldKeys.length
    ) {
      hits.push({
        categoryId: cat.id,
        wholeCategory,
        flagKeys,
        numberFlagKeys,
        enumFlagKeys,
        settingFieldKeys,
      });
    }
  }
  return hits;
}

/**
 * "Bu kategoride HİÇBİR eşleşme yok" fotoğrafı.
 *
 * Arama sonuç vermediğinde ekranda kalan kategori, süzgeç yokmuş gibi TÜM
 * satırlarını çizerdi: kullanıcı "eşleşen ayar yok" yazan bir şeridin yanında
 * dolu bir liste görür ve hangisinin doğru olduğunu bilemez. Boş isabet, o
 * kategorinin de "arama altında" olduğunu söyler.
 */
export function emptySettingsHit(categoryId: string): SettingsSearchHit {
  return {
    categoryId,
    wholeCategory: false,
    flagKeys: [],
    numberFlagKeys: [],
    enumFlagKeys: [],
    settingFieldKeys: [],
  };
}

/** Bu satır ŞU ANDA çizilsin mi (arama yoksa her zaman evet). */
export function isSettingRowVisible(hit: SettingsSearchHit | undefined, key: string): boolean {
  if (!hit) return true;
  if (hit.wholeCategory) return true;
  return (
    hit.flagKeys.includes(key) ||
    hit.numberFlagKeys.includes(key) ||
    hit.enumFlagKeys.includes(key) ||
    hit.settingFieldKeys.includes(key)
  );
}

/** Sekme şeridinde basılan eşleşme sayısı (kategori kimliği eşleştiyse gösterilmez). */
export function settingsHitCount(hit: SettingsSearchHit): number {
  return (
    hit.flagKeys.length +
    hit.numberFlagKeys.length +
    hit.enumFlagKeys.length +
    hit.settingFieldKeys.length
  );
}
