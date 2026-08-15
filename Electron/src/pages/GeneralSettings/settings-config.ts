import {
  Building2,
  Banknote,
  Blocks,
  ClipboardList,
  Factory,
  Truck,
  TabletSmartphone,
  Monitor,
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

/** FeatureFlags'in yalnızca BOOLEAN değerli anahtarları (toggle edilebilenler).
 *  travelerCardConfig gibi nesne ayarları bu listeden hariçtir — kendi paneli var. */
type BooleanFlagKey = {
  [K in keyof FeatureFlags]: FeatureFlags[K] extends boolean ? K : never;
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
}

/** FeatureFlags'in SAYISAL değerli anahtarları (numberFlags satırları için). */
type NumberFlagKey = {
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
  key: NumberFlagKey;
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
 * - `flags`       → config'teki flag listesini generic toggle olarak çizer
 * - `device`      → mobil cihaz eşleştirme/onay (org düzeyi) özel section
 * - `workstation` → BU BİLGİSAYARA özel yerel ayarlar: etiket yazıcısı + kantar + sunucu adresi
 * - `session`     → oturum süresi + hareketsizlik zaman aşımı (sayısal) özel section
 */
export type CategoryKind =
  | "flags"
  | "device"
  | "workstation"
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
  | "system";

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
 * yapar: `goodsReceiptRequirePriceEnabled` (Mal Kabul ekranı rejimden BAĞIMSIZ,
 * `goods-receipt.routes.ts`te `requireFinanceEnabled` YOK) `financeEnabled`
 * kapatılınca panelden tamamen kaybolur ve mal kabul fişleri 400 almaya devam
 * ederdi. Bekçi: `Teks-Erp/scripts/test_feature_flag_contract.ts` §14 — panelde
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
 * NOT — `productionEnabled` bugün HİÇBİR kategoriyi kapılamaz ve bu bir eksik
 * değil ÖLÇÜMDÜR: backend'de `requireProductionEnabled` diye bir middleware
 * YOKTUR, mobil `featureFlag.service` bu alanı hiç taşımaz ve İş Emirleri /
 * Kartela karoları `visibleWhen` taşımaz. Yani bayrak kapatılsa bile KK1 tuzağı,
 * scan-back doğrulaması, Tambur aşım kesimi ve parti no biçimi aynen çalışır —
 * ayarlarını gizlemek yalnız geri dönüş yolunu kapatırdı. Gün gelir üretim
 * yüzeyleri gerçekten rejim kapısına alınırsa bu anahtar burada kullanılabilir;
 * o güne kadar §14 onu reddeder.
 */
export type SettingsRegimeKey = "productionEnabled" | "financeEnabled";

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
  { id: "system", label: "Sistem" },
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
   * Bu kategoriyi GÖRMEK için yeterli izinlerden herhangi biri. Verilmezse
   * `admin:settings` gerekir — yeni kategori eklerken varsayılan DAR olsun diye
   * (izin unutulursa kategori gizlenir; ters kurgu sistem ayarını sızdırırdı).
   */
  permissionAny?: string[];
  /** kind === "flags" için doldurulur. */
  flags?: FlagDef[];
  /** kind === "flags" sekmesine gömülü sayısal feature-flag alanları (opsiyonel). */
  numberFlags?: NumberFlagDef[];
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
      "Bu kurulumda hangi modüller açık — üretim ve ön muhasebe. Menüler, ekranlar ve otomatik kancalar bu iki anahtara bakar.",
    keywords:
      "modül rejim üretim muhasebe ön muhasebe finance production aç kapat kurulum fabrika ticaret alım satım menü gizle",
    kind: "flags",
    section: "modules",
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
    ],
  },
  {
    id: "customers",
    label: "Müşteriler",
    icon: UsersRound,
    description: "Müşteri kartı ve şube (sevk noktası) davranışı.",
    keywords:
      "müşteri şube sevk noktası branch ihracat kodu kart firma tedarikçi sevk yeri gizle",
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
  // Depo/satın alma bayrakları bilinçli olarak Muhasebe sekmesinde DEĞİL: bu üç
  // ayarı yapan kişi depo/satın alma sorumlusudur ve ayarların değiştirdiği şey
  // mal kabul + iplik çıkışı EKRANLARININ davranışıdır (fatura/cari değil).
  // "Mal kabulde fiyat zorunlu" ayarı muhasebeye HİZMET eder ama muhasebecinin
  // ekranında yaşamaz — sekme, ayarın etkilediği ekranın sahibine göre seçilir.
  //
  // ⚠️⚠️ REJİM KAPISI YOK — YERLEŞİM "Depo & Muhasebe" BAŞLIĞI ALTINDA OLSA DA.
  // Üç bayrağın da enforcement'ı `finance.enabled` KAPALIYKEN DE koşar:
  //   · goodsReceiptRequirePriceEnabled / purchaseBlockOverReceiptEnabled →
  //     `goods-receipt.service.confirm`; `goods-receipt.routes.ts` REJİMSİZDİR
  //     (kapı yalnız izin: `goods-receipt:*`) ve Mal Kabul karosu da rejimsizdir.
  //   · yarnBlockNegativeBalanceEnabled → `yarn-balance-guard.helper`; iplik
  //     defterine `goods-receipt.service` de yazar (`applyYarnMovementTx`), yani
  //     rejimsiz yoldan tetiklenir.
  // Kapılansaydı: fiyat zorunluluğunu açıp ön muhasebeyi bırakan firma, mal kabul
  // fişleri 400 alırken bayrağı kapatacak hiçbir ekran bulamazdı; simetrik olarak
  // ön muhasebe kullanmayan ama mal kabul kullanan firma onu hiç AÇAMAZDI.
  // Bekçi: `Teks-Erp/scripts/test_feature_flag_contract.ts` §14.
  {
    id: "warehouse",
    label: "Depo & Satın Alma",
    icon: Warehouse,
    description: "Mal kabul, alış siparişi ve iplik stok hareketlerinin katılık ayarları.",
    keywords:
      "depo ambar mal kabul giriş irsaliye alış satın alma sipariş tedarikçi fazla kabul tolerans " +
      "iplik kg stok bakiye eksi negatif birim fiyat zorunlu maliyet",
    kind: "flags",
    section: "trade",
    flags: [
      {
        key: "yarnBlockNegativeBalanceEnabled",
        title: "İplik stoğu eksi bakiyeye düşemesin",
        summary: "Bakiyeyi eksiye düşürecek iplik çıkışı reddedilir; ters/düzeltme kayıtları muaf.",
        defaultOn: false,
        audience: ["Depocu"],
        desc: "Açıkken iplik ÇIKIŞI, o kalemin ilgili depodaki kg bakiyesini eksiye düşürecekse reddedilir. Kapalıyken (varsayılan) kayıt geçer ve bakiye eksiye düşebilir. Ters/düzeltme kayıtları ile belge iptalleri MUAFTIR — yanlış girilmiş bir hareket 'bakiye yetmiyor' diye geri alınamaz kalmamalı. ⚠️ Açmadan önce depoların açılış/devir bakiyelerinin girildiğinden emin olun: sistemde 0 görünen dolu bir depodan tek çıkış bile yapılamaz.",
      },
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
  {
    // id "system" tarihsel — komut paleti/derin linkler ?tab=system ile gelir, kırmayalım.
    id: "system",
    label: "Bu Bilgisayar",
    icon: Monitor,
    description:
      "Bu bilgisayara özel yerel donanım: etiket yazıcısı (seri/CUPS), sevkiyat kantarı, barkod tabancası ve sunucu adresi.",
    keywords:
      "yazıcı etiket yazıcısı printer com cups kuyruk seri baud diyalogsuz doğrudan baskı cihaz kaydı " +
      "kantar tartı scale sunucu adresi API backend bağlantı url endpoint bu bilgisayar yerel workstation " +
      "barkod qr tabanca okuyucu scanner wedge klavye usb bluetooth her yerde okut terminator enter tab hassasiyet test",
    kind: "workstation",
    section: "printing",
    // Tek "geniş olmayan" kategori: yerel donanımını kendisi kuran personel
    // `settings:workstation` ile YALNIZ bu sekmeyi görür (sayfadaki diğer
    // kategoriler listeye bile girmez).
    permissionAny: [SETTINGS_ADMIN_PERMISSION, WORKSTATION_PERMISSION],
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
];

/** Kullanıcının izinlerine göre görünen kategoriler (sayfa + komut paleti ORTAK). */
export function visibleSettingsCategories(
  hasAnyPermission: (perms: string[]) => boolean,
): SettingsCategory[] {
  return SETTINGS_CATEGORIES.filter((cat) =>
    hasAnyPermission(cat.permissionAny ?? [SETTINGS_ADMIN_PERMISSION]),
  );
}
