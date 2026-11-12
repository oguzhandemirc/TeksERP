// Sipariş kaydının veri kaynakları — her biri MEVCUT bir okuma ucu. Kapı (izin + modül) `useRouteAccess.canGo`dan:
// kapalı kaynağa istek atılmaz, yüzeyi çizilmez. Detay/sevkiyat sorgu anahtarları mevcut kartlarla AYNI (tek önbellek).
import { useQuery } from "@tanstack/react-query";
import { useRouteAccess } from "@/hooks/useRouteAccess";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { SYSTEM_ACTIVITY_ACCESS } from "@/lib/permissions";
import { printedDocumentService } from "@/services/printedDocumentService";
import { systemLogService } from "@/services/systemLogService";
import { listWeavingOrders } from "@/pages/Operations/WeavingOrders/service";
import { orderService } from "../service";
import { ORDER_CONFIRMATION_READ } from "../OrderConfirmationButton";

export const RECORD_LIMIT = 50;

export interface OrderAccess {
  write: boolean;
  workOrders: boolean;
  weaving: boolean;
  shipments: boolean;
  documents: boolean;
  history: boolean;
  production: boolean;
}

export function useOrderAccess(): OrderAccess {
  const { canGo } = useRouteAccess();
  const { hasPermission, hasAnyPermission } = useRoleAccess();
  const production = useFeatureFlags().data?.data?.productionEnabled ?? true;
  return {
    write: hasPermission("order:write"),
    workOrders: production && canGo({ to: "/operations/work-orders", izin: ["workorder:read"] }),
    weaving: canGo({ to: "/operations/weaving-orders", izin: ["weavingorder:read"] }),
    shipments: canGo({ to: "/operations/shipments", izin: ["shipping:read"] }),
    documents: hasAnyPermission(ORDER_CONFIRMATION_READ),
    history: canGo({ to: "/system/activity", izin: SYSTEM_ACTIVITY_ACCESS }),
    production,
  };
}

export const orderRecordQuery = (id: string) => ({
  queryKey: ["orders", "record", id],
  queryFn: () => orderService.getById(id).then((r) => r.data),
  staleTime: 15_000,
});

export function useOrderRecord(id: string | null) {
  return useQuery({ ...orderRecordQuery(id ?? ""), enabled: Boolean(id) });
}

export const orderShipmentsQuery = (id: string) => ({
  queryKey: ["orders", "shipments", id],
  queryFn: () => orderService.getShipments(id),
  staleTime: 30_000,
});

export const orderWeavingQuery = (id: string) => ({
  queryKey: ["weaving-orders", "order-record", id],
  queryFn: () => listWeavingOrders({ limit: RECORD_LIMIT, filters: { orderId: id } }).then((r) => r.data),
  staleTime: 30_000,
});

export const orderDocVersionsQuery = (id: string) => ({
  queryKey: ["printed-documents", "ORDER_CONFIRMATION", id, "versions"],
  queryFn: () => printedDocumentService.listVersions("ORDER_CONFIRMATION", id).then((r) => r.data ?? []),
  staleTime: 30_000,
});

export const orderHistoryQuery = (id: string) => ({
  queryKey: ["system-logs", "order-record", id],
  queryFn: () => systemLogService.list({ tableName: "ORDER", recordId: id, limit: RECORD_LIMIT }).then((r) => r.data),
});
