// Cari kaydının veri kaynakları — her kaynak MEVCUT bir okuma ucu + carinin süzgeci; erişim hedefi
// (`useRouteAccess.canGo`) ilgili ekranın izin+modül kapısıdır: kapalıysa kaynak hiç sorgulanmaz, yüzey çizilmez.
import type { IconTileTone } from "@/components/ui/icon-tile";
import type { RouteTarget } from "@/hooks/useRouteAccess";
import { SYSTEM_ACTIVITY_ACCESS } from "@/lib/permissions";
import apiClient from "@/services/apiClient";
import { listPayments, type PaymentRow } from "@/pages/Finance/service";
import { orderService } from "@/pages/Operations/Orders/service";
import { shipmentService } from "@/pages/Operations/Shipments/service";
import type { Order } from "@/pages/Operations/Orders/types";
import type { ShipmentListItem } from "@/pages/Operations/Shipments/types";

export const CARI_TARGETS = {
  orders: { to: "/operations/orders", izin: ["order:read"] },
  shipments: { to: "/operations/shipments", izin: ["shipping:read"] },
  finance: { to: "/finance/cari", izin: ["finance:read"] },
  payments: { to: "/finance/payments", izin: ["finance:read"] },
  // Fason sevk/kabul listesi `workorder:read` ister (kokpit ekranı ayrıca subcontractor:read'i de kabul eder).
  fason: { to: "/operations/fason-kokpiti", izin: ["workorder:read"] },
  purchases: { to: "/operations/purchase-orders", izin: ["purchase-order:read"] },
  receipts: { to: "/operations/goods-receipts", izin: ["goods-receipt:read"] },
  prices: { to: "/cost/price-lists", izin: ["price-list:read"] },
  emanet: { to: "/operations/icerideki-isler", izin: ["roll:read"] },
  history: { to: "/system/activity", izin: SYSTEM_ACTIVITY_ACCESS },
} as const satisfies Record<string, RouteTarget>;
export type CariSourceKey = keyof typeof CARI_TARGETS;

export const orderPath = (id: string) => `/operations/orders?focus=${id}`;
export const shipmentPath = (s: Pick<ShipmentListItem, "id" | "kind">) => (s.kind === "DIRECT" ? `/operations/shipments/direct/${s.id}` : `/operations/shipments/${s.id}`);
export const cariStatementPath = (cariAccountId: string) => `/finance/cari?focus=${cariAccountId}`;

/** Birleşik hareket satırı (yan panel "son hareketler"). `to` yoksa satır tıklanmaz. */
export interface CariMovement {
  key: string;
  kind: string;
  tone: IconTileTone;
  docNo: string;
  sub: string | null;
  amount: string | null;
  at: string;
  to: string | null;
  muted?: boolean;
}

export interface FasonDispatchRow {
  id: string;
  dispatchNo: string;
  dispatchedAt: string;
  totalQty: string | number | null;
  cancelledAt: string | null;
  workOrder: { id: string; workOrderNumber: string } | null;
}

export const fetchRecentOrders = (customerId: string, limit = 5) =>
  orderService.listCursor({ limit, filters: { customerId }, sortBy: "createdAt", sortOrder: "desc" }).then((r) => r.data as Order[]);
export const fetchRecentShipments = (customerId: string, limit = 5) =>
  shipmentService.listCursor({ limit, filters: { customerId }, sortBy: "createdAt", sortOrder: "desc" }).then((r) => r.data);
export const fetchRecentPayments = (cariAccountId: string, pageSize = 5) => listPayments({ page: 1, pageSize, cariId: cariAccountId }).then((r) => r.data);
export const fetchFasonDispatches = (subcontractorId: string, pageSize = 5) =>
  apiClient
    .get<{ data: FasonDispatchRow[] }>("/api/subcontractor/dispatches", { params: { subcontractorId, page: 1, pageSize, status: "all" } })
    .then((r) => r.data.data ?? []);

export type { PaymentRow };
