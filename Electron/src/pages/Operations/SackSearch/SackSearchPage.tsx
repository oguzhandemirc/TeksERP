import { useMemo, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { ChevronDown, PackageSearch, ScanLine } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { sackSearchService } from "./service";
import { SearchFilters } from "./SearchFilters";
import { SackResultCard } from "./SackResultCard";
import { RollLocateCard } from "./RollLocateCard";
import type { LocatedRoll, SackSearchParams } from "./types";

const QUERY_KEY = "sack-search";
const PAGE_SIZE = 30;

/**
 * Çuval/Top Arama (saha #1+#23) — üç soruya tek ekran:
 * ürün→hangi çuvallarda ne kadar, çuval→içinde ne var, top→hangi çuvalda.
 */
export function SackSearchPage() {
  const [filters, setFilters] = useState<SackSearchParams>({});
  const debounced = useDebouncedValue(filters, 300);
  const [barcode, setBarcode] = useState("");
  const [located, setLocated] = useState<LocatedRoll | null>(null);

  const query = useInfiniteQuery({
    queryKey: [QUERY_KEY, debounced],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      sackSearchService.search({ ...debounced, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : undefined),
    staleTime: 30_000,
  });

  const sacks = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  // Top bul — 404 toast'ı apiClient interceptor'dan gelir, onError sadece temizler.
  const locate = useMutation({
    mutationFn: (code: string) => sackSearchService.locateRoll(code),
    onSuccess: (res) => setLocated(res.data),
    onError: () => setLocated(null),
  });

  const submitBarcode = () => {
    const code = barcode.trim();
    if (code) locate.mutate(code);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Çuval & Top Arama"
        description="Hangi üründen hangi çuvalda ne kadar var, çuvalda ne var, top hangi çuvalda — filtrele ya da barkod okut."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />

      {/* Top bul — barkod okutma/yapıştırma */}
      <div className="flex items-center gap-2 border-b px-6 py-3">
        <div className="relative max-w-sm flex-1">
          <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitBarcode()}
            placeholder="Top barkodu okut/yaz → nerede?"
            className="pl-8"
          />
        </div>
        <Button size="sm" onClick={submitBarcode} disabled={!barcode.trim() || locate.isPending}>
          {locate.isPending ? "Aranıyor…" : "Topu Bul"}
        </Button>
      </div>

      <SearchFilters
        filters={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
      />

      {located && <RollLocateCard roll={located} onClear={() => setLocated(null)} />}

      <div className="flex-1 overflow-auto p-6">
        {query.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : sacks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <PackageSearch className="h-8 w-8 opacity-50" />
            <p className="text-sm">Filtrelerle eşleşen çuval yok.</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {sacks.map((s) => (
                <SackResultCard key={s.id} sack={s} />
              ))}
            </div>
            <div className="flex justify-center p-6">
              <Button
                variant="outline"
                size="sm"
                disabled={!query.hasNextPage || query.isFetchingNextPage}
                onClick={() => query.fetchNextPage()}
                className="gap-2"
              >
                {query.isFetchingNextPage ? (
                  "Yükleniyor..."
                ) : query.hasNextPage ? (
                  <>
                    <ChevronDown className="h-4 w-4" />
                    Daha Fazla Yükle
                  </>
                ) : (
                  "Liste sonu"
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
