// =============================================================================
// FASONDAKİ İPLİK — `GET /api/warping-orders/yarn-at-subcontractor` istemcisi (devere D6c)
// =============================================================================
// Uç sayfasız dizi döner (fasoncu × iplik × lot × sahip grubu); süzgeçler `filter[...]` sarmalıyla + `search` SUNUCUDA.
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
  /** Değer alanları OPT-IN: yalnız `goods-receipt:read` ile gelir (anahtar yoksa izin yok). */
  priceStatus?: YarnAtSubPriceStatus;
  unitPrice?: string | null;
  currency?: string | null;
  value?: string | null;
}

/** `PRICE` fiyatlı · `NO_LOT` lotsuz · `NO_PRICE` mal kabulde fiyat yok · `MIXED_CURRENCY` lotun fişleri farklı para biriminde. */
export type YarnAtSubPriceStatus = "PRICE" | "NO_LOT" | "NO_PRICE" | "MIXED_CURRENCY";

export interface YarnAtSubFilters {
  subcontractorId?: string;
  yarnItemId?: string;
  lotId?: string;
  /** Lot no · iplik · fasoncu · sipariş no araması (sunucu). */
  search?: string;
  /** CSV — `COMPLETED` = devreden (kapanmış siparişten kalan). */
  status?: string;
}

const FILTER_KEYS = ["subcontractorId", "yarnItemId", "lotId", "status"] as const;

export async function listYarnAtSubcontractor(f: YarnAtSubFilters): Promise<YarnAtSubRow[]> {
  const sp = new URLSearchParams();
  for (const k of FILTER_KEYS) if (f[k]) sp.set(`filter[${k}]`, f[k] as string);
  if (f.search) sp.set("search", f.search);
  const qs = sp.toString();
  const r = await apiClient.get<{ success: boolean; data: YarnAtSubRow[] }>(`/api/warping-orders/yarn-at-subcontractor${qs ? `?${qs}` : ""}`);
  return r.data.data ?? [];
}

export const yarnAtSubQueryKey = (f: YarnAtSubFilters) =>
  [YARN_AT_SUB_QUERY_KEY, f.subcontractorId ?? "", f.yarnItemId ?? "", f.lotId ?? "", f.status ?? "", f.search ?? ""] as const;

/**
 * Lot süzgecinin seçenek kaynağı (FilterBar `lookup`): AYNI uca kendi anahtarı (lotId) HARİÇ diğer süzgeçlerle gider →
 * seçenek = seçilince listede çıkacak lot (faceted). `isActive` gibi katalog süzgeçleri uca GİTMEZ (uç tanımadığı adı 400'ler).
 */
export function yarnAtSubLotOptions(base: Omit<YarnAtSubFilters, "lotId" | "search">) {
  return {
    getAll: async (p: { search?: string }) => {
      const rows = await listYarnAtSubcontractor({ ...base, search: p.search });
      const seen = new Map<string, { id: string; name: string; code?: string }>();
      for (const r of rows) if (r.lotId && !seen.has(r.lotId)) seen.set(r.lotId, { id: r.lotId, name: r.lotNo ?? r.lotId, code: r.yarnItemName ?? r.yarnItemCode ?? undefined });
      const data = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
      return { success: true, data, pagination: { page: 1, pageSize: data.length, total: data.length, totalPages: 1 } };
    },
  };
}

/** Kart bölümleri için (iplik kartı · fasoncu kartı) — `enabled` false iken istek ATILMAZ. */
export function useYarnAtSubcontractor(f: YarnAtSubFilters, enabled: boolean) {
  return useQuery({
    queryKey: yarnAtSubQueryKey(f),
    queryFn: () => listYarnAtSubcontractor(f),
    enabled,
    staleTime: 30_000,
  });
}
