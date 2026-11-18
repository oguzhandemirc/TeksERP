// =============================================================================
// Picker / dropdown "tümünü çek" helper'ı
// =============================================================================
// Master data ekranlarındaki picker'lar (renk, özellik, kumaş, müşteri, vb.)
// "tümünü tek seferde göster" davranışı kullanır. Tarihsel olarak her sayfada
// `colorService.getAll({ page: 1, pageSize: 500, ... })` gibi inline kod
// vardı; backend `MAX_PAGE_SIZE` değiştikçe (100 → 200 → 500) yer yer 400
// hataları üretiyordu (operasyon engelleyici).
//
// Çözüm: tek helper. Tüm picker'lar buna yönelir. Backend sınırını aşan
// listeler için cursor mode'a düşmek istenirse helper genişletilebilir
// (PICKER_MAX_PAGE_SIZE üst sınırını backend ile eşle, üstü için
// `listCursor` kullan).
//
// Kullanım:
//   const { data } = useQuery({
//     queryKey: ["colors", "picker"],
//     queryFn: () => loadAllForPicker(colorService),
//   });
//
// Filtre veya sort özelleştirmek için:
//   loadAllForPicker(itemService, {
//     filters: { isActive: "true", itemType: "FABRIC" },
//     sortBy: "code",
//   });
// =============================================================================

import type { CrudService } from "@/services/crudService";
import type { PaginatedResponse, QueryParams } from "@/types/api";

/**
 * Backend MAX_PAGE_SIZE ile eşleşmeli. Aşılırsa backend 400 verir; bu
 * helper'ı kullananlar otomatik korunur. Backend sınırı arttığında bu sabit
 * de güncellenmeli.
 */
export const PICKER_MAX_PAGE_SIZE = 500;

export interface PickerOptions {
  /** Default: `{ isActive: "true" }` — pasif kayıtlar dropdown'da görünmez. */
  filters?: Record<string, string | string[]>;
  /** Default: `"name"` — picker'ların çoğu ada göre sıralı. */
  sortBy?: string;
  /** Default: `"asc"`. */
  sortOrder?: "asc" | "desc";
  /** Default: `undefined` — arama parametresi yok. */
  search?: string;
}

const DEFAULT_FILTERS: Record<string, string | string[]> = { isActive: "true" };

/**
 * Bir CRUD servisinden picker için kullanılacak tüm aktif kayıtları çek.
 * Tek istekle backend limit'ine kadar getirir. Limit aşılırsa hata fırlatır.
 *
 * @throws Picker veri seti backend limit'ini aşıyorsa (`total > PICKER_MAX_PAGE_SIZE`)
 *         cursor mode'a yönlendirici hata. UI tarafında bu hatayı yakalayıp
 *         arama-bazlı (filter-as-you-type) picker'a geçmek gerekir.
 */
export async function loadAllForPicker<T>(
  service: CrudService<T>,
  options: PickerOptions = {}
): Promise<PaginatedResponse<T>> {
  const params: QueryParams = {
    page: 1,
    pageSize: PICKER_MAX_PAGE_SIZE,
    sortBy: options.sortBy ?? "name",
    sortOrder: options.sortOrder ?? "asc",
    filters: options.filters ?? DEFAULT_FILTERS,
    ...(options.search ? { search: options.search } : {}),
  };

  const res = await service.getAll(params);

  if (res.pagination && res.pagination.total > PICKER_MAX_PAGE_SIZE) {
    // Master data normalde bu sınırı aşmaz; aşıyorsa picker yerine arama
    // tabanlı (combobox + debounced search) UI gerekir. Sessizce kesilmiş
    // veri vermek yerine açık hata.
    throw new Error(
      `Picker veri seti çok büyük (${res.pagination.total} kayıt > ${PICKER_MAX_PAGE_SIZE}). ` +
        `Bu liste için arama tabanlı combobox kullanın (filter-as-you-type).`
    );
  }

  return res;
}

/**
 * CrudService OLMAYAN sayfalı uçlar için (`page`/`pageSize` + `pagination.total`, ör.
 * `/api/yarn/stocks` — tavanı 200): sayfa sayfa sonuna kadar çeker, sessiz kesmez.
 * Sayfa boyu buradadır (her uç ≥ 100 kabul eder); çağıran inline `pageSize` yazmaz.
 */
export const PAGED_PICKER_PAGE_SIZE = 100;
/** Kaçak döngü kesici: 100 × 50 = 5.000 satır üstü seçici değil arama ister. */
export const PAGED_PICKER_MAX_PAGES = 50;

export interface PagedPickerPage<T> {
  data: T[];
  pagination: { total: number };
}

export async function loadAllPagesForPicker<T>(
  fetchPage: (page: number, pageSize: number) => Promise<PagedPickerPage<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= PAGED_PICKER_MAX_PAGES; page++) {
    const res = await fetchPage(page, PAGED_PICKER_PAGE_SIZE);
    rows.push(...res.data);
    if (res.data.length < PAGED_PICKER_PAGE_SIZE || rows.length >= res.pagination.total) return rows;
  }
  throw new Error(
    `Picker veri seti çok büyük (${PAGED_PICKER_PAGE_SIZE * PAGED_PICKER_MAX_PAGES} kaydı aştı). ` +
      `Bu liste için arama tabanlı seçici kullanın.`,
  );
}

/**
 * CURSOR sayfalı uçlar için (`limit`/`cursor` + `pagination.nextCursor`, ör. `/api/yarn/lots`
 * tavanı 200, `/api/warp-beams` tavanı 100): imleç bitene kadar çeker, sessiz kesmez.
 * Çağıran inline `limit: N` yazmaz; sayfa boyu ve kaçak kesici buradadır.
 */
export interface CursorPickerPage<T> {
  data: T[];
  pagination?: { nextCursor: string | null; hasMore?: boolean };
}

export async function loadAllCursorPagesForPicker<T>(
  fetchPage: (cursor: string | undefined, limit: number) => Promise<CursorPickerPage<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let page = 1; page <= PAGED_PICKER_MAX_PAGES; page++) {
    const res = await fetchPage(cursor, PAGED_PICKER_PAGE_SIZE);
    rows.push(...res.data);
    const next = res.pagination?.nextCursor;
    if (!next || res.pagination?.hasMore === false) return rows;
    cursor = next;
  }
  throw new Error(
    `Picker veri seti çok büyük (${PAGED_PICKER_PAGE_SIZE * PAGED_PICKER_MAX_PAGES} kaydı aştı). ` +
      `Bu liste için arama tabanlı seçici kullanın.`,
  );
}
