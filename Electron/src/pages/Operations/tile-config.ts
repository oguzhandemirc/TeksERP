import {
  ShoppingCart,
  Factory,
  Package,
  Layers,
  Scale,
  Truck,
  SwatchBook,
  Tags,
  Undo2,
  ClipboardList,
  ScanBarcode,
  PackageOpen,
  Share2,
  type LucideIcon,
} from "lucide-react";
import type { OperationGroupKey } from "./groups-config";

/**
 * Kurşun ekranlarının görünürlüğünü belirleyen durum. AYRI bir tip: Kurşun Sırası
 * ROUTE kapısı da aynı yüklemi çağırıyor ve orada sevk onayı bayrağının bir
 * karşılığı yok — daha geniş bir bağlam istemek, kapıyı kararı etkilemeyen sahte
 * bir alan uydurmaya zorlardı.
 *
 * Sayaçlar `useKursunVisibility` ile gelir; veri yokken (yükleniyor / hata /
 * yetkisiz) 0'dır ve kural saf bayrak davranışına düşer.
 */
export interface KursunTileVisibility {
  /** `production.kursunBypassEnabled` — YENİ kurşun dağıtımı açık mı. */
  kursunBypassEnabled: boolean;
  /** Açık (bekleyen) kurşun dağıtımı sayısı. */
  kursunPendingAssignmentCount: number;
  /** Tablet rejiminde bekleyen kurşun adımı sayısı. */
  kursunTabletRegimeCount: number;
}

/** Karo görünürlüğünün bağlı olduğu ÇALIŞMA ANI durumunun tamamı (hub kullanır). */
export interface OperationsVisibilityContext extends KursunTileVisibility {
  /** `shipping.confirmationEnabled` — sevk onayı ara adımı. */
  shipmentConfirmationEnabled: boolean;
}

/**
 * Kurşun Sırası görünürlüğü — KARO ve ROUTE kapısının PAYLAŞTIĞI tek kural:
 *   görünür ⇔ bayrak KAPALI **VEYA** tablet rejiminde açık kurşun adımı VAR.
 *
 * Eski kural salt "bayrak açıksa gizle" idi ve bir boşluk bırakıyordu: bayrak
 * açıldığı anda tablette DOKUNULMUŞ (KK2 kaydı / hata kaydı / kapanmış hareket
 * taşıyan) iş emirleri dağıtılamıyor, tablet rejiminde kalıyordu. Karo gizlenince
 * planlamacı onların SIRASINI değiştiremiyor, acil işaretleyemiyordu — iş durmuyor
 * (tablet operatörü kendi "Açık Kartlar" listesini ayrı uçtan sıralı görüyor),
 * yalnız önceliklendirme körleşiyordu. Artık ekran o işler bitene kadar durur,
 * biter bitmez kendiliğinden kaybolur.
 *
 * Ayrı isimli fonksiyon (karo nesnesine gömülü anonim yüklem DEĞİL): route kapısı
 * bunu `import` eder. Karoyu `key` ile arayıp yüklemini okumak, anahtar değişince
 * kapıyı sessizce "her zaman açık"a düşürürdü.
 */
export const kursunQueueTileVisible = (ctx: KursunTileVisibility): boolean =>
  !ctx.kursunBypassEnabled || ctx.kursunTabletRegimeCount > 0;

/**
 * Kurşun Dağıtım görünürlüğü:
 *   görünür ⇔ bayrak AÇIK **VEYA** bekleyen (açık) dağıtım VAR.
 *
 * Eski kural salt "bayrak kapalıysa gizle" idi; ROUTE bilinçli olarak açık
 * bırakılmıştı (dağıtılmış işler bitirilebilsin) ve ortaya tuhaf bir durum
 * çıkıyordu: sayfa çalışıyor ama menüde yok, yalnız komut paletinden/adresle
 * girilebiliyordu. Artık menü route ile hizalı — dağıtılmış iş kaldığı sürece karo
 * durur, son atama bitince kendiliğinden kaybolur. ROUTE'a DOKUNULMADI: kapı hâlâ
 * yalnız izne bakar (bkz. `routes/content-routes.tsx`).
 */
export const kursunDagitimTileVisible = (ctx: KursunTileVisibility): boolean =>
  ctx.kursunBypassEnabled || ctx.kursunPendingAssignmentCount > 0;

export interface OperationsTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  /** Ait olduğu mantıksal grup (hub'da bölüm başlığı altında toplanır). */
  group: OperationGroupKey;
  permission?: string;
  /** Birden çok izinden HERHANGİ biri yeterli (route requireAnyPermission ile hizalı). */
  permissionAny?: string[];
  /**
   * Duruma bağlı görünürlük — verilmezse karo her zaman görünür (izin filtresi ayrı).
   *
   * NEDEN BAYRAK ALANI DEĞİL DE FONKSİYON (2026-08-02 kararı):
   * Eski üç alan (`requiresShipmentConfirmation` / `requiresKursunBypass` /
   * `hiddenWhenKursunBypass`) hub'da ard arda `if (…) return false` ile
   * uygulanıyordu; yani alanlar sessizce **VE** ile birleşiyordu. Yeni kurallar
   * ise **VEYA**'dır ("bayrak açık VEYA işi kaldı"). Bunu alan olarak ifade etmek
   * için iki alan daha (`visibleWhenPendingAssignments`,
   * `visibleWhenTabletRegime`) eklemek gerekirdi ve hangi alanın VE hangisinin
   * VEYA ile bağlandığı bilgisi karonun yanında değil, hub'ın filtre gövdesinde
   * kalırdı — düzeltmeye çalıştığımız hatanın ta kendisi. Tek bir saf yüklem,
   * kuralı karonun YANINDA tutar, hub'ı aptallaştırır (izin + yüklem) ve
   * doğrudan birim testine açar (`tile-visibility.test.ts`).
   *
   * Yüklem SAF olmalı: React hook'u çağırmaz, yalnız `ctx`'e bakar.
   */
  visibleWhen?: (ctx: OperationsVisibilityContext) => boolean;
}

export const operationsTiles: OperationsTile[] = [
  {
    key: "orders",
    title: "Siparişler",
    description: "Müşteri siparişleri ve termin takibi",
    icon: ShoppingCart,
    to: "/operations/orders",
    group: "planning",
    permission: "order:read",
  },
  {
    key: "work-orders",
    title: "İş Emirleri",
    description: "Üretim partileri ve rota ilerleyişi",
    icon: Factory,
    to: "/operations/work-orders",
    group: "production",
    permission: "workorder:read",
  },
  {
    key: "product-balance",
    title: "Kumaş Dengesi",
    description: "Talep ↔ depo + üretim; eksik kadar iş emri aç",
    icon: Scale,
    to: "/operations/product-balance",
    group: "planning",
    permission: "workorder:read",
  },
  {
    key: "rolls",
    title: "Envanter",
    description: "Ham/bitmiş stok ve top yaşam döngüsü",
    icon: Package,
    to: "/operations/rolls",
    group: "warehouse",
    permission: "roll:read",
  },
  {
    key: "shipments",
    title: "Sevkiyatlar",
    description: "Müşteri sevkiyatları + sevk irsaliyesi",
    icon: Truck,
    to: "/operations/shipments",
    group: "shipping",
    permission: "shipping:read",
  },
  {
    // Eski "Çuval Depo" + "Okutarak Sevk" tek ekranda birleşti (Sevk Kapısı).
    key: "sack-store",
    title: "Sevk Kapısı",
    description: "Çuval okut → sevk et / irsaliye bas; planlı (çıkış bekleyen) sevkler",
    icon: ScanBarcode,
    to: "/operations/sack-store",
    group: "shipping",
    permission: "shipping:read",
    // Sevk onayı adımı KAPALIYKEN (varsayılan) sevkler doğrudan çıkar → bu ekranın
    // yapacağı iş yok. DAVRANIŞ AYNEN KORUNDU (eski `requiresShipmentConfirmation`
    // alanının birebir karşılığı) — yalnız ifade biçimi yükleme taşındı.
    // NOT: kurşun karolarındaki "işi kaldıysa durur" koşulunun benzeri buraya
    // BİLİNÇLİ eklenmedi (kapsam dışı). Onay açıkken kurulmuş PLANNED sevkiyat
    // varken bayrak kapatılırsa çıkış onayı yalnız bu ekrandan yapıldığı için
    // aynı sınıf boşluk burada da doğar; istenirse `ctx`'e bekleyen PLANNED
    // sevkiyat sayacı eklenip aynı VEYA kalıbı uygulanır.
    visibleWhen: (ctx) => ctx.shipmentConfirmationEnabled,
  },
  {
    key: "sack-content-edit",
    title: "Paketleme / Çuvallar",
    description: "Çuval/top ara, içerik düzenle (okut/tart/çıkar/taşı), yeni çuval aç → depodan sevkiyat kur",
    icon: PackageOpen,
    to: "/operations/sack-content-edit",
    group: "warehouse",
    permission: "shipping:write",
  },
  {
    key: "relabel-station",
    title: "Yeniden Etiketle",
    description: "Barkod okut → spec düzelt (renk/kalite/en) veya A→B müşteri için yeniden bas",
    icon: Tags,
    to: "/operations/relabel-station",
    group: "warehouse",
    // Route ile hizalı: roll:write VEYA label:edit olan kullanıcı erişebilir/görebilir.
    permissionAny: ["roll:write", "label:edit"],
  },
  {
    key: "accounting-dispatch",
    // Ana "Sevkiyatlar" ekranından ayrı: bu salt-okunur muhasebe/export ekranı.
    title: "Sevkiyatlar (Muhasebe)",
    description: "Sevki tamamlananlar — salt-okunur + kumaş/çuval/çeki fişi",
    icon: ClipboardList,
    to: "/operations/accounting-dispatch",
    group: "shipping",
    permission: "shipping:read",
  },
  {
    key: "kartela",
    title: "Kartela Takibi",
    description: "Kartela fason sevkleri ve dönen kartelalar",
    icon: SwatchBook,
    to: "/operations/kartela",
    group: "production",
    permission: "kartela:read",
  },
  {
    key: "returns",
    title: "İade Takibi",
    description: "Müşteri iadeleri — hangi siparişten/kumaştan ne kadar döndü",
    icon: Undo2,
    to: "/operations/returns",
    group: "shipping",
    permission: "return:read",
  },
  {
    key: "kursun-queue",
    title: "Kurşun Sırası",
    description: "Fasondan dönen toplar için Kurşun + KK2 sırasını planla",
    icon: Layers,
    to: "/operations/kursun-queue",
    group: "production",
    // Route ile hizalı: kalitecinin yanında kurşun dağıtımcısı da kuyruğu izler
    // (dağıtım kararı bu kuyruğun üstüne kurulur — bkz. Kurşun Dağıtım).
    permissionAny: ["quality:write", "workorder:distribute"],
    // Kural + gerekçe: `kursunQueueTileVisible` (yukarıda). ROUTE kapısı da AYNI
    // fonksiyonu çağırır — karo gizlemek yetmez, komut paleti ve doğrudan adres
    // route'u yine açardı.
    visibleWhen: kursunQueueTileVisible,
  },
  {
    key: "kursun-dagitim",
    title: "Kurşun Dağıtım",
    description: "Fasondan kabul edilen iş emirlerini fiziksel kurşun makinelerine dağıt",
    icon: Share2,
    to: "/operations/kursun-dagitim",
    group: "production",
    permission: "workorder:distribute",
    // Kural + gerekçe: `kursunDagitimTileVisible` (yukarıda).
    visibleWhen: kursunDagitimTileVisible,
  },
];
