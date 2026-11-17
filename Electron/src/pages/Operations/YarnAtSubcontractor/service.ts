// =============================================================================
// FASONDAKİ İPLİK — `GET /api/warping-orders/yarn-at-subcontractor` istemcisi (devere D6c)
// =============================================================================
// Uç sayfasız dizi döner (fasoncu × iplik × lot × sahip grubu); süzgeçler `filter[...]` sarmalıyla SUNUCUDA.
// Özet şeridi aynı yanıttan hesaplanır → liste ile özet TEK where. Kapı: `warping-order:read` + devere + iplik.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

export const YARN_AT_SUB_QUERY_KEY = "yarn-at-subcontractor";
export const YARN_AT_SUB_PATH = "/operations/fasondaki-iplik";
/** Sipariş sayfası (D6a `operations/fason-devere/:id`). */
export const warpingOrderHref = (id: string) => `/operations/fason-devere/${id}`;

export type WarpingOrderStatusCode = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface YarnAtSubOrder {
  warpingOrderId: string;
  orderNo: string;
  status: WarpingOrderStatusCode;
  kg: string;
}

export interface YarnAtSubRow {
  subcontractorId: string;
  subcontractorCode: string | null;
  subcontractorName: string | null;
  yarnItemId: string;
  yarnItemCode: string | null;
  yarnItemName: string | null;
  lotId: string | null;
  lotNo: string | null;
  ownerCustomerId: string | null;
  ownerCustomerName: string | null;
  kg: string;
  oldestDispatchedAt: string;
  orders: YarnAtSubOrder[];
}

export interface YarnAtSubFilters {
  subcontractorId?: string;
  yarnItemId?: string;
  /** CSV — `COMPLETED` = devreden (kapanmış siparişten kalan). */
  status?: string;
}

const FILTER_KEYS = ["subcontractorId", "yarnItemId", "status"] as const;

export async function listYarnAtSubcontractor(f: YarnAtSubFilters): Promise<YarnAtSubRow[]> {
  const sp = new URLSearchParams();
  for (const k of FILTER_KEYS) if (f[k]) sp.set(`filter[${k}]`, f[k] as string);
  const qs = sp.toString();
  const r = await apiClient.get<{ success: boolean; data: YarnAtSubRow[] }>(`/api/warping-orders/yarn-at-subcontractor${qs ? `?${qs}` : ""}`);
  return r.data.data ?? [];
}

/** Kart bölümleri için (iplik kartı · fasoncu kartı) — `enabled` false iken istek ATILMAZ. */
export function useYarnAtSubcontractor(f: YarnAtSubFilters, enabled: boolean) {
  return useQuery({
    queryKey: [YARN_AT_SUB_QUERY_KEY, f.subcontractorId ?? "", f.yarnItemId ?? "", f.status ?? ""],
    queryFn: () => listYarnAtSubcontractor(f),
    enabled,
    staleTime: 30_000,
  });
}
