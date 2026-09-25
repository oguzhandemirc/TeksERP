import {
  ArrowLeftRight,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Factory,
  History,
  Package,
  PackageOpen,
  PackagePlus,
  Scale,
  ScanBarcode,
  Share2,
  ShoppingBasket,
  ShoppingCart,
  SwatchBook,
  Tags,
  Spool,
  Truck,
  Undo2,
  Wrench,
  type LucideIcon,
  AlertOctagon,
  Layers,
} from "lucide-react";
import type { OperationGroupKey } from "./groups-config";
// Paket D — görünürlük kuralları SAF katmanda (bileşen içindeki bir `&&`
// zinciri tersine çevrilse hiçbir testi kırmazdı; projenin yazılı deseni).
import { isYarnStockVisible } from "./Yarn/yarn-regime";
import { isPurchaseOrdersVisible } from "./PurchaseOrders/po-regime";
import { isStockCountVisible, STOCK_COUNTS_PATH } from "./StockCounts/stockCount-regime";
import { isGoodsReceiptVisible } from "./GoodsReceipts/goodsReceipt-regime";
// P5 (2026-09-03) — üretim karoları `production.enabled` bayrağının arkasına
// alındı; üçü de `requireProductionEnabled` taşıyan router'lara bakıyor.
import {
  isKursunPlanningVisible,
  isProductBalanceVisible,
  isWorkOrdersVisible,
} from "./production-regime";
import { isWeavingOrdersVisible } from "./WeavingOrders/weaving-regime";
import { isMachineStopsVisible } from "./MachineStops/stop-regime";
import { isWarpBeamsVisible } from "./WarpBeams/warp-beam-regime";

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
  /**
   * ÇOK DEPOLU kurulum mu (`depo.multiEnabled`)?
   *
   * ⚠️ 2026-09-02: bu alan artık VERİDEN TÜRETİLMİYOR (eskiden "aktif depo > 1")
   * — gerçek bir modül anahtarı. Sebep: türetilmiş durum ikinci depo açılır
   * açılmaz yüzeyleri getiriyordu; modülü açma kararı artık AÇIK bir karardır ve
   * backend kapısıyla (`requireDepoMultiEnabled`, transfer uçları) aynı kaynaktan
   * beslenir. Adı `depoMultiEnabled` — bayrağın adıyla birebir (ctx'te ikinci bir
   * ad, "hangisi asıl" sorusunu doğururdu).
   *
   * "Fabrikada sıfır görünür fark" kuralının karo ayağı: fabrikada anahtar
   * KAPALI damgalandı (migration ölçtü) → Depo Transferi karosu ÇİZİLMEZ.
   *
   * Mal Kabul karosu bu bayrağa BAĞLANMAZ — tek depolu bir alım-satım firması da
   * onu kullanır; orada kapı İZİNDİR (`goods-receipt:*`, hiçbir varsayılan rolde yok).
   */
  depoMultiEnabled: boolean;
  /**
   * DEVERE / LEVENT modülü (`devere.enabled`) — ETKİN değer
   * (`ticaret && iplik && devere`), ham değil. Zincir üç halkadır ve panelde
   * TEK yerde çözülür (`useOperationsVisibilityContext`); backend kapısı
   * `requireDevereEnabled` aynı sırayı ölçer. Ham değer yalnız Modüller
   * ekranındaki toggle'ın kendi yazdığını geri okuması için döner.
   */
  devereEnabled: boolean;
  /**
   * DOKUMA İŞİ modülü (`dokuma.enabled`) — ETKİN değer (`production && dokuma`),
   * ham değil; tek çözüm noktası `useOperationsVisibilityContext`. Tezgah
   * izlemenin KARDEŞİ, çocuğu değil. Backend kapısı `requireDokumaEnabled`
   * (`weaving-order` · `machine-run` · `machine-doff` router'ları).
   */
  dokumaEnabled: boolean;
  /**
   * Ön muhasebe modülü açık mı (`finance.enabled`) — fiilen "bu bir TİCARET
   * kurulumu" anahtarı. Tanımlar menüsünün cari rejimi buna bakar: bayrak
   * AÇIKKEN tek "Cariler" karosu, KAPALIYKEN (fabrika) bugünkü Müşteriler +
   * Fason Firmalar. Belirsizken (yükleniyor) FALSE → fabrika görünümüne düşülür
   * (Sidebar featureFlag kararıyla aynı yön: yanlış tarafa düşmek fabrikada
   * karo titremesi demekti, ticarette yalnız kısa bir gecikme).
   */
  financeEnabled: boolean;
  /**
   * Üretim modülü açık mı (`production.enabled`, varsayılan AÇIK). Belirsizken
   * TRUE'ya düşülür — backend varsayılanı da odur.
   *
   * 2026-09-03 (P5): artık GERÇEKTEN karo kararı veriyor — İş Emirleri · Kumaş
   * Dengesi · Kurşun Planlama (Operasyon) ve Üretim Rotaları · İş Emri
   * Şablonları · Refakat Kartı (Tanımlar) bu bayrağa bağlandı. Yüklemler saf
   * katmanda: `Operations/production-regime.ts` · `Definitions/production-regime.ts`.
   * Backend ikizi `requireProductionEnabled` (route · iş emri · tambur · kurşun ·
   * parti · refakat kartı router'ları).
   *
   * ⚠️ ALAN AYRICA TİP ZORUNLULUĞU: komut paletinin Genel Ayarlar girişleri
   * `settingsCategoryVisibleWhen` yüklemini TAŞIYOR (kopyalamıyor) ve o yüklem
   * `SettingsRegime` bekliyor — yani bu bağlam iki rejim anahtarını da taşımak
   * zorunda. Karo bağı düşse bile alan kalır.
   *
   * ⚠️ AYAR KATEGORİLERİ AYRI BİR SORU ve orada kapı GİZLEME değil KİLİTTİR
   * (`SettingsCategory.moduleKey`): bu bayrağın arkasında OLMAYAN yüzeyler de
   * var (`/api/rolls` bilinçli kapısız), yani ayar sekmesini gizlemek "açtım,
   * kapatamıyorum" çıkmazı üretirdi. Ölçen bekçi:
   * `Teks-Erp/scripts/test_feature_flag_contract.ts` §14 / §14b.
   */
  productionEnabled: boolean;
  /**
   * TİCARET modülü açık mı (`ticaret.enabled`)? Alış siparişi · mal kabul · fiyat
   * listesi · stok sayımı yüzeylerinin rejim kapısı. Backend ikizi
   * `requireTicaretEnabled`. Belirsizken FALSE (fabrika görünümü — "sıfır fark").
   *
   * ⚠️ `financeEnabled` ile AYNI ŞEY DEĞİL: 2026-09-02'ye kadar bu ekranlar
   * ön muhasebe bayrağına asılıydı; ticaret paketi ondan ayrıldı. Bir kurulum
   * fatura tutmadan alım-satım yapabilir (ticaret açık, muhasebe kapalı).
   */
  ticaretEnabled: boolean;
  /**
   * İPLİK modülü açık mı? ⚠️ Buradaki değer ETKİN değerdir
   * (`ticaretEnabled && iplikEnabled`) — bağımlılık TEK YERDE, bağlamı kuran
   * `useOperationsVisibilityContext` içinde çözülür. Karo yüklemleri zinciri
   * yeniden kurmaz; kurarlarsa bir gün biri unutur ve ticaret kapalıyken iplik
   * karosu belirir (backend yine 403 verir → tıklanan boş ekran).
   */
  iplikEnabled: boolean;
  /**
   * KAPALI rapor anahtarları — `reports.closedKeys` tek listesi (Raporlar K2/K5).
   * `null` = liste okunamadı ya da bayraklar henüz yüklenmedi ⇒ FAIL-CLOSED, hiçbir rapor
   * açık değil. Karo · route · palet üçü de `isReportOpen`den okur, listeyi kendisi süzmez.
   */
  reportsClosedKeys: readonly string[] | null;
  /** Rapor açık mı — katalogda olmayan anahtar KAPALI, liste okunamadıysa KAPALI. */
  isReportOpen: (key: string) => boolean;
  /**
   * Bayrak sorgusu SONUÇLANDI mı (başarı YA DA hata). Yüklenmemiş bayrak "kapalı" DEĞİL
   * "bilinmiyor"dur: modül/rapor kapısı bunu okuyup BEKLER — yenilemede (HMR · Cmd+R · ilk
   * giriş) ticaret yolu `?? false` ile kapalı okunup `/forbidden`a yönlendiriliyordu (2026-09-17).
   */
  flagsReady: boolean;
  /** Sorgu HATA ile bitti: bayraklar bilinmiyor; kapılar yönlendirmez, gerçek kapı backend 403. */
  flagsFailed: boolean;
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
    // Defter onarımı — karo YALNIZ `shipping:repair-allocation` taşıyan kişiye
    // çizilir (sahadaki yönetici). `shipping:write` bu ekranı GÖRMEZ.
    key: "allocation-repair",
    title: "Siparişe Yazılamayanlar",
    description: "Mal çıkmış ama sipariş defterine işlenmemiş sevkiyatlar",
    icon: Wrench,
    to: "/operations/allocation-repair",
    group: "planning",
    permission: "shipping:repair-allocation",
  },
  {
    key: "work-orders",
    title: "İş Emirleri",
    description: "Üretim partileri ve rota ilerleyişi",
    icon: Factory,
    to: "/operations/work-orders",
    group: "production",
    permission: "workorder:read",
    // ÜRETİM MODÜLÜ (2026-09-03): backend `workorder.routes` zaten
    // `requireProductionEnabled` taşıyordu; karo bayraksızdı → modül kapalı bir
    // kurulumda kart görünür, tıklayınca 403. Yüklem SAF modülden DOĞRUDAN
    // geçirilir (sarmalayan ok fonksiyonu YAZILMAZ — palet kimlik testi).
    visibleWhen: isWorkOrdersVisible,
  },
  {
    key: "work-order-events",
    title: "İş Emri Hareketleri",
    description: "İş emri no ya da top barkoduyla bütün hareketler",
    icon: History,
    to: "/operations/work-order-events",
    group: "production",
    permission: "workorder:read",
    // İş emirleriyle aynı modül kapısı — üretim kapalı kurulumda karo çizilmez.
    visibleWhen: isWorkOrdersVisible,
  },
  {
    key: "product-balance",
    title: "Kumaş Dengesi",
    description: "Talep ↔ depo + üretim; eksik kadar iş emri aç",
    icon: Scale,
    to: "/operations/product-balance",
    group: "planning",
    permission: "workorder:read",
    // Backend ikizi `production-balance.routes` → `requireProductionEnabled`.
    visibleWhen: isProductBalanceVisible,
  },
  {
    // DOKUMA İŞİ (2026-09-13, ekran dilimi): backend `weaving-order.routes`
    // `requireDokumaEnabled` taşır; karo aynı bayrağa bağlı — referans profilde
    // KAPALI, karo çizilmez. Yüklem SAF modülden DOĞRUDAN geçirilir (palet
    // kimlik testi `toBe`).
    key: "weaving-orders",
    title: "Dokuma İşleri",
    description: "Ne dokunacak, ne kadar, kimde — dokuma işi planlama; koşum ve top indirme tabletten",
    icon: Spool,
    to: "/operations/weaving-orders",
    group: "production",
    permission: "weavingorder:read",
    visibleWhen: isWeavingOrdersVisible,
  },
  {
    // TEZGAH DURUŞLARI (2026-09-14, Faz 1b web yüzeyi): backend `machine-stop.routes`
    // `requireDokumaEnabled` taşır; karo aynı bayrağa bağlı. İki izinden BİRİ açar
    // (route `requireAnyPermission` ile birebir); eylemler ekran içinde izinle.
    key: "machine-stops",
    title: "Tezgah Duruşları",
    description: "Sebep bekleyen duruşlar, sebep atama ve yeniden sınıflandırma, elle duruş girişi",
    icon: AlertOctagon,
    to: "/operations/machine-stops",
    group: "production",
    permissionAny: ["loom:manual-entry", "loom:classify"],
    visibleWhen: isMachineStopsVisible,
  },
  {
    // LEVENTLER (2026-09-14, devere Faz 1b): backend `warp-beam.routes` `requireDevereEnabled`
    // taşır; karo aynı bayrağa bağlı (ETKİN değer: devere → iplik → ticaret). Referans
    // profilde KAPALI, karo çizilmez. Yüklem SAF (palet kimlik testi `toBe`).
    key: "warp-beams",
    title: "Leventler",
    description: "Levent planla, sar (iplik brüt çıkar, dip ayrı döner), hazır levent stoğu",
    icon: Layers,
    to: "/operations/warp-beams",
    group: "production",
    permission: "warpbeam:read",
    visibleWhen: isWarpBeamsVisible,
  },
  {
    key: "rolls",
    // "Kumaş Stoğu" (2026-09-17): sektör kalıbı — stok ekranı malzeme sınıfına göre adlanır; eski genel ad her şeyi
    // kapsıyormuş gibi okunuyordu, oysa yalnız TOPLAR. Route/izin/key değişmedi.
    title: "Kumaş Stoğu",
    description: "Toplar — depo, statü, metraj",
    icon: Package,
    to: "/operations/rolls",
    group: "warehouse",
    permission: "roll:read",
  },
  {
    // Kumaş Stoğu'nun hemen yanında (kullanıcı: iki stok karosu YAN YANA, Mal Kabul üçüncü). Paket D
    // (2026-08-14) ticaret paketi: `visibleWhen` REJİM bayrağına bağlı, fabrikada HİÇ çizilmez; yüklem SAF
    // modülden DOĞRUDAN (sarmalayan ok fonksiyonu YAZILMAZ — palet bekçisi `toBe` ile aynı nesneyi ölçer).
    key: "yarn-stock",
    title: "İplik Stoğu",
    description: "Lotlar — kg bakiyesi",
    icon: Boxes,
    to: "/operations/yarn-stock",
    group: "warehouse",
    permission: "warehouse:read",
    visibleWhen: isYarnStockVisible,
  },
  {
    key: "goods-receipts",
    title: "Mal Kabul",
    description: "Satın alınan malın depo girişi — fiş + barkod + etiket",
    icon: PackagePlus,
    to: "/operations/goods-receipts",
    group: "warehouse",
    // İKİ KAPI (2026-09-03'te düzeltildi): İZİN + REJİM.
    // ① İzin — `goods-receipt:read`, hiçbir varsayılan rol şablonunda YOK.
    // ② Rejim — `ticaret.enabled`. Eski yorum "kapı İZİN" diyordu ve bu, backend
    //    2026-09-02'de `requireTicaretEnabled`e geçtikten sonra YANLIŞ hâle
    //    gelmişti: modül kapalı + izin verilmiş bir kurulumda karo çizilir,
    //    tıklayınca uç 403 verirdi (canlı ayrışma, `test_screen_catalog`
    //    KARO_BEKLEYEN listesinde park ediliyordu).
    // ⚠️ `depoMultiEnabled` şartı KONMAZ — tek depolu ticaret firması da kullanır.
    permission: "goods-receipt:read",
    visibleWhen: isGoodsReceiptVisible,
  },
  // ── Paket D (2026-08-14) — ticaret paketi (İplik Stoğu yukarıda, aynı kural) ─────
  // `visibleWhen` ile REJİM bayrağına bağlı: fabrikada `finance.enabled` KAPALI ve
  // karo orada HİÇ çizilmez. Yüklem SAF bir modülden DOĞRUDAN geçirilir (sarmalayan
  // ok fonksiyonu YAZILMAZ) — komut paleti bekçisi karo ile palet girişinin AYNI
  // fonksiyon nesnesini taşıdığını `toBe` ile doğruluyor.
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
    visibleWhen: (ctx) => ctx.depoMultiEnabled,
  },
  {
    key: "stock-counts",
    title: "Stok Sayımı",
    description: "Depoyu say, defterle karşılaştır, farkı fark fişiyle kayda geçir",
    icon: ClipboardCheck,
    to: STOCK_COUNTS_PATH,
    group: "warehouse",
    permission: "warehouse:read",
    // Saf yüklem DOĞRUDAN geçirilir (sarmalayan ok fonksiyonu YAZILMAZ) — palet
    // paritesi bekçisi karo ile girişin AYNI fonksiyon nesnesini taşımasını arar.
    visibleWhen: isStockCountVisible,
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
    // ikisi de aynı ekranı kullanır.
    permissionAny: ["quality:write", "workorder:distribute"],
    // ⚠️ İKİ FARKLI BAYRAK, KARIŞTIRMA: ekran hâlâ
    // `production.kursunBypassEnabled`ten BAĞIMSIZ (o bayrak yalnız ekranın
    // İÇİNDEKİ dağıtım kontrollerini açar/kapatır). Buradaki kapı MODÜL
    // anahtarı `production.enabled` — backend ikizi `kursun-bypass.routes`
    // üzerindeki `requireProductionEnabled` (2026-09-03).
    visibleWhen: isKursunPlanningVisible,
  },
];
