import type { ListScope } from "@/types/api";

/** Liste kapsamında kullanıcının daralttığı bir şey var mı (filtre değeri, arama, tarih). Özet şeridi "Filtreli" der. */
export function isListFiltered(scope: Pick<ListScope, "filters" | "search" | "dateFrom" | "dateTo">): boolean {
  if (scope.search?.trim()) return true;
  if (scope.dateFrom || scope.dateTo) return true;
  return Object.values(scope.filters).some((v) => (Array.isArray(v) ? v.length > 0 : v !== "" && v != null));
}
