import {
  ShoppingCart,
  Factory,
  Package,
  Truck,
  ListChecks,
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
    description: "Çıkış belgeleri ve gönderiler",
    icon: Truck,
    to: "/operations/shipments",
    permission: "shipment:read",
  },
  {
    key: "shipping-queue",
    title: "Sevkiyat Kuyruğu",
    description: "Sipariş seviyesinde sevkiyat akışını yönet",
    icon: ListChecks,
    to: "/operations/shipping-queue",
    permission: "allocation:write",
  },
];
