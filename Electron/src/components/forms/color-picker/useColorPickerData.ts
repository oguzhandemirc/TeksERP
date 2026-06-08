import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { colorService } from "@/pages/Colors/service";
import { loadAllForPicker } from "@/lib/picker-loader";
import { customerAliasService } from "@/pages/Customers/aliasService";
import { useRoleAccess } from "@/hooks/useRoleAccess";

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
 *  - `pinned`     → müşteriye atanmış aktif renkler (üstte, vurgulu)
 *  - `listColors` → "tüm renkler" (kısıtlı: client filtre / sınırsız: sunucu
 *                    cursor araması), atanmışlar dedupe edilir
 *  - `assignedById` → seçili rengin müşteri rengi olup olmadığını çözmek için
 *                     (arama/sayfalamadan bağımsız tam küme)
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

  // Pinned, müşteri alias endpoint'ini okur (customer-alias:read). İzni olmayan
  // kullanıcılar için sessizce kapat — 403 toast'ı yerine pinning'siz çalışsın.
  const { hasPermission } = useRoleAccess();
  const canReadAliases = hasPermission("customer-alias:read");

  // --- Müşterinin atanmış renkleri. customerId varsa modal kapalıyken de çek
  //     (queryKey paylaşımlı → tüm satırlar tek istekte dedupe; trigger rozeti
  //     için gerekli). ---
  const pinnedQ = useQuery({
    queryKey: ["color-picker", "pinned", customerId],
    queryFn: () => customerAliasService.listColorAliases(customerId as string),
    enabled: Boolean(customerId) && canReadAliases,
    staleTime: 60_000,
  });

  // --- Kısıtlı mod: izinli küme küçük → tek seferde çek, client filtrele. ---
  const restrictedQ = useQuery({
    queryKey: ["color-picker", "restricted-all"],
    queryFn: () => loadAllForPicker(colorService),
    enabled: open && isRestricted,
    staleTime: 60_000,
  });

  // --- Sınırsız mod: sunucu cursor araması (debounced). ---
  const listQ = useInfiniteQuery({
    queryKey: ["color-picker", "search", debouncedSearch],
    queryFn: ({ pageParam }) =>
      colorService.listCursor({
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

  // Atanmış (aktif) renklerin tam haritası — arama/restrict filtresi YOK.
  const assignedById = useMemo(() => {
    const map = new Map<string, PickerColor>();
    for (const r of pinnedQ.data?.data ?? []) {
      const col = r.color;
      if (col?.isActive) {
        map.set(r.colorId, {
          id: r.colorId,
          code: col.code,
          name: col.name,
          hex: col.hex,
        });
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
