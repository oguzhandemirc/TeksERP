import {
  ShoppingCart,
  Factory,
  Package,
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
 * Karo görünürlüğünün bağlı olduğu ÇALIŞMA ANI durumu (hub + komut paleti).
 *
 * 2026-08-05'te KÜÇÜLDÜ: içinde üç kurşun alanı vardı (`kursunBypassEnabled`,
 * `kursunPendingAssignmentCount`, `kursunTabletRegimeCount`) ve iki ayrı kurşun
 * karosunun görünürlüğünü sürüyordu. Kurşun Sırası + Kurşun Dağıtım TEK ekranda
 * birleşti (`Kurşun Planlama`) ve o ekran BAYRAKTAN BAĞIMSIZ — bayrak yalnız
 * ekranın İÇİNDEKİ dağıtım kontrollerini açıp kapatıyor. Görünürlük kararı da
 * saf izin kontrolüne indi; sayaçları menü için çeken uç (`/kursun-bypass/
 * visibility`) Electron'da artık tüketilmiyor.
 *
 * 2026-08-22'de bir daha KÜÇÜLDÜ: `pendingPlannedShipments` (çıkış bekleyen
 * PLANNED sevkiyat sondası) kalktı — bkz. Sevk Kapısı karosundaki not. Bağlam
 * artık tek bayrak taşır; yeni bir sayaç eklemeden önce sorulacak soru "bu
 * ekranın işi başka bir ekrandan da yapılabiliyor mu?" (yapılabiliyorsa sayaç
 * değil, o ekrana aksiyon eklenir).
 */
export interface OperationsVisibilityContext {
  /** `shipping.confirmationEnabled` — sevk onayı ara adımı. */
  shipmentConfirmationEnabled: boolean;
}

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
    // Sevk Kapısı = "sevk onayı adımı" bayrağının EKRANI. Bayrak KAPALIYKEN
    // (varsayılan) sevkler doğrudan çıkar → board'un işi yok → karo gizli.
    //
    // 2026-08-05 → 08-22 arasında kural "bayrak açık VEYA çıkış bekleyen PLANNED
    // sevkiyat varsa" idi: storno (sevki geri al) sevkiyatı PLANNED'a düşürüyordu
    // ve çıkış onayı YALNIZ bu ekrandaydı → karo gizlenirse mal kapıda, ekran yok.
    // Saha vakası (SVK2008260008, 2026-08-21): bayrak kapalı fabrikada geri alınan
    // bir sevkiyat yüzünden karo beklenmedik şekilde belirdi ve çuval bir gün
    // kilitli kaldı. 2026-08-22 kararı: PLANNED sevkiyatın bu ekrana ihtiyacı
    // KALMADI — storno kapalı rejimde varsayılan olarak sevkiyatı KAPATIR
    // (`releaseSacks`, çuvallar depoya) ve Sevkiyatlar detayı PLANNED sevkiyata
    // "Sevk Et" verir. Kural saf bayrağa indi; sonda sorgusu da kalktı.
    // Route (`/operations/sack-store`) bayrağa bakmaz — eski sekme/okutma hedefi
    // yine açılır, yalnız menüde çizilmez.
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
    // Eski "Kurşun Sırası" + "Kurşun Dağıtım" tek ekranda birleşti (2026-08-05).
    // İkisi de AYNI iş emirlerini gösteriyordu; bayrak yeni açıldığında ikisi
    // birden menüde çıkıyor ve planlamacı aynı işi iki listede arıyordu.
    key: "kursun-dagitim",
    title: "Kurşun Planlama",
    description: "Kurşun sırasını düzenle; dağıtım açıkken fiziksel makinelere dağıt",
    icon: Share2,
    to: "/operations/kursun-dagitim",
    group: "production",
    // Route ile hizalı: kaliteci sırayı yönetir, dağıtımcı makineye verir —
    // ikisi de aynı ekranı kullanır. `visibleWhen` YOK: ekran artık
    // `production.kursunBypassEnabled` bayrağından bağımsız (bayrak yalnız
    // ekranın içindeki dağıtım kontrollerini açar/kapatır).
    permissionAny: ["quality:write", "workorder:distribute"],
  },
];
