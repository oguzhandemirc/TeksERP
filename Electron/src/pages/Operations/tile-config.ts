import {
  ShoppingCart,
  Factory,
  ArrowLeftRight,
  Package,
  PackagePlus,
  Scale,
  Truck,
  SwatchBook,
  Tags,
  Undo2,
  ClipboardList,
  ScanBarcode,
  PackageOpen,
  Share2,
  Boxes,
  ShoppingBasket,
  type LucideIcon,
} from "lucide-react";
import type { OperationGroupKey } from "./groups-config";
// Paket D — görünürlük kuralları SAF katmanda (bileşen içindeki bir `&&`
// zinciri tersine çevrilse hiçbir testi kırmazdı; projenin yazılı deseni).
import { isYarnStockVisible } from "./Yarn/yarn-regime";
import { isPurchaseOrdersVisible } from "./PurchaseOrders/po-regime";

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
 */
export interface OperationsVisibilityContext {
  /** `shipping.confirmationEnabled` — sevk onayı ara adımı. */
  shipmentConfirmationEnabled: boolean;
  /**
   * Çıkış bekleyen (PLANNED) sevkiyat sayısı — bayrak KAPALIYKEN bile Sevk
   * Kapısı'nı görünür tutan "işi kaldıysa dur" koşulunun girdisi. Bilinmiyorsa
   * (izin yok / henüz yüklenmedi) 0 — karo yalnız bayrağa göre karar verir.
   */
  pendingPlannedShipments: number;
  /**
   * ÇOK DEPOLU kurulum mu (aktif depo > 1)?
   *
   * ⚠️ "Fabrikada sıfır görünür fark" kuralının karo ayağı: tek depolu üretici
   * fabrikada Depo Transferi karosu ÇİZİLMEZ — orada taşınacak ikinci depo yok
   * ve karo yalnız gürültü olurdu. İkinci depo açıldığı gün kendiliğinden belirir.
   * Emsal: mobil `PlaceActions` (seçenek sayısı 1 ise madde anlamsız).
   *
   * Mal Kabul karosu bu bayrağa BAĞLANMAZ — tek depolu bir alım-satım firması da
   * onu kullanır; orada kapı İZİNDİR (`goods-receipt:*`, hiçbir varsayılan rolde yok).
   */
  multiWarehouse: boolean;
  /**
   * Ön muhasebe modülü açık mı (`finance.enabled`) — fiilen "bu bir TİCARET
   * kurulumu" anahtarı. Tanımlar menüsünün cari rejimi buna bakar: bayrak
   * AÇIKKEN tek "Cariler" karosu, KAPALIYKEN (fabrika) bugünkü Müşteriler +
   * Fason Firmalar. Belirsizken (yükleniyor) FALSE → fabrika görünümüne düşülür
   * (Sidebar featureFlag kararıyla aynı yön: yanlış tarafa düşmek fabrikada
   * karo titremesi demekti, ticarette yalnız kısa bir gecikme).
   */
  financeEnabled: boolean;
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
    key: "goods-receipts",
    title: "Mal Kabul",
    description: "Satın alınan malın depo girişi — fiş + barkod + etiket",
    icon: PackagePlus,
    to: "/operations/goods-receipts",
    group: "warehouse",
    // Kapı İZİN: bu ekran yalnız alım-satım kurulumundadır (üretici fabrika malı
    // KK1'den alır) ve izin hiçbir varsayılan rol şablonunda YOK.
    // ⚠️ `multiWarehouse` şartı KONMAZ — tek depolu ticaret firması da kullanır.
    permission: "goods-receipt:read",
  },
  // ── Paket D (2026-08-14) — ticaret paketi ─────────────────────────────────
  // İkisi de `visibleWhen` ile REJİM bayrağına bağlı: fabrikada
  // `finance.enabled` KAPALI ve bu karolar orada HİÇ çizilmez. Yüklem SAF bir
  // modülden DOĞRUDAN geçirilir (sarmalayan ok fonksiyonu YAZILMAZ) — komut
  // paleti bekçisi karo ile palet girişinin AYNI fonksiyon nesnesini taşıdığını
  // `toBe` ile doğruluyor.
  {
    key: "yarn-stock",
    title: "İplik Kg-Stok",
    description: "İplik kg bakiyeleri + hareket dökümü (top/barkod yok)",
    icon: Boxes,
    to: "/operations/yarn-stock",
    group: "warehouse",
    permission: "warehouse:read",
    visibleWhen: isYarnStockVisible,
  },
  {
    key: "purchase-orders",
    title: "Alış Siparişleri",
    description: "Ne ısmarladım, ne geldi — tedarikçi siparişleri ve kalan miktarlar",
    icon: ShoppingBasket,
    to: "/operations/purchase-orders",
    group: "warehouse",
    permissionAny: ["purchase-order:read", "purchase-order:write"],
    visibleWhen: isPurchaseOrdersVisible,
  },
  {
    key: "warehouse-transfers",
    title: "Depo Transferi",
    description: "Depolar arası taşıma + transfer irsaliyesi",
    icon: ArrowLeftRight,
    to: "/operations/warehouse-transfers",
    group: "warehouse",
    permission: "warehouse:transfer",
    // Tek depolu kurulumda taşınacak ikinci depo YOK → karo çizilmez (fabrikada
    // sıfır görünür fark). İkinci depo açıldığı gün kendiliğinden belirir.
    visibleWhen: (ctx) => ctx.multiWarehouse,
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
    // yapacağı iş yok. AMA bayrak kapatıldığı anda ZATEN KURULMUŞ PLANNED
    // sevkiyatlar olabilir ve çıkış onayı YALNIZ bu ekrandan yapılıyor → karo
    // gizlenirse o sevkiyatlar erişilemez kalır (mal kapıda, ekran yok). 2026-08-05'e
    // kadar bu boşluk bilinçli bırakılmıştı; sevk geri alma (storno) işi bayrağı
    // aç-kapa edilebilir hale getirdiği için kapatıldı. Kurşun karolarındaki
    // "işi kaldıysa durur" VEYA kalıbının aynısı.
    visibleWhen: (ctx) => ctx.shipmentConfirmationEnabled || ctx.pendingPlannedShipments > 0,
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
