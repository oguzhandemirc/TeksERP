import type { CursorParams, DateRange, QueryParams } from "@/types/api";

type PartialQueryParams = Partial<QueryParams>;

export function buildQueryString(params: PartialQueryParams): string {
  const searchParams = new URLSearchParams();

  if (params.page && params.page > 1) searchParams.set("page", String(params.page));
  if (params.pageSize && params.pageSize !== 20) searchParams.set("pageSize", String(params.pageSize));
  if (params.sortBy && params.sortBy !== "createdAt") searchParams.set("sortBy", params.sortBy);
  if (params.sortOrder && params.sortOrder !== "desc") searchParams.set("sortOrder", params.sortOrder);
  if (params.search) searchParams.set("search", params.search);
  appendDateRange(searchParams, params);
  appendFilters(searchParams, params.filters);

  const qs = searchParams.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Cursor mode için query string. `mode=cursor` zorunlu;
 * `withTotal=true` sadece ilk fetch'te gönderilir.
 */
export function buildCursorQueryString(params: CursorParams): string {
  const sp = new URLSearchParams();
  sp.set("mode", "cursor");
  sp.set("limit", String(params.limit));
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.withTotal) sp.set("withTotal", "true");
  if (params.search) sp.set("search", params.search);
  if (params.sortBy && params.sortBy !== "createdAt") sp.set("sortBy", params.sortBy);
  if (params.sortOrder && params.sortOrder !== "desc") sp.set("sortOrder", params.sortOrder);
  appendDateRange(sp, params);
  appendFilters(sp, params.filters);
  return `?${sp.toString()}`;
}

function appendDateRange(sp: URLSearchParams, range: DateRange): void {
  if (range.dateField) sp.set("dateField", range.dateField);
  if (range.dateFrom) sp.set("dateFrom", range.dateFrom);
  if (range.dateTo) sp.set("dateTo", range.dateTo);
}

function appendFilters(
  sp: URLSearchParams,
  filters: Record<string, string | string[]> | undefined,
): void {
  if (!filters) return;
  for (const [key, value] of Object.entries(filters)) {
    if (!value || (Array.isArray(value) && value.length === 0)) continue;
    const filterValue = Array.isArray(value) ? value.join(",") : value;
    if (filterValue) sp.set(`filter[${key}]`, filterValue);
  }
}

export function parseUrlToQueryParams(
  searchString: string,
  defaults?: PartialQueryParams,
): QueryParams {
  const url = new URLSearchParams(searchString);

  const page = parseInt(url.get("page") ?? "", 10) || defaults?.page || 1;
  const pageSize = parseInt(url.get("pageSize") ?? "", 10) || defaults?.pageSize || 20;
  const sortBy = url.get("sortBy") ?? defaults?.sortBy ?? "createdAt";
  const sortOrder = (url.get("sortOrder") as "asc" | "desc") ?? defaults?.sortOrder ?? "desc";
  const search = url.get("search") ?? defaults?.search ?? undefined;

  const filters: Record<string, string | string[]> = { ...defaults?.filters };
  url.forEach((value, key) => {
    const match = key.match(/^filter\[(.+)]$/);
    if (match?.[1]) {
      filters[match[1]] = value.includes(",") ? value.split(",") : value;
    }
  });

  const dateField = url.get("dateField") ?? defaults?.dateField ?? undefined;
  const dateFrom = url.get("dateFrom") ?? defaults?.dateFrom ?? undefined;
  const dateTo = url.get("dateTo") ?? defaults?.dateTo ?? undefined;

  return { page, pageSize, sortBy, sortOrder, filters, search, dateField, dateFrom, dateTo };
}
