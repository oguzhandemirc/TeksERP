import { ShoppingCart, Factory, Warehouse, Truck, type LucideIcon } from "lucide-react";

/** Operasyon hub karolarının mantıksal grupları (Tanımlar hub'ıyla aynı desen). */
export type OperationGroupKey = "planning" | "production" | "warehouse" | "shipping";

export interface OperationGroup {
  key: OperationGroupKey;
  title: string;
  description: string;
  icon: LucideIcon;
}

/** Görüntülenme sırası = üretim akışı (talep → üretim → depo → sevk). */
export const operationGroups: OperationGroup[] = [
  {
    key: "planning",
    title: "Satış & Planlama",
    description: "Siparişler ve talep–üretim dengesi",
    icon: ShoppingCart,
  },
  {
    key: "production",
    title: "Üretim & Fason",
    description: "İş emirleri, kurşun sırası ve kartela fason takibi",
    icon: Factory,
  },
  {
    key: "warehouse",
    title: "Depo & Paketleme",
    description: "Kumaş ve iplik stoğu, çuval içeriği/paketleme ve etiket düzeltme",
    icon: Warehouse,
  },
  {
    key: "shipping",
    title: "Sevkiyat & İade",
    description: "Sevk çıkışı, muhasebe dökümü ve müşteri iadeleri",
    icon: Truck,
  },
];
