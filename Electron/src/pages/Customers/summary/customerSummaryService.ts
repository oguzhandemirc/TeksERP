import apiClient from "@/services/apiClient";
import { buildCursorQueryString } from "@/lib/query-builder";
import type { CursorPaginatedResponse } from "@/types/api";
import { orderService } from "@/pages/Operations/Orders/service";
import { sackHubService } from "@/pages/Operations/SackContentEdit/service";
import { returnsService } from "@/pages/Operations/Returns/service";
import { getCariByCustomer } from "@/pages/Finance/service";
import type { ShipmentListItem } from "@/pages/Operations/Shipments/types";

// Müşteri kartı "Özet" sekmesinin veri kapısı — YALNIZ var olan uçlar, her süzme ve toplam
// SUNUCUDA (istemci toplamaz). İptaller liste ekranlarıyla aynı biçimde dışlanır ki
// "Tümünü gör" ile açılan liste aynı sayıyı söylesin.

export const SUMMARY_LIMIT = 10;

/** Sevk listesinin süzülmüş kümenin TAMAMI için özeti (`withSummary=true`; BRÜT metre). */
export interface ShipmentSummaryTotals {
  shipmentCount: number;
  totalMeters: number;
  totalKg: number;
}

export type ShipmentSummaryResponse = CursorPaginatedResponse<ShipmentListItem> & {
  summary?: ShipmentSummaryTotals;
};

const orderFilters = (customerId: string) => ({ customerId, hideCancelled: "true" });

export const customerSummaryService = {
  /** Son siparişler — sipariş listesinin cursor ucu, iptaller hariç. */
  recentOrders: (customerId: string) =>
    orderService.listCursor({ limit: SUMMARY_LIMIT, sortBy: "createdAt", sortOrder: "desc", filters: orderFilters(customerId) }),

  /** Sipariş toplamları — listeyle AYNI where (`buildListWhere`). */
  orderStats: (customerId: string) =>
    orderService.getStats({ page: 1, pageSize: 1, sortBy: "createdAt", sortOrder: "desc", filters: orderFilters(customerId) }),

  /** Açık sipariş kalemleri — sevk rehberi ucu (sunucu cari ile süzer). */
  openOrders: (customerId: string) => sackHubService.listOpenOrders({ customerId }),

  /** Sevk edilenler — birleşik liste (çuval + doğrudan sevk), BRÜT; özet kümenin tamamı için. */
  dispatchedShipments: (customerId: string): Promise<ShipmentSummaryResponse> =>
    apiClient
      .get<ShipmentSummaryResponse>(
        `/api/shipping/shipments${buildCursorQueryString({
          limit: SUMMARY_LIMIT,
          sortBy: "createdAt",
          sortOrder: "desc",
          filters: { customerId, status: "DISPATCHED" },
        })}&withSummary=true`,
      )
      .then((r) => r.data),

  /** İadeler — iptal edilmemiş iade satırları; ilk sayfada özet (adet + metre). */
  returns: (customerId: string) =>
    returnsService.listCursor({ limit: SUMMARY_LIMIT, withTotal: true, sortBy: "createdAt", sortOrder: "desc", filters: { customerId } }),

  /** Cari bakiye — finans kapısının arkasında (`finance:read` + modül açık). */
  cari: (customerId: string) => getCariByCustomer(customerId),
};
