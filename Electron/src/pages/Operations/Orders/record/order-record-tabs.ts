// Sipariş kayıt sayfası sekmeleri — görünürlük TEK yerden: kapı (izin + modül + rejim) açık VE veri var.
// Yoklanan listeler sekme içeriğiyle AYNI sorgu anahtarını kullanır (ikinci istek yok). Geçmiş audit'tir:
// görünürlüğü yalnız izin kapısı, sayı rozeti basılmaz (ayak izinden sayı türetilmez).
import { useQueries } from "@tanstack/react-query";
import { Factory, FileText, History, Info, ListOrdered, Truck, type LucideIcon } from "lucide-react";
import type { RecordTab } from "@/components/record/RecordPageShell";
import type { Order } from "../types";
import { linkedWorkOrders } from "./order-movements";
import { orderDocVersionsQuery, orderShipmentsQuery, orderWeavingQuery, RECORD_LIMIT, type OrderAccess } from "./useOrderRecordData";

export const ORDER_TAB_KEYS = ["genel", "kalemler", "uretim", "sevkiyatlar", "belgeler", "gecmis"] as const;
export type OrderTabKey = (typeof ORDER_TAB_KEYS)[number];

const TAB_META: Record<OrderTabKey, { label: string; icon: LucideIcon }> = {
  genel: { label: "Genel", icon: Info },
  kalemler: { label: "Kalemler", icon: ListOrdered },
  uretim: { label: "Üretim", icon: Factory },
  sevkiyatlar: { label: "Sevkiyatlar", icon: Truck },
  belgeler: { label: "Belgeler", icon: FileText },
  gecmis: { label: "Geçmiş", icon: History },
};

export interface OrderTabCounts {
  lines: number;
  workOrders: number;
  weaving: number | undefined;
  shipments: number | undefined;
  documents: number | undefined;
}

/** Görünür sekmeler; `undefined` sayı = henüz yok/yükleniyor → gizli. */
export function visibleOrderTabs(access: OrderAccess, c: OrderTabCounts): RecordTab[] {
  const production = access.production ? (access.workOrders ? c.workOrders : 0) + (access.weaving ? (c.weaving ?? 0) : 0) : 0;
  const show: Record<OrderTabKey, number | null> = {
    genel: null,
    kalemler: c.lines > 0 ? c.lines : -1,
    uretim: production > 0 ? production : -1,
    sevkiyatlar: (c.shipments ?? 0) > 0 ? c.shipments! : -1,
    belgeler: access.documents && (c.documents ?? 0) > 0 ? c.documents! : -1,
    gecmis: access.history ? null : -1,
  };
  return ORDER_TAB_KEYS.filter((k) => show[k] !== -1).map((k) => {
    const n = show[k];
    return { key: k, ...TAB_META[k], count: n != null && n < RECORD_LIMIT ? n : null };
  });
}

export function useOrderRecordTabs(order: Order, access: OrderAccess): RecordTab[] {
  const [ships, weaving, docs] = useQueries({
    queries: [
      orderShipmentsQuery(order.id),
      { ...orderWeavingQuery(order.id), enabled: access.weaving },
      { ...orderDocVersionsQuery(order.id), enabled: access.documents },
    ],
  });
  return visibleOrderTabs(access, {
    lines: order.lines.length,
    workOrders: linkedWorkOrders(order.lines).length,
    weaving: (weaving!.data as unknown[] | undefined)?.length,
    shipments: (ships!.data as { data?: { shipments: unknown[] } } | undefined)?.data?.shipments.length,
    documents: (docs!.data as unknown[] | undefined)?.length,
  });
}
