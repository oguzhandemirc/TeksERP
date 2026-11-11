import { ShoppingCart, Factory, Warehouse, Truck, type LucideIcon } from "lucide-react";
import { TERIM } from "@/lib/terim";

/**
 * Operasyon karolarının mantıksal grupları. T5 (2026-11-11): her grup kendi menü KÖKÜDÜR
 * (Satış · Üretim · Depo · Sevkiyat) ve kendi bölüm sayfası (`route`) vardır; ekran adresleri
 * `/operations/...` olarak kalır, eski `/operations` birleşik sayfası da çalışır.
 */
export type OperationGroupKey = "planning" | "production" | "warehouse" | "shipping";

export interface OperationGroup {
  key: OperationGroupKey;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Bölüm (kart) sayfasının adresi — menü kökü buraya gider. */
  route: string;
}

/** Görüntülenme sırası = üretim akışı (talep → üretim → depo → sevk). */
export const operationGroups: OperationGroup[] = [
  {
    key: "planning",
    title: "Satış",
    description: "Siparişler, teklifler ve talep–üretim dengesi",
    icon: ShoppingCart,
    route: "/sales",
  },
  {
    key: "production",
    title: "Üretim",
    get description() { return `${TERIM.terbiyeIsEmri.cumleBasiCogul.yalin}, kurşun sırası, kartela ve fason takibi`; },
    icon: Factory,
    route: "/production",
  },
  {
    key: "warehouse",
    title: "Depo",
    description: "Kumaş, iplik ve sarf stoğu, paketleme, mal kabul ve gelen belgeler",
    icon: Warehouse,
    route: "/warehouse",
  },
  {
    key: "shipping",
    title: "Sevkiyat",
    description: "Sevk çıkışı, muhasebe dökümü ve müşteri iadeleri",
    icon: Truck,
    route: "/shipping",
  },
];

export function operationGroup(key: OperationGroupKey): OperationGroup {
  return operationGroups.find((g) => g.key === key)!;
}
