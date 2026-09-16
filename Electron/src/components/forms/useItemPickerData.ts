// =============================================================================
// ÜRÜN SEÇİCİ MODALI VERİSİ — TEK sonsuz sorgu (`itemService.listCursor`, 50), arama + üç süzgeç SUNUCUDA (v3 kalıbı)
// =============================================================================
// `loadAllForPicker` KULLANILMAZ (>500 ürün fırlatır; liste cursor'la sonsuzdur). `open=false` iken sorgu kapalı;
// kapanınca arama/süzgeç SIFIRLANMAZ (kullanıcı bulduğu yerde açar). Renk ve özellik seçicilerinin kataloğu ayrı
// (`useItemPickerCatalogs`): küçük master data, `loadAllForPicker` ile; ≥500 fırlatırsa o süzgeç GİZLENİR, liste çalışır.
// =============================================================================
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { loadAllForPicker } from "@/lib/picker-loader";
import { colorService } from "@/pages/Colors/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { ITEM_PICKER_PAGE, itemPickerFilters, itemPickerRow, type AllowedItemTypes, type ItemPickerFilterState } from "./itemPicker";

interface Args {
  open: boolean;
  search: string;
  filter: ItemPickerFilterState;
  allowedTypes?: AllowedItemTypes;
}

export function useItemPickerData({ open, search, filter, allowedTypes }: Args) {
  const filters = itemPickerFilters(filter, allowedTypes);
  const q = useInfiniteQuery({
    queryKey: ["item-picker", search, filters],
    queryFn: async ({ pageParam }) => {
      const res = await itemService.listCursor({ cursor: pageParam, limit: ITEM_PICKER_PAGE, sortBy: "name", sortOrder: "asc", filters, ...(search ? { search } : {}) });
      return { rows: (res.data as Item[]).map(itemPickerRow), next: res.pagination.nextCursor ?? null };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: open,
    staleTime: 30_000,
  });
  const pages = q.data?.pages ?? [];
  return {
    rows: pages.flatMap((p) => p.rows),
    isLoading: q.isLoading,
    isError: q.isError,
    hasMore: Boolean(q.hasNextPage),
    isFetchingNext: q.isFetchingNextPage,
    fetchNext: () => {
      void q.fetchNextPage();
    },
  };
}

export interface CatalogOption { id: string; label: string }

/** Renk ve özellik katalogları — süzgeç seçicilerinin kaynağı; katalog sığmazsa (`loadAllForPicker` fırlatır) `null` → seçici gizlenir. */
export function useItemPickerCatalogs(open: boolean): { colors: CatalogOption[] | null; properties: CatalogOption[] | null } {
  const colors = useQuery({
    queryKey: ["item-picker", "colors"],
    queryFn: async () => (await loadAllForPicker(colorService)).data.map((c) => ({ id: c.id, label: c.name })),
    enabled: open,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const properties = useQuery({
    queryKey: ["item-picker", "properties"],
    queryFn: async () => (await loadAllForPicker(fabricPropertyService)).data.map((p) => ({ id: p.id, label: p.name })),
    enabled: open,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { colors: colors.isError ? null : (colors.data ?? []), properties: properties.isError ? null : (properties.data ?? []) };
}
