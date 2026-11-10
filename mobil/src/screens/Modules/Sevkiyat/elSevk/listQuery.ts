// Sevk Çıkışı listesi (el terminali v2) — süzgeç durumu → sorgu parametresi (tek kaynak; süzme SUNUCUDA).
import { factoryDayEndIso, factoryDayStartIso } from '../../../../lib/factory-time';
import { calendarKey, type DateRange } from '../../../../components/filters/rollHistoryFilter';

export type StatusFilter = 'ALL' | 'PLANNED' | 'DISPATCHED';
export type SortKey = 'newest' | 'oldest' | 'customer';

export interface ListFilter {
  status: StatusFilter;
  customer: { id: string; name: string } | null;
  range: DateRange | null;
  sort: SortKey;
}

export const DEFAULT_LIST_FILTER: ListFilter = { status: 'ALL', customer: null, range: null, sort: 'newest' };

export const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: 'Tümü' },
  { key: 'PLANNED', label: 'Açık' },
  { key: 'DISPATCHED', label: 'Sevk edildi' },
];

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Yeni → eski' },
  { key: 'oldest', label: 'Eski → yeni' },
  { key: 'customer', label: 'Cari A → Z' },
];

export const LIST_PAGE_SIZE = 30;

/** Süzgeç + arama + cursor → `GET /shipping/shipments` parametreleri. Boş süzgeç anahtar üretmez. */
export function listQueryParams(f: ListFilter, search: string, cursor: string | null = null): Record<string, string> {
  const p: Record<string, string> = { mode: 'cursor', limit: String(LIST_PAGE_SIZE) };
  if (f.sort === 'customer') {
    p.sortBy = 'customerName';
    p.sortOrder = 'asc';
  } else {
    p.sortBy = 'createdAt';
    p.sortOrder = f.sort === 'oldest' ? 'asc' : 'desc';
  }
  if (f.status !== 'ALL') p.status = f.status;
  if (f.customer) p.customerId = f.customer.id;
  if (f.range) {
    // dateField zorunlu: backend alan adı yoksa aralığı sessizce yok sayar.
    p.dateField = 'createdAt';
    p.dateFrom = factoryDayStartIso(calendarKey(f.range.from));
    p.dateTo = factoryDayEndIso(calendarKey(f.range.to));
  }
  const q = search.trim();
  if (q) p.search = q;
  if (cursor) p.cursor = cursor;
  return p;
}

/** Süzgeç düğmesi rozeti — sıralama süzgeç sayılmaz. */
export function activeFilterCount(f: ListFilter): number {
  return (f.status !== 'ALL' ? 1 : 0) + (f.customer ? 1 : 0) + (f.range ? 1 : 0);
}

export const HANDHELD_LIST_KEY = ['handheld-shipments'] as const;

export function listQueryKey(f: ListFilter, search: string) {
  return [
    ...HANDHELD_LIST_KEY,
    f.status,
    f.customer?.id ?? null,
    f.range ? `${calendarKey(f.range.from)}_${calendarKey(f.range.to)}` : null,
    f.sort,
    search.trim(),
  ] as const;
}
