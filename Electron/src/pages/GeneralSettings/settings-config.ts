import {
  Building2,
  Banknote,
  ClipboardList,
  Factory,
  Truck,
  TabletSmartphone,
  Monitor,
  Clock,
  Tags,
  Layers,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { FeatureFlags } from "@/services/featureFlagService";

/** FeatureFlags'in yalnızca BOOLEAN değerli anahtarları (toggle edilebilenler).
 *  travelerCardConfig gibi nesne ayarları bu listeden hariçtir — kendi paneli var. */
type BooleanFlagKey = {
  [K in keyof FeatureFlags]: FeatureFlags[K] extends boolean ? K : never;
}[keyof FeatureFlags];

/** Tek bir özellik anahtarının ekranda görünen metinleri. `key` backend kontratına bağlanır. */
export interface FlagDef {
  key: BooleanFlagKey;
  title: string;
  desc: string;
  /**
   * Sekme içi alt-başlık (aynı domainin farklı istasyonlarını ayırır — örn. Üretim
   * sekmesinde "KK1 / Kalite", "Fason", "Tambur"). Aynı `group` ardışık flag'ler tek
   * blok olur; verilmezse başlıksız düz liste (geriye uyumlu).
   */
  group?: string;
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

export interface SettingsCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  kind: CategoryKind;
  /**
   * Bu kategoriyi GÖRMEK için yeterli izinlerden herhangi biri. Verilmezse
   * `admin:settings` gerekir — yeni kategori eklerken varsayılan DAR olsun diye
   * (izin unutulursa kategori gizlenir; ters kurgu sistem ayarını sızdırırdı).
   */
  permissionAny?: string[];
  /** kind === "flags" için doldurulur. */
  flags?: FlagDef[];
  /**
   * Komut paletinde (arama) bu kategoriyi bulduran ek anahtar kelimeler. İçindeki
   * tek tek ayarların adları/eş anlamlıları burada; aramada görünmez ama eşleşir.
   */
  keywords?: string;
}

/**
 * Genel Ayarlar ekranının domaine bölünmüş kategorileri. Yeni bir özellik anahtarı
 * eklerken: backend `FeatureFlags` kontratına ekle → ilgili kategorinin `flags`
 * dizisine bir satır ekle. Sayfa otomatik render eder (ayrı kart/mutation gerekmez).
 */
export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: "company",
    label: "Şirket Bilgileri",
    icon: Building2,
    description: "ERP'nin kurulduğu firmanın adı — panel başlığında ve uygulama genelinde gösterilir.",
    keywords: "şirket firma ad kurum işletme marka isim başlık panel",
    kind: "company",
  },
  {
    id: "customers",
    label: "Müşteriler",
    icon: UsersRound,
    description: "Müşteri kartı ve şube (sevk noktası) davranışı.",
    keywords:
      "müşteri şube sevk noktası branch ihracat kodu kart firma tedarikçi sevk yeri gizle",
    kind: "flags",
    flags: [
      {
        key: "customerBranchesEnabled",
        title: "Müşteri şubeleri (sevk noktaları) özelliğini göster",
        desc: "Açıkken (varsayılan) müşteri kartında Şubeler sekmesi, yeni müşteri formunda şube taslağı ve sipariş formunda şube seçimi görünür. 'Her şube = ayrı müşteri' düzeninde çalışan firma kapatır — şube ekranları gizlenir; mevcut kayıtlardaki şube verisi ve sipariş bağları KORUNUR, sadece görünmez olur.",
      },
    ],
  },
  {
    id: "orders",
    label: "Siparişler",
    icon: Banknote,
    description: "Sipariş ekranlarındaki fiyat/para birimi alanları ve varsayılan termin süresi.",
    keywords:
      "fiyat para birimi birim fiyat tutar döviz kur pricing sipariş termin deadline gün süre varsayılan vade teslim tarih",
    kind: "flags",
    flags: [
      {
        key: "pricingEnabled",
        title: "Sipariş para birimi ve fiyat alanlarını göster",
        desc: "Kapalıyken sipariş ekranlarında para birimi seçici, birim fiyat input'u ve toplam tutar gizlenir. Mevcut kayıtlardaki değerler korunur — kalıcı veri kaybı YOK.",
      },
    ],
  },
  {
    id: "work-orders",
    label: "İş Emirleri",
    icon: ClipboardList,
    description: "İş emri formundaki alanlar, parti kodu davranışı ve varsayılan planlama süresi.",
    keywords:
      "iş emri hedef metraj parti kodu batch otomatik üretim miktarı termin planlama süre gün varsayılan deadline plan",
    kind: "flags",
    flags: [
      {
        key: "targetQuantityEnabled",
        title: "İş emri hedef metraj alanını göster",
        desc: "Kapalıyken iş emri formunda 'hedef metraj' alanı gizlenir. Proses-only fabrikada üretim miktarını giren kumaş belirler; ileride örgü/üretim eklenirse açılır.",
      },
      {
        key: "partyCodeAuto",
        title: "İş emri parti kodunu otomatik üret",
        desc: "Kapalıyken (varsayılan) iş emri formunda İş Emri No elle girilir ve zorunludur. Açıkken sistem otomatik üretir (İE1207260001 — İE + GGAAYY + sıra); formda 'elle gir' ile yine değiştirilebilir. Not: partinin kendi numarası (P1207261) her zaman otomatiktir, bu ayardan etkilenmez.",
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
    flags: [
      {
        key: "rawWidthEnabled",
        group: "KK1 / Kalite",
        title: "KK1 ham kumaş girişinde en (cm) alanını göster",
        desc: "Kapalıyken mobil KK1 ekranında en alanı gizlenir; operatör isterse 'en gir' ile yine girebilir. Ham kumaşın eni önemsiz — bitmiş topun eni iş emrinden gelir. Kumaş Dengesi ham stoğu en'e bakmadan sayar.",
      },
      {
        key: "kk1WeightEntryEnabled",
        group: "KK1 / Kalite",
        title: "KK1 ham kumaş girişinde ağırlık (kg) alanını göster",
        desc: "Kapalıyken (varsayılan) mobil KK1 Manuel Giriş ekranında ağırlık (kg) alanı gizlenir VE backend ağırlık verisini reddeder — operatör yanlışlıkla veya kasıtlı olarak kg giremez. Açıkken makine arızasında elle metrajın yanında ağırlık da girilebilir. (Metraj girişi bu ayardan bağımsız, her zaman açıktır.)",
      },
      {
        key: "kk1DuplicateGuardEnabled",
        group: "KK1 / Kalite",
        title: "Ham girişte mükerrer top uyarısı",
        desc: "Açıkken aynı operatör/makine 90 saniye içinde birebir aynı kumaş + metraj + en girerse sistem uyarır ve kaydı ancak açık onayla alır (engellemez — arka arkaya birebir aynı top gerçekten gelebilir). Sunucu yeniden başlarken tuşa üst üste basılması sonucu doğan kopya stok kayıtlarına karşı ikinci savunma hattıdır. ⚠️ Açmadan önce sahadaki tabletlerin güncel sürüme yükseltildiğinden emin olun — eski sürüm bu uyarıyı tanımaz.",
      },
      {
        key: "fasonNoteMobileEntry",
        group: "Fason",
        title: "Fason Sevk'te fason talimatını sahadaki operatör telefondan girebilsin",
        desc: "Kapalıyken (varsayılan) sahadaki operatör mobil Fason Sevk ekranında talimat giremez; talimat yalnızca iş emrindeki fason adımının notundan gelir. Açıkken operatör sevk sırasında telefondan talimat girebilir/değiştirebilir (boş bırakırsa adım notu kullanılır).",
      },
      {
        key: "kursunBypassEnabled",
        group: "Kurşun",
        title: "Kurşun istasyonunda tablet yok — işi dağıtımla yürüt (kurşun bypass)",
        desc: "Kapalıyken (varsayılan) kurşun + KK2 normal akışta, tabletten okutularak işlenir. Açıkken kurşun fiziksel olarak yapılır ama dijital izlenmez (hatalar kâğıtta kalır): yetkili personel 'Kurşun Dağıtım' ekranından bekleyen iş emrini fiziksel bir kurşun MAKİNESİNE atar (istasyon tek, makineler N tane); Tambur refakat kartını okuttuğunda kurşun/KK2 adımı önizleme+onay ile TAMAMLANMIŞ sayılır ve toplar Tambur'a geçer (kalite Tambur'da belirlenir, kurşunda 'Belirsiz' kalır). Kurşun rotanın son adımıysa iş dağıtım ekranındaki 'İşi Bitir' ile kapanır ve toplar depoya iner. Bu ayar YALNIZCA yeni dağıtım yapılmasını kapılar — kapatsan da hâlihazırda dağıtılmış iş emirleri bypass ile bitirilir; adım ATLANMAZ, normal şekilde tamamlanır. NOT: açıkken 'Kurşun Sırası' ekranı gizlenir — o sıralamanın tek tüketicisi kurşun tabletiydi; izleme ve acil işaretleme 'Kurşun Dağıtım' ekranında (aynı sıralamayla) yapılır.",
      },
      {
        key: "tamburOverQuantityEnabled",
        group: "Tambur",
        title: "Tambur'da çıkan top metresi giriş metresini aşabilsin",
        desc: "Açıkken (varsayılan) — Tambur asıl ölçüm noktası olduğu için — operatör kayıtlıdan fazla ölçtüğünde (örn. 100m açık kumaşı 150m top yapma) mobilde onay sonrası kabul edilir; kaynak top tamamen tüketilir. Kapatırsan Tambur'da çıkan top kayıtlı metrajdan fazla olamaz (örn. 100m topa 110m girilemez). Yalnızca aşım anında devreye girer, normal kesim etkilenmez.",
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
    flags: [
      {
        key: "shipmentConfirmationEnabled",
        title: "Sevk onayı adımı",
        desc: "Kapalı (varsayılan): depo çuvallarını seç → doğrudan sevk edilir (stok o an düşer). Açık: önce PLANNED (planlı) sevkiyat kurulur; fiili çıkış ayrıca 'Sevk Kapısı' ekranından onaylanır. Stok her iki modda da yalnız çıkışta düşer.",
      },
      {
        key: "shipmentUndoSameDayOnly",
        title: "Sevk geri almayı aynı günle sınırla",
        desc: "Kapalı (varsayılan): sevk edilmiş bir sevkiyat tarih sınırı olmadan geri alınabilir (\"Sevki Geri Al\" — mal hiç çıkmadıysa; irsaliye İPTAL edilir, toplar sevk öncesi rafına döner). Açık: yalnız BUGÜN sevk edilenler geri alınabilir. Faturalanmış sevkiyat ve bu sevkiyattan iade alınmış olması bu ayardan bağımsız olarak her zaman geri almayı engeller. Geri alma ayrı bir izin ister: shipping:undo-dispatch.",
      },
      {
        key: "returnGradingEnabled",
        title: "İade kabulünde personel kaliteyi değiştirebilsin",
        desc: "Kapalıyken mobil İade ekranında 'kalite belirt' kontrolü gizlenir; top çıktığı kaliteyle döner. Açıkken teslim alan personel topun kalitesini düzeltebilir (etiket değişir; iade yine Hazır Depo'ya iner). Kapalıyken backend gönderilen kalite override'ını yok sayar.",
      },
      {
        key: "shippingSimulatedWeightEnabled",
        title: "Simüle kantardan gelen çuval tartısı kaydedilebilsin (demo/eğitim)",
        desc: "Kapalıyken (varsayılan) cihaz kaydında “simülasyon” açık bir kantardan okunan kg backend tarafından REDDEDİLİR (400) — simüle kantar 10-100 kg arası rastgele değer üretir ve çuval kg'si sevk irsaliyesine + çeki listesine basılır (müşteri/gümrük belgesi). Elle giriş (⋮ → “Elle kg gir”) bu ayardan ETKİLENMEZ; kantarsız/arızalı durumun kaçış yoludur. Yalnızca demo/eğitim kurulumunda açın.",
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
    flags: [
      {
        key: "kartelaMeasurementEnabled",
        title: "Kartela kabulünde uzunluk (cm) / ağırlık (kg) alanlarını göster",
        desc: "Kapalıyken (varsayılan) kartelalar yalnızca ADET sayılır; kabul ekranında ve kartela listelerinde cm/kg (Boy/En/Uzunluk) alanları gizlenir. Açıkken kabulde ölçü girilebilir ve listelerde görünür. Kartela firmasına gönderilen topun gerçek metresi bu ayardan ETKİLENMEZ.",
      },
    ],
  },
  {
    id: "devices",
    label: "Cihazlar",
    icon: TabletSmartphone,
    description: "Mobil cihaz (tablet/telefon) onay zorunluluğu ve eşleştirme.",
    keywords: "cihaz eşleştirme tablet telefon pairing onay zorunlu allowlist mobil",
    kind: "device",
  },
  {
    id: "session",
    label: "Oturum & Güvenlik",
    icon: Clock,
    description: "Oturum süresi (token ömrü) ve hareketsizlik zaman aşımı.",
    keywords:
      "oturum süre süresi token jwt giriş çıkış logout otomatik hareketsizlik idle zaman aşımı timeout güvenlik session ömür dakika saat çalışma oturumu makine yer onayı saha work session kart personel kartı qr login pin giriş yöntemi token dolunca otomatik çıkış autoLogout aynı hesap ikinci oturum eşzamanlı politika kick notify eskiyi düşür sınırsız başka bilgisayar mobil hareketsizlik kilidi kilit ekranı tablet telefon",
    kind: "session",
  },
  {
    id: "label",
    label: "Etiket Baskısı",
    icon: Tags,
    description: "Org-geneli etiket baskı ayarları: kopya adedi, varsayılan medya, native gönderim.",
    keywords:
      "etiket label baskı yazdır kopya adet çift üst alt yapıştır tambur native gönderim varsayılan medya boyut ölçü mm dpi eni boyu boşluk pay",
    kind: "label",
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
    // Tek "geniş olmayan" kategori: yerel donanımını kendisi kuran personel
    // `settings:workstation` ile YALNIZ bu sekmeyi görür (sayfadaki diğer
    // kategoriler listeye bile girmez).
    permissionAny: [SETTINGS_ADMIN_PERMISSION, WORKSTATION_PERMISSION],
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
