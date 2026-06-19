import apiClient from "@/services/apiClient";
import type {
  ApiResponse,
  CursorPaginatedResponse,
  CursorParams,
  QueryParams,
} from "@/types/api";

export interface SwatchParentProperty {
  propertyId: string;
  property: { id: string; code: string; name: string };
}

export interface SwatchParentRoll {
  id: string;
  barcode: string | null;
  qualityGrade: string;
  color: { id: string; code: string; name: string; hex: string | null } | null;
  properties: SwatchParentProperty[];
}

export interface Swatch {
  id: string;
  cardNumber: string;
  barcode: string;
  itemId: string;
  colorId: string | null;
  width: number | null;
  /** cm — kabulde opsiyonel girilir, boş olabilir. */
  length: number | null;
  /** Kartela fason kabulinde doğduğu receipt. */
  parentReceiptId: string | null;
  parentRollId: string | null;
  purpose: string | null;
  createdById: string | null;
  item?: { id: string; code: string; name: string } | null;
  color?: { id: string; code: string; name: string; hex: string | null } | null;
  parentRoll?: SwatchParentRoll | null;
  createdAt: string;
  updatedAt: string;
}

export interface SwatchStats {
  count: number;
  /** Filtreye uyan tüm kartelaların `length` toplamı — cm. */
  totalLength: number;
}

export interface SwatchListParams {
  itemId?: string;
  limit?: number;
}

/**
 * Backend `/api/swatches` `filter[]` syntax'ı bilmez — direkt `?itemId=` bekler.
 * `useDataTable` ise URL filtre'lerini `filters.itemId` formatında verir.
 * Bu helper ikisini köprüler.
 */
function appendKnownFilters(
  sp: URLSearchParams,
  filters: Record<string, string | string[]> | undefined,
): void {
  if (!filters) return;
  const itemId = typeof filters.itemId === "string" ? filters.itemId : undefined;
  if (itemId) sp.set("itemId", itemId);
}

export const swatchService = {
  list(params?: SwatchListParams): Promise<ApiResponse<Swatch[]>> {
    const q = new URLSearchParams();
    if (params?.itemId) q.set("itemId", params.itemId);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return apiClient
      .get<ApiResponse<Swatch[]>>(`/api/swatches${qs ? `?${qs}` : ""}`)
      .then((r) => r.data);
  },

  /** `useDataTable` ile uyumlu cursor pagination. */
  listCursor(params: CursorParams): Promise<CursorPaginatedResponse<Swatch>> {
    const sp = new URLSearchParams();
    sp.set("mode", "cursor");
    sp.set("limit", String(params.limit));
    if (params.cursor) sp.set("cursor", params.cursor);
    if (params.withTotal) sp.set("withTotal", "true");
    if (params.search) sp.set("search", params.search);
    appendKnownFilters(sp, params.filters);
    return apiClient
      .get<CursorPaginatedResponse<Swatch>>(`/api/swatches?${sp.toString()}`)
      .then((r) => r.data);
  },

  /** Tek kartelayı barkoduyla getir (SW-...). Tabanca/scan ile detay açmak için. */
  getByBarcode(barcode: string): Promise<ApiResponse<Swatch>> {
    return apiClient
      .get<ApiResponse<Swatch>>(`/api/swatches/by-barcode/${encodeURIComponent(barcode)}`)
      .then((r) => r.data);
  },

  /** Listeyle aynı filtre setini paylaşan aggregate (count + totalLength). */
  getStats(
    params: Pick<QueryParams, "filters" | "search">,
  ): Promise<ApiResponse<SwatchStats>> {
    const sp = new URLSearchParams();
    if (params.search) sp.set("search", params.search);
    appendKnownFilters(sp, params.filters);
    const qs = sp.toString();
    return apiClient
      .get<ApiResponse<SwatchStats>>(`/api/swatches/stats${qs ? `?${qs}` : ""}`)
      .then((r) => r.data);
  },
};
