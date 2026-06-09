import {
  Building2,
  Banknote,
  ClipboardList,
  Factory,
  Truck,
  TabletSmartphone,
  Server,
  Clock,
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
}

/**
 * Kategori içeriğinin nasıl render edileceği:
 * - `flags`  → config'teki flag listesini generic toggle olarak çizer
 * - `device`  → cihaz eşleştirme (enforce edilen, uyarılı) özel section
 * - `api`     → sunucu adresi (bu bilgisayara özel) özel section
 * - `session` → oturum süresi + hareketsizlik zaman aşımı (sayısal) özel section
 */
export type CategoryKind = "flags" | "device" | "api" | "company" | "session";

export interface SettingsCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  kind: CategoryKind;
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
    id: "orders",
    label: "Siparişler",
    icon: Banknote,
    description: "Sipariş ekranlarındaki fiyat ve para birimi alanları.",
    keywords: "fiyat para birimi birim fiyat tutar döviz kur pricing sipariş",
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
    description: "İş emri formundaki alanlar ve parti kodu davranışı.",
    keywords: "iş emri hedef metraj parti kodu batch otomatik üretim miktarı",
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
        desc: "Kapalıyken (varsayılan) iş emri formunda Parti Kodu elle girilir ve zorunludur. Açıkken sistem otomatik üretir (P-YYMMDD-NNN); formda 'elle gir' ile yine değiştirilebilir.",
      },
    ],
  },
  {
    id: "production",
    label: "Üretim — Saha",
    icon: Factory,
    description: "Sahadaki mobil istasyon ekranlarının davranışı.",
    keywords: "KK1 ham en genişlik cm boyahane notu fason sevk mobil operatör saha kalite tambur metraj aşım fazla ölçüm açık kumaş top",
    kind: "flags",
    flags: [
      {
        key: "rawWidthEnabled",
        title: "KK1 ham kumaş girişinde en (cm) alanını göster",
        desc: "Kapalıyken mobil KK1 ekranında en alanı gizlenir; operatör isterse 'en gir' ile yine girebilir. Ham kumaşın eni önemsiz — bitmiş topun eni iş emrinden gelir. Ürün Dengesi ham stoğu en'e bakmadan sayar.",
      },
      {
        key: "dyehouseNoteMobileEntry",
        title: "Fason sevkte boyahane notunu operatör telefondan girebilsin",
        desc: "Kapalıyken (varsayılan) sahadaki operatör mobil Fason Sevk ekranında boyahane notu giremez; not yalnızca iş emrindeki 'Boyahane Notu' alanından gelir. Açıkken operatör sevk sırasında telefondan not girebilir/değiştirebilir (boş bırakırsa iş emrindeki not kullanılır).",
      },
      {
        key: "tamburOverQuantityEnabled",
        title: "Tambur'da çıkan top metresi giriş metresini aşabilsin",
        desc: "Açıkken (varsayılan) — Tambur asıl ölçüm noktası olduğu için — operatör kayıtlıdan fazla ölçtüğünde (örn. 100m açık kumaşı 150m top yapma) mobilde onay sonrası kabul edilir; kaynak top tamamen tüketilir. Kapatırsan Tambur'da çıkan top kayıtlı metrajdan fazla olamaz (örn. 100m topa 110m girilemez). Yalnızca aşım anında devreye girer, normal kesim etkilenmez.",
      },
    ],
  },
  {
    id: "shipping",
    label: "Sevkiyat & İade",
    icon: Truck,
    description: "Sevk çıkış akışı ve iade kabul davranışı.",
    keywords: "sevk onayı ambar aldı çıkış sevkiyat iade kalite grading hazır depo",
    kind: "flags",
    flags: [
      {
        key: "shipmentConfirmationEnabled",
        title: "Sevk için ayrı 'ambar aldı / çıkış' onayı zorunlu olsun",
        desc: "Kapalıyken (varsayılan) mobil Sevkiyat ekranında paketleyen 'Hemen Sevk Et' ile direkt sevk edebilir (stok o an düşer); isterse 'Sevke Hazır' yapıp ara depoda bekletir. Açıkken paketleyen yalnızca 'Sevke Hazır' yapar; fiili çıkış ('ambar aldı') ayrı 'Sevk Çıkışı' ekranından onaylanır. Ara depoda bekleme + sonradan çıkış her iki modda da mümkündür — stok yalnız çıkışta düşer.",
      },
      {
        key: "returnGradingEnabled",
        title: "İade kabulünde personel kaliteyi değiştirebilsin",
        desc: "Kapalıyken mobil İade ekranında 'kalite belirt' kontrolü gizlenir; top çıktığı kaliteyle döner. Açıkken teslim alan personel topun kalitesini düzeltebilir (etiket değişir; iade yine Hazır Depo'ya iner). Kapalıyken backend gönderilen kalite override'ını yok sayar.",
      },
    ],
  },
  {
    id: "devices",
    label: "Cihazlar",
    icon: TabletSmartphone,
    description: "Sahadaki tabletlerin eşleştirme zorunluluğu.",
    keywords: "cihaz eşleştirme tablet pairing makine atfı zorunlu kod",
    kind: "device",
  },
  {
    id: "session",
    label: "Oturum & Güvenlik",
    icon: Clock,
    description: "Oturum süresi (token ömrü) ve hareketsizlik zaman aşımı.",
    keywords:
      "oturum süre süresi token jwt giriş çıkış logout otomatik hareketsizlik idle zaman aşımı timeout güvenlik session ömür dakika saat",
    kind: "session",
  },
  {
    id: "system",
    label: "Sistem",
    icon: Server,
    description: "Bu bilgisayara özel bağlantı ayarları.",
    keywords: "sunucu adresi API backend bağlantı url endpoint",
    kind: "api",
  },
];
