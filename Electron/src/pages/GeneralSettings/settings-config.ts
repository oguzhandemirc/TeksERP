import {
  Building2,
  Banknote,
  Blocks,
  Boxes,
  FlaskConical,
  ClipboardList,
  Factory,
  Truck,
  TabletSmartphone,
  Printer,
  Scale,
  ScanLine,
  Server,
  Clock,
  Tags,
  Layers,
  UsersRound,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import type { FeatureFlags } from "@/services/featureFlagService";
import { SETTING_KEYS as RAW_SETTING_KEYS } from "@/services/systemSettingService";
import { BatchNumberHint } from "./BatchNumberHint";
import { PHASE_OUT_LINE_QTY_OPTIONS, PHASE_OUT_NEW_ORDER_OPTIONS } from "@/lib/item-lifecycle-flags";
import {
  SHIPMENT_ORDER_REQUIREMENT_OPTIONS,
  SHIPPING_DOC_CEKI_NAME_MODE_OPTIONS,
  SHIPPING_ORDER_COVERAGE_OPTIONS,
  SHIPPING_DOC_ITEM_NAME_MODE_OPTIONS,
  SHIPPING_INVOICE_MODE_OPTIONS,
  PACKING_GROUP_NUMBERING_OPTIONS,
  PACKING_GROUP_MODE_OPTIONS,
  PACKAGE_NO_MODE_OPTIONS,
  PACKAGE_NUMBERING_OPTIONS,
  SACK_DUMP_NAME_MODE_OPTIONS,
  PACKING_POOL_PACKAGE_NO_OPTIONS,
} from "@/lib/shipping-flags";
import { IS_ELECTRON } from "@/lib/runtime-env";

/** FeatureFlags'in yalnızca BOOLEAN değerli anahtarları (toggle edilebilenler).
 *  travelerCardConfig gibi nesne ayarları bu listeden hariçtir — kendi paneli var. */
type BooleanFlagKey = {
  [K in keyof FeatureFlags]: FeatureFlags[K] extends boolean ? K : never;
}[keyof FeatureFlags];

/** Sayısal (nullable) değerli anahtarlar — `FlagDef.numberField` yalnız bunları alır. */
export type NumberFlagKey = {
  [K in keyof FeatureFlags]: FeatureFlags[K] extends number | null ? K : never;
}[keyof FeatureFlags];
/**
 * "Kimi etkiler" — satırın karşısındaki İNSAN. Serbest metin DEĞİL kapalı bir
 * sözlük: her yazan kendi kelimesini uydurursa aynı kitle üç ayrı adla anılır
 * ("saha", "operatör", "tablet kullanıcısı") ve rozet süse döner.
 */
export const SETTINGS_AUDIENCES = [
  "Operatör",
  "Planlamacı",
  "Depocu",
  "Muhasebeci",
  "Sevkiyat",
  "Yönetim",
] as const;
export type SettingAudience = (typeof SETTINGS_AUDIENCES)[number];

/** Tek bir özellik anahtarının ekranda görünen metinleri. `key` backend kontratına bağlanır. */
export interface FlagDef {
  key: BooleanFlagKey;
  title: string;
  /**
   * SATIRDA görünen TEK cümle. Uzun gerekçe `desc`te, (i) balonunun arkasında
   * kalır — ayar ekranı bir el kitabı değil, bir karar listesidir.
   */
  summary: string;
  desc: string;
  /**
   * Backend'in KAYIT YOKKEN döndüğü değer (rozet: AÇIK/KAPALI). ⚠️ Burada
   * yazan sayı ikinci bir kaynak değildir: `test_feature_flag_contract` §12 her
   * satırı ilgili `readX` okuyucusunu BOŞ istemciyle çağırarak doğrular —
   * ayrışırsa bekçi kırmızı verir.
   */
  defaultOn: boolean;
  /** Bu ayarın ekranını/işini değiştirdiği kişi(ler). En az bir kayıt. */
  audience: SettingAudience[];
  /**
   * Sekme içi alt-başlık (aynı domainin farklı istasyonlarını ayırır — örn. Üretim
   * sekmesinde "KK1 / Kalite", "Fason", "Tambur"). Aynı `group` ardışık flag'ler tek
   * blok olur; verilmezse başlıksız düz liste (geriye uyumlu).
   */
  group?: string;
  /**
   * Toggle'ın ALTINA çizilen canlı bilgi bloğu (opsiyonel). Statik `desc`'ten farkı:
   * sunucudan okunan bir DEĞERİ gösterir (örn. parti sayacının bulunduğu numara).
   * Bileşen kendi sorgusunu yönetir ve gösterecek bir şey yoksa `null` döner.
   */
  hint?: ComponentType;
  /**
   * Toggle AÇIKKEN altında çizilen sayısal alan (opsiyonel) — "bayrak + eşik"
   * ikilisi tek satırda, TEK Kaydet altında yaşasın diye.
   *
   * ⚠️ İç alan adı `numberKey` — düz `key` OLMAMALI: sözleşme bekçisi
   * (`test_feature_flag_contract.ts`) panel kümesini alan adına bakarak okur ve
   * boolean bayrakları düz `key` alanından toplar; sayısal anahtar da o adla
   * yazılsaydı boolean D kümesine sızar ve bekçi yanlış şey ölçerdi.
   * (Kural GİRİNTİ ya da satır başı DEĞİL — regex 2026-09-03'te biçimden
   * kurtarıldı; Prettier'ın nesneyi tek satıra alması artık yanlış kırmızı
   * üretmiyor. Bu yorumda örnek bir alan yazımı GÖSTERİLMEZ: bekçi kaynağı
   * tarar ve yorumdaki örnek de kümeye hayalet bir anahtar eklerdi — birebir
   * yaşandı, `system-setting.service.ts`teki aynı ders.)
   */
  numberField?: {
    numberKey: NumberFlagKey;
    label: string;
    unit: string;
    min: number;
    max: number;
    /** Alan boş bırakıldığında (null) gösterilecek uyarı — kural etkisiz kalır. */
    emptyWarning: string;
  };
}

/**
 * FeatureFlags'in METİN (enum) değerli anahtarları — `enumFlags` satırları.
 *
 * ⚠️ `companyName` de metindir ama bir ENUM DEĞİLDİR (kapalı değer kümesi yok)
 * ve kendi kartından yönetilir; buraya yalnız kapalı kümeli ayarlar girer.
 */
type EnumFlagKey = {
  [K in keyof FeatureFlags]: FeatureFlags[K] extends string ? K : never;
}[keyof FeatureFlags];

/**
 * Kapalı değer kümeli (enum) feature-flag satırı — boolean toggle'larla AYNI
 * taslak + AYNI Kaydet + AYNI PATCH altında yaşar.
 *
 * ⚠️ İç alan adı **`enumKey`** olmak ZORUNDA, düz `key` DEĞİL. Sözleşme bekçisi
 * (`Teks-Erp/scripts/test_feature_flag_contract.ts`) panelin BOOLEAN kümesini
 * kaynak metninden `key:` alanına bakarak toplar; enum anahtarı da o adla
 * yazılsaydı boolean kümesine sızar ve "yönetilemez boolean bayrak" kontrolü
 * yanlış şey ölçerdi. `numberKey:` ayrımının varlık sebebi birebir aynıydı.
 *
 * ⚠️ `defaultValue` bir BEYANDIR ve ikinci kaynaktır — bekçi §16 onu backend
 * okuyucusunu BOŞ istemciyle çağırarak doğrular; yanlış yazmak kırmızı verir.
 */
export interface EnumFlagDef {
  enumKey: EnumFlagKey;
  title: string;
  summary: string;
  desc: string;
  /** Backend'in KAYIT YOKKEN döndüğü değer (rozet: "Varsayılan: …"). */
  defaultValue: string;
  options: ReadonlyArray<{ value: string; label: string; hint: string }>;
  audience: SettingAudience[];
  group?: string;
  /** "radio" = seçenekler alt alta, her birinin altında tek cümle (açılır liste yerine). */
  display?: "radio";
}

/** FeatureFlags'in SERBEST METİN anahtarları — `textFlags` satırları (enum DEĞİL). */
export type TextFlagKey = {
  [K in keyof FeatureFlags]: FeatureFlags[K] extends string ? K : never;
}[keyof FeatureFlags];

/**
 * SERBEST METİN satırı (2026-09-22): değer <input>'tan gelir; kapalı küme yok. Sınır ve
 * izinli karakterler burada beyan edilir, sunucu zod'u ikinci kapıdır. ⚠️ İç alan adı
 * `textKey` — `key`/`enumKey` OLMAMALI: sözleşme bekçisi kümeleri alan adından okur.
 * Sözleşme bekçisi bu anahtarı `FREE_TEXT_FLAGS` listesinde gerekçeli tutar.
 */
export interface TextFlagDef {
  textKey: TextFlagKey;
  title: string;
  summary: string;
  desc: string;
  defaultValue: string;
  maxLength: number;
  pattern: RegExp;
  placeholder: string;
  invalidHint: string;
  audience: SettingAudience[];
  group?: string;
}

/**
 * FeatureFlags'in SAYISAL değerli anahtarları (`numberFlags` satırları için).
 *
 * ⚠️ `NumberFlagKey` ile KARIŞTIRMA (merge, 2026-09-01): o, bir bayrağın İÇİNE
 * gömülü eşiği adresler ve NULLABLE'dır (boş = "eşik yok"); bu ise bağımsız,
 * her zaman değeri olan sayısal satırlarındır. İki küme farklı — tek ada
 * indirgemek, nullable eşikleri bağımsız satır sanan bir tip hatası doğururdu.
 */
type NumericSettingKey = {
  [K in keyof FeatureFlags]: FeatureFlags[K] extends number ? K : never;
}[keyof FeatureFlags];

/**
 * Sekmeye gömülü SAYISAL feature-flag alanı. Boolean toggle'larla AYNI taslak +
 * AYNI Kaydet altında yaşar ve aynı PATCH /api/feature-flags ile yazılır —
 * ayrı bir kaydetme yolu açmak "iki Kaydet, hangisi neyi yazdı" karışıklığıydı.
 * (`SettingFieldDef` bundan FARKLI: o system-setting upsert'idir, feature-flag
 * değil — bkz. aşağıdaki gerekçe.)
 */
export interface NumberFlagDef {
  key: NumericSettingKey;
  title: string;
  desc: string;
  min: number;
  max: number;
  /** Sunucu değeri henüz yüklenmemişken gösterilecek değer (backend default'u). */
  fallback: number;
  /** Input'un yanında basılan birim etiketi (örn. "%", "gün"). */
  unit?: string;
  step?: number;
  /** Bu ayarın işini değiştirdiği kişi(ler). En az bir kayıt. */
  audience: SettingAudience[];
}

/** `systemSettingService.SETTING_KEYS` değerlerinin birleşimi (ham `system_settings.key`). */
export type SystemSettingKey = (typeof RAW_SETTING_KEYS)[keyof typeof RAW_SETTING_KEYS];

/**
 * FEATURE-FLAG SÖZLEŞMESİNİN DIŞINDA kalan sayısal ayar alanı — `PUT
 * /api/admin/settings/:key` ile ham `system_settings` satırına yazılır.
 *
 * ⚠️ NEDEN AYRI BİR TÜR: bu anahtarlar `GET /api/feature-flags` yükünde DÖNMEZ
 * (uygulama açılışında her istemcinin çektiği yükü şişirmemek için) — yani
 * `updateSchema`/`setFeatureFlags` dört-kapı sözleşmesi onları GÖRMEZ. Tam da
 * bu yüzden panelde yüzeyi olmayan bir ayar SESSİZCE ulaşılamaz kalabilir:
 * `shipping.toleranceMeters` 2026-08-15'e kadar öyleydi (sipariş "tamamlandı"
 * eşiğini belirliyordu ve hiçbir ekrandan değiştirilemiyordu). Bekçi:
 * `Teks-Erp/scripts/test_feature_flag_contract.ts` §11 — her `SETTING_KEYS`
 * satırı ya feature-flag yükünde ya burada ya da GEREKÇELİ muaf listesindedir.
 */
export interface SettingFieldDef {
  key: SystemSettingKey;
  title: string;
  desc: string;
  min: number;
  max: number;
  /** Sunucuda kayıt yokken backend okuyucusunun döndüğü değer. */
  fallback: number;
  unit?: string;
  /** `system_settings.description` kolonuna yazılan açıklama (denetim izi). */
  savedDesc: string;
  audience: SettingAudience[];
}

/**
 * Kategori içeriğinin nasıl render edileceği:
 * - `flags`     → config'teki flag listesini generic toggle olarak çizer
 * - `device`    → mobil cihaz eşleştirme/onay (org düzeyi) özel section
 * - `session`   → oturum süresi + hareketsizlik zaman aşımı (sayısal) özel section
 * - `printer` / `scale` / `scanner` / `server` → BU BİLGİSAYARA özel yerel donanım
 *
 * ⚠️ TEK BİR `workstation` KİNDİ VARDI VE İÇİNDE DÖRT ALT SEKME ÇİZİYORDU
 * (2026-09-04'te kaldırıldı, kullanıcı kararı: "bu bilgisayardaki yazıcı, kantar,
 * sunucu vb bunları ayır; bir menü altında ayrı sekmeler olmasın, genel ayarlar
 * içinde yandaki menüde yapabilirsin"). İç içe sekme İKİ ayrı kirli-taslak
 * guard'ı, İKİ ayrı gezinme yüzeyi ve ADRESSİZ bir alt seçim demekti: `?tab=system`
 * hangi cihazın açılacağını söylemiyordu, yani palet/derin bağlantı yazıcıya
 * gidemiyordu. Dört ayrı kategori bu üçünü birden çözer — ray zaten bir menüdür.
 */
export type CategoryKind =
  | "flags"
  | "device"
  | "printer"
  | "scale"
  | "scanner"
  | "server"
  | "company"
  | "session"
  | "label";

/**
 * Genel Ayarlar'ın varsayılan kapısı — sistem GENELİNİ değiştiren her kategori
 * bunu ister (ayar sunucuya yazılır, tüm fabrikayı etkiler).
 */
export const SETTINGS_ADMIN_PERMISSION = "admin:settings";

/**
 * "Bu Bilgisayar" kategorisinin dar izni. Buradaki ayarların hiçbiri sunucuya
 * yazılmaz (yerel `machine-config` deposu) → etkisi tek makineyle sınırlı, o
 * yüzden yazıcısını/kantarını kendisi kuran personele `admin:settings`
 * vermeden atanabilir. Backend aynası: `Teks-Erp` permission-catalog.
 */
export const WORKSTATION_PERMISSION = "settings:workstation";

/**
 * İKİNCİ SEVİYE — kategorileri modüle göre toplayan bölüm başlıkları.
 *
 * NEDEN: 14 kategori tek düz listede "hangi ayar nerede" sorusunu yanıtsız
 * bırakıyordu (2026-08-15 kullanıcı bildirimi: "çok karışık"). Kırılım BİLİNÇLİ
 * OLARAK sığdır — yapraklar (kategoriler) değişmedi, üstlerine yalnız bir
 * başlık katmanı geldi; kategorileri bölüp 20 yaprağa çıkarmak okunurluğu
 * artırmaz, arama kutusu zaten "adını bilen" kullanıcıyı doğrudan götürür.
 */
export type SettingsSectionId =
  | "modules"
  | "sales"
  | "production"
  | "trade"
  | "printing"
  | "workstation"
  | "system"
  | "demo";

/**
 * BİRİNCİ SEVİYE — kategorinin hangi EKRANDA çizildiği (2026-09-04, kullanıcı
 * isteği: "modül flaglarını ayrı bir yere taşıyalım · firmadaki yetkilinin
 * düzenleyebileceği flaglar ayrı bir yerde olsun · güncelleme denetleme ayrı
 * bir yerde olsun · geri kalanlar durabilir").
 *
 *   • `"flags"`    → Sistem → **Özellik Anahtarları** (fabrika yetkilisinin
 *                    düzenlediği DAVRANIŞ bayrakları)
 *   • `"vendor"`   → Sistem → **Modüller** (satın alınan modül anahtarları +
 *                    kurulum beyanı; satıcı ekranı)
 *   • `"printing"`    → Sistem → **Baskı & Cihazlar** (etiket baskısı, cihaz eşleştirme)
 *   • `"workstation"` → Sistem → **Bu Bilgisayar** (yazıcı, kantar, tabanca,
 *                       sunucu adresi — yerel, sunucuya yazmaz)
 *   • `"company"`     → Sistem → **Şirket & Güvenlik** (şirket bilgileri, oturum)
 *
 * 2026-09-24: eski tek "Genel Ayarlar" ekranı bu üçüne bölündü (kullanıcı
 * isteği: her biri ayrı ekran, ayrı yetkiyle). Eski adres `/system/settings`
 * yalnız yönlendirir (`LegacySettingsRedirect`).
 *
 * ⚠️ AYRIM `kind`İN İKİZİ DEĞİL: `kind` satırların NASIL çizildiğini söyler
 * (flags/device/session/…), `surface` HANGİ EKRANDA çizildiklerini. İkisini
 * birleştirmek "yeni bir flags kategorisi eklemek onu otomatik olarak fabrika
 * ekranına koyar" demek olurdu — modül anahtarları da `kind: "flags"`tır.
 *
 * ⚠️ TEK KAYNAK: kategori HANGİ ekranda çiziliyorsa palet/derin bağlantı da
 * ORAYA gitmek zorunda (`settingsCategoryPath`). Ayrışırsa kullanıcı Ctrl+K'dan
 * tıklar, açılan sayfa o sekmeyi bulamaz ve SESSİZCE ilk sekmeye düşer
 * ("Kurşun Sırası" dersinin ayar ekranındaki ikizi). Bekçi:
 * `settings-surface.test.ts`.
 */
export type SettingsSurface = "flags" | "vendor" | "printing" | "workstation" | "company";

/**
 * Bölüm → yüzey. **Kategorinin yüzeyi BÖLÜMÜNDEN TÜRETİLİR** (`categorySurface`);
 * kategoriye ayrı bir `surface` alanı BİLEREK eklenmedi — iki yazar olsaydı bir
 * bölümün altındaki kategorilerden biri başka sayfaya kayar ve ray başlığı
 * yalan söylerdi ("Satış & Sevkiyat" başlığı altında, o sayfada olmayan bir
 * sekme). Yeni bölüm eklerken bu tablo ZORUNLU (Record → derleme düşer).
 */
export const SECTION_SURFACE: Record<SettingsSectionId, SettingsSurface> = {
  modules: "vendor",
  demo: "vendor",
  sales: "flags",
  production: "flags",
  trade: "flags",
  printing: "printing",
  workstation: "workstation",
  system: "company",
};

/** Yüzeyin adresi — palet/derin bağlantı ve route TEK yerden okur. */
export const SURFACE_PATH: Record<SettingsSurface, string> = {
  flags: "/system/feature-flags",
  vendor: "/system/module-profile",
  printing: "/system/printing",
  workstation: "/system/workstation",
  company: "/system/company",
};

/** Eski "Genel Ayarlar" adresi — yalnız yeni ekranlara yönlendirir. */
export const LEGACY_SETTINGS_PATH = "/system/settings";

/**
 * Yüzeyin EKRAN ADI — sayfa başlığı, Sistem karosu ve palet girişleri aynı
 * kelimeyi kullanmak zorunda. Palet "Genel Ayarlar · Muhasebe" derken kullanıcıyı
 * başka bir ekrana atarsa arama sonucu yalan söyler. Bekçi: `settings-surface.test.ts`.
 */
export const SURFACE_LABEL: Record<SettingsSurface, string> = {
  flags: "Özellik Anahtarları",
  vendor: "Modüller",
  printing: "Baskı & Cihazlar",
  workstation: "Bu Bilgisayar",
  company: "Şirket & Güvenlik",
};

/**
 * REJİM kapısı — bir KATEGORİNİN tamamı bu bayrağa bağlıdır. `undefined` → her
 * zaman görünür.
 *
 * ⚠️⚠️ TEK KURAL, KOPYALANAMAZ:
 * **BİR AYAR SATIRI, YÖNETTİĞİ YÜZEYDEN DAHA KATI KAPILANAMAZ.**
 * Bir ayarı rejimle gizlemek ancak o ayarın ENFORCEMENT'ı aynı rejim kapalıyken
 * ULAŞILAMAZ ise meşrudur. Aksi halde davranış çalışmaya devam eder, ayarı ise
 * hiçbir ekrandan kapatılamaz — "açamamak" değil, **AÇTIKTAN SONRA GERİ
 * ALAMAMAK**, ve bu sınıfın tek çıkışı ham `PUT /api/admin/settings/:key`tir.
 *
 * ⚠️ KAPI SEKMEDE (kategori) DEĞİL BÖLÜMDE (başlık) OLAMAZ. Bölüm bir YERLEŞİM
 * öğesidir; "Depo & Muhasebe" başlığı altında hem rejime bağlı (Muhasebe) hem
 * bağlı olmayan (Depo & Satın Alma) bir sekme yan yana durur. Kapıyı başlığa
 * koymak, kapsamı yerleşim tercihine bağlar ve tam da 2026-08-15'te olan şeyi
 * yapar: `goodsReceiptRequirePriceEnabled` (Mal Kabul ekranının kapısı
 * `financeEnabled` DEĞİLDİR — 2026-09-02'den beri `requireTicaretEnabled`)
 * `financeEnabled` kapatılınca panelden tamamen kaybolur ve mal kabul fişleri
 * 400 almaya devam ederdi. Bekçi: `Teks-Erp/scripts/test_feature_flag_contract.ts` §14 — panelde
 * rejimle gizlenen HER bayrağın okuyucusunu tarar ve rejimsiz bir route'tan
 * ulaşılabiliyorsa kırmızı verir.
 *
 * ⚠️ YÖN, operasyon ekranlarındakinin TERSİDİR ve bu bilinçlidir. Karolarda
 * belirsizken GİZLENİR (fabrikada "sıfır görünür fark"); AYARLARDA ise bayrak
 * henüz yüklenmemişken backend VARSAYILANINA düşülür (`productionEnabled ??
 * true`, `financeEnabled ?? false`) — panelin her yerindeki yazım, fabrikada
 * titremeyi de engeller.
 *
 * ⚠️ Rejim ANAHTARLARININ KENDİSİ koşulsuz görünen "Modüller" kategorisinde
 * yaşar, asla kapılı bir kategoride.
 *
 * NOT — `productionEnabled` bugün yine HİÇBİR kategoriyi kapılamaz, ama gerekçe
 * 2026-09-02'de DEĞİŞTİ: backend'de artık `requireProductionEnabled` diye gerçek
 * bir kapı VAR (route.routes · workorder.routes · tambur.routes · … on router).
 * Kategorileri kapılamamasının bugünkü sebebi başka: bu kategorilerdeki ayarların
 * yönettiği davranışların bir kısmı (KK1 tuzağı, scan-back, parti no biçimi)
 * üretim kapısının ARKASINDA DEĞİL — mobil `/api/rolls` bilinçli olarak kapısız.
 * Gizlemek yine yalnız geri dönüş yolunu kapatırdı. Modül-kapalı kategorilerin
 * salt-okunur bandı ayrı bir paketin işidir (P5); o gün bu union genişler.
 * §14 o güne kadar `productionEnabled`ı bir kategori kapısı olarak reddeder.
 *
 * ⚠️ Aynı sebeple `ticaretEnabled`/`iplikEnabled`/`depoMultiEnabled` de bu union'a
 * GİRMEDİ: anahtarların kendisi eklendi (aşağıdaki "Modüller" kategorisi), ama
 * hiçbir kategori onların arkasına alınmadı — "Depo & Muhasebe" bölümü hâlâ
 * `financeEnabled`e bağlıdır ve o karar bu pakette değişmedi.
 */
export type SettingsRegimeKey = "productionEnabled" | "financeEnabled";

/**
 * Bir ayar kategorisini KİLİTLEYEBİLEN modül anahtarları (gizleme DEĞİL — bkz.
 * `SettingsCategory.moduleKey`).
 *
 * ⚠️ Yer tutucu modüller (`kumasTeknikEnabled` / `tezgahEnabled`) bilerek YOK:
 * arkalarında ayar satırı da yüzey de bulunmuyor, union'a girselerdi hiçbir
 * kategoriye konamayan ölü değerler olurlardı. Bekçi (`§14b`) değerlerin
 * backend rejim kapılarıyla (`REGIME_GATES`) birebirliğini ölçer.
 */
export type SettingsModuleKey =
  | "productionEnabled"
  | "financeEnabled"
  | "ticaretEnabled"
  | "iplikEnabled"
  | "depoMultiEnabled"
  | "devereEnabled"
  | "dokumaEnabled";

/** Bölüm = SALT YERLEŞİM (başlık + sıra). Rejim kapısı taşımaz — bkz. yukarıdaki gerekçe. */
export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "modules", label: "Modüller" },
  { id: "sales", label: "Satış & Sevkiyat" },
  { id: "production", label: "Üretim & Kalite" },
  { id: "trade", label: "Depo & Muhasebe" },
  { id: "printing", label: "Baskı & Cihazlar" },
  // ⚠️ AYRI BÖLÜM, `printing` DEĞİL: buradaki dört kategori SUNUCUYA HİÇBİR ŞEY
  // YAZMAZ (yerel `machine-config` + `localStorage`) ve tek makineyi etkiler; o
  // yüzden dar izinle (`settings:workstation`) de görülebilirler. "Baskı &
  // Cihazlar" başlığının altına konsalardı ray, org-geneli "Etiket Baskısı" ile
  // yerel "Yazıcı"yı aynı kümede gösterir ve dar izinli personel yalnız bir
  // kısmını görünce başlık yalan söylerdi.
  { id: "workstation", label: "Bu Bilgisayar" },
  { id: "system", label: "Sistem" },
  // ⚠️ AYRI BÖLÜM, `modules` DEĞİL: `modules` rejim anahtarlarının (`SettingsRegimeKey`)
  // evidir ve oraya konsaydı `demoModeEnabled` de bir rejim anahtarı sanılırdı.
  // Demo modu bir MODÜL değil, kurulumun NE OLDUĞUNA dair bir beyandır.
  { id: "demo", label: "Demo" },
];

export interface SettingsCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  kind: CategoryKind;
  /** Ait olduğu bölüm — TAM BİR tane (bekçi: `settings-groups.test.ts`). */
  section: SettingsSectionId;
  /**
   * Bu kategorinin REJİM kapısı; verilmezse koşulsuz görünür.
   *
   * ⚠️ Yalnız kategorinin TÜM satırlarının enforcement'ı bayrak kapalıyken
   * ulaşılamaz oluyorsa doldurulur (bkz. `SettingsRegimeKey` gerekçesi).
   * Mekanik bekçi: `Teks-Erp/scripts/test_feature_flag_contract.ts` §14.
   */
  regime?: SettingsRegimeKey;
  /**
   * Bu kategorinin satırlarını KİLİTLEYEN modül anahtarı (2026-09-03, P5).
   *
   * ⚠️ `regime`in İKİZİ DEĞİL, `superadminOnly`nin ikizidir:
   *   · `regime`        → kategoriyi GİZLER (hiç çizilmez, herkese)
   *   · `moduleKey`     → satırlar salt-okunur + bant (SATICI görünümünde)
   *   · `superadminOnly`→ aynı kilit, sebebi KİMLİK
   *
   * ⚠️ 2026-09-04 — GÖRÜNÜRLÜK ARTIK SATIRDAN TÜRÜYOR, BU ALANDAN DEĞİL. Kapalı
   * modülün satırları fabrika yöneticisine hiç çizilmez (`flag-modules.ts` →
   * `filterCategoryByModules`) ve kategoriden geriye satır kalmazsa sekme de
   * düşer. Bu alan kilidin (yazma + bant) kaynağı olarak KALDI; iki soru ayrı
   * kaldığı için karma kategori (çekirdek + modül satırı bir arada) hâlâ
   * mümkün. P5'in "gizlemek geri dönüşü kapatır" itirazı, modül anahtarları
   * kendi ekranına (Sistem → Modüller) taşındığı gün geçersizleşti.
   *
   * ⚠️ NEDEN `SettingsRegimeKey` GENİŞLETİLMEDİ: o union GİZLEME kapısıdır ve
   * `test_feature_flag_contract §14` onu ÖLÇER — üretim/ticaret/depo
   * anahtarlarının hiçbiri bugün bir kategoriyi gizleyemez (satırların
   * enforcement'ı rejimsiz yollardan da koşuyor; somut sızıntı zincirleri
   * ölçüldü). Kilit o ölçümün DIŞINDADIR çünkü hiçbir şeyi ulaşılamaz
   * yapmıyor; ölçen bekçi `§14b`.
   *
   * ⚠️ KATEGORİ DÜZEYİ — satır düzeyi (`FlagDef.moduleKey`) BİLİNÇLİ olarak
   * yazılmadı: bant "bu kategoride BAZI satırlar kilitli" demek zorunda kalır
   * ve kullanıcı hangisinin donduğunu satır satır aramak zorunda kalırdı. Karma
   * kategori varsa çözüm kategoriyi BÖLMEKtir (emsal: "Depo & Satın Alma" →
   * "Mal Kabul & Alış" + "İplik", 2026-09-03).
   *
   * ⚠️ `modules` ve `demo` kategorileri bunu ASLA taşımaz (bekçi kilitler):
   * modül anahtarlarının evi kendi kilidinin arkasına konamaz.
   */
  moduleKey?: SettingsModuleKey;
  /**
   * Bu kategoriyi GÖRMEK ve YAZMAK için yeterli izinlerden herhangi biri.
   * Verilmezse `admin:settings` gerekir — yeni kategori eklerken varsayılan DAR
   * olsun diye (izin unutulursa kategori gizlenir; ters kurgu sistem ayarını
   * sızdırırdı). Dar izin backend `constants/settings-scopes.ts`teki aynı kodla
   * yalnız bu kategorinin anahtarlarını yazar (bekçi: `test_settings_scopes`).
   */
  permissionAny?: string[];
  /**
   * YALNIZ masaüstü (Electron) kurulumunda çizilir.
   *
   * ⚠️ İZİN DEĞİL ORTAM kapısıdır ve `visibleSettingsCategories` içinde durur —
   * yani sayfa İLE komut paleti AYNI listeyi görür. Sayfada gizlenip palette
   * bırakılsaydı web kullanıcısı Ctrl+K'dan "Sunucu Adresi"ni bulur, tıklar ve
   * sessizce ilk sekmeye düşerdi (`?tab=` çözülemeyen kategoriye düşer).
   *
   * ⚠️ Donanım kategorileri (yazıcı/kantar/tabanca) bunu TAŞIMAZ: kendi
   * `window.api?.<domain>` kontrolleriyle "yalnız masaüstünde" mesajı basarlar
   * (bkz. `lib/runtime-env` — domain bazlı degrade, toptan gizleme değil). Tek
   * istisna sunucu adresi: web'de API sayfanın origin'idir ve runtime ezmesi
   * kullanıcıyı kendi açamayacağı yanlış adrese kilitler.
   */
  desktopOnly?: boolean;
  /**
   * Bu kategorinin satırlarını YALNIZ satıcı (süperadmin) hesabı yazabilir;
   * fabrika yöneticisi kategoriyi GÖRÜR ama salt-okunur çizilir + bant.
   *
   * ⚠️ İZİN DEĞİL KİMLİK kapısıdır: `admin:settings` taşıyan fabrika admini bu
   * satırları backend'de de yazamaz (`flagWriteGuard` üçüncü dalı → 403
   * `MODULE_FLAG_SUPERADMIN_ONLY`). Ekranı tamamen GİZLEMEK bilinçli olarak
   * REDDEDİLDİ: fabrika hangi modüllerin açık olduğunu görebilmeli, yoksa
   * "menüde niye yok" sorusunun cevabı hiçbir yüzeyde yazmaz.
   *
   * ⚠️ `regime`in İKİZİ DEĞİL: rejim kategoriyi GİZLER, bu KİLİTLER. İkisini
   * aynı alanla anlatmak, "Modüller" kategorisini bir gün kendi anahtarının
   * arkasına almaya davet ederdi — geri dönüşü olmayan tuzak (bkz. kategori
   * başındaki "REJİM ANAHTARLARININ EVİ" notu).
   */
  superadminOnly?: boolean;
  /** kind === "flags" için doldurulur. */
  flags?: FlagDef[];
  /** kind === "flags" sekmesine gömülü sayısal feature-flag alanları (opsiyonel). */
  numberFlags?: NumberFlagDef[];
  /** kind === "flags" sekmesine gömülü KAPALI KÜMELİ (enum) ayarlar (opsiyonel). */
  enumFlags?: EnumFlagDef[];
  textFlags?: TextFlagDef[];
  /** Feature-flag sözleşmesi DIŞINDAKİ ham system-setting alanları (opsiyonel). */
  settingFields?: SettingFieldDef[];
  /**
   * Komut paletinde (arama) bu kategoriyi bulduran ek anahtar kelimeler. İçindeki
   * tek tek ayarların adları/eş anlamlıları burada; aramada görünmez ama eşleşir.
   */
  keywords?: string;
}

/**
 * Genel Ayarlar ekranının domaine bölünmüş kategorileri. Yeni bir özellik anahtarı
 * eklerken: backend `FeatureFlags` kontratına ekle → ilgili kategorinin `flags`
 * dizisine bir satır ekle (başlık + tek cümle + `defaultOn` + `audience`).
 * Sayfa otomatik render eder (ayrı kart/mutation gerekmez).
 */
export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    // ⚠️ REJİM ANAHTARLARININ EVİ. Bu kategori HİÇBİR rejim kapısının arkasında
    // olamaz: `financeEnabled` kapalıyken "Depo & Muhasebe" bölümü gizlenir ve
    // anahtar orada dursaydı ön muhasebe bir daha AÇILAMAZDI (2026-08-05
    // `kk1DuplicateGuardEnabled` dersinin arayüz ikizi: asıl tehlike açamamak
    // değil, geri dönememektir).
    id: "modules",
    label: "Modüller",
    icon: Blocks,
    description:
      "Bu kurulumda hangi modüller açık. Menüler, ekranlar, backend kapıları ve otomatik kancalar bu anahtarlara bakar.",
    keywords:
      "modül rejim üretim muhasebe ön muhasebe finance production aç kapat kurulum fabrika ticaret alım satım iplik kg depo çoklu depo transfer menü gizle",
    kind: "flags",
    section: "modules",
    // Yazma satıcı hesabına ait (backend `flagWriteGuard`ın aynası); fabrika
    // yöneticisi kategoriyi salt-okunur görür. Sistem hesabı HİÇ doğmamış bir
    // kurulumda panel yine yazabilir — supap `systemAccountExists` üzerinden
    // ve backend'deki emniyet supabıyla AYNI kaynaktan (bkz. FeatureFlagSection).
    superadminOnly: true,
    flags: [
      {
        key: "productionEnabled",
        title: "Üretim modülünü aç",
        summary: "Kumaş Stoğu'ndaki üretim sekmeleri ve siparişlerdeki iş emri yüzeyleri çizilir.",
        defaultOn: true,
        audience: ["Planlamacı", "Yönetim"],
        desc: "Açıkken (varsayılan) Kumaş Stoğu'nda üretim sekmeleri ve Siparişler'de iş emri kolonu/aksiyonları görünür. Kapatınca yalnız yüzeyler gizlenir; kayıtlar silinmez. Ön muhasebeden bağımsızdır.",
      },
      {
        key: "financeEnabled",
        title: "Ön muhasebe modülünü aç",
        summary: "Cari, fatura, tahsilat/ödeme, kasa-banka ekranları ve depo/satın alma ayarları açılır.",
        defaultOn: false,
        audience: ["Muhasebeci", "Yönetim"],
        desc: "Açıkken menüde Muhasebe görünür ve sevkiyattan otomatik fatura taslağı doğabilir. Kapalıyken (varsayılan) ekranlar açılmaz, uçlar 403 verir. Kapatmak mevcut kayıtları silmez.",
      },
      // ⚠️ SIRA LOAD-BEARING (görsel değil, iş sırası): İplik satırı Ticaret'in
      // ALTINDA durur çünkü backend bağımlılığı öyle — ticaret kapalıyken iplik
      // açılamaz (400 MODULE_DEPENDENCY). Kullanıcı listeyi yukarıdan aşağı
      // okuyup açtığında doğru sırayı kendiliğinden uygular.
      {
        key: "ticaretEnabled",
        title: "Ticaret modülünü aç",
        summary: "Alış siparişi, mal kabul, fiyat listeleri ve stok sayımı ekranları açılır.",
        defaultOn: false,
        audience: ["Depocu", "Muhasebeci", "Yönetim"],
        desc: "Açıkken alış siparişi, mal kabul, fiyat listesi ve stok sayımı ekranları açılır. Kapalıyken (varsayılan) uçlar 403 verir, karolar çizilmez. Ön muhasebeden bağımsızdır; İplik ve Devere bu modüle bağlıdır.",
      },
      {
        key: "iplikEnabled",
        title: "İplik modülünü aç",
        summary: "İplik kg stok defteri ve hareketleri (giriş/çıkış/sayım düzeltmesi) açılır.",
        defaultOn: false,
        audience: ["Depocu", "Yönetim"],
        desc: "Açıkken iplik kg defteri ve hareketleri açılır. Kapalıyken (varsayılan) uçlar 403 verir. ⚠️ Ticaret modülü kapalıyken açılamaz (kaydetmede hata).",
      },
      {
        // ⚠️ SIRA LOAD-BEARING: Devere, İplik'in ALTINDA durur — zincir üç
        // halkadır (devere → iplik → ticaret) ve kullanıcı listeyi yukarıdan
        // aşağı okuyup açtığında doğru sırayı kendiliğinden uygular.
        key: "devereEnabled",
        title: "Devere / levent modülünü aç",
        summary: "Çözgü kartları ekranı açılır; levent stoğu ve levent defteri sonraki dilimde gelir.",
        defaultOn: false,
        audience: ["Planlamacı", "Yönetim"],
        desc: "Açıkken çözgü kartları ve kartlardaki devere alanları (denye · çözgü kartı) görünür. Kapalıyken (varsayılan) uçlar 403 verir. ⚠️ İplik modülü (o da Ticaret) kapalıyken açılamaz.",
      },
      {
        // ⚠️ SIRA LOAD-BEARING: Dokuma işi, Üretim'in ALTINDA durur (ön koşul
        // `production.enabled`); tezgah izlemenin KARDEŞİDİR, çocuğu değil.
        key: "dokumaEnabled",
        title: "Dokuma işi modülünü aç",
        summary:
          "Dokuma İşleri ekranı (planlama · kapat · iptal) açılır; tezgah koşumu ve top indirme uçları çalışır.",
        defaultOn: false,
        audience: ["Planlamacı", "Yönetim"],
        desc: "Açıkken Dokuma İşleri ekranı, tezgah koşumu ve top indirme uçları açılır. Kapalıyken (varsayılan) 403 verir, karo çizilmez. ⚠️ Üretim modülü kapalıyken açılamaz.",
      },
      {
        key: "depoMultiEnabled",
        title: "Çoklu depo modülünü aç",
        summary: "Depo seçicileri, listelerdeki depo kolonu ve depolar arası transfer ekranı açılır.",
        defaultOn: false,
        audience: ["Depocu", "Yönetim"],
        desc: "Açıkken depo seçicileri, depo kolonu ve Depo Transferi ekranı gelir. Kapalıyken (tek depolu varsayılan) hepsi gizlenir, transfer uçları 403 verir. Depo tanımı ve defteri her iki modda da yaşar.",
      },
      {
        key: "emanetEnabled",
        title: "Emanet / konsinye mülkiyet modülünü aç",
        summary:
          "Top, levent ve iplik lotunda “sahibi olan müşteri” alanı açılır; emanet mal yalnız sahibine sevk edilir.",
        defaultOn: false,
        audience: ["Depocu", "Planlamacı", "Yönetim"],
        desc: "Açıkken top, levent ve iplik lotunda “sahibi olan müşteri” alanı açılır; emanet mal ayrı sayılır. Kapalıyken (varsayılan) alan çizilmez, yazılamaz ve her mal fabrikanın sayılır.",
      },
      // ⚠️ `kumasTeknikEnabled` ve `tezgahEnabled` BİLEREK BURADA YOK: arkalarında
      // henüz hiçbir yüzey/kapı yok, satırları yalnız "açtım ama hiçbir şey
      // olmadı" üretirdi. Backend sözleşme bekçisinde gerekçeli muaf listesinde
      // (`PANEL_EXEMPT`) duruyorlar; yüzey doğduğu gün buraya eklenirler.
    ],
  },
  {
    id: "customers",
    label: "Müşteriler",
    icon: UsersRound,
    description: "Müşteri kartı ve şube (sevk noktası) davranışı.",
    keywords:
      "müşteri şube sevk noktası branch ihracat kodu kart firma tedarikçi sevk yeri gizle mükerrer birleştirme benzer ad bulanık eşik duplicate",
    kind: "flags",
    section: "sales",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:customers"],
    flags: [
      {
        key: "customerBranchesEnabled",
        title: "Müşteri şubeleri (sevk noktaları) özelliğini göster",
        summary: "Müşteri kartında Şubeler sekmesi ve sipariş formunda şube seçimi görünür.",
        defaultOn: true,
        audience: ["Planlamacı", "Sevkiyat"],
        desc: "Açıkken (varsayılan) müşteri kartında Şubeler sekmesi ve sipariş/sevk formlarında şube seçimi görünür. “Her şube ayrı müşteri” düzeninde çalışan firma kapatır; mevcut şube kayıtları silinmez.",
      },
      {
        key: "duplicatesFuzzyEnabled",
        group: "Mükerrer kayıtlar",
        title: "Mükerrer taramasında BENZER adları da aday göster (bulanık eşleştirme)",
        summary:
          "Mükerrer Kayıtlar ekranı yalnız birebir aynı adı değil, BENZER adları da aday olarak listeler.",
        defaultOn: true,
        audience: ["Yönetim"],
        desc: "Açıkken (varsayılan) Mükerrer Kayıtlar ekranı benzer adları da aday listeler (‘ŞAHİN TEKSTİL A.Ş.’ ~ ‘Sahin Tekstil Ltd.’). Aday yalnız gösterilir, birleştirme yapılmaz; eşik aşağıdaki alandan.",
        numberField: {
          numberKey: "duplicatesFuzzyThresholdPct",
          label: "Benzerlik eşiği",
          unit: "%",
          min: 50,
          max: 100,
          emptyWarning:
            "Boş bırakılırsa fabrika varsayılanı (%90) kullanılır. 90 = neredeyse aynı; 70'in altı gürültü üretir.",
        },
      },
    ],
  },
  {
    id: "orders",
    label: "Siparişler",
    icon: Banknote,
    description: "Sipariş ekranlarındaki fiyat alanları, varsayılan termin ve 'tamamlandı' sayma toleransı.",
    keywords:
      "fiyat para birimi birim fiyat tutar döviz kur pricing sipariş termin deadline gün süre varsayılan vade teslim tarih " +
      "tolerans eksik sevk tamamlandı kapanma metre karşılanma",
    kind: "flags",
    section: "sales",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:orders"],
    flags: [
      {
        key: "pricingEnabled",
        title: "Sipariş para birimi ve fiyat alanlarını göster",
        summary: "Sipariş ekranlarında para birimi, birim fiyat ve toplam tutar çizilir.",
        defaultOn: false,
        audience: ["Planlamacı", "Muhasebeci"],
        desc: "Kapalıyken sipariş ekranlarında para birimi, birim fiyat ve toplam tutar gizlenir. Mevcut değerler korunur; veri kaybı yok.",
      },
      {
        key: "itemPhaseOutNewPlan",
        title: "Tükenene kadar karta yeni üretim planı",
        summary: "Tükenene kadar karta topsuz ve siparişsiz iş emri ya da dokuma işi açılabilsin mi.",
        defaultOn: true,
        audience: ["Planlamacı"],
        group: "Ürün yaşam döngüsü",
        desc: "Açıkken (varsayılan) Tükenene kadar karta yeni iş emri açılabilir ama yalnız mevcut stok tüketilir — belgesiz yeni stok girişi yine kapalıdır. Kapalıyken yalnız mevcut topları okutarak iş emri açılır. Kartı yeniden doldurmak isteyen fabrika kartı Aktif'e döndürür.",
      },
    ],
    enumFlags: [
      {
        enumKey: "itemPhaseOutNewOrder",
        title: "Tükenene kadar karta yeni sipariş",
        summary: "Kullanımdan kaldırılan (Tükenene kadar) karta yeni sipariş satırı nasıl açılsın.",
        defaultValue: "OKUTULAN_TOPLAR",
        options: PHASE_OUT_NEW_ORDER_OPTIONS,
        audience: ["Planlamacı", "Sevkiyat"],
        group: "Ürün yaşam döngüsü",
        display: "radio",
        desc: "“Yalnız okutulan toplar” (varsayılan): yeni sipariş yalnız toplardan hızlı siparişle açılır. “Kapalı”: hiç yeni sipariş açılmaz — sevkte sipariş zorunluysa mal yalnız “Siparişsiz devam et” ile sevk edilir. “Serbest”: normal kart gibi.",
      },
      {
        enumKey: "itemPhaseOutLineQty",
        title: "Tükenene kadar kartın açık satırında miktar",
        summary: "Açık sipariş satırında miktar değiştirilebilsin mi.",
        defaultValue: "SERBEST_UYARILI",
        options: PHASE_OUT_LINE_QTY_OPTIONS,
        audience: ["Planlamacı"],
        group: "Ürün yaşam döngüsü",
        display: "radio",
        desc: "“Serbest, uyarılı” (varsayılan): artırma ve azaltma serbest, kısa bir stok uyarısı görünür. “Yalnız azaltma”: artırma reddedilir. “Kilitli”: miktar değişmez.",
      },
    ],
    settingFields: [
      {
        key: RAW_SETTING_KEYS.ORDER_DEFAULT_DEADLINE_DAYS,
        title: "Sipariş termini varsayılanı",
        desc: "Sipariş açılırken termin boş bırakılırsa sipariş tarihine bu kadar gün eklenir. Girilen termini ETKİLEMEZ, mevcut siparişlere dokunmaz.",
        min: 1,
        max: 365,
        fallback: 7,
        unit: "gün",
        savedDesc: "Sipariş termini varsayılan gün sayısı (boş bırakılırsa kullanılır)",
        audience: ["Planlamacı"],
      },
      {
        // 2026-08-15 envanter denetiminin (a) sınıfı: bu ayar sipariş
        // KAPANIŞINI belirliyordu ve panelde HİÇBİR yüzeyi yoktu — yalnız
        // `PUT /api/admin/settings/:key` ucundan, yani hiçbir ekrandan.
        key: RAW_SETTING_KEYS.SHIPPING_TOLERANCE_METERS,
        title: "Sipariş tamamlanma toleransı",
        desc: "Bir sipariş kalemi istenenden bu kadar metre EKSİK sevk edilmiş olsa bile sipariş TAMAMLANDI sayılır (kumaşta birebir metraj tutmaz). 0 yazılırsa tolerans yoktur: metrenin tamamı sevk edilmeden sipariş kapanmaz. Fazla sevk bu ayardan bağımsızdır. Değişiklik yalnız bundan SONRAKİ hesaplamalarda geçerlidir — kapanmış siparişler yeniden açılmaz.",
        min: 0,
        max: 100,
        fallback: 5,
        unit: "m",
        savedDesc: "Sipariş tamamlanma toleransı (metre)",
        audience: ["Sevkiyat", "Planlamacı"],
      },
    ],
  },
  {
    id: "shipping",
    label: "Sevkiyat & İade",
    icon: Truck,
    description: "Sevk çıkış akışı, çuval kodu üretimi ve iade kabul davranışı.",
    keywords:
      "sevk onayı adımı çıkış sevkiyat planlı sevk kapısı iade kalite grading depo çuval kodu şablon otomatik isimlendirme numara",
    kind: "flags",
    section: "sales",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:shipping"],
    flags: [
      {
        key: "shipmentConfirmationEnabled",
        title: "Sevk onayı adımı",
        summary:
          "Sevk iki adıma bölünür: önce planlı sevkiyat kurulur, çıkış ayrıca Sevk Kapısı'ndan onaylanır.",
        defaultOn: false,
        audience: ["Sevkiyat"],
        desc: "Açıkken sevkiyat önce “planlı” kurulur, fiili çıkış Sevk Kapısı'ndan onaylanır. Kapalıyken (varsayılan) çuvallar seçilince doğrudan sevk edilir. Stok iki modda da yalnız çıkışta düşer.",
      },
      {
        key: "shipmentManualSackCountEnabled",
        title: "Çuval sayısını elle gir",
        summary:
          "Sevkiyat ekranında 'araca yüklenen çuval adedi' alanı açılır; irsaliyede sistem sayısıyla YAN YANA basılır.",
        defaultOn: false,
        audience: ["Sevkiyat"],
        desc: "Açıkken sevkiyat ekranında “araca yüklenen çuval adedi” alanı çıkar ve irsaliyeye bu sayı basılır. Kapalıyken (varsayılan) sistemin saydığı çuval adedi kullanılır.",
      },
      {
        key: "shipmentUndoSameDayOnly",
        title: "Sevk geri almayı aynı günle sınırla",
        summary: "Yalnız bugün sevk edilmiş sevkiyatlar geri alınabilir.",
        defaultOn: false,
        audience: ["Sevkiyat", "Yönetim"],
        desc: "Açıkken yalnız bugün sevk edilmiş sevkiyat geri alınabilir. Kapalıyken (varsayılan) tarih sınırı yoktur. Geri alma irsaliyeyi iptal eder, toplar rafa döner (mal hiç çıkmadıysa kullanılır).",
      },
      {
        key: "returnGradingEnabled",
        title: "İade kabulünde personel kaliteyi değiştirebilsin",
        summary: "Teslim alan personel iade edilen topun kalitesini düzeltebilir.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Açıkken iade teslim alan personel topun kalitesini düzeltebilir (etiket değişir). Kapalıyken tablette kalite kontrolü gizlenir, top çıktığı kaliteyle döner; backend de kalite değişikliğini reddeder.",
      },
      {
        key: "shippingSimulatedWeightEnabled",
        title: "Simüle kantardan gelen çuval tartısı kaydedilebilsin (demo/eğitim)",
        summary:
          "Simülasyon modundaki kantarın ürettiği rastgele kg değeri kabul edilir — yalnız demo kurulumu.",
        defaultOn: false,
        audience: ["Sevkiyat", "Yönetim"],
        desc: "Açıkken “simülasyon” işaretli kantardan gelen rastgele kg kabul edilir — yalnız demo/eğitim için. Kapalıyken (varsayılan) backend bu kg'yi reddeder (400). Kg belgeye basıldığı için gerçek kurulumda kapalı kalır.",
      },
      {
        key: "shippingAllowOverAllocation",
        title: "Sipariş miktarını aşan mal da siparişe yazılsın",
        summary: "Ismarlanandan fazla gönderilen metraj sipariş defterine “fazla sevk” olarak işlenir.",
        defaultOn: false,
        audience: ["Sevkiyat", "Muhasebeci"],
        group: "Sipariş eşleştirme",
        desc: "Açıkken siparişten fazla gönderilen metraj da siparişe “fazla sevk” olarak yazılır. Kapalıyken (varsayılan) tahsis sipariş miktarını aşamaz; fazlası hiçbir satıra işlenmez ve sipariş açık kalır.",
      },
      {
        key: "shippingAllocWidthToleranceEnabled",
        title: "Siparişe yazarken en farkını hoş gör",
        summary: "Topun eni sipariş satırındakinden az farklıysa yine o siparişe yazılsın.",
        defaultOn: false,
        audience: ["Sevkiyat", "Planlamacı"],
        group: "Sipariş eşleştirme",
        desc: "Açıkken topun eni sipariş satırından en fazla aşağıdaki kadar farklıysa yine o siparişe yazılır. Kapalıyken (varsayılan) en tam eşleşmek zorundadır. Kumaş ve renk her zaman kesin eşleşir.",
        numberField: {
          numberKey: "shippingAllocWidthToleranceCm",
          label: "Kabul edilen en farkı",
          unit: "cm",
          min: 1,
          max: 10,
          emptyWarning: "Boş bırakılırsa 1 cm kullanılır. Sahada gördüğünüz gerçek sapmadan büyük seçmeyin.",
        },
      },
      {
        key: "shippingDocProductColorSplit",
        title: "İrsaliye ürün listesinde müşteri rengi ayrı sütun",
        summary: "Müşteri adı tek hücrede birleşik yazmak yerine, renk kendi sütununa çıkar.",
        defaultOn: false,
        audience: ["Sevkiyat", "Muhasebeci"],
        group: "Belge",
        desc: "Açıkken irsaliye ürün listesinde müşteri rengi ayrı sütuna çıkar; müşterinin kendi renk adı yoksa hücre boş kalır. Kapalıyken (varsayılan) kumaş + renk + en tek hücrede yazar. ⚠️ Müşteriye giden belgeyi değiştirir.",
      },
      {
        key: "packingGroupsEnabled",
        title: "Paketleme grubu (çuvalları partilere ayır)",
        summary: "Havuzdaki çuvallar “P1 / P2” diye ayrılır; sevk butonu yalnız açık grubu gönderir.",
        defaultOn: false,
        audience: ["Sevkiyat", "Depocu"],
        group: "Paketleme",
        desc: "Açıkken havuzdaki çuvallar gruplara (P1, P2 …) ayrılır ve “Hemen Sevk Et” yalnız seçili grubu gönderir. Kapalıyken (varsayılan) havuz tek düz listedir ve dolu her çuval gider.",
      },
      {
        key: "packageNoStartsAtZero",
        title: "Ambalaj numarası 0’dan başlasın",
        summary: "Sevk partisinde ilk çuval 0 numarasını alır (kapalı = 1).",
        defaultOn: false,
        audience: ["Sevkiyat", "Depocu"],
        group: "Sevk partisi",
        desc: "Açıkken sevk partisinde ilk çuval 0 numarasını alır. Kapalıyken (varsayılan) 1'den başlar. Yalnız yeni açılan partileri etkiler; yalnız sevk partisi modunda anlamlıdır.",
      },
      {
        key: "packingLotRequired",
        title: "Her çuval bir sevk partisinde doğsun",
        summary: "Partisiz çuval açma engellenir. ⚠️ Tablet çuval açamaz.",
        defaultOn: false,
        audience: ["Sevkiyat", "Depocu"],
        group: "Sevk partisi",
        desc: "Açıkken partisiz çuval açma isteği reddedilir (400). Kapalıyken (varsayılan) havuza partisiz çuval açılır, sonra partiye alınır. ⚠️ Bu sürümde tablet parti seçmeden çuval açar — tablet güncellenene kadar açmayın.",
      },
      {
        key: "packingLotPartialDispatch",
        title: "Sevk partisinin bir kısmı sevk edilebilsin",
        summary: "Partiden seçilen çuvallar gider, parti yaşamaya devam eder (kapalı = parti bütün gider).",
        defaultOn: true,
        audience: ["Sevkiyat", "Depocu"],
        group: "Sevk partisi",
        desc: "Açıkken (varsayılan) partiden seçilen çuvallar gider, kalanlar partide açık kalır. Kapalıyken sevk kurulurken partinin açık çuvallarının tamamı seçilmelidir (eksik seçim 400). Partisiz çuvallar etkilenmez.",
      },
      {
        key: "shippingDocPackingLot",
        title: "İrsaliye ve çeki listesinde parti adı + ambalaj numarası",
        summary: "Çuval satırında ambalaj no ve sevk partisi adı kolonları basılır.",
        defaultOn: false,
        audience: ["Sevkiyat", "Muhasebeci"],
        group: "Belge",
        desc: "Açıkken irsaliye ve çeki listesinde çuval satırına “Ambalaj No” ve “Sevk Partisi” kolonları gelir; partisiz çuvalda boş kalır. Kapalıyken (varsayılan) standart çıktı. ⚠️ Müşteriye giden belgeyi değiştirir.",
      },
      {
        key: "shippingSackSeqOnDoc",
        title: "İrsaliye ve çeki listesinde sevkiyat içi çuval sırası",
        summary:
          "Her çuval satırına “Sıra” kolonu (1, 2, 3 … ya da SP1, P-1 …) basılır; başlangıç numarası seçilir.",
        defaultOn: false,
        audience: ["Sevkiyat", "Muhasebeci"],
        group: "Belge",
        desc: "Açıkken irsaliye ve çeki listesine “Sıra” kolonu gelir (sevk anında verilen 1, 2, 3 …; başlangıç aşağıdaki alandan). Kapalıyken (varsayılan) sayı yalnız sıralamada kullanılır, basılmaz. Yalnız yeni sevkiyatları etkiler.",
        numberField: {
          numberKey: "shippingSackSeqStart",
          label: "Başlangıç numarası",
          unit: "",
          min: 0,
          max: 999,
          emptyWarning: "Boş bırakılırsa 1’den başlar.",
        },
      },
      {
        key: "shippingSackSeqShowTotal",
        title: "Sıra etiketinde toplam da yazılsın (3/100)",
        summary: "“SP3/100” gibi — kaç çuvalın kaçıncısı olduğu görünür.",
        defaultOn: false,
        audience: ["Sevkiyat", "Depocu"],
        group: "Belge",
        desc: "Açıkken sıra etiketi “3/100” biçiminde basılır (toplam = sevkiyattaki çuval sayısı). Yalnız sıra kolonu açıkken anlamlıdır; biçim her baskıda canlı okunur.",
      },
      {
        key: "shippingSackSeqPrefixLive",
        title: "Ön ek değişince eski belgeler de değişsin",
        summary: "Kapalı (önerilen): her belge sevk anındaki ön ekle kalır. Açık: yeniden baskı ayarlardaki güncel ön eki kullanır.",
        defaultOn: false,
        audience: ["Sevkiyat", "Muhasebeci"],
        group: "Belge",
        desc: "Kapalıyken (varsayılan, önerilen) ön ek sevk anında belgeye donar; ayar sonradan değişse de eski irsaliyeler aynı basılır. Açıkken her yeniden baskı ayarlardaki güncel ön eki kullanır — geçmiş belgeler değişir.",
      },
      {
        key: "shippingWeighRequiredEnabled",
        title: "Sevk öncesi tüm çuvallar tartılmış olsun",
        summary: "Yurtiçi sevkte de tartı zorunlu olur; tartısız çuval varken sevkiyat kurulamaz.",
        defaultOn: false,
        audience: ["Sevkiyat", "Depocu"],
        group: "Tartı",
        desc: "Açıkken yurtiçi sevkte de tüm çuvalların tartılı olması gerekir; tartısız çuval varken sevkiyat kurulamaz. Kapalıyken (varsayılan) tartı yalnız yurtdışı sevkte zorunludur. Çuvalın içeriği değişirse kg SIFIRLANIR — çuval yeniden tartılır.",
      },
      {
        key: "shippingManualWeightRestrictedEnabled",
        title: "Elle kg girişini sevkiyat sorumlusuyla sınırla",
        summary: "Tablet operatörü kantardan tartar; elle kg yalnız sevkiyat yazma yetkisi olan kişide.",
        defaultOn: false,
        audience: ["Sevkiyat", "Operatör"],
        group: "Tartı",
        desc: "Açıkken elle kg girişi yalnız sevkiyat yazma yetkisi olan kullanıcıya açıktır; tablet operatörü kantardan tartar. Kapalıyken (varsayılan) herkes elle girebilir. ⚠️ ÖNKOŞUL: önce tüm tablet ve paneller güncel sürüme geçmiş olmalı; eski istemci elle/kantar ayrımını göndermez.",
      },
    ],
    textFlags: [
      {
        textKey: "shippingSackSeqPrefix",
        title: "Sevkiyat içi çuval sırası ön eki",
        summary: "Serbest metin, en çok 8 karakter: “SP” → SP1, “P-” → P-1, “Çuval ” → Çuval 1. Boş = yalnız sayı.",
        desc: "Belgedeki sıra etiketinin ön eki (SP1, P-1, Çuval 1). Sayı sevk anında donar; ön ek de sevk anında belgeye yazılır — sonradan değiştirmek eski belgeleri etkilemez (“eski belgeler de değişsin” açılmadıkça). Yalnız sıra kolonu açıkken görünür.",
        defaultValue: "",
        maxLength: 8,
        // ⚠️ SUNUCUNUN YAZMA YÜKLEMİNİN AYNASI — `system-setting.service.ts`
        // `SHIPPING_SACK_SEQ_PREFIX_WRITE_RE`. Eğik çizgi YOK: dosya/sayfa adını
        // kırar. Ayrı proje olduğu için import edilemez; eşliği backend bekçisi
        // `test_sack_seq_label` §5 METİN olarak ölçer — burayı gevşetmek kırmızı verir.
        pattern: /^[\p{L}\p{N}\-_. ]{0,8}$/u,
        placeholder: "örn. SP  ·  P-  ·  Çuval ",
        invalidHint: "Yalnız harf, rakam, - _ . ve boşluk; en çok 8 karakter.",
        audience: ["Sevkiyat", "Muhasebeci"],
        group: "Belge",
      },
    ],
    enumFlags: [
      {
        enumKey: "sackDumpNameMode",
        title: "Çuval/grup içerik dökümünde ad",
        summary: "Excel ve PDF dökümünde kumaş+renk adı bizden mi, müşteriden mi, ikisi birden mi.",
        defaultValue: "ikisi",
        options: SACK_DUMP_NAME_MODE_OPTIONS,
        audience: ["Sevkiyat", "Depocu"],
        group: "Paketleme",
        desc: "Çuval/grup içerik dökümünün (Excel · PDF) varsayılan ad rejimi. “İkisi” (varsayılan) standart çıktıdır. Döküm penceresinden tek seferlik başka mod seçilebilir; o seçim bu ayarı değiştirmez.",
      },
      {
        enumKey: "packingGroupNumbering",
        title: "Paketleme grubu numarası nasıl artsın",
        summary: "Sevk edilip boşalan numara yeniden kullanılsın mı, yoksa hep ileri mi gitsin.",
        defaultValue: "artan",
        options: PACKING_GROUP_NUMBERING_OPTIONS,
        audience: ["Sevkiyat", "Depocu"],
        group: "Paketleme",
        desc: "Grup numarası kimlik değil park yeridir: belgeye basılmaz, grup boşalınca serbest kalır. “Artan” (varsayılan) hep ileri gider; “Boşluğu doldur” en küçük boş numarayı verir. Yalnız paketleme grubu açıkken anlamlıdır.",
      },
      {
        enumKey: "packingGroupMode",
        title: "Paketleme grubu davranışı",
        summary: "Grup bir çalışma yaftası mı (varsayılan), yoksa numaralı çuvallar taşıyan SEVK PARTİSİ mi.",
        defaultValue: "grup",
        options: PACKING_GROUP_MODE_OPTIONS,
        audience: ["Sevkiyat", "Depocu"],
        group: "Sevk partisi",
        desc: "“Paketleme grubu” (varsayılan): grup bir çalışma yaftasıdır, boşalınca görünmez olur, çuvala numara verilmez. “Sevk partisi”: parti açık/kapalı durum taşır, her çuval ambalaj numarası alır ve belgeye basılabilir.",
      },
      {
        enumKey: "packageNoMode",
        title: "Ambalaj numarası nasıl verilsin",
        summary: "Sayaçtan mı, sayaçtan ama ezilebilir mi, tamamen elle mi.",
        defaultValue: "otomatik-ezilebilir",
        options: PACKAGE_NO_MODE_OPTIONS,
        audience: ["Sevkiyat", "Depocu"],
        group: "Sevk partisi",
        desc: "“Otomatik, ezilebilir” (varsayılan): sayaç verir, kullanıcı değiştirebilir. “Otomatik”: alan salt-okunur. “Elle”: numara zorunlu, sayaç ilerlemez. Aynı partide aynı numara iki açık çuvalda olamaz. Yalnız sevk partisi modunda.",
      },
      {
        enumKey: "packingPoolPackageNo",
        title: "Partisiz çuvalın ambalaj numarası ne zaman doğsun",
        summary: "Sevkte (sevk sırası) ya da çuval açılırken (carinin havuz sayacı).",
        defaultValue: "sevkte",
        options: PACKING_POOL_PACKAGE_NO_OPTIONS,
        audience: ["Sevkiyat", "Depocu"],
        group: "Sevk partisi",
        desc: "Partisiz (havuz) çuval içindir. “Sevkte” (varsayılan): çuval numarasız yaşar, sevkte sevkiyat sırasını alır. “Çuval açılırken”: carinin havuz sayacından numara alır, sevkte de kalır; müşterisiz çuval numara almaz.",
      },
      {
        enumKey: "packageNumbering",
        title: "Ambalaj numarası sayacı",
        summary: "Giden/çıkarılan çuvalın numarası geri verilsin mi.",
        defaultValue: "artan",
        options: PACKAGE_NUMBERING_OPTIONS,
        audience: ["Sevkiyat", "Depocu"],
        group: "Sevk partisi",
        desc: "“Artan” (varsayılan): verilen numara geri verilmez, çıkarılan 7'nin yerine sonraki çuval 8 olur. “Boşluğu doldur”: en küçük boş numara verilir — sevk edilmiş bir numara yeniden doğabilir. Yalnız sevk partisi modunda.",
      },
      {
        enumKey: "shippingOrderRequirement",
        title: "Sevkiyat siparişe bağlansın mı",
        summary: "Siparişsiz sevkte ne yapılsın: sorma · uyar (varsayılan) · zorunlu tut.",
        defaultValue: "warn",
        options: SHIPMENT_ORDER_REQUIREMENT_OPTIONS,
        audience: ["Sevkiyat", "Planlamacı"],
        desc: "Siparişsiz sevkte ne olsun: “Sorma” · “Uyar” (varsayılan: sevkiyat kurulur, uyarı görünür) · “Zorunlu tut” (sipariş seçilmeden kurulmaz). ⚠️ ÖNKOŞUL: “Zorunlu tut” için tablette sipariş seçici olan APK kurulu olmalı; yoksa sahada sevk kurulamaz.",
      },
      {
        enumKey: "shippingInvoiceMode",
        title: "Fatura izi nereden yazılsın",
        summary: "Sevkin fatura numarası dış programdan elle mi işaretlensin, ERP faturasından mı gelsin.",
        defaultValue: "dis",
        options: SHIPPING_INVOICE_MODE_OPTIONS,
        audience: ["Muhasebeci", "Sevkiyat"],
        desc: "“Dış programdan” (varsayılan): fatura başka programda kesilir, buraya numara ve tarih elle işaretlenir. “Yalnız ERP faturası”: elle işaretleme kapanır, numara Muhasebe'deki faturadan gelir.",
      },
      {
        enumKey: "shippingDocItemNameMode",
        title: "Sevk belgesinde ürün adı",
        summary: "İrsaliyede kendi ürün adımız mı, müşterinin kullandığı ad mı, yoksa ikisi de mi yazsın.",
        defaultValue: "bizdeki",
        options: SHIPPING_DOC_ITEM_NAME_MODE_OPTIONS,
        audience: ["Sevkiyat", "Muhasebeci"],
        desc: "İrsaliyede ürün adı: bizim adımız (varsayılan) · müşterinin kullandığı ad · ikisi. Müşteri adı önce sipariş satırındaki tek seferlik addan, yoksa müşteri kartındaki karşılıktan gelir; o da yoksa bizim ad basılır.",
      },
      {
        enumKey: "shippingOrderCoverage",
        title: "Siparişe yazılamayan mal",
        summary: "Çuvaldaki mal seçili siparişlere yazılamıyorsa ne olsun — sessiz mi, uyarı mı, engel mi.",
        defaultValue: "off",
        options: SHIPPING_ORDER_COVERAGE_OPTIONS,
        audience: ["Sevkiyat", "Planlamacı"],
        desc: "Seçilen siparişe yazılamayan mal için: “Sessiz” · “Uyar” (varsayılan) · “Zorunlu tut” (sevkiyat kurulmaz; bilinçli fazla/numune için “siparişsiz mal” kutusu işaretlenir). Kapı yalnız kurulumda çalışır, çıkışta değil.",
      },
      {
        enumKey: "shippingDocCekiNameMode",
        title: "Çeki listesinde ad",
        summary:
          "Çeki listesi üstteki ayarı mı izlesin, yoksa kendi kuralı mı olsun (ör. hem bizim hem müşterinin adı).",
        defaultValue: "devral",
        options: SHIPPING_DOC_CEKI_NAME_MODE_OPTIONS,
        audience: ["Sevkiyat", "Depocu"],
        desc: "Çeki listesinin ad rejimi. “Genel ayarı izle” (varsayılan) üstteki irsaliye ayarını uygular; diğer seçenekler yalnız çeki bölümünü çevirir. Çeki listesi tek başına da basılıp ambarda kontrol listesi olarak kullanılır.",
      },
    ],
  },
  {
    id: "work-orders",
    label: "İş Emirleri",
    icon: ClipboardList,
    description: "İş emri formundaki alanlar, parti kodu davranışı ve varsayılan planlama süresi.",
    keywords:
      "iş emri hedef metraj parti kodu batch otomatik üretim miktarı termin planlama süre gün varsayılan deadline plan parti no kısa dönen 99 plaka numara",
    kind: "flags",
    section: "production",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:work-orders"],
    // ÜRETİM MODÜLÜ — KİLİT (gizleme DEĞİL). Beş satırın beşi de iş emri/parti
    // nesnesine ait: üretim kapalıyken iş emri açılamaz (`workorder.routes` →
    // `requireProductionEnabled`), yani parti no biçimi ya da planlama süresi
    // ayarlanacak bir şey kalmaz. Kategori GÖRÜNÜR kalır ki fabrika değerleri
    // görsün ve modülü açtığı an düzenleyebilsin.
    moduleKey: "productionEnabled",
    flags: [
      {
        key: "targetQuantityEnabled",
        title: "İş emri hedef metraj alanını göster",
        summary: "İş emri formunda 'hedef metraj' alanı çizilir.",
        defaultOn: false,
        audience: ["Planlamacı"],
        desc: "Kapalıyken iş emri formunda “hedef metraj” alanı gizlenir; üretim miktarını girilen kumaş belirler. Örgü/üretim eklenirse açılır.",
      },
      {
        key: "partyCodeAuto",
        title: "İş emri parti kodunu otomatik üret",
        summary: "İş Emri No elle yazılmak yerine sistem tarafından önerilir.",
        // ⚠️ VARSAYILAN `true` OLDU (D3③): bayrak artık `workOrder.numberSource`tan
        // türetiliyor ve o serinin varsayılanı `FREE` ⇒ türetilmiş değer `true`.
        // Panelin rozeti backend okuyucusuyla BİREBİR olmak zorunda (bekçi
        // `test_feature_flag_contract` ölçer); `false` bırakmak ekranda "varsayılan
        // kapalı" yazarken sunucunun açık dönmesi demekti.
        defaultOn: true,
        audience: ["Planlamacı"],
        desc:
          "Açıkken İş Emri No sistem tarafından üretilir (İE + GGAAYY + sıra), formda yine değiştirilebilir. "
          + "Kapalıyken elle girilir ve zorunludur. "
          + "⚠️ Bu anahtar artık Ayarlar → Numaralandırma ekranındaki “numara kaynağı” ayarının iki değerli "
          + "kısayoludur; oradaki üçüncü seçenek (“yalnız sistem” — elle giriş YASAK) bu anahtarla "
          + "ifade edilemez ve bu anahtar o seçimi bozmaz.",
      },
      {
        key: "batchShortNumberEnabled",
        title: "Parti no kısa ve dönen olsun",
        summary: "Parti numarası kısa bir aralıkta gidip başa döner — fabrikadaki plaka düzeninin karşılığı.",
        defaultOn: true,
        audience: ["Planlamacı", "Operatör"],
        desc: "Açıkken (varsayılan) parti numarası kısa bir aralıkta döner — fabrikadaki plaka düzeni. Aralığın kendisi (ön ek, hane, alt/üst sınır, başa dönme) Ayarlar → Numaralandırma ekranındaki “Parti no (kısa, dönen)” serisinden değiştirilir; aşağıdaki satır yürürlükteki aralığı gösterir. ⚠️ Numara benzersiz değildir; kimlik parti kaydının kendisidir. Kapalıyken uzun, tekil numara üretilir.",
        hint: BatchNumberHint,
      },
      {
        key: "batchLastNumberHintEnabled",
        title: "İş emri formunda 'Son Kullanılan Parti No' rozetini göster",
        summary: "Yeni iş emri formunda son verilen parti numarası rozet olarak gösterilir.",
        defaultOn: true,
        audience: ["Planlamacı"],
        desc: "Açıkken (varsayılan) yeni iş emri formunda son verilen parti numarası rozet olarak görünür. Sıradaki numarayı vaat etmez; numara parti doğduğu anda verilir.",
      },
      {
        key: "batchAutoCreateEnabled",
        title: "Açık parti yokken partiyi sistem kendisi açsın",
        summary:
          "Tambur'dan elle top eklerken iş emrinde hiç açık parti yoksa sistem yeni bir parti açıp topu ona bağlar.",
        defaultOn: false,
        audience: ["Planlamacı", "Operatör"],
        desc: "Açıkken Tambur'da elle top eklenirken iş emrinde açık parti yoksa sistem yeni parti açar ve topu ona bağlar. Kapalıyken (varsayılan) top partisiz doğar. ⚠️ ÖNKOŞUL: parti numarası üreteci açık olmalı; kapalıysa elle top ekleme parti bulamaz.",
      },
    ],
    settingFields: [
      {
        key: RAW_SETTING_KEYS.WORKORDER_DEFAULT_PLAN_DURATION_DAYS,
        title: "Planlama süresi varsayılanı",
        desc: "İş emri açılırken planlama bitiş tarihi boş bırakılırsa başlangıca bu kadar gün eklenir. Girilen tarihi ETKİLEMEZ, mevcut iş emirlerine dokunmaz.",
        min: 1,
        max: 365,
        fallback: 7,
        unit: "gün",
        savedDesc: "İş emri planlama süresi varsayılan gün sayısı",
        audience: ["Planlamacı"],
      },
    ],
  },
  {
    id: "production",
    label: "Üretim — Saha",
    icon: Factory,
    description: "Sahadaki mobil istasyon ekranlarının davranışı.",
    keywords:
      "KK1 ham en genişlik cm fason talimat boyahane notu sevk mobil operatör saha kalite tambur metraj aşım fazla ölçüm açık kumaş top " +
      "kurşun dağıtım bypass makine atama kağıt fason dönüş tambur onay kurşun sırası top iptal sebep zorunlu gerekçe",
    kind: "flags",
    section: "production",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:production"],
    flags: [
      {
        key: "rawWidthEnabled",
        group: "KK1 / Kalite",
        title: "KK1 ham kumaş girişinde en (cm) alanını göster",
        summary: "Ham girişte en alanı çizilir; kapalıyken operatör isterse yine girebilir.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Kapalıyken tablet KK1 ekranında en alanı gizlenir; operatör isterse yine girebilir. Bitmiş topun eni iş emrinden gelir, ham stok en'e bakmadan sayılır.",
      },
      {
        key: "kk1WeightEntryEnabled",
        group: "KK1 / Kalite",
        title: "KK1 ham kumaş girişinde ağırlık (kg) alanını göster",
        summary: "Ham girişte kg alanı açılır; kapalıyken backend gönderilen kg'yi reddeder.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Açıkken KK1 elle girişte kg alanı açılır (makine arızasında metrajın yanına). Kapalıyken (varsayılan) alan gizlenir ve backend gönderilen kg'yi reddeder.",
      },
      {
        key: "kk1DuplicateGuardEnabled",
        group: "KK1 / Kalite",
        title: "Ham girişte mükerrer top uyarısı",
        summary: "90 saniye içinde birebir aynı top yeniden girilirse sistem sorar; onaylanırsa kaydeder.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Açıkken aynı operatör/makine 90 saniye içinde birebir aynı kumaş + metraj + en girerse sistem sorar; kayıt ancak onayla alınır (engellemez). Kapalıyken uyarı yok.",
      },
      {
        key: "qualityGradeRequiredEnabled",
        group: "KK1 / Kalite",
        title: "Top kalitesi zorunlu olsun",
        summary: "Kalite seçilmeden top girilemez, kesilemez ve iş emri kapanışında depoya indirilemez.",
        defaultOn: false,
        audience: ["Operatör", "Yönetim"],
        desc: "Açıkken kalite dört yerde zorunlu olur: top girişi, Tambur kesimi, iş emri kapanışı ve depo transferi. Kapalıyken (varsayılan) kalite isteğe bağlıdır; seçilmeyen top “Belirsiz” kalitede yaşar. ⚠️ ÖNKOŞUL: kalite kataloğunda aktif kayıt olmalı ve tabletler güncel olmalı, yoksa saha dört yerde de takılır.",
      },
      {
        key: "kk1OnlineOnlyEnabled",
        group: "KK1 / Kalite",
        title: "Ham girişte çevrimdışı kuyruğu kapat (online-only)",
        summary: "Tablet sunucuya ulaşamazken ham giriş yapılamaz; form kilitlenir ve sebebi yazar.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Açıkken tablet sunucuya ulaşamazken ham giriş yapılamaz; form kilitlenir ve sebebini söyler. Kayıt ile etiket tek akışta yürür, bekleyen kuyruk doğmaz. Kapalıyken çevrimdışı kuyruk kullanılır.",
      },
      {
        key: "kk1HistoryAllEntriesEnabled",
        group: "KK1 / Kalite",
        title: "Ham girişte 'Tüm Girişler' herkesin kayıtlarını göstersin",
        summary: "Tabletteki 'Tüm Girişler' listesi tüm operatörleri gösterir ve personele göre süzülebilir.",
        defaultOn: false,
        audience: ["Operatör", "Yönetim"],
        desc: "Açıkken tabletteki “Tüm Girişler” listesi bütün operatörlerin ham girişlerini gösterir ve operatöre göre süzülür. Kapalıyken (varsayılan) operatör yalnız kendi girdiği topları görür.",
      },
      {
        key: "kk1LabelScanVerifyEnabled",
        group: "KK1 / Kalite",
        title: "Ham girişte etiket geri-okutma doğrulaması (scan-back)",
        summary: "Basılan etiket okutulmadan yeni top girilemez — 'kâğıt gerçekten çıktı mı' kanıtı.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Açıkken basılan her top etiketi okutulmadan yeni top girilemez — “kâğıt gerçekten çıktı mı” sorusunu tarayıcı cevaplar. Kapalıyken etiket basılır basılmaz devam edilir.",
      },
      {
        key: "fasonShrinkWarnEnabled",
        group: "Fason",
        title: "Fason kabulünde çekme (metraj farkı) uyarısı göster",
        summary:
          "Fason kabulünde giden ↔ dönen metraj farkı toleransı aşarsa uyarı çıkar (çekme normaldir, aşırısı sorulur).",
        defaultOn: true,
        audience: ["Operatör", "Planlamacı"],
        desc: "Açıkken (varsayılan) fason kabulde giden ↔ dönen metraj farkı aşağıdaki toleransı aşarsa uyarı + onay ister (boyahanede çekme normaldir). Kapalıyken fark gösterilir ama sorulmaz.",
        numberField: {
          numberKey: "fasonShrinkTolerancePct",
          label: "Tolerans",
          unit: "%",
          min: 1,
          max: 100,
          emptyWarning: "Boş bırakılırsa fabrika varsayılanı (%10) kullanılır.",
        },
      },
      {
        key: "fasonNoteMobileEntry",
        group: "Fason",
        title: "Fason Sevk'te fason talimatını sahadaki operatör telefondan girebilsin",
        summary: "Operatör sevk sırasında fason talimatını telefondan yazabilir/değiştirebilir.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Açıkken sahadaki operatör mobil Fason Sevk ekranında talimatı yazabilir/değiştirebilir. Kapalıyken (varsayılan) talimat yalnız iş emrindeki fason adımının notundan gelir.",
      },
      {
        key: "kursunBypassEnabled",
        group: "Kurşun",
        title: "Kurşun istasyonunda tablet yok — işi dağıtımla yürüt (kurşun bypass)",
        summary: "Kurşun/KK2 tabletten okutulmaz; iş makineye dağıtılır ve Tambur okutmasıyla kapanır.",
        defaultOn: false,
        audience: ["Planlamacı", "Operatör"],
        desc: "Açıkken kurşun/KK2 tabletten okutulmaz; yetkili “Kurşun Dağıtım” ekranından işi makineye dağıtır, Tambur okutmasıyla tamamlanır. Kapalıyken (varsayılan) normal akış. Dağıtılmış işler bayrak kapansa da bypass'ta kalır.",
      },
      {
        key: "tamburOverQuantityEnabled",
        group: "Tambur",
        title: "Tambur'da çıkan top metresi giriş metresini aşabilsin",
        summary: "Kayıtlıdan fazla ölçülen metraj onay sonrası kabul edilir; kaynak top tükenir.",
        defaultOn: true,
        audience: ["Operatör"],
        desc: "Açıkken (varsayılan) Tambur'da kayıtlıdan fazla ölçülen metraj onay sonrası kabul edilir; kaynak top tamamen tüketilir. Kapalıyken aşan ölçüm reddedilir.",
      },
      {
        key: "tamburShortCutA1Enabled",
        group: "Tambur",
        title: "Kısa kesimde kalite otomatik A1 yazılsın",
        summary: "Tamburda eşiğin ALTINDA kalan kesimin kalitesi kendiliğinden 2. kaliteye (A1) çekilir.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Açıkken Tambur'da aşağıdaki eşiğin altında kalan kesimin kalitesi kendiliğinden A1 (2. kalite) olur; operatör değiştirebilir. Kapalıyken (varsayılan) kalite her zaman elle seçilir.",
        numberField: {
          numberKey: "tamburShortCutA1ThresholdM",
          label: "Eşik",
          unit: "metre",
          min: 1,
          max: 10000,
          emptyWarning: "Eşik girilmeden kural ÇALIŞMAZ — ayar açık ama etkisiz.",
        },
      },
      {
        key: "tamburUndoFullSameDayOnly",
        group: "Tambur",
        title: "Tümden geri alma yalnız aynı gün yapılabilsin",
        summary: "Dünkü bir Tambur kapanışı tümden geri alınamaz; tek parça iptali etkilenmez.",
        defaultOn: false,
        audience: ["Operatör", "Yönetim"],
        desc: "Açıkken bir Tambur kapanışı yalnız aynı gün tümden geri alınabilir; dünkü kapanış geri alınamaz. Tek parça iptali etkilenmez. Tümden geri alma zaten ayrı yetki ve sebep ister.",
      },
      {
        key: "productionCancelReasonRequired",
        group: "Top iptali",
        title: "Top iptalinde sebep zorunlu olsun",
        summary:
          "Açıkken top iptali sebep (katalogdan ya da metin) girilmeden kaydedilmez; kapalıyken sebep isteğe bağlı.",
        defaultOn: false,
        audience: ["Operatör", "Depocu", "Yönetim"],
        desc: "Açıkken top iptali (panel ve tablet) sebep seçilmeden/yazılmadan kaydedilmez. Kapalıyken (varsayılan) sebep isteğe bağlıdır.",
      },
    ],
  },
  {
    id: "kartela",
    label: "Kartela",
    icon: Layers,
    description: "Kartela (örnek kart) kabul ve stok davranışı.",
    keywords: "kartela örnek kart swatch ölçü uzunluk cm ağırlık kg boy en adet stok",
    kind: "flags",
    section: "production",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:kartela"],
    flags: [
      {
        key: "kartelaMeasurementEnabled",
        title: "Kartela kabulünde uzunluk (cm) / ağırlık (kg) alanlarını göster",
        summary: "Kartelalar adet dışında cm/kg ile de ölçülür ve listelerde gösterilir.",
        defaultOn: false,
        audience: ["Operatör", "Depocu"],
        desc: "Açıkken kartela kabulünde ve listelerinde cm/kg alanları görünür. Kapalıyken (varsayılan) kartelalar yalnız adet sayılır; alanlar gizlenir.",
      },
    ],
  },
  {
    // Devere Faz 2 (2026-09-14): iplik lotu — modül kapalıyken kategori gizli (`moduleKey`).
    id: "devere",
    label: "Devere / Levent",
    icon: Layers,
    description: "Levent sarımı ve iplik lotu katılık ayarları.",
    keywords: "devere levent lot iplik lotu bobin çözgü sarım mal kabul",
    kind: "flags",
    section: "production",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:devere"],
    moduleKey: "devereEnabled",
    flags: [
      {
        key: "devereLotRequired",
        title: "İplik lotu zorunlu olsun",
        summary:
          "İçeride levent sarımında iplik çıkış satırı ve mal kabulde iplik satırı lot numarasız kaydedilemez.",
        defaultOn: false,
        audience: ["Depocu", "Operatör"],
        desc: "Açıkken içeride sarımda lotsuz iplik çıkışı ve mal kabulde lotsuz iplik satırı reddedilir. Kapalıyken (varsayılan) lot isteğe bağlıdır; lotsuz satır uyarıyla yazılır ve lot izlemesine girmez.",
      },
      {
        key: "devereMountTracking",
        title: "Levent tezgah bağı defteri",
        summary:
          "Hazır levent tezgaha takılır, sökülür, tüketimi ve bitişi kaydedilir; kalan metre olaylardan hesaplanır.",
        defaultOn: false,
        audience: ["Operatör", "Yönetim"],
        desc: "Açıkken levent tezgaha takılır, sökülür, tüketimi ve bitişi kaydedilir (Leventler ekranında Tak / Sök / Tüket / Bitir / Hurda). Kapalıyken (varsayılan) levent sarıldıktan sonra “hazır” kalır, bu eylemler görünmez.",
      },
      {
        key: "devereMountTrackingRequired",
        title: "Bağlamada yöntem ve başlangıç saati zorunlu olsun",
        summary:
          "Levent tezgaha takılırken bağlama yöntemi (düğüm / tahar / takım) ve kurulum başlangıç saati girilmeden kayıt alınmaz.",
        defaultOn: false,
        audience: ["Operatör", "Yönetim"],
        desc: "Açıkken levent takılırken bağlama yöntemi (düğüm / tahar / takım) ve başlangıç saati zorunludur; kurulum süresi raporlarına girer. Kapalıyken (varsayılan) isteğe bağlıdır. Yalnız levent tezgah bağı açıkken anlamlıdır.",
      },
      {
        key: "devereAutoConsume",
        title: "Tezgahtan inen top leventten otomatik düşsün",
        summary:
          "KK1'de indirme bağıyla doğan topun metresi, indirme anında tezgahta bağlı leventlerden çözgü tüketimi olarak kendiliğinden yazılır.",
        defaultOn: false,
        audience: ["Operatör", "Yönetim"],
        desc: "Açıkken tezgahtan inen top kaydedilince metresi o tezgahta bağlı leventlerden otomatik düşer. Kapalıyken (varsayılan) tüketim yalnız elle yazılır; KK1 kaydı değişmez.",
      },
      {
        key: "devereBeamWeavingLinkRequired",
        title: "Levent sarımında dokuma işi zorunlu olsun",
        summary: "Levent planlanırken/sarılırken hangi dokuma işi için sarıldığı seçilmeden kayıt alınmaz.",
        defaultOn: false,
        audience: ["Operatör", "Yönetim"],
        desc: "Açıkken levent bir dokuma işine bağlanmadan planlanamaz/sarılamaz. Kapalıyken (varsayılan) stoğa serbest levent sarılır ve raporda “işsiz levent” olarak ayrı görünür.",
      },
    ],
  },
  {
    id: "dokuma",
    label: "Dokuma",
    icon: Factory,
    description: "Dokuma işi, tezgah koşumu ve sipariş bağı katılık ayarları.",
    keywords: "dokuma işi tezgah koşum sipariş satırı bağ zincir levent",
    kind: "flags",
    section: "production",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:dokuma"],
    moduleKey: "dokumaEnabled",
    flags: [
      {
        key: "dokumaRunWeavingOrderRequired",
        title: "Tezgah koşumu dokuma işine bağlı açılsın",
        summary: "Tezgahta koşum açılırken dokuma işi seçilmeden kayıt alınmaz.",
        defaultOn: false,
        audience: ["Operatör", "Yönetim"],
        desc: "Açıkken tezgah koşumu bir dokuma işine bağlanmadan açılamaz; tablet takılı leventin işini ön-doldurur. Kapalıyken (varsayılan) işsiz koşum (stoka dokuma) açılır ve raporda ayrı görünür.",
      },
      {
        key: "dokumaOrderLineLinkRequired",
        title: "Dokuma işi sipariş satırına bağlı olsun",
        summary: "Dokuma işi en az bir sipariş satırına bağlanmadan kaydedilmez.",
        defaultOn: false,
        audience: ["Planlamacı", "Yönetim"],
        desc: "Açıkken dokuma işi en az bir sipariş satırına bağlanmadan kaydedilemez. Kapalıyken (varsayılan) stoka dokuma işi açılır ve hub'da ayrı sekmede durur.",
      },
    ],
  },
  // Depo/satın alma bayrakları bilinçli olarak Muhasebe sekmesinde DEĞİL: bu
  // ayarları yapan kişi depo/satın alma sorumlusudur ve ayarların değiştirdiği
  // şey mal kabul + iplik çıkışı EKRANLARININ davranışıdır (fatura/cari değil).
  // "Mal kabulde fiyat zorunlu" ayarı muhasebeye HİZMET eder ama muhasebecinin
  // ekranında yaşamaz — sekme, ayarın etkilediği ekranın sahibine göre seçilir.
  //
  // ⚠️⚠️ REJİM (GİZLEME) KAPISI YOK, MODÜL (KİLİT) KAPISI VAR — ikisi ayrı şey.
  // Üç bayrağın da enforcement'ı `finance.enabled` KAPALIYKEN koşar, yani bu
  // kategori ön muhasebe rejimiyle GİZLENEMEZ (o karar değişmedi ve `§14`
  // ölçüyor). Kilit ise farklı bir soruya cevap verir: "bu ayarın ait olduğu
  // MODÜL bu kurulumda satın alındı mı?" — ve kilit hiçbir şeyi ulaşılamaz
  // yapmadığı için o ölçümün dışındadır.
  //
  // ⚠️ KATEGORİ 2026-09-03'TE İKİYE BÖLÜNDÜ ve sebebi granülarite: tek kategori
  // İKİ farklı modülün satırlarını taşıyordu (2 ticaret + 1 iplik). Tek bir
  // `moduleKey` bunu anlatamazdı; satır düzeyinde kilit ise bandı "bazı satırlar
  // kilitli" demeye zorlar ve kullanıcı hangisinin donduğunu tek tek arardı.
  // Bölme, `moduleKey`in kategori düzeyinde kalmasını sağlayan karardır.
  {
    id: "warehouse",
    label: "Mal Kabul & Alış",
    icon: Warehouse,
    description: "Mal kabul ve alış siparişi katılık ayarları.",
    keywords:
      "depo ambar mal kabul giriş irsaliye alış satın alma sipariş tedarikçi fazla kabul tolerans " +
      "birim fiyat zorunlu maliyet ticaret",
    kind: "flags",
    section: "trade",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:warehouse"],
    // TİCARET MODÜLÜ — KİLİT. İki satırın da enforcement'ı
    // `goods-receipt.service.confirm`tedir ve o servise giden router
    // 2026-09-02'den beri `requireTicaretEnabled` taşır: ticaret kapalıyken mal
    // kabul fişi HİÇ oluşturulamaz, yani bu iki katılık ayarının uygulanacağı
    // bir kayıt yoktur. Kategori GÖRÜNÜR kalır — "açtım, kapatamıyorum"
    // çıkmazının panel ikizi gizlemekle doğardı, kilitlemekle değil (modül her
    // zaman Sistem → Modüller ekranından geri açılabilir).
    moduleKey: "ticaretEnabled",
    flags: [
      {
        key: "purchaseBlockOverReceiptEnabled",
        title: "Siparişten fazla mal kabulünü engelle",
        summary: "Alış siparişi miktarını aşan kabul satırı reddedilir; serbest kabul muaf.",
        defaultOn: false,
        audience: ["Depocu"],
        desc: "Açıkken alış siparişi miktarını aşan kabul satırı reddedilir (tolerans ayrı ayardan). Kapalıyken (varsayılan) fazla mal kaydedilir, sistem yalnız uyarır — fiziksel olarak fazla mal gelebilir.",
      },
      {
        key: "goodsReceiptRequirePriceEnabled",
        title: "Mal kabul satırında birim fiyat zorunlu olsun",
        summary: "Fiyatı satırdan da siparişten de çözülemeyen mal kabul kaydedilemez.",
        defaultOn: false,
        audience: ["Depocu", "Muhasebeci"],
        desc: "Açıkken satırda birim fiyat yoksa ve siparişten de çözülemiyorsa mal kabul kaydedilemez. Fiyat kabul anında donar; alış faturası taslağı ve maliyet oradan doğar. Kapalıyken fiyatsız kabul serbesttir.",
      },
    ],
  },
  {
    // 2026-09-03'te "Depo & Satın Alma"dan AYRILDI: tek satır, ama başka bir
    // MODÜLÜN satırı (`iplik.enabled`). Karma kategoride kilit anlatılamıyordu.
    // ⚠️ KİLİT ETKİN DEĞERE bakar (`ticaret && iplik`): İplik, Ticaret'e
    // bağımlıdır ve ticaret kapalıyken iplik açık BIRAKILMIŞ olsa bile ekran
    // çalışmaz. Zinciri çözen tek yer `resolveSettingsModuleState`.
    id: "yarn",
    label: "İplik",
    icon: Boxes,
    description: "İplik kg stok hareketlerinin katılık ayarları.",
    keywords:
      "iplik kg stok bakiye eksi negatif çıkış sayım düzeltme depo yarn lot kalite bekletme karantina bloke serbest",
    kind: "flags",
    section: "trade",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:yarn"],
    moduleKey: "iplikEnabled",
    flags: [
      {
        key: "yarnBlockNegativeBalanceEnabled",
        title: "İplik stoğu eksi bakiyeye düşemesin",
        summary: "Bakiyeyi eksiye düşürecek iplik çıkışı reddedilir; ters/düzeltme kayıtları muaf.",
        defaultOn: false,
        audience: ["Depocu"],
        desc: "Açıkken bakiyeyi eksiye düşürecek iplik çıkışı reddedilir. Kapalıyken (varsayılan) kayıt geçer, bakiye eksiye düşebilir. Ters/düzeltme kayıtları ve belge iptalleri muaftır.",
      },
      {
        key: "goodsReceiptYarnQualityHoldEnabled",
        title: "Mal kabulde doğan iplik lotu kalite bekletmede doğsun",
        summary:
          'Yeni iplik lotu "kalite bekletmede" doğar; serbest bırakılmadan levent sarımına ve iplik çıkışına giremez.',
        defaultOn: false,
        audience: ["Depocu", "Operatör", "Yönetim"],
        desc: "Açıkken mal kabulde doğan iplik lotu “kalite bekletmede” doğar; serbest bırakılmadan levent sarımına giremez (elle açılan lot serbesttir). Kapalıyken (varsayılan) lot serbest doğar.",
      },
    ],
  },
  {
    id: "finance",
    label: "Muhasebe",
    icon: Banknote,
    description: "Fatura, tahsilat/ödeme ve kasa-banka davranışının katılık + otomasyon ayarları.",
    keywords:
      "muhasebe cari fatura tahsilat ödeme kasa banka bakiye ekstre yaşlandırma vade kur döviz finance " +
      "eksi bakiye negatif kasa engeli kdv oran varsayılan vergi " +
      "risk limiti aşım onay engel taslak otomatik sevk fifo kapama tahsis avans sıfır fiyat promosyon " +
      "numune bedelsiz ileri tarih çek keşide iplik stok düşme",
    kind: "flags",
    section: "trade",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:finance"],
    // ⚠️ REJİM KAPILI OLAN TEK KATEGORİ — ve bu ÖLÇÜLDÜ, varsayılmadı: dokuz
    // satırın enforcement'ının hepsi `finance.enabled` kapalıyken ULAŞILAMAZ.
    // Sekiz tanesi `requireFinanceEnabled` taşıyan router'ların arkasındaki
    // servislerde (invoice · payment · cash/future-date guard'ları), dokuzuncusu
    // (`financeAutoDraftFromShipmentEnabled`) rejimsiz sevk yolundan çağrılıyor
    // ama helper'ın İLK ifadesi `readFinanceEnabled()` — yani kendi kapısını
    // taşıyor. Yeni bir satır eklerken aynı soruyu sor: "bayrak kapalıyken bu
    // kural yine de bir isteği reddedebilir mi?" Evetse kategori kapılanamaz.
    regime: "financeEnabled",
    numberFlags: [
      {
        key: "financeDefaultVatRate",
        title: "Varsayılan KDV oranı",
        desc: "Fatura formunda yeni satır ve mal kabulden üretilen alış taslağı bu KDV oranıyla açılır. Yalnız ön-dolum; her satırda değiştirilebilir, mevcut kayıtlara dokunmaz.",
        min: 0,
        max: 100,
        fallback: 20,
        unit: "%",
        audience: ["Muhasebeci"],
      },
      {
        key: "financeInvoicePriceTolerancePct",
        title: "Fatura ↔ mal kabul tutar toleransı",
        desc: "“Fatura onayında mal kabul fişleriyle karşılaştır” açıkken fatura tutarı ile fiş tutarı arasındaki sapma bu yüzdeyi aşarsa onay reddedilir. 0 = hiç fark kabul edilmez.",
        min: 0,
        max: 100,
        fallback: 0,
        unit: "%",
        audience: ["Muhasebeci"],
      },
    ],
    flags: [
      {
        key: "financeInvoiceMatchTolerance",
        group: "Fatura",
        title: "Fatura onayında mal kabul fişleriyle karşılaştır",
        summary:
          "Alış faturası onaylanırken bağlı mal kabul fişlerinin miktar ve tutar toplamıyla karşılaştırılır; tolerans aşılırsa onay reddedilir.",
        defaultOn: false,
        audience: ["Muhasebeci"],
        desc: "Açıkken alış faturası onaylanırken bağlı mal kabul fişlerinin miktar ve tutar toplamıyla karşılaştırılır; sapma toleransı aşarsa onay reddedilir. Kapalıyken (varsayılan) karşılaştırma yapılmaz.",
        numberField: {
          numberKey: "financeInvoiceQtyTolerancePct",
          label: "Miktar toleransı",
          unit: "%",
          min: 0,
          max: 100,
          emptyWarning: "Boş bırakılırsa 0 (fark kabul edilmez).",
        },
      },
      {
        key: "financeBlockNegativeCashEnabled",
        group: "Kasa & Risk",
        title: "Kasa eksi bakiyeye düşemesin",
        summary: "Kasayı eksiye düşürecek nakit çıkışı reddedilir; banka hesapları ve iptaller muaf.",
        defaultOn: false,
        audience: ["Muhasebeci"],
        desc: "Açıkken kasayı eksiye düşürecek nakit çıkışı (ödeme, masraf, virman, çek ödeme) reddedilir; hata kasa adını ve bakiyeyi söyler. Banka hesapları ve iptaller etkilenmez. Kapalıyken eksi bakiye serbesttir.",
      },
      {
        key: "financeRiskLimitBlockEnabled",
        group: "Kasa & Risk",
        title: "Risk limiti aşımında satış faturası onayını engelle",
        summary: "Cari risk limitini aşan satış faturası onaylanamaz; alış ve iptaller muaf.",
        defaultOn: false,
        audience: ["Muhasebeci", "Yönetim"],
        desc: "Açıkken cari risk limitini aşan satış faturasının onayı reddedilir; alış ve iptaller muaftır. Kapalıyken (varsayılan) limit yalnız uyarıdır — satışı durdurma kararı ticari bir karardır.",
      },
      {
        key: "financeAllowZeroPriceLineEnabled",
        group: "Fatura kuralları",
        title: "Sıfır fiyatlı fatura satırına izin ver",
        summary: "Fiyatı 0 olan satır faturayı onaya sokabilir (promosyon/numune/bedelsiz).",
        defaultOn: false,
        audience: ["Muhasebeci"],
        desc: "Açıkken fiyatı 0 olan satır faturayı onaya sokabilir (promosyon, numune, bedelsiz sevk). Kapalıyken (varsayılan) 0 fiyat onayı durdurur. ⚠️ İzin verilen şey sıfırdır; fiyatı boş bırakmak değil.",
      },
      {
        key: "financeFutureDatedDocumentBlockEnabled",
        group: "Fatura kuralları",
        title: "İleri tarihli mali belgeyi engelle",
        summary: "Fatura, tahsilat, masraf ve virman belgesinin tarihi bugünden ileri olamaz.",
        defaultOn: false,
        audience: ["Muhasebeci"],
        desc: "Açıkken fatura, tahsilat/ödeme, masraf ve virman belgesinin tarihi bugünden ileri olamaz (fabrika günü). Kapalıyken (varsayılan) serbesttir. ⚠️ Çek bu kuralın dışındadır; vadesi ileri tarihlidir.",
      },
      {
        key: "financeAutoDraftFromShipmentEnabled",
        group: "Otomasyon",
        title: "Sevk onayında otomatik fatura taslağı oluştur",
        summary: "Sevk edilen her sevkiyat için satış faturası TASLAĞI doğar; onay her zaman elle.",
        defaultOn: false,
        audience: ["Muhasebeci", "Sevkiyat"],
        desc: "Açıkken sevk edilen her sevkiyat için satış faturası taslağı kendiliğinden doğar; muhasebeci kontrol edip onaylar. Onayı sistem asla kendi vermez. Kapalıyken (varsayılan) fatura elle oluşturulur.",
      },
      {
        key: "financeAutoAllocateOnPaymentEnabled",
        group: "Otomasyon",
        title: "Tahsilat/ödemeyi en eski faturalara otomatik kapat (FIFO)",
        summary: "Kaydedilen tutar en eski açık faturalardan başlayarak otomatik kapatılır.",
        defaultOn: false,
        audience: ["Muhasebeci"],
        desc: "Açıkken kaydedilen tahsilat/ödeme carinin en eski açık faturalarından başlayarak otomatik kapatılır; artan tutar avans olarak açıkta kalır. Kapalıyken (varsayılan) kapanacak faturayı kullanıcı seçer.",
      },
      {
        key: "financeYarnOutOnInvoiceEnabled",
        group: "Otomasyon",
        title: "Satış faturası onayında iplik stoktan düşsün",
        summary:
          "Faturadaki iplik satırları onayda depodan düşer — sevkte de düşen kurulumda ÇİFTE düşüm olur.",
        defaultOn: false,
        audience: ["Muhasebeci", "Depocu"],
        desc: "Açıkken satış faturası onaylanınca iplik satırları kalemin varsayılan deposundan düşer; fatura iptalinde geri yazılır. Kapalıyken (varsayılan) iplik yalnız sevk/depo hareketiyle düşer. ⚠️ Sevkte de düşen kurulumda çift düşüm olur.",
      },
    ],
  },
  {
    id: "label",
    label: "Etiket Baskısı",
    icon: Tags,
    description: "Org-geneli etiket baskı ayarları: kopya adedi, varsayılan medya, native gönderim.",
    keywords:
      "etiket label baskı yazdır kopya adet çift üst alt yapıştır tambur native gönderim varsayılan medya boyut ölçü mm dpi eni boyu boşluk pay",
    kind: "label",
    section: "printing",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:label"],
  },
  {
    id: "devices",
    label: "Cihazlar",
    icon: TabletSmartphone,
    description: "Mobil cihaz (tablet/telefon) onay zorunluluğu ve eşleştirme.",
    keywords: "cihaz eşleştirme tablet telefon pairing onay zorunlu allowlist mobil",
    kind: "device",
    section: "printing",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:devices"],
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // BU BİLGİSAYAR — dört YEREL kategori (2026-09-04: alt sekmeler raya taşındı)
  // ═══════════════════════════════════════════════════════════════════════════
  // Dördünün ORTAK ölçütü: sunucuya HİÇBİR ŞEY yazmazlar. Yazıcı/kantar/tabanca
  // `machine-config` taslağına (`useDeviceDraft`), sunucu adresi `localStorage`a
  // yazar; etkisi tek makineyle sınırlıdır. Bu yüzden dördü de dar izinle
  // (`settings:workstation`) görülebilir ve dördü de aynı kapıyı TAŞIMAK
  // ZORUNDA — biri unutulursa yerel donanımını kuran personel o kategoriyi
  // göremez ve `admin:settings` istemek zorunda kalır. Bekçi ölçüyor.
  //
  // ⚠️ Org-geneli "Etiket Baskısı" (`label`) ve "Cihazlar" (`devices`) BU KÜMEDE
  // DEĞİL: onlar sunucuya yazar (`admin:settings`), yalnız adları benziyor.
  {
    // ⚠️ id "printer" — eski `?tab=system` derin bağlantısı buraya YÖNLENİR
    // (`SETTINGS_TAB_ALIASES`). Kimliği "system" bırakmak, dört kategoriden
    // birine tarihsel bir ad yapıştırmak olurdu.
    id: "printer",
    label: "Yazıcı",
    icon: Printer,
    description:
      "Bu bilgisayara bağlı etiket yazıcısı: taşıma (Windows kuyruğu / seri / CUPS), hedef ve diyalogsuz doğrudan baskı.",
    keywords:
      "yazıcı etiket yazıcısı printer com cups kuyruk seri baud winspool raw passthrough diyalogsuz doğrudan baskı " +
      "argox bixolon zpl ppla pplb usb bu bilgisayar yerel workstation cihaz kaydı",
    kind: "printer",
    section: "workstation",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, WORKSTATION_PERMISSION],
  },
  {
    id: "scale",
    label: "Kantar",
    icon: Scale,
    description:
      "Bu bilgisayara bağlı sevkiyat kantarı (seri/COM) — çuval tartma ekranı buradaki tanımı okur.",
    keywords:
      "kantar tartı scale terazi seri com baud ağırlık kg tart deneme tartısı sevkiyat çuval bu bilgisayar yerel workstation",
    kind: "scale",
    section: "workstation",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, WORKSTATION_PERMISSION],
  },
  {
    id: "scanner",
    label: "Tabanca",
    icon: ScanLine,
    description: "Barkod tabancası: “her yerde okut” davranışı, terminatör ve burst tespiti hassasiyeti.",
    keywords:
      "barkod qr tabanca okuyucu scanner wedge klavye usb bluetooth her yerde okut terminator enter tab " +
      "hassasiyet burst test bu bilgisayar yerel workstation",
    kind: "scanner",
    section: "workstation",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, WORKSTATION_PERMISSION],
  },
  {
    id: "server",
    label: "Sunucu Adresi",
    icon: Server,
    description: "Uygulamanın bağlandığı backend (API) adresi — bu bilgisayara özeldir.",
    keywords:
      "sunucu adresi API backend bağlantı url endpoint ip port host adres bu bilgisayar yerel workstation",
    kind: "server",
    section: "workstation",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, WORKSTATION_PERMISSION],
    // Web'de API sayfanın origin'idir; runtime ezmesi kullanıcının kendi
    // açamayacağı yanlış bir adrese kilitler (bkz. `desktopOnly` gerekçesi).
    desktopOnly: true,
  },
  {
    id: "company",
    label: "Şirket Bilgileri",
    icon: Building2,
    description: "ERP'nin kurulduğu firmanın adı — panel başlığında ve uygulama genelinde gösterilir.",
    keywords: "şirket firma ad kurum işletme marka isim başlık panel",
    kind: "company",
    section: "system",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:company"],
  },
  {
    id: "session",
    label: "Oturum & Güvenlik",
    icon: Clock,
    description: "Oturum süresi (token ömrü) ve hareketsizlik zaman aşımı.",
    keywords:
      "oturum süre süresi token jwt giriş çıkış logout otomatik hareketsizlik idle zaman aşımı timeout güvenlik session ömür dakika saat çalışma oturumu makine yer onayı saha work session kart personel kartı qr login pin giriş yöntemi token dolunca otomatik çıkış autoLogout aynı hesap ikinci oturum eşzamanlı politika kick notify eskiyi düşür sınırsız başka bilgisayar mobil hareketsizlik kilidi kilit ekranı tablet telefon",
    kind: "session",
    section: "system",
    permissionAny: [SETTINGS_ADMIN_PERMISSION, "settings:session"],
  },
  {
    // ═══════════════════════════════════════════════════════════════════════
    // DEMO KURULUMU — sürüm paketinde OTOMATİK KAPALI
    // ═══════════════════════════════════════════════════════════════════════
    // Bu bir TERCİH değil, kurulumun NE OLDUĞUNA dair bir beyandır. Açıkken
    // panelde DEMO rozeti çizilir ve `/api/demo/*` senaryo üreticileri açılır
    // (fabrikada test edilmesi zor ekranları — "yeniden etiketle", kartela,
    // kurşun kuyruğu — tek tıkla doldurmak için).
    //
    // ⚠️ Varsayılan KAPALI ve bu YAPISAL bir güvencedir: sürüm paketine sızan
    // bir demo yardımcısı, sahada hiçbir şey yapılmadığı sürece ETKİSİZDİR.
    // Backend uçları da bayrağı KENDİ okur (`requireDemoMode`) — menüyü
    // gizlemek yetmez, adresi bilen biri ekranı yine açardı.
    id: "demo",
    label: "Demo",
    icon: FlaskConical,
    description:
      "Bu kurulum bir DEMO/EĞİTİM kurulumu mu? Açıkken örnek senaryo üreten yardımcılar ve DEMO rozeti görünür.",
    keywords: "demo eğitim tanıtım örnek senaryo test sunum müşteri gösterimi deneme kurulum sandbox",
    kind: "flags",
    section: "demo",
    flags: [
      {
        key: "demoModeEnabled",
        title: "Bu kurulum bir DEMO kurulumudur",
        summary: "Ekranlarda örnek veri üreten 'Demo' yardımcıları ve üst şeritte DEMO rozeti görünür.",
        defaultOn: false,
        audience: ["Yönetim"],
        desc: "Açıkken ekranlarda örnek veri üreten Demo yardımcıları ve üst şeritte DEMO rozeti görünür; /api/demo/* uçları açılır. Kapalıyken (varsayılan) hiçbiri çizilmez ve uçlar 403 verir. Gerçek fabrikada kapalı kalır.",
      },
    ],
  },
];

/** Kategorinin çizildiği ekran — BÖLÜMÜNDEN türetilir (tek yazar). */
export function categorySurface(cat: SettingsCategory): SettingsSurface {
  return SECTION_SURFACE[cat.section];
}

/**
 * Bu kategoriye giden adres — palet, derin bağlantı ve "şuradan açılır"
 * metinleri BURADAN okur.
 *
 * ⚠️ Satıcı yüzeyi (`vendor`) `?tab=` TAŞIMAZ: Modüller ekranı bir sekme şeridi
 * değil tek sayfadır. Sekme parametresi verilseydi sayfa onu yok sayar ve palet
 * "gittim ama bir şey açılmadı" hissi üretirdi.
 */
export function settingsCategoryPath(cat: SettingsCategory): string {
  const surface = categorySurface(cat);
  return surface === "vendor" ? SURFACE_PATH.vendor : `${SURFACE_PATH[surface]}?tab=${cat.id}`;
}

/**
 * "Bu Bilgisayar" bölümüne giren kategoriler — YEREL, sunucuya yazmayan ayarlar.
 * Dar izin (`settings:workstation`) ve hub kartının hedefi buradan okunur.
 */
export const WORKSTATION_SECTION: SettingsSectionId = "workstation";

/**
 * Bölümün İLK kategorisi — "Bu Bilgisayar" kartı/kısayolu buraya götürür.
 *
 * ⚠️ SABİT KİMLİK YAZILMAZ, SIRADAN TÜRETİLİR: ray sırası değiştiğinde kart
 * kullanıcıyı hâlâ o bölümün ilk sekmesine götürür. Elle yazılsaydı bir gün
 * "Yazıcı" bölümden çıkar, kart ölü bir `?tab=` taşır ve sayfa SESSİZCE ilk
 * sekmeye düşerdi.
 */
export function workstationEntryPath(): string {
  const first = SETTINGS_CATEGORIES.find((c) => c.section === WORKSTATION_SECTION);
  return first ? settingsCategoryPath(first) : SURFACE_PATH.workstation;
}

/**
 * Kullanıcının izinlerine göre görünen kategoriler (sayfa + komut paleti ORTAK).
 *
 * `surface` verilirse YALNIZ o ekranın kategorileri döner. Vermemek "tüm
 * kategoriler" demektir ve yalnız palet/bekçi için anlamlıdır — bir SAYFA
 * yüzeyini daima belirtir, yoksa Genel Ayarlar modül anahtarlarını da çizerdi.
 */
export function visibleSettingsCategories(
  hasAnyPermission: (perms: string[]) => boolean,
  surface?: SettingsSurface,
  /** Masaüstü mü? Varsayılan CANLI ortam; testler açıkça verir. */
  isDesktop: boolean = IS_ELECTRON,
): SettingsCategory[] {
  return SETTINGS_CATEGORIES.filter(
    (cat) =>
      (surface === undefined || categorySurface(cat) === surface) &&
      (isDesktop || !cat.desktopOnly) &&
      hasAnyPermission(cat.permissionAny ?? [SETTINGS_ADMIN_PERMISSION]),
  );
}

/**
 * ESKİ `?tab=` KİMLİKLERİ → bugünkü kategori.
 *
 * ⚠️ SESSİZ DÜŞÜŞÜN TEK PANZEHİRİ. `resolveActiveSettingsCategory` tanımadığı
 * bir `?tab=` değerinde İLK kategoriye düşer ve sebebini hiçbir yerde yazmaz;
 * yani eski bir yer imi / kayıtlı bağlantı / dış doküman `?tab=system` derse
 * kullanıcı "Yazıcı" yerine listedeki ilk sekmeyi görür ve bunun bir yönlendirme
 * olduğunu anlamaz. Kimlik değiştiren HER kategori buraya bir satır bırakır.
 *
 * ⚠️ HEDEF, KATALOGDA GERÇEKTEN VAR OLMAK ZORUNDA (bekçi ölçüyor): silinmiş bir
 * kimliğe yönlendiren takma ad, düzeltmek istediği sessiz düşüşün aynısını üretir.
 */
export const SETTINGS_TAB_ALIASES: Readonly<Record<string, string>> = {
  // 2026-09-04: "Bu Bilgisayar" tek sekmeydi, dört kategoriye ayrıldı; ilk
  // cihazı (yazıcı) açmak, eski sekmenin varsayılan alt sekmesiyle aynı yerdir.
  system: "printer",
};
