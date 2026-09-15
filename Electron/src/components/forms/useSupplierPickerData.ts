// =============================================================================
// TEDARİKÇİ LİSTE MODALI VERİSİ — iki bacak, sunucudan sayfa sayfa, rol SUNUCUDA (istek #5 rev.)
// =============================================================================
// Cari bacağı cursor'lu (`listCursor`, `useEntityPickerData` emsali); fason bacağı yalnız offset verir
// (`subcontractor-management.service.findAll`) → sayfa numarasıyla `useInfiniteQuery`. "Tümü"de iki bacak
// birlikte: önce cariler tükenir, sonra fason sayfaları — sıralama SUNUCUNUN, istemcide yeniden sıralanmaz
// (sayfa sınırı korunur). Rol seçimi `supplierRoleQuery` ile parametreye çevrilir; kapalı bacak sorulmaz.
// =============================================================================
import { useInfiniteQuery } from "@tanstack/react-query";
import { customerService } from "@/pages/Customers/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { supplierListFilters } from "./supplierParty";
import { supplierRoleQuery, toSupplierPickerRows, type SupplierPickerRow, type SupplierRoleFilter } from "./supplierPicker";

export const SUPPLIER_PICKER_PAGE = 50;

interface Args {
  open: boolean;
  search: string;
  role: SupplierRoleFilter;
  includeInactive: boolean;
}

export function useSupplierPickerData({ open, search, role, includeInactive }: Args) {
  const q = supplierRoleQuery(role);
  const base = supplierListFilters(includeInactive);
  const customersQ = useInfiniteQuery({
    queryKey: ["supplier-picker", "customers", search, role, includeInactive],
    queryFn: ({ pageParam }) =>
      customerService.listCursor({
        cursor: pageParam,
        limit: SUPPLIER_PICKER_PAGE,
        sortBy: "name",
        sortOrder: "asc",
        filters: { ...base, ...(q.customerType ? { type: q.customerType } : {}) },
        ...(search ? { search } : {}),
        ...(pageParam === null ? { withTotal: true } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.pagination.nextCursor ?? undefined,
    enabled: open && q.customers,
    staleTime: 30_000,
  });
  const subsQ = useInfiniteQuery({
    queryKey: ["supplier-picker", "subcontractors", search, role, includeInactive],
    queryFn: ({ pageParam }) =>
      subcontractorService.getAll({ page: pageParam, pageSize: SUPPLIER_PICKER_PAGE, sortBy: "name", sortOrder: "asc", filters: base, ...(search ? { search } : {}) }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
    enabled: open && q.subcontractors,
    staleTime: 30_000,
  });

  const customers = q.customers ? (customersQ.data?.pages ?? []).flatMap((p) => p.data as Customer[]) : [];
  const subs = q.subcontractors ? (subsQ.data?.pages ?? []).flatMap((p) => p.data as Subcontractor[]) : [];
  const rows: SupplierPickerRow[] = toSupplierPickerRows(customers, subs);
  const customersMore = q.customers && Boolean(customersQ.hasNextPage);
  const subsMore = q.subcontractors && Boolean(subsQ.hasNextPage);
  const totalCustomers = q.customers ? customersQ.data?.pages[0]?.pagination.totalEstimate : 0;
  const totalSubs = q.subcontractors ? subsQ.data?.pages[0]?.pagination.total : 0;

  return {
    rows,
    isLoading: (q.customers && customersQ.isLoading) || (q.subcontractors && subsQ.isLoading),
    customersError: q.customers && customersQ.isError,
    subcontractorsError: q.subcontractors && subsQ.isError,
    hasMore: customersMore || subsMore,
    isFetchingMore: customersQ.isFetchingNextPage || subsQ.isFetchingNextPage,
    total: totalCustomers != null && totalSubs != null ? totalCustomers + totalSubs : undefined,
    /** Önce cariler tükenir, sonra fason sayfaları. */
    loadMore: () => {
      if (customersMore) void customersQ.fetchNextPage();
      else if (subsMore) void subsQ.fetchNextPage();
    },
  };
}
