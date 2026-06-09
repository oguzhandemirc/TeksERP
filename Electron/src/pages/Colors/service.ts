import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import { buildCursorQueryString, buildQueryString } from "@/lib/query-builder";
import { PICKER_MAX_PAGE_SIZE } from "@/lib/picker-loader";
import type {
  CursorPaginatedResponse,
  CursorParams,
  PaginatedResponse,
} from "@/types/api";
import type { Color } from "./types";

export const colorService = createCrudService<Color>("/api/colors");

// `?scope=public` → backend müşteriye ATANMIŞ (assigned=true) renkleri listeden
// dışlar. Renk seçicinin "Tüm Renkler" bölümü yalnızca public renkleri gösterir;
// müşteriye özel renkler sadece o müşterinin pinned (★) bölümünde çıkar.
const PUBLIC_SCOPE = "scope=public";

/**
 * Renk seçici (sınırsız mod) için public renk araması — cursor.
 * `colorService.listCursor` ile aynı ama `scope=public` ekler.
 */
export function listPublicColorsCursor(
  params: CursorParams,
): Promise<CursorPaginatedResponse<Color>> {
  // buildCursorQueryString her zaman `?mode=cursor&...` döner → "&" ile ekle.
  return apiClient
    .get<CursorPaginatedResponse<Color>>(
      `/api/colors${buildCursorQueryString(params)}&${PUBLIC_SCOPE}`,
    )
    .then((r) => r.data);
}

/**
 * Renk seçici (ürün izinli / kısıtlı mod) için tüm public renkleri tek istekte
 * çek — `loadAllForPicker(colorService)` muadili, `scope=public` ekler.
 */
export async function loadPublicColorsForPicker(): Promise<PaginatedResponse<Color>> {
  const qs = buildQueryString({
    page: 1,
    pageSize: PICKER_MAX_PAGE_SIZE,
    sortBy: "name",
    sortOrder: "asc",
    filters: { isActive: "true" },
  });
  const sep = qs ? "&" : "?";
  const res = await apiClient
    .get<PaginatedResponse<Color>>(`/api/colors${qs}${sep}${PUBLIC_SCOPE}`)
    .then((r) => r.data);

  if (res.pagination && res.pagination.total > PICKER_MAX_PAGE_SIZE) {
    throw new Error(
      `Picker veri seti çok büyük (${res.pagination.total} kayıt > ${PICKER_MAX_PAGE_SIZE}). ` +
        `Bu liste için arama tabanlı combobox kullanın (filter-as-you-type).`,
    );
  }
  return res;
}

/**
 * Bir müşteriye ATANMIŞ (assigned=true) aktif renkler — picker'ın "Müşteri
 * Renkleri" (pinned ★) bölümü için. `property:read` ile çalışır (alias yönetim
 * izni gerekmez) → izni olmayan satışçı da müşterinin özel rengini seçebilir.
 */
export async function loadAssignedColorsForCustomer(
  customerId: string,
): Promise<Color[]> {
  const qs = buildQueryString({
    page: 1,
    pageSize: PICKER_MAX_PAGE_SIZE,
    sortBy: "name",
    sortOrder: "asc",
    filters: { isActive: "true" },
  });
  const sep = qs ? "&" : "?";
  const res = await apiClient
    .get<PaginatedResponse<Color>>(
      `/api/colors${qs}${sep}assignedTo=${encodeURIComponent(customerId)}`,
    )
    .then((r) => r.data);
  return res.data;
}
