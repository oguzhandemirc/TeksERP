import {
  ShoppingCart,
  Factory,
  Package,
  PackageSearch,
  Layers,
  Scale,
  Truck,
  SwatchBook,
  Tags,
  Undo2,
  Warehouse,
  ClipboardList,
  ScanBarcode,
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
    title: "Toplar",
    description: "Envanter ve top yaşam döngüsü",
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
    key: "sack-store",
    title: "Çuval Depo",
    description: "Çuval depodaki + kapı önündeki sevkler; hangi çuvalda ne, kodu, kg",
    icon: Warehouse,
    to: "/operations/sack-store",
    permission: "shipping:read",
  },
  {
    key: "sack-search",
    title: "Çuval & Top Arama",
    description: "Hangi üründen hangi çuvalda ne kadar; top hangi çuvalda",
    icon: PackageSearch,
    to: "/operations/sack-search",
    permission: "shipping:read",
  },
  {
    key: "scan-dispatch",
    title: "Okutarak Sevk",
    description: "Kapıda çuvalları okut → sevkiyatına göre grupla → kapıya taşı / sevk et",
    icon: ScanBarcode,
    to: "/operations/scan-dispatch",
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
