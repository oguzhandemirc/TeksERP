// Operasyon › Depo & Paketleme karoları (sıra = hub sırası).
import { ArrowLeftRight, Boxes, ClipboardCheck, FileCog, PackageCheck, Package, PackageOpen, PackagePlus, ScanText, ShoppingBasket, Tags } from "lucide-react";
import { isYarnStockVisible } from "../Yarn/yarn-regime";
import { isPurchaseOrdersVisible } from "../PurchaseOrders/po-regime";
import { isStockCountVisible, STOCK_COUNTS_PATH } from "../StockCounts/stockCount-regime";
import { isGoodsReceiptVisible } from "../GoodsReceipts/goodsReceipt-regime";
import { isIncomingDocumentVisible } from "../GelenBelgeler/gelenBelge-regime";
import { CUSTOMER_DEFAULTS_PATH } from "../GelenBelgeler/paths";
import { flagOffHint } from "@/lib/flag-setting-path";
import type { OperationsTile } from "../tile-config";

export const warehouseTiles: OperationsTile[] = [
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
    offHint: flagOffHint("iplikEnabled"),
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
    offHint: flagOffHint("ticaretEnabled"),
  },
  {
    // Gülkesim OCR D5: müşteri irsaliyesi (fotoğraf/Excel/elle) → gözden geçirme → onayda emanet topu.
    // Modül KAPALIYKEN karo GİZLİ (offHint yok): fason işlemci olmayan fabrikada ekranın varlığı gürültüdür.
    key: "gelen-belgeler",
    title: "Gelen Belgeler",
    description: "Müşteri irsaliyesi — fotoğraf okuma, gözden geçirme, onayda emanet topu",
    icon: ScanText,
    to: "/operations/gelen-belgeler",
    group: "warehouse",
    permission: "gelen-belge:read",
    visibleWhen: isIncomingDocumentVisible,
  },
  {
    // E2: gönderen şablonu ↔ cari bağı (gönderen önerisinin en öncesi). Modül kapalıyken GİZLİ (üst karo gibi).
    key: "gelen-belge-sablonlari",
    title: "Gönderen Şablonları",
    description: "Okunan belge yerleşimini gönderen cariye ve varsayılan sahibe bağla",
    icon: FileCog,
    to: "/operations/gelen-belgeler/sablonlar",
    group: "warehouse",
    permission: "gelen-belge:template",
    visibleWhen: isIncomingDocumentVisible,
  },
  {
    // E4b: sahibe özel varsayılan ürün (ürünsüz satır onayda bununla girer; fabrika ayarını ezer). Aynı kapı.
    key: "gelen-belge-varsayilan-urunler",
    title: "Müşteri Varsayılan Ürünleri",
    description: "Gelen belgede ürünü seçilmemiş satırın müşteriye göre gireceği kumaş",
    icon: PackageCheck,
    to: CUSTOMER_DEFAULTS_PATH,
    group: "warehouse",
    permission: "gelen-belge:template",
    visibleWhen: isIncomingDocumentVisible,
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
    offHint: flagOffHint("ticaretEnabled"),
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
    offHint: flagOffHint("ticaretEnabled"),
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
];
