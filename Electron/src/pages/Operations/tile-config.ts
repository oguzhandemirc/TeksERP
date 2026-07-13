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
  type LucideIcon,
} from "lucide-react";

export interface OperationsTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  permission?: string;
  /** Birden çok izinden HERHANGİ biri yeterli (route requireAnyPermission ile hizalı). */
  permissionAny?: string[];
}

export const operationsTiles: OperationsTile[] = [
  {
    key: "orders",
    title: "Siparişler",
    description: "Müşteri siparişleri ve termin takibi",
    icon: ShoppingCart,
    to: "/operations/orders",
    permission: "order:read",
  },
  {
    key: "work-orders",
    title: "İş Emirleri",
    description: "Üretim partileri ve rota ilerleyişi",
    icon: Factory,
    to: "/operations/work-orders",
    permission: "workorder:read",
  },
  {
    key: "product-balance",
    title: "Ürün Dengesi",
    description: "Talep ↔ depo + üretim; eksik kadar iş emri aç",
    icon: Scale,
    to: "/operations/product-balance",
    permission: "workorder:read",
  },
  {
    key: "rolls",
    title: "Envanter",
    description: "Ham/bitmiş stok ve top yaşam döngüsü",
    icon: Package,
    to: "/operations/rolls",
    permission: "roll:read",
  },
  {
    key: "shipments",
    title: "Sevkiyatlar",
    description: "Müşteri sevkiyatları + sevk irsaliyesi",
    icon: Truck,
    to: "/operations/shipments",
    permission: "shipping:read",
  },
  {
    // Eski "Çuval Depo" + "Okutarak Sevk" tek ekranda birleşti (Sevk Kapısı).
    key: "sack-store",
    title: "Sevk Kapısı",
    description: "Çuval okut → sevk et / irsaliye bas; planlı (çıkış bekleyen) sevkler",
    icon: ScanBarcode,
    to: "/operations/sack-store",
    permission: "shipping:read",
  },
  {
    key: "sack-content-edit",
    title: "Çuval Deposu / Paketleme",
    description: "Çuval/top ara, içerik düzenle (okut/tart/çıkar/taşı), yeni çuval aç → depodan sevkiyat kur",
    icon: PackageOpen,
    to: "/operations/sack-content-edit",
    permission: "shipping:write",
  },
  {
    key: "relabel-station",
    title: "Yeniden Etiketle",
    description: "Barkod okut → spec düzelt (renk/kalite/en) veya A→B müşteri için yeniden bas",
    icon: Tags,
    to: "/operations/relabel-station",
    // Route ile hizalı: roll:write VEYA label:edit olan kullanıcı erişebilir/görebilir.
    permissionAny: ["roll:write", "label:edit"],
  },
  {
    key: "accounting-dispatch",
    title: "Sevk Edilenler (Muhasebe)",
    description: "Sevki tamamlananlar — salt-okunur + ürün/çuval/çeki fişi",
    icon: ClipboardList,
    to: "/operations/accounting-dispatch",
    permission: "shipping:read",
  },
  {
    key: "kartela",
    title: "Kartela Takibi",
    description: "Kartela fason sevkleri ve dönen kartelalar",
    icon: SwatchBook,
    to: "/operations/kartela",
    permission: "kartela:read",
  },
  {
    key: "returns",
    title: "İade Takibi",
    description: "Müşteri iadeleri — hangi siparişten/üründen ne kadar döndü",
    icon: Undo2,
    to: "/operations/returns",
    permission: "return:read",
  },
  {
    key: "kursun-queue",
    title: "Kurşun Sırası",
    description: "Fasondan dönen toplar için Kurşun + KK2 sırasını planla",
    icon: Layers,
    to: "/operations/kursun-queue",
    permission: "quality:write",
  },
];
