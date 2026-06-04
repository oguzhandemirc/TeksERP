import {
  ShoppingCart,
  Factory,
  Package,
  Layers,
  Scale,
  Truck,
  SwatchBook,
  type LucideIcon,
} from "lucide-react";

export interface OperationsTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  permission?: string;
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
    key: "kartela",
    title: "Kartela Takibi",
    description: "Kartela fason sevkleri ve dönen kartelalar",
    icon: SwatchBook,
    to: "/operations/kartela",
    permission: "kartela:read",
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
