import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  listPublicColorsCursor,
  loadAssignedColorsForCustomer,
  loadPublicColorsForPicker,
} from "@/pages/Colors/service";

export interface PickerColor {
  id: string;
  code: string;
  name: string;
  hex: string | null;
}

const PAGE_LIMIT = 50;

interface Args {
  open: boolean;
  customerId?: string | null;
  /** Ürün izinli renk listesi (dolu = kısıtlı mod). */
  allowedColorIds?: string[] | null;
  debouncedSearch: string;
}

/**
 * Renk seçici modalının veri katmanı:
 *  - `pinned`     → müşteriye ATANMIŞ (assigned=true) aktif renkler (üstte, vurgulu)
 *  - `listColors` → "tüm renkler" (kısıtlı: client filtre / sınırsız: sunucu
 *                    cursor araması), atanmışlar dedupe edilir
 *  - `assignedById` → seçili rengin müşteri rengi olup olmadığını çözmek için
 *                     (arama/sayfalamadan bağımsız tam küme)
 *
 * NOT: Sadece müşteri panelinden özel ad verilmiş ama atanmamış (assigned=false)
 * renkler "Müşteri Renkleri" bölümüne GİRMEZ — onlar normal katalog renkleridir.
 */
export function useColorPickerData({
  open,
  customerId,
  allowedColorIds,
  debouncedSearch,
}: Args) {
  const isRestricted = Boolean(allowedColorIds && allowedColorIds.length > 0);
  const allowedSet = useMemo(() => new Set(allowedColorIds ?? []), [allowedColorIds]);
  const q = debouncedSearch.trim().toLowerCase();

  // --- Müşteriye ATANMIŞ renkler. `assignedTo` colors endpoint'inden (property:read)
  //     gelir — eski alias endpoint'i customer-alias:read gerektiriyordu, o izni
  //     olmayan satışçı müşterinin özel rengini hiç seçemiyordu. customerId varsa
  //     modal kapalıyken de çek (queryKey paylaşımlı → trigger rozeti için). ---
  const pinnedQ = useQuery({
    queryKey: ["color-picker", "pinned", customerId],
    queryFn: () => loadAssignedColorsForCustomer(customerId as string),
    enabled: Boolean(customerId),
    staleTime: 60_000,
  });

  // --- Kısıtlı mod: izinli küme küçük → tek seferde çek, client filtrele.
  //     scope=public → başka müşterilere atanmış renkler dışlanır (atanmış
  //     renkler yalnızca pinned bölümünden, ilgili müşteriye gelir). ---
  const restrictedQ = useQuery({
    queryKey: ["color-picker", "restricted-public"],
    queryFn: () => loadPublicColorsForPicker(),
    enabled: open && isRestricted,
    staleTime: 60_000,
  });

  // --- Sınırsız mod: sunucu cursor araması (debounced). scope=public →
  //     müşteriye özel renkler "Tüm Renkler"de görünmez. ---
  const listQ = useInfiniteQuery({
    queryKey: ["color-picker", "search", debouncedSearch],
    queryFn: ({ pageParam }) =>
      listPublicColorsCursor({
        cursor: pageParam,
        limit: PAGE_LIMIT,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
        ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.pagination.nextCursor ?? undefined,
    enabled: open && !isRestricted,
    staleTime: 30_000,
  });

  // Atanmış (assigned=true + aktif) renklerin tam haritası — arama/restrict
  // filtresi YOK. Backend zaten assigned=true + isActive süzüyor.
  const assignedById = useMemo(() => {
    const map = new Map<string, PickerColor>();
    for (const c of pinnedQ.data ?? []) {
      if (c.isActive) {
        map.set(c.id, { id: c.id, code: c.code, name: c.name, hex: c.hex });
      }
    }
    return map;
  }, [pinnedQ.data]);

  // Görünür pinned bölüm: arama + (kısıtlı modda) izinli kümeyle kesişim.
  const pinned = useMemo(() => {
    let arr = [...assignedById.values()];
    if (isRestricted) arr = arr.filter((c) => allowedSet.has(c.id));
    return arr.filter((c) => matchesSearch(c, q));
  }, [assignedById, isRestricted, allowedSet, q]);

  // "Tüm renkler" — atanmışları çıkar (sadece pinned'de görünsünler).
  const listColors = useMemo<PickerColor[]>(() => {
    if (isRestricted) {
      return (restrictedQ.data?.data ?? [])
        .filter((c) => allowedSet.has(c.id))
        .filter((c) => !assignedById.has(c.id))
        .map(toPickerColor)
        .filter((c) => matchesSearch(c, q));
    }
    return (listQ.data?.pages ?? [])
      .flatMap((p) => p.data)
      .filter((c) => !assignedById.has(c.id))
      .map(toPickerColor);
  }, [isRestricted, restrictedQ.data, listQ.data, allowedSet, assignedById, q]);

  return {
    isRestricted,
    allowedSet,
    pinned,
    assignedById,
    listColors,
    isLoading: isRestricted ? restrictedQ.isLoading : listQ.isLoading,
    isPinnedLoading: Boolean(customerId) && pinnedQ.isLoading,
    hasMore: !isRestricted && Boolean(listQ.hasNextPage),
    fetchNext: () => listQ.fetchNextPage(),
    isFetchingNext: listQ.isFetchingNextPage,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function toPickerColor(c: {
  id: string;
  code: string;
  name: string;
  hex: string | null;
}): PickerColor {
  return { id: c.id, code: c.code, name: c.name, hex: c.hex };
}

function matchesSearch(c: PickerColor, q: string): boolean {
  if (!q) return true;
  return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
}
