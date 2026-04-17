import type { QueryParams } from "@/types/api";

type PartialQueryParams = Partial<QueryParams>;

export function buildQueryString(params: PartialQueryParams): string {
  const searchParams = new URLSearchParams();

  if (params.page && params.page > 1) {
    searchParams.set("page", String(params.page));
  }

  if (params.pageSize && params.pageSize !== 20) {
    searchParams.set("pageSize", String(params.pageSize));
  }

  if (params.sortBy && params.sortBy !== "createdAt") {
    searchParams.set("sortBy", params.sortBy);
  }

  if (params.sortOrder && params.sortOrder !== "desc") {
    searchParams.set("sortOrder", params.sortOrder);
  }

  if (params.search) {
    searchParams.set("search", params.search);
  }

  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      if (!value || (Array.isArray(value) && value.length === 0)) continue;

      const filterValue = Array.isArray(value) ? value.join(",") : value;
      if (filterValue) {
        searchParams.set(`filter[${key}]`, filterValue);
      }
    }
  }

  const qs = searchParams.toString();
  return qs ? `?${qs}` : "";
}

export function parseUrlToQueryParams(
  searchString: string,
  defaults?: PartialQueryParams,
): QueryParams {
  const url = new URLSearchParams(searchString);

  const page = parseInt(url.get("page") ?? "", 10) || defaults?.page || 1;
  const pageSize =
    parseInt(url.get("pageSize") ?? "", 10) || defaults?.pageSize || 20;
  const sortBy = url.get("sortBy") ?? defaults?.sortBy ?? "createdAt";
  const sortOrder =
    (url.get("sortOrder") as "asc" | "desc") ??
    defaults?.sortOrder ??
    "desc";
  const search = url.get("search") ?? defaults?.search ?? undefined;

  const filters: Record<string, string | string[]> = {
    ...defaults?.filters,
  };
  url.forEach((value, key) => {
    const match = key.match(/^filter\[(.+)]$/);
    if (match) {
      const field = match[1];
      filters[field] = value.includes(",") ? value.split(",") : value;
    }
  });

  return { page, pageSize, sortBy, sortOrder, filters, search };
}
