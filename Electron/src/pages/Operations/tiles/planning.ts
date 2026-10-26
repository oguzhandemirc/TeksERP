// Operasyon › Satış & Planlama karoları (sıra = hub sırası).
import { Scale, ShoppingCart, Wrench } from "lucide-react";
import { isProductBalanceVisible } from "../production-regime";
import { flagOffHint } from "@/lib/flag-setting-path";
import type { OperationsTile } from "../tile-config";

export const planningTiles: OperationsTile[] = [
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
    key: "product-balance",
    title: "Kumaş Dengesi",
    description: "Talep ↔ depo + üretim; eksik kadar terbiye iş emri aç",
    icon: Scale,
    to: "/operations/product-balance",
    group: "planning",
    permission: "workorder:read",
    // Backend ikizi `production-balance.routes` → `requireProductionEnabled`.
    visibleWhen: isProductBalanceVisible,
    offHint: flagOffHint("productionEnabled"),
  },
];
