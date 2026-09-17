// =============================================================================
// TEDARİKÇİ SEÇİCİ MODALI VERİSİ — TEK sonsuz sorgu, bacak ayrımlı sayfa token'ı (v3)
// =============================================================================
// Cari bacağı `listCursor` (cursor, 50), fason bacağı `getAll` (sayfa numarası, 50). `getNextPageParam`
// saf `nextPageToken` ile karar verir: aynı bacakta devam → (ALL'da) fason 1. sayfa → bitti. Bir bacak
// düşerse (500) o sayfa `error:true` + boş satır olarak döner ve sorgu ÖBÜR bacağa geçer — liste yarım
// değil "uyarılı" olur (`supplierLoadNotice`). `open=false` iken sorgu kapalı; kapanınca arama/rol
// SIFIRLANMAZ (kullanıcı bulduğu yerde açar).
// =============================================================================
import { useInfiniteQuery } from "@tanstack/react-query";
import { customerService } from "@/pages/Customers/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { supplierListFilters } from "./supplierParty";
import {
  SUPPLIER_PICKER_PAGE,
  UNLINKED_SUBCONTRACTOR_FILTER,
  customerRow,
  firstPageToken,
  legsFor,
  nextPageToken,
  subcontractorRow,
  type PageToken,
  type PickerList,
  type PickerPage,
  type SupplierRoleFilter,
} from "./supplierPicker";

interface Args {
  open: boolean;
  search: string;
  role: SupplierRoleFilter;
  includeInactive: boolean;
  /** Tedarikçi (SUPPLIER/BOTH cari + fason) · müşteri (yalnız cari; ALL = CUSTOMER sonra BOTH) ·
   *  müşteri-only (dönüştürme görünümü: yalnız type=CUSTOMER). */
  list?: PickerList;
}

async function fetchPage(token: PageToken, args: Args): Promise<PickerPage> {
  const base = supplierListFilters(args.includeInactive);
  const search = args.search ? { search: args.search } : {};
  try {
    if (token.leg === "customers") {
      // Bacağın tipi token'da (müşteri kipi ALL: CUSTOMER → BOTH); token'sız hâl listeden.
      const customerType = token.type ?? legsFor(args.role, args.list).customerType;
      const res = await customerService.listCursor({
        cursor: token.cursor,
        limit: SUPPLIER_PICKER_PAGE,
        sortBy: "name",
        sortOrder: "asc",
        filters: { ...base, ...(customerType ? { type: customerType } : {}) },
        ...search,
      });
      const next = res.pagination.nextCursor;
      return { token, rows: (res.data as Customer[]).map(customerRow), next: next ? { ...token, cursor: next } : null, error: false };
    }
    // Bağlı fason (fason = carinin rolü) cari satırında TEK kez görünür — bu bacak yalnız bağsızları ister.
    const res = await subcontractorService.getAll({ page: token.page, pageSize: SUPPLIER_PICKER_PAGE, sortBy: "name", sortOrder: "asc", filters: { ...base, ...UNLINKED_SUBCONTRACTOR_FILTER }, ...search });
    const { page, totalPages } = res.pagination;
    return { token, rows: (res.data as Subcontractor[]).map(subcontractorRow), next: page < totalPages ? { leg: "subs", page: page + 1 } : null, error: false };
  } catch {
    return { token, rows: [], next: null, error: true };
  }
}

export function useSupplierPickerData(args: Args) {
  const { open, search, role, includeInactive, list = "supplier" } = args;
  const q = useInfiniteQuery({
    queryKey: ["supplier-picker", list, search, role, includeInactive],
    queryFn: ({ pageParam }) => fetchPage(pageParam, args),
    initialPageParam: firstPageToken(role, list),
    getNextPageParam: (last) => nextPageToken(last, role, list),
    enabled: open,
    staleTime: 30_000,
  });
  const pages = q.data?.pages ?? [];
  return {
    rows: pages.flatMap((p) => p.rows),
    isLoading: q.isLoading,
    customersError: pages.some((p) => p.error && p.token.leg === "customers"),
    subcontractorsError: pages.some((p) => p.error && p.token.leg === "subs"),
    hasMore: Boolean(q.hasNextPage),
    isFetchingNext: q.isFetchingNextPage,
    fetchNext: () => {
      void q.fetchNextPage();
    },
  };
}
