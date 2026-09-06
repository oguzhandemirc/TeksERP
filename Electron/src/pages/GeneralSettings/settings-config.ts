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
import {
  SHIPMENT_ORDER_REQUIREMENT_OPTIONS,
  SHIPPING_DOC_CEKI_NAME_MODE_OPTIONS,
  SHIPPING_DOC_ITEM_NAME_MODE_OPTIONS,
  SHIPPING_INVOICE_MODE_OPTIONS,
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
 *   • `"settings"` → Sistem → **Genel Ayarlar** ("geri kalanlar": şirket,
 *                    oturum, cihaz, etiket baskısı, bu bilgisayar)
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
export type SettingsSurface = "settings" | "flags" | "vendor";

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
  printing: "settings",
  workstation: "settings",
  system: "settings",
};

/** Yüzeyin adresi — palet/derin bağlantı ve route TEK yerden okur. */
export const SURFACE_PATH: Record<SettingsSurface, string> = {
  settings: "/system/settings",
  flags: "/system/feature-flags",
  vendor: "/system/module-profile",
};

/**
 * Yüzeyin EKRAN ADI — sayfa başlığı, Sistem karosu ve palet girişleri aynı
 * kelimeyi kullanmak zorunda. Palet "Genel Ayarlar · Muhasebe" derken kullanıcıyı
 * başka bir ekrana atarsa arama sonucu yalan söyler. Bekçi: `settings-surface.test.ts`.
 */
export const SURFACE_LABEL: Record<SettingsSurface, string> = {
  settings: "Genel Ayarlar",
  flags: "Özellik Anahtarları",
  vendor: "Modüller",
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
  | "depoMultiEnabled";

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
   * Bu kategoriyi GÖRMEK için yeterli izinlerden herhangi biri. Verilmezse
   * `admin:settings` gerekir — yeni kategori eklerken varsayılan DAR olsun diye
   * (izin unutulursa kategori gizlenir; ters kurgu sistem ayarını sızdırırdı).
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
        summary:
          "Envanterdeki üretim sekmeleri ve siparişlerdeki iş emri yüzeyleri çizilir.",
        defaultOn: true,
        audience: ["Planlamacı", "Yönetim"],
        desc: "AÇIK (varsayılan) olduğunda Envanter'de üretim sekmeleri (Üretimde · Üretim Akışı · Fasonda · Kurşun/Tambur Bekleyen) ve Siparişler'de iş emri kolonu/filtresi/toplu aksiyonu görünür. ⚠️ Ön muhasebeden BAĞIMSIZDIR: ikisi aynı anda açık olabilir — muhasebe tutan bir fabrika üretim ekranlarını kaybetmemeli. Kapatmak yalnız bu yüzeyleri gizler; iş emri verisi ve akışı yerinde kalır. Ayarlar ekranında da 'Üretim & Kalite' bölümü bu anahtara bağlıdır.",
      },
      {
        key: "financeEnabled",
        title: "Ön muhasebe modülünü aç",
        summary:
          "Cari, fatura, tahsilat/ödeme, kasa-banka ekranları ve depo/satın alma ayarları açılır.",
        defaultOn: false,
        audience: ["Muhasebeci", "Yönetim"],
        desc: "Kapalıyken (varsayılan) menüde 'Muhasebe' satırı çizilmez, ekranlar açılmaz ve sevkiyattan otomatik fatura taslağı ÜRETİLMEZ. Bu bir görünürlük ayarı değil rejim anahtarıdır — kapatmak mevcut kayıtları silmez, yalnız modülü devre dışı bırakır. Ekranları görmek için ayrıca 'finance:*' yetkisi gerekir. Ayarlar ekranında da 'Depo & Muhasebe' bölümü bu anahtara bağlıdır.",
      },
      // ⚠️ SIRA LOAD-BEARING (görsel değil, iş sırası): İplik satırı Ticaret'in
      // ALTINDA durur çünkü backend bağımlılığı öyle — ticaret kapalıyken iplik
      // açılamaz (400 MODULE_DEPENDENCY). Kullanıcı listeyi yukarıdan aşağı
      // okuyup açtığında doğru sırayı kendiliğinden uygular.
      {
        key: "ticaretEnabled",
        title: "Ticaret modülünü aç",
        summary:
          "Alış siparişi, mal kabul, fiyat listeleri ve stok sayımı ekranları açılır.",
        defaultOn: false,
        audience: ["Depocu", "Muhasebeci", "Yönetim"],
        desc: "Kapalıyken (üretici fabrikanın varsayılanı) alış siparişi · mal kabul · fiyat listesi · stok sayımı uçları 403 verir ve karoları çizilmez. Ön muhasebeden BAĞIMSIZDIR: bu anahtar MAL hareketinin ticari yüzünü açar, 'Ön muhasebe' ise cari/fatura defterini. Alım-satım yapan bir firmada ikisi de açıktır; yalnız üretim yapan fabrikada ikisi de kapalı kalır.",
      },
      {
        key: "iplikEnabled",
        title: "İplik modülünü aç",
        summary:
          "İplik kg stok defteri ve hareketleri (giriş/çıkış/sayım düzeltmesi) açılır.",
        defaultOn: false,
        audience: ["Depocu", "Yönetim"],
        desc: "Kapalıyken (varsayılan) iplik kg defteri uçları 403 verir ve karo çizilmez. ⚠️ TİCARET MODÜLÜNE BAĞLIDIR: Ticaret kapalıyken bu anahtar açılamaz (kaydetmede hata verir) ve açık bırakılmış olsa bile ekran çalışmaz. Kapatma sırası da terstir — önce İplik, sonra Ticaret kapatılır.",
      },
      {
        key: "depoMultiEnabled",
        title: "Çoklu depo modülünü aç",
        summary:
          "Depo seçicileri, listelerdeki depo kolonu ve depolar arası transfer ekranı açılır.",
        defaultOn: false,
        audience: ["Depocu", "Yönetim"],
        desc: "Kapalıyken (tek depolu kurulumun varsayılanı) depo seçicileri ve depo kolonu çizilmez, Depo Transferi karosu görünmez ve transfer uçları 403 verir — tek depoda taşınacak ikinci bir yer yoktur. Depo TANIMI ve depo defteri bu anahtardan BAĞIMSIZDIR: kapalıyken de depo kartı açılabilir, hareketler yazılmaya devam eder. ⚠️ Bu karar 2026-09-02'ye kadar depo SAYISINDAN türetiliyordu; artık açık bir anahtar — ikinci depoyu açmak yüzeyleri kendiliğinden getirmez, bu satır da açılmalıdır.",
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
    flags: [
      {
        key: "customerBranchesEnabled",
        title: "Müşteri şubeleri (sevk noktaları) özelliğini göster",
        summary:
          "Müşteri kartında Şubeler sekmesi ve sipariş formunda şube seçimi görünür.",
        defaultOn: true,
        audience: ["Planlamacı", "Sevkiyat"],
        desc: "Açıkken (varsayılan) müşteri kartında Şubeler sekmesi, yeni müşteri formunda şube taslağı ve sipariş formunda şube seçimi görünür. 'Her şube = ayrı müşteri' düzeninde çalışan firma kapatır — şube ekranları gizlenir; mevcut kayıtlardaki şube verisi ve sipariş bağları KORUNUR, sadece görünmez olur.",
      },
      {
        key: "duplicatesFuzzyEnabled",
        group: "Mükerrer kayıtlar",
        title: "Mükerrer taramasında BENZER adları da aday göster (bulanık eşleştirme)",
        summary:
          "Mükerrer Kayıtlar ekranı yalnız birebir aynı adı değil, BENZER adları da aday olarak listeler.",
        defaultOn: true,
        audience: ["Yönetim"],
        desc: "Sistem → Mükerrer Kayıtlar ekranı müşteri/kumaş/renk/fason kayıtlarını üç kuralla tarar: aynı ad (büyük/küçük harf ve Türkçe karakter farkı sayılmaz), kimlik çakışması (vergi no, ihracat kodu, e-posta, telefon, kumaş kodu harf-ikizi) ve — bu ayar açıkken (varsayılan) — BENZER ad ('ŞAHİN TEKSTİL A.Ş.' ~ 'Sahin Tekstil Ltd.'). Benzerlik aşağıdaki eşiğin üstündeyse aday olur; sayı/varyant taşıyan adlar (KRİSTAL V-01 / V-02) birebir aynı sayıyı taşımıyorsa hiçbir zaman aday yapılmaz. Aday yalnız GÖSTERİR, hiçbir şey birleştirmez; 'Mükerrer değil' dediğin çift bir daha çıkmaz.",
        numberField: {
          numberKey: "duplicatesFuzzyThresholdPct",
          label: "Benzerlik eşiği",
          unit: "%",
          min: 50,
          max: 100,
          emptyWarning: "Boş bırakılırsa fabrika varsayılanı (%90) kullanılır. 90 = neredeyse aynı; 70'in altı gürültü üretir.",
        },
      },
    ],
  },
  {
    id: "orders",
    label: "Siparişler",
    icon: Banknote,
    description:
      "Sipariş ekranlarındaki fiyat alanları, varsayılan termin ve 'tamamlandı' sayma toleransı.",
    keywords:
      "fiyat para birimi birim fiyat tutar döviz kur pricing sipariş termin deadline gün süre varsayılan vade teslim tarih " +
      "tolerans eksik sevk tamamlandı kapanma metre karşılanma",
    kind: "flags",
    section: "sales",
    flags: [
      {
        key: "pricingEnabled",
        title: "Sipariş para birimi ve fiyat alanlarını göster",
        summary: "Sipariş ekranlarında para birimi, birim fiyat ve toplam tutar çizilir.",
        defaultOn: false,
        audience: ["Planlamacı", "Muhasebeci"],
        desc: "Kapalıyken sipariş ekranlarında para birimi seçici, birim fiyat input'u ve toplam tutar gizlenir. Mevcut kayıtlardaki değerler korunur — kalıcı veri kaybı YOK.",
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
    flags: [
      {
        key: "shipmentConfirmationEnabled",
        title: "Sevk onayı adımı",
        summary:
          "Sevk iki adıma bölünür: önce planlı sevkiyat kurulur, çıkış ayrıca Sevk Kapısı'ndan onaylanır.",
        defaultOn: false,
        audience: ["Sevkiyat"],
        desc: "Kapalı (varsayılan): depo çuvallarını seç → doğrudan sevk edilir (stok o an düşer). Açık: önce PLANNED (planlı) sevkiyat kurulur; fiili çıkış ayrıca 'Sevk Kapısı' ekranından onaylanır. Stok her iki modda da yalnız çıkışta düşer.",
      },
      {
        key: "shipmentManualSackCountEnabled",
        title: "Çuval sayısını elle gir",
        summary:
          "Sevkiyat ekranında 'araca yüklenen çuval adedi' alanı açılır; irsaliyede sistem sayısıyla YAN YANA basılır.",
        defaultOn: false,
        audience: ["Sevkiyat"],
        desc: "Kapalı (varsayılan): irsaliyede yalnız sistemin saydığı çuval kaydı adedi kullanılır. Açık: sevkiyat ekranında \"Araca yüklenen çuval adedi\" alanı çıkar ve operatör gerçekte kaç çuval gittiğini yazar. Sahada 10 çuval gönderilip hepsi tek bir çuval kaydının içine yazıldığında sistemin saydığı rakam fiziksel gerçeği vermez; bu alan o farkı kapatır. Girilen rakam irsaliyede sistemin saydığıyla YAN YANA basılır (biri diğerinin yerine geçmez) ve muhasebe listesinde de görünür. Alan boş bırakılabilir — boşken belge bugünkü gibi basılır.",
      },
      {
        key: "shipmentUndoSameDayOnly",
        title: "Sevk geri almayı aynı günle sınırla",
        summary: "Yalnız bugün sevk edilmiş sevkiyatlar geri alınabilir.",
        defaultOn: false,
        audience: ["Sevkiyat", "Yönetim"],
        desc: "Kapalı (varsayılan): sevk edilmiş bir sevkiyat tarih sınırı olmadan geri alınabilir (\"Sevki Geri Al\" — mal hiç çıkmadıysa; irsaliye İPTAL edilir, toplar sevk öncesi rafına döner). Açık: yalnız BUGÜN sevk edilenler geri alınabilir. Faturalanmış sevkiyat ve bu sevkiyattan iade alınmış olması bu ayardan bağımsız olarak her zaman geri almayı engeller. Geri alma ayrı bir izin ister: shipping:undo-dispatch.",
      },
      {
        key: "returnGradingEnabled",
        title: "İade kabulünde personel kaliteyi değiştirebilsin",
        summary: "Teslim alan personel iade edilen topun kalitesini düzeltebilir.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Kapalıyken mobil İade ekranında 'kalite belirt' kontrolü gizlenir; top çıktığı kaliteyle döner. Açıkken teslim alan personel topun kalitesini düzeltebilir (etiket değişir; iade yine Hazır Depo'ya iner). Kapalıyken backend gönderilen kalite override'ını yok sayar.",
      },
      {
        key: "shippingSimulatedWeightEnabled",
        title: "Simüle kantardan gelen çuval tartısı kaydedilebilsin (demo/eğitim)",
        summary:
          "Simülasyon modundaki kantarın ürettiği rastgele kg değeri kabul edilir — yalnız demo kurulumu.",
        defaultOn: false,
        audience: ["Sevkiyat", "Yönetim"],
        desc: "Kapalıyken (varsayılan) cihaz kaydında “simülasyon” açık bir kantardan okunan kg backend tarafından REDDEDİLİR (400) — simüle kantar 10-100 kg arası rastgele değer üretir ve çuval kg'si sevk irsaliyesine + çeki listesine basılır (müşteri/gümrük belgesi). Elle giriş (⋮ → “Elle kg gir”) bu ayardan ETKİLENMEZ; kantarsız/arızalı durumun kaçış yoludur. Yalnızca demo/eğitim kurulumunda açın.",
      },
      {
        key: "shippingWeighRequiredEnabled",
        title: "Sevk öncesi tüm çuvallar tartılmış olsun",
        summary:
          "Yurtiçi sevkte de tartı zorunlu olur; tartısız çuval varken sevkiyat kurulamaz.",
        defaultOn: false,
        audience: ["Sevkiyat", "Depocu"],
        group: "Tartı",
        desc: "Kapalı (varsayılan): yalnız YURTDIŞI sevk tüm çuvalların tartılı olmasını ister — yurtiçi sevk tartısız yapılabilir (bugünkü davranış). Açık: yurtiçi sevk de tartı ister; sevkiyat kurma, çuval ekleme ve sevk etme adımlarının üçü de tartısız çuval varken 400 verir ve hangi çuvalların tartısız olduğunu söyler. İHRACAT KURALI BU AYARDAN BAĞIMSIZDIR ve her zaman geçerlidir (ayar yalnız genişletir, gevşetmez). ⚠️ İKİ YAN ETKİ: (1) “Hızlı Sevk” (topları seç → tek adımda sevk) tamamen kapanır — orada çuval operatöre görünmeden doğduğu için tartılamaz; sevk Paketleme/Çuvallar ekranından yapılır. (2) Tartılı bir çuvala sonradan top eklenirse kg SIFIRLANIR (bayat kg irsaliyeye gitmesin diye) — o çuval yeniden tartılmadan sevk edilemez; operatör bunu “sistem tartıyı unuttu” diye okumasın.",
      },
      {
        key: "shippingManualWeightRestrictedEnabled",
        title: "Elle kg girişini sevkiyat sorumlusuyla sınırla",
        summary:
          "Tablet operatörü kantardan tartar; elle kg yalnız sevkiyat yazma yetkisi olan kişide.",
        defaultOn: false,
        audience: ["Sevkiyat", "Operatör"],
        group: "Tartı",
        desc: "⚠️ ÖNKOŞUL: Tüm tabletler ve paneller güncel olmalı. Eski istemciler tartı kaynağını bildirmediği için elle tartı yolu toplu olarak kapanır. — Kapalı (varsayılan): çuval tartısı elle de girilebilir, kimse ayırt edilmez (bugünkü davranış). Açık: elle giriş yalnız “shipping:write” yetkisi taşıyan kişide serbest kalır; yalnız mobil paketleme/sevkiyat yetkisiyle gelen tablet operatörü kantardan tartmak zorundadır (elle girerse 403). Yeni bir yetki kodu EKLENMEZ — ayrım mevcut yetkilerle kurulur, yani kimseye yeni bir şey atamanız gerekmez. Çuval açılışında kg gönderen yol da aynı kuraldan geçer (arka kapı yok).",
      },
    ],
    enumFlags: [
      {
        enumKey: "shippingOrderRequirement",
        title: "Sevkiyat siparişe bağlansın mı",
        summary:
          "Siparişsiz sevkte ne yapılsın: sorma · uyar (varsayılan) · zorunlu tut.",
        defaultValue: "warn",
        options: SHIPMENT_ORDER_REQUIREMENT_OPTIONS,
        audience: ["Sevkiyat", "Planlamacı"],
        desc: "⚠️ ÖNKOŞUL (yalnız “Zorunlu tut” için): Tabletlerde sipariş seçici bulunan APK kurulu olmalı. Bugünkü tablet Paketleme ekranı sipariş göndermiyor — “block” seçilirse sahada HİÇ sevkiyat kurulamaz. Önce APK, sonra bu ayar. — Siparişe yazılmayan mal, karşılanma/açık talep/Ürün Dengesi ekranlarında GÖRÜNMEZ; fabrika karşılanmış talebi yeniden üretir. “Uyar” (varsayılan) sevkiyatı kurar ve ekranda uyarı basar. “Zorunlu tut” kurulumu engeller — ama “Siparişsiz devam et” işaretlenirse yine geçer (numune/fazla mal meşru bir iştir; kural “sipariş seç” değil “ne yaptığını söyle”). Engel YALNIZ kurulumdadır: ayar açılmadan önce kurulmuş planlı sevkiyatların çıkışı kilitlenmez. Fasondan doğrudan sevk de AYNI kurala tabidir (orada da “Siparişsiz devam et” kutusu vardır).",
      },
      {
        enumKey: "shippingInvoiceMode",
        title: "Fatura izi nereden yazılsın",
        summary:
          "Sevkin fatura numarası dış programdan elle mi işaretlensin, ERP faturasından mı gelsin.",
        defaultValue: "dis",
        options: SHIPPING_INVOICE_MODE_OPTIONS,
        audience: ["Muhasebeci", "Sevkiyat"],
        desc: "“Dış programdan” (varsayılan): fatura başka bir muhasebe programında kesilir, buraya yalnız numarası + tarihi elle işaretlenir (bugünkü davranış). “Yalnız ERP faturası”: elle işaretleme kapanır (400) ve numara yalnız Muhasebe → Faturalar'da onaylanan faturadan gelir; yanlış girilmiş bir izi KALDIRMAK her modda mümkün kalır. “İkisi de”: elle işaret serbesttir ama sevkin ERP faturası varsa uyarı çıkar (engel yok) — geçiş dönemi için. Fasondan doğrudan sevk de aynı kurala tabidir. NOT: sevk sonrası otomatik fatura taslağı bu ayardan etkilenmez, kendi ön muhasebe anahtarına bağlıdır.",
      },
      {
        enumKey: "shippingDocItemNameMode",
        title: "Sevk belgesinde ürün adı",
        summary:
          "İrsaliyede kendi ürün adımız mı, müşterinin kullandığı ad mı, yoksa ikisi de mi yazsın.",
        defaultValue: "bizdeki",
        options: SHIPPING_DOC_ITEM_NAME_MODE_OPTIONS,
        audience: ["Sevkiyat", "Muhasebeci"],
        desc: "Müşterinin bizim üründe kullandığı ad iki yerden gelir: sipariş satırına bir SEFERLİĞİNE yazılan ad (varsa O kazanır) ve müşteri kartındaki kalıcı karşılık (Müşteri Adları). İkisi de yoksa bizim adımız basılır — “Müşterideki ad” seçiliyken bile hücre boş kalmaz. Ad, sevk anında belgeye DONAR: müşteri kartındaki karşılığı sonradan değiştirmek eski irsaliyeyi değiştirmez. Bu ayar yalnız HANGİ adın basıldığını belirler; ayarı değiştirmek belgenin içeriğini değiştirmez, yeni revizyon doğurmaz, eski belgeler de yeni ayarla basılır. Kolon başlıklarını “Belge Alanları” tablosundan kendiniz yazabilirsiniz. NOT: kapsam sevk irsaliyesi + muhasebe fişidir; fasondan DOĞRUDAN sevk irsaliyesi bu ayarın dışındadır.",
      },
      {
        enumKey: "shippingDocCekiNameMode",
        title: "Çeki listesinde ad",
        summary:
          "Çeki listesi üstteki ayarı mı izlesin, yoksa kendi kuralı mı olsun (ör. hem bizim hem müşterinin adı).",
        defaultValue: "devral",
        options: SHIPPING_DOC_CEKI_NAME_MODE_OPTIONS,
        audience: ["Sevkiyat", "Depocu"],
        desc: "Çeki listesi sevk irsaliyesinin bir bölümüdür ama TEK BAŞINA da basılabilir (Sevkiyat → Yazdır → Çeki Listesi) ve ambarda kontrol listesi olarak kullanılır. Bu yüzden orada “hem bizdeki hem müşterideki ad” istemek anlamlıdır — oysa müşteriye giden ürün listesinde iki ad birden istenmez. Varsayılan “Genel ayarı izle”: çeki listesi üstteki “Sevk belgesinde ürün adı” ayarının dediğini yapar, yani bugünkü çıktı tek bayt değişmez. Diğer üç seçenek YALNIZ çeki bölümünü çevirir; ürün listesine ve muhasebe fişine dokunmaz. Müşterideki ad karşılığı olmayan satırda bizim adımız basılır (hücre boş kalmaz).",
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
        desc: "Kapalıyken iş emri formunda 'hedef metraj' alanı gizlenir. Proses-only fabrikada üretim miktarını giren kumaş belirler; ileride örgü/üretim eklenirse açılır.",
      },
      {
        key: "partyCodeAuto",
        title: "İş emri parti kodunu otomatik üret",
        summary: "İş Emri No elle yazılmak yerine sistem tarafından önerilir.",
        defaultOn: false,
        audience: ["Planlamacı"],
        desc: "Kapalıyken (varsayılan) iş emri formunda İş Emri No elle girilir ve zorunludur. Açıkken sistem otomatik üretir (İE1207260001 — İE + GGAAYY + sıra); formda 'elle gir' ile yine değiştirilebilir. Not: partinin kendi numarası her zaman otomatiktir, bu ayardan etkilenmez — biçimini aşağıdaki 'Parti no kısa ve dönen olsun' ayarı belirler.",
      },
      {
        key: "batchShortNumberEnabled",
        title: "Parti no kısa ve dönen olsun (P01…P99)",
        summary:
          "Parti numarası P01'den P99'a gider ve başa döner — fabrikadaki plaka düzeninin karşılığı.",
        defaultOn: true,
        audience: ["Planlamacı", "Operatör"],
        desc: "Açıkken (varsayılan) parti numarası P01'den başlar, P99'a kadar gider ve sonra tekrar P01'e döner — fabrikadaki numaralı fiziksel parti plakası düzenine karşılık gelir. ⚠️ Bu numara BENZERSİZ DEĞİLDİR: aynı numara birkaç günde bir yeniden kullanılır ve sistem numaranın o an başka bir partide olup olmadığına BAKMAZ. Partiyi kayıt olarak birbirinden ayıran şey numara değil, iş emri + tarihtir; parti no ile arama bu yüzden birden çok sonuç döndürür. Kapatırsan eski biçime dönülür: P + gün-ay-yıl + günlük sıra (P0508261) — o biçim benzersizdir. Ayarı değiştirmek MEVCUT partilerin numarasını değiştirmez, yalnız bundan sonra doğacakları etkiler.",
        hint: BatchNumberHint,
      },
      {
        key: "batchLastNumberHintEnabled",
        title: "İş emri formunda 'Son Kullanılan Parti No' rozetini göster",
        summary:
          "Yeni iş emri formunda son verilen parti numarası rozet olarak gösterilir.",
        defaultOn: true,
        audience: ["Planlamacı"],
        desc: "Açıkken (varsayılan) yeni iş emri formundaki Parti Kodu alanının üstünde son verilmiş parti numarası rozet olarak yazar. Planlamacıya fikir verir; SIRADAKİ numarayı VAAT ETMEZ (numara parti doğduğu anda atanır, aradaki her yeni parti sırayı kaydırır). Yalnız gösterimdir — numara üretimini etkilemez.",
      },
      {
        key: "batchAutoCreateEnabled",
        title: "Açık parti yokken partiyi sistem kendisi açsın",
        summary:
          "Tambur'dan elle top eklerken iş emrinde hiç açık parti yoksa sistem yeni bir parti açıp topu ona bağlar.",
        defaultOn: false,
        audience: ["Planlamacı", "Operatör"],
        desc: "Kapalıyken (varsayılan) Tambur'da elle top eklenirken iş emrinde hiç açık parti yoksa top PARTİSİZ doğar (bugünkü davranış). Açıkken sistem o anda yeni bir parti açar ve topu ona bağlar — operatöre soru sorulmaz, açılan partinin numarası kayıt sonrası ekranda yazar. Birden fazla açık parti varsa davranış değişmez: operatöre hangi partiye ekleneceği sorulur. ÖNKOŞUL: Bu ayar 'parti ZORUNLU olsun' demek DEĞİLDİR — operatörün elle parti açmasını isteyen düzen ayrı bir pakettir; bugün sistemde sıfırdan parti yaratan bir ekran yok, o yüzden 'zorunlu' seçeneği sahayı çıkışsız bırakırdı. İş emrine top bağlamanın diğer yolları (Hızlı İş Emri, toplu top ekleme) bu ayardan ETKİLENMEZ — orada parti zaten her zaman doğar.",
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
      "kurşun dağıtım bypass makine atama kağıt fason dönüş tambur onay kurşun sırası",
    kind: "flags",
    section: "production",
    flags: [
      {
        key: "rawWidthEnabled",
        group: "KK1 / Kalite",
        title: "KK1 ham kumaş girişinde en (cm) alanını göster",
        summary: "Ham girişte en alanı çizilir; kapalıyken operatör isterse yine girebilir.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Kapalıyken mobil KK1 ekranında en alanı gizlenir; operatör isterse 'en gir' ile yine girebilir. Ham kumaşın eni önemsiz — bitmiş topun eni iş emrinden gelir. Kumaş Dengesi ham stoğu en'e bakmadan sayar.",
      },
      {
        key: "kk1WeightEntryEnabled",
        group: "KK1 / Kalite",
        title: "KK1 ham kumaş girişinde ağırlık (kg) alanını göster",
        summary: "Ham girişte kg alanı açılır; kapalıyken backend gönderilen kg'yi reddeder.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Kapalıyken (varsayılan) mobil KK1 Manuel Giriş ekranında ağırlık (kg) alanı gizlenir VE backend ağırlık verisini reddeder — operatör yanlışlıkla veya kasıtlı olarak kg giremez. Açıkken makine arızasında elle metrajın yanında ağırlık da girilebilir. (Metraj girişi bu ayardan bağımsız, her zaman açıktır.)",
      },
      {
        key: "kk1DuplicateGuardEnabled",
        group: "KK1 / Kalite",
        title: "Ham girişte mükerrer top uyarısı",
        summary:
          "90 saniye içinde birebir aynı top yeniden girilirse sistem sorar; onaylanırsa kaydeder.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Açıkken aynı operatör/makine 90 saniye içinde birebir aynı kumaş + metraj + en girerse sistem uyarır ve kaydı ancak açık onayla alır (engellemez — arka arkaya birebir aynı top gerçekten gelebilir). Sunucu yeniden başlarken tuşa üst üste basılması sonucu doğan kopya stok kayıtlarına karşı ikinci savunma hattıdır. ⚠️ Açmadan önce sahadaki tabletlerin güncel sürüme yükseltildiğinden emin olun — eski sürüm bu uyarıyı tanımaz.",
      },
      {
        key: "qualityGradeRequiredEnabled",
        group: "KK1 / Kalite",
        title: "Top kalitesi zorunlu olsun",
        summary:
          "Kalite seçilmeden top girilemez, kesilemez ve iş emri kapanışında depoya indirilemez.",
        defaultOn: false,
        audience: ["Operatör", "Yönetim"],
        desc: "Kapalıyken (varsayılan) kalite opsiyoneldir: kaliteye bakılmadan girilen top 'Belirsiz' kalitede yaşar ve kararı sonraki istasyon verir. Açıkken kalite DÖRT yerde zorunlu olur: (1) ham/manuel top girişi, (2) Tambur'da kesim toplamı topun metrajını doldurmuyorsa doğan 'kalan' parça — kaynak topun da kalitesi yoksa, (3) depodaki topun kesilmesi, (4) iş emri kapanışında 'depoya al' / '2. kalite' kararı verilen toplar. Bilerek DIŞARIDA bırakılanlar: açık kumaş kesimi (kalite zaten hep dolu), fason kabulünde doğan toplar (kaliteye orada bakılmaz — karar Tambur'un), son adımın otomatik depo indirişi (kilitlenirse iş emri hiç kapanmaz) ve iade kabulü (kalite girecek ekran yok). ÖNKOŞUL: Açmadan önce sahadaki tabletler güncel APK'da olmalı — 'kalan parça için kalite' alanı eski sürümde YOK ve o dal 'kalite zorunlu' hatasıyla durur; ayrıca çevrimdışı kuyrukta bekleyen kalitesiz kayıtlar gönderilirken reddedilir ve tekrar denenmez.",
      },
      {
        key: "kk1OnlineOnlyEnabled",
        group: "KK1 / Kalite",
        title: "Ham girişte çevrimdışı kuyruğu kapat (online-only)",
        summary: "Tablet sunucuya ulaşamazken ham giriş yapılamaz; form kilitlenir ve sebebi yazar.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Açıkken mobil KK1 sunucuya ulaşamazken kayıt ALMAZ: form kilitlenir ve sebebi yazar (ağ mı, sunucu mu). Kayıt ile etiket tek akışta yürür — 'sırada bekleyen / basılamayan etiket' listeleri hiç doğmaz, kesintide girilemeyen top sunucu dönünce girilir. Kapalıyken (varsayılan) bugünkü davranış: çevrimdışı girişler kuyruğa alınır, bağlantı gelince gönderilir ve etiketleri o zaman basılır. ⚠️ Açmadan önce sahadaki tabletlerin bu rejimi tanıyan APK'da olduğundan emin olun — eski sürüm bayrağı görmez ve kuyrukla çalışmaya devam eder.",
      },
      {
        key: "kk1HistoryAllEntriesEnabled",
        group: "KK1 / Kalite",
        title: "Ham girişte 'Tüm Girişler' herkesin kayıtlarını göstersin",
        summary:
          "Tabletteki 'Tüm Girişler' listesi tüm operatörleri gösterir ve personele göre süzülebilir.",
        defaultOn: false,
        audience: ["Operatör", "Yönetim"],
        desc: "Açıkken tabletteki 'Tüm Girişler' listesi TÜM operatörlerin ham girişlerini gösterir ve operatöre göre süzülebilir. Kapalıyken (varsayılan) operatör yalnız KENDİ girdiği topları görür — sağdaki 'Son Kayıtlar' listesi bu ayardan bağımsız her zaman kişiye özeldir. Bu bir yetki duvarı değil ekran sadeleştirmesidir; yönetim panelindeki Toplar listesi aynı veriyi 'Ekleyen' filtresiyle her durumda görür.",
      },
      {
        key: "kk1LabelScanVerifyEnabled",
        group: "KK1 / Kalite",
        title: "Ham girişte etiket geri-okutma doğrulaması (scan-back)",
        summary: "Basılan etiket okutulmadan yeni top girilemez — 'kâğıt gerçekten çıktı mı' kanıtı.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Açıkken basılan her top etiketi için tablet 'çıkan kâğıdı OKUT' ister ve okutulmadan yeni top girilemez — 'etiket çıktı mı' sorusunu yazılım değil tarayıcı cevaplar (yazıcı baskı onayı döndürmez; yazılımın 'bastım' demesi kâğıdın çıktığını kanıtlamaz). Etiket okunmuyorsa 'Tekrar Bas' ile yeni kâğıt basılır. Kapalıyken (varsayılan) ekranda bu akışa dair hiçbir öğe görünmez. ⚠️ Seri girişe her topta bir okutma adımı ekler; kamera arızasında akışı tıkayabilir — geri dönüş yolu bu anahtarı kapatmaktır. Açmadan önce tabletlerin güncel APK'da olduğundan emin olun.",
      },
      {
        key: "fasonShrinkWarnEnabled",
        group: "Fason",
        title: "Fason kabulünde çekme (metraj farkı) uyarısı göster",
        summary:
          "Fason kabulünde giden ↔ dönen metraj farkı toleransı aşarsa uyarı çıkar (çekme normaldir, aşırısı sorulur).",
        defaultOn: true,
        audience: ["Operatör", "Planlamacı"],
        desc: "Boyahanede kumaş ÇEKER: 250 metre giden mal 220 metre döner ve bu normal bir üretim gerçeğidir. Açıkken (varsayılan) kabul ekranı bu farkı gösterir ve yalnız aşağıdaki toleransın ÜSTÜNDEysa uyarı + onay ister. Kapatırsan fark yine yazılır ama hiçbir uyarı/onay çıkmaz. Bu ayar SUNUMU belirler: fark her hâlükârda sapma defterine (fason firesi) kaydedilir ve Fason Karnesi'ndeki fire oranını besler — yani ayarı kapatmak fireyi gizlemez, yalnız operatörü durdurmaz.",
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
        desc: "Kapalıyken (varsayılan) sahadaki operatör mobil Fason Sevk ekranında talimat giremez; talimat yalnızca iş emrindeki fason adımının notundan gelir. Açıkken operatör sevk sırasında telefondan talimat girebilir/değiştirebilir (boş bırakırsa adım notu kullanılır).",
      },
      {
        key: "kursunBypassEnabled",
        group: "Kurşun",
        title: "Kurşun istasyonunda tablet yok — işi dağıtımla yürüt (kurşun bypass)",
        summary:
          "Kurşun/KK2 tabletten okutulmaz; iş makineye dağıtılır ve Tambur okutmasıyla kapanır.",
        defaultOn: false,
        audience: ["Planlamacı", "Operatör"],
        desc: "Kapalıyken (varsayılan) kurşun + KK2 normal akışta, tabletten okutularak işlenir. Açıkken kurşun fiziksel olarak yapılır ama dijital izlenmez (hatalar kâğıtta kalır): yetkili personel 'Kurşun Dağıtım' ekranından bekleyen iş emrini fiziksel bir kurşun MAKİNESİNE atar (istasyon tek, makineler N tane); Tambur refakat kartını okuttuğunda kurşun/KK2 adımı önizleme+onay ile TAMAMLANMIŞ sayılır ve toplar Tambur'a geçer (kalite Tambur'da belirlenir, kurşunda 'Belirsiz' kalır). Kurşun rotanın son adımıysa iş dağıtım ekranındaki 'İşi Bitir' ile kapanır ve toplar depoya iner. Bu ayar YALNIZCA yeni dağıtım yapılmasını kapılar — kapatsan da hâlihazırda dağıtılmış iş emirleri bypass ile bitirilir; adım ATLANMAZ, normal şekilde tamamlanır. NOT: açıkken 'Kurşun Sırası' ekranı gizlenir — o sıralamanın tek tüketicisi kurşun tabletiydi; izleme ve acil işaretleme 'Kurşun Dağıtım' ekranında (aynı sıralamayla) yapılır.",
      },
      {
        key: "tamburOverQuantityEnabled",
        group: "Tambur",
        title: "Tambur'da çıkan top metresi giriş metresini aşabilsin",
        summary: "Kayıtlıdan fazla ölçülen metraj onay sonrası kabul edilir; kaynak top tükenir.",
        defaultOn: true,
        audience: ["Operatör"],
        desc: "Açıkken (varsayılan) — Tambur asıl ölçüm noktası olduğu için — operatör kayıtlıdan fazla ölçtüğünde (örn. 100m açık kumaşı 150m top yapma) mobilde onay sonrası kabul edilir; kaynak top tamamen tüketilir. Kapatırsan Tambur'da çıkan top kayıtlı metrajdan fazla olamaz (örn. 100m topa 110m girilemez). Yalnızca aşım anında devreye girer, normal kesim etkilenmez.",
      },
      {
        key: "tamburShortCutA1Enabled",
        group: "Tambur",
        title: "Kısa kesimde kalite otomatik A1 yazılsın",
        summary:
          "Tamburda eşiğin ALTINDA kalan kesimin kalitesi kendiliğinden 2. kaliteye (A1) çekilir.",
        defaultOn: false,
        audience: ["Operatör"],
        desc: "Kapalıyken (varsayılan) tamburda kalite her zaman elle seçilir. Açıkken kesim uzunluğu aşağıdaki eşiğin ALTINDA kalırsa kalite kendiliğinden A1'e çevrilir — kısa parça fiziksel olarak 2. kalitedir ve operatör kaliteyi çevirmeyi unutunca 1. Kalite etiketiyle depoya iniyordu. Kural YALNIZ 1. Kalite seçiliyken devreye girer: operatör A1 ya da Fire'ı kendisi seçtiyse dokunulmaz, otomatik yazılan A1 de elle geri çevrilebilir. Makineden ölçüm ve 'kalanı kes' yolları dahil. Bu ayar FABRİKA VARSAYILANIDIR — tablette yetkili operatör (saha düzeltme yetkisi olan) cihaz bazında açıp kapatabilir ya da kendi eşiğini girebilir.",
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
        desc: "Tambur'da bir kapanışı TÜMDEN geri almak (o kesimden çıkan tüm topları iptal edip kaynağı diriltmek) iş emrinin geçmişini yeniden yazar; bu yüzden zaten ayrı bir yetki (roll:manual-adjust) ve zorunlu sebep ister. Bu ayar AÇIKKEN ek olarak süre sınırı koyar: kapanış bugün yapıldıysa geri alınabilir, dünkü bir kapanış geri alınamaz. Varsayılan KAPALI — asıl koruma zaten parçaların kendisindedir (çuvala okutulmuş / sevke girmiş / yeniden kesilmiş parça hiçbir koşulda geri alınamaz) ve sert bir süre sınırı, dün akşam yapılmış bir hatayı sabah düzeltmeyi imkânsız kılarak yeni bir çıkmaz üretebilir. TEK PARÇA iptali bu ayardan ETKİLENMEZ.",
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
    flags: [
      {
        key: "kartelaMeasurementEnabled",
        title: "Kartela kabulünde uzunluk (cm) / ağırlık (kg) alanlarını göster",
        summary: "Kartelalar adet dışında cm/kg ile de ölçülür ve listelerde gösterilir.",
        defaultOn: false,
        audience: ["Operatör", "Depocu"],
        desc: "Kapalıyken (varsayılan) kartelalar yalnızca ADET sayılır; kabul ekranında ve kartela listelerinde cm/kg (Boy/En/Uzunluk) alanları gizlenir. Açıkken kabulde ölçü girilebilir ve listelerde görünür. Kartela firmasına gönderilen topun gerçek metresi bu ayardan ETKİLENMEZ.",
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
        desc: "Kapalıyken (varsayılan) alış siparişinden fazla mal gelirse kayıt yapılır ve sistem yalnız uyarır — fiziksel olarak fazla mal GELEBİLİR ve kayıt gerçeği yazmalıdır. Açıkken sipariş miktarını aşan satır reddedilir; toleransı sıfır olan firmalar için. Siparişe bağlı OLMAYAN (serbest) mal kabulü ile kabul iptali/düzeltmesi bu kuraldan muaftır.",
      },
      {
        key: "goodsReceiptRequirePriceEnabled",
        title: "Mal kabul satırında birim fiyat zorunlu olsun",
        summary: "Fiyatı satırdan da siparişten de çözülemeyen mal kabul kaydedilemez.",
        defaultOn: false,
        audience: ["Depocu", "Muhasebeci"],
        desc: "Açıkken satırda birim fiyat yoksa ve siparişten de çözülemiyorsa mal kabul kaydedilemez. Gerekçe: fiyat kabul ANINDA donar ve alış faturası taslağı ile maliyet oradan doğar; sonradan girilen fiyat geçmişe dönük maliyet düzeltmesi demektir. Kapalıyken (varsayılan) fiyatsız kabul yapılabilir, fatura aşamasında girilir. Ters/iptal satırları fiyat taşımaz, muaftır. Bedelsiz mal için Muhasebe'deki 'Sıfır fiyatlı fatura satırına izin ver' ayarıyla birlikte düşünün.",
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
    keywords: "iplik kg stok bakiye eksi negatif çıkış sayım düzeltme depo yarn",
    kind: "flags",
    section: "trade",
    moduleKey: "iplikEnabled",
    flags: [
      {
        key: "yarnBlockNegativeBalanceEnabled",
        title: "İplik stoğu eksi bakiyeye düşemesin",
        summary: "Bakiyeyi eksiye düşürecek iplik çıkışı reddedilir; ters/düzeltme kayıtları muaf.",
        defaultOn: false,
        audience: ["Depocu"],
        desc: "Açıkken iplik ÇIKIŞI, o kalemin ilgili depodaki kg bakiyesini eksiye düşürecekse reddedilir. Kapalıyken (varsayılan) kayıt geçer ve bakiye eksiye düşebilir. Ters/düzeltme kayıtları ile belge iptalleri MUAFTIR — yanlış girilmiş bir hareket 'bakiye yetmiyor' diye geri alınamaz kalmamalı. ⚠️ Açmadan önce depoların açılış/devir bakiyelerinin girildiğinden emin olun: sistemde 0 görünen dolu bir depodan tek çıkış bile yapılamaz.",
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
        desc: "Fatura formunda yeni satır ve mal kabulden üretilen alış taslağı bu oranla açılır. Yalnız ön-dolum — her satırda değiştirilebilir; mevcut fatura ve taslaklara dokunmaz.",
        min: 0,
        max: 100,
        fallback: 20,
        unit: "%",
        audience: ["Muhasebeci"],
      },
    ],
    flags: [
      {
        key: "financeBlockNegativeCashEnabled",
        group: "Kasa & Risk",
        title: "Kasa eksi bakiyeye düşemesin",
        summary:
          "Kasayı eksiye düşürecek nakit çıkışı reddedilir; banka hesapları ve iptaller muaf.",
        defaultOn: false,
        audience: ["Muhasebeci"],
        desc: "Açıkken kasadan (fiziksel nakit) para ÇIKARAN dört işlem — ödeme, masraf fişi, virmanın çıkan kasa bacağı, çek ödeme — kasayı eksiye düşürecekse reddedilir; hata mesajı kasa adını, mevcut bakiyeyi ve istenen tutarı söyler. BANKA hesapları muaftır (kredili mevduat meşru); iptal/storno her zaman geçer. ⚠️ Açmadan önce kasaların açılış/devir bakiyelerinin girildiğinden emin olun — sistemde bakiyesi 0 görünen dolu bir kasadan tek işlem bile yapılamaz.",
      },
      {
        key: "financeRiskLimitBlockEnabled",
        group: "Kasa & Risk",
        title: "Risk limiti aşımında satış faturası onayını engelle",
        summary: "Cari risk limitini aşan satış faturası onaylanamaz; alış ve iptaller muaf.",
        defaultOn: false,
        audience: ["Muhasebeci", "Yönetim"],
        desc: "Kapalıyken (varsayılan) cari kartındaki risk limiti yalnız UYARIDIR — satışı durdurma kararı ticari bir karardır ve sistem onu vardiya ortasında sessizce vermez. Açıkken limiti aşan SATIŞ faturasının onayı reddedilir; mesaj cari adını, limiti ve mevcut bakiyeyi söyler. Alış faturaları, taslak oluşturma/düzenleme ve iptal/storno bu kuraldan MUAFTIR — limiti aşan bir faturayı iptal edememek çıkmaz olurdu.",
      },
      {
        key: "financeAllowZeroPriceLineEnabled",
        group: "Fatura kuralları",
        title: "Sıfır fiyatlı fatura satırına izin ver",
        summary: "Fiyatı 0 olan satır faturayı onaya sokabilir (promosyon/numune/bedelsiz).",
        defaultOn: false,
        audience: ["Muhasebeci"],
        desc: "Kapalıyken (varsayılan) fiyatı 0 olan satır faturayı onaya sokmaz. Promosyon, numune ve bedelsiz sevk yapan firmalar açar. ⚠️ İzin verilen şey SIFIRDIR, fiyatı boş bırakmak değil: '0 yazdım' bir karardır, 'fiyat bulunamadı' bir eksiktir ve ikisi aynı kapıdan geçmez. Eksi fiyat bu ayardan bağımsız her zaman reddedilir — indirim/iade ayrı belgeyle yapılır.",
      },
      {
        key: "financeFutureDatedDocumentBlockEnabled",
        group: "Fatura kuralları",
        title: "İleri tarihli mali belgeyi engelle",
        summary: "Fatura, tahsilat, masraf ve virman belgesinin tarihi bugünden ileri olamaz.",
        defaultOn: false,
        audience: ["Muhasebeci"],
        desc: "Açıkken fatura, tahsilat/ödeme, masraf ve virman belgelerinin tarihi bugünden ileri olamaz (gün sınırı fabrika günüdür). Kapalıyken (varsayılan) ileri tarih serbesttir. ⚠️ ÇEK bu kuralın DIŞINDADIR: çekin keşide ve vade tarihi her zaman ileri olabilir — ileri tarihli çek işin normalidir, engellemek özelliği kullanılamaz kılardı.",
      },
      {
        key: "financeAutoDraftFromShipmentEnabled",
        group: "Otomasyon",
        title: "Sevk onayında otomatik fatura taslağı oluştur",
        summary: "Sevk edilen her sevkiyat için satış faturası TASLAĞI doğar; onay her zaman elle.",
        defaultOn: false,
        audience: ["Muhasebeci", "Sevkiyat"],
        desc: "Açıkken sevk edilen her sevkiyat için satış faturası TASLAĞI kendiliğinden doğar; muhasebeci onu açar, kontrol eder ve onaylar. Fatura ONAYINI sistem asla kendi vermez. Kapalıyken (varsayılan) fatura elle oluşturulur. Not: 'Ön muhasebe modülünü aç' kapalıysa bu ayar açık olsa bile hiçbir taslak üretilmez. Taslak üretilemezse sevk yine tamamlanır — sevkiyat muhasebeye rehin edilmez.",
      },
      {
        key: "financeAutoAllocateOnPaymentEnabled",
        group: "Otomasyon",
        title: "Tahsilat/ödemeyi en eski faturalara otomatik kapat (FIFO)",
        summary: "Kaydedilen tutar en eski açık faturalardan başlayarak otomatik kapatılır.",
        defaultOn: false,
        audience: ["Muhasebeci"],
        desc: "Açıkken kaydedilen tutar, carinin en eski açık faturalarından başlayarak otomatik kapatılır; artan tutar avans olarak açıkta bırakılır. Kapalıyken (varsayılan) hangi faturanın kapanacağını kullanıcı seçer. Otomatik yapılan kapama elle silinebilir — 'sistem yaptı' diye kilitlenmez. Faturanın para birimi tahsilattan farklıysa o fatura atlanır: kur kararı otomatikleştirilmez.",
      },
      {
        key: "financeYarnOutOnInvoiceEnabled",
        group: "Otomasyon",
        title: "Satış faturası onayında iplik stoktan düşsün",
        summary:
          "Faturadaki iplik satırları onayda depodan düşer — sevkte de düşen kurulumda ÇİFTE düşüm olur.",
        defaultOn: false,
        audience: ["Muhasebeci", "Depocu"],
        desc: "Açıkken satış faturası onaylandığında faturadaki iplik satırları kalemin varsayılan deposundan düşer; fatura iptal edilirse geri yazılır. Kapalıyken (varsayılan) iplik stoğu yalnız sevk/depo hareketiyle düşer. ⚠️ Bu bir EK GÜVENCE DEĞİL, 'stoğu hangi belge düşürüyor' sorusunun cevabıdır: sevkte de düşen bir kurulumda açmak aynı kilogramı İKİ KEZ düşürür.",
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
  },
  {
    id: "devices",
    label: "Cihazlar",
    icon: TabletSmartphone,
    description: "Mobil cihaz (tablet/telefon) onay zorunluluğu ve eşleştirme.",
    keywords: "cihaz eşleştirme tablet telefon pairing onay zorunlu allowlist mobil",
    kind: "device",
    section: "printing",
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
    description:
      "Barkod tabancası: “her yerde okut” davranışı, terminatör ve burst tespiti hassasiyeti.",
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
    keywords:
      "demo eğitim tanıtım örnek senaryo test sunum müşteri gösterimi deneme kurulum sandbox",
    kind: "flags",
    section: "demo",
    flags: [
      {
        key: "demoModeEnabled",
        title: "Bu kurulum bir DEMO kurulumudur",
        summary:
          "Ekranlarda örnek veri üreten 'Demo' yardımcıları ve üst şeritte DEMO rozeti görünür.",
        defaultOn: false,
        audience: ["Yönetim"],
        desc: "KAPALI (varsayılan) olduğunda hiçbir demo yardımcısı çizilmez ve /api/demo/* uçları 403 döner — yani gerçek bir fabrika kurulumunda bu bölümün varlığı tek başına hiçbir şeyi değiştirmez. AÇIK olduğunda, sahada denenmesi zor akışlar (yeniden etiketle, kartela sevk/kabul, kurşun kuyruğu, planlı sevkiyat) tek tıkla örnek veriyle doldurulabilir; üretilen her kayıt DEMO- önekiyle ve denetim izi bırakarak doğar. Gerçek bir fabrikada AÇMAYIN.",
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
  return first ? settingsCategoryPath(first) : SURFACE_PATH.settings;
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
