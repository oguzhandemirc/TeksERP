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
  /** Yalnız "Sevk onayı adımı" AÇIKKEN görünür — kapalıyken (varsayılan) sevkler
   *  doğrudan çıkar, bu ekran anlamsız → menüden gizlenir. */
  requiresShipmentConfirmation?: boolean;
  /** Yalnız "kurşun bypass" AÇIKKEN görünür — kapalıyken (varsayılan) kurşun normal
   *  akışta tabletten işlenir, dağıtım ekranı anlamsız → menüden gizlenir. Bayrak
   *  kapatılsa da ekranın ROUTE'u açık kalır: dağıtılmış işler bitirilebilsin. */
  requiresKursunBypass?: boolean;
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
    requiresShipmentConfirmation: true,
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
  },
  {
    key: "kursun-dagitim",
    title: "Kurşun Dağıtım",
    description: "Fasondan kabul edilen iş emirlerini kurşun istasyonlarına dağıt",
    icon: Share2,
    to: "/operations/kursun-dagitim",
    group: "production",
    permission: "workorder:distribute",
    requiresKursunBypass: true,
  },
];
