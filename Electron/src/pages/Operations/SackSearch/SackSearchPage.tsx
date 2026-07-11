import { useMemo, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { ChevronDown, ClipboardList, PackageSearch, Truck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScanField } from "@/components/scanner/ScanField";
import { classifyBarcode } from "@/lib/scanner/barcode-kind";
import { useScanSeed } from "@/hooks/useScanSeed";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { sackSearchService } from "./service";
import { SearchFilters } from "./SearchFilters";
import { SackResultCard } from "./SackResultCard";
import { RollLocateCard } from "./RollLocateCard";
import { PickListPrintDialog } from "./PickListPrintDialog";
import { CreateShipmentFromSacksDialog } from "./CreateShipmentFromSacksDialog";
import { sackDisplayState, type LocatedRoll, type SackSearchParams } from "./types";

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
  // Çeki listesi seçimi — filtre değişse de KORUNUR: senaryo "gri Patos'u seç,
  // sonra mavi Mitos'u filtreleyip ekle" (müşterinin karışık talebi tek kağıtta).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickListIds, setPickListIds] = useState<string[] | null>(null);
  const [createIds, setCreateIds] = useState<string[] | null>(null);

  const query = useInfiniteQuery({
    queryKey: [QUERY_KEY, debounced],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      sackSearchService.search({ ...debounced, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : undefined),
    staleTime: 30_000,
  });

  const sacks = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  // Seçili çuvallardan sevkiyat kurulabilir mi: hepsi HAVUZDA-mühürlü (POOL) + tek müşteri.
  const selectedSacks = useMemo(() => sacks.filter((s) => selectedIds.has(s.id)), [sacks, selectedIds]);
  const shipmentEligible = useMemo(() => {
    if (selectedSacks.length === 0) return false;
    const allPool = selectedSacks.every((s) => sackDisplayState(s) === "POOL");
    const customers = new Set(selectedSacks.map((s) => s.customer?.id ?? "_"));
    return allPool && customers.size === 1;
  }, [selectedSacks]);

  const toggleSelect = (sackId: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sackId)) next.delete(sackId);
      else next.add(sackId);
      return next;
    });
  const visibleAllSelected = sacks.length > 0 && sacks.every((s) => selectedIds.has(s.id));
  const toggleSelectVisible = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (visibleAllSelected) sacks.forEach((s) => next.delete(s.id));
      else sacks.forEach((s) => next.add(s.id));
      return next;
    });

  // Top bul — 404 toast'ı apiClient interceptor'dan gelir, onError sadece temizler.
  const locate = useMutation({
    mutationFn: (code: string) => sackSearchService.locateRoll(code),
    onSuccess: (res) => setLocated(res.data),
    onError: () => setLocated(null),
  });

  // Top barkodu → "nerede?"; çuval kodu (CV-) → çuval filtresine yönlendir.
  const handleScan = (code: string) => {
    if (classifyBarcode(code).kind === "SACK") {
      setFilters((f) => ({ ...f, sackCode: code }));
      setBarcode("");
      toast.info(`Çuval kodu filtreye uygulandı: ${code}`);
      return;
    }
    locate.mutate(code);
  };

  // "Her yerde okut" → bu sekmeye yönlendirme (top: nerede; çuval: filtre).
  useScanSeed("scanCode", (code) => {
    setBarcode(code);
    handleScan(code);
  });

  // Sevk edilmiş çuval yönlendirmesi (scan-anywhere): kod tür fark etmeksizin
  // çuval filtresine yazılır + "sevk edilmişleri de ara" açılır — yoksa
  // varsayılan kapsam DISPATCHED'ı gizler, operatör boş liste görürdü.
  useScanSeed("scanCodeDispatched", (code) => {
    setFilters((f) => ({ ...f, sackCode: code, scope: "DISPATCHED" }));
    toast.info(`Sevk edilmiş çuval filtreye uygulandı: ${code}`);
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Çuval & Top Arama"
        description="Hangi üründen hangi çuvalda ne kadar var, çuvalda ne var, top hangi çuvalda — filtrele ya da barkod okut."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />

      {/* Top bul — barkod okutma/yapıştırma (CV- çuval kodu filtreye yönlenir) */}
      <ScanField
        className="border-b px-6 py-3"
        value={barcode}
        onChange={setBarcode}
        onScan={handleScan}
        placeholder="Top barkodu okut/yaz → nerede? (çuval kodu → filtre)"
        expectPrefix={["ROLL", "SACK"]}
        submitLabel="Topu Bul"
        busy={locate.isPending}
        busyLabel="Aranıyor…"
      />

      <SearchFilters filters={filters} onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))} />

      {located && <RollLocateCard roll={located} onClear={() => setLocated(null)} />}

      {/* Çeki listesi araç çubuğu — seçim varken veya liste doluyken görünür */}
      {(sacks.length > 0 || selectedIds.size > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-6 py-2">
          <Button variant="outline" size="sm" onClick={toggleSelectVisible} disabled={sacks.length === 0}>
            {visibleAllSelected ? "Görünenlerin seçimini kaldır" : "Görünenleri seç"}
          </Button>
          {selectedIds.size > 0 && (
            <>
              <Button
                size="sm"
                disabled={!shipmentEligible}
                onClick={() => setCreateIds(selectedSacks.map((s) => s.id))}
                title={
                  shipmentEligible
                    ? undefined
                    : "Sevkiyat için: hepsi HAVUZDA-mühürlü + tek müşteri olmalı"
                }
              >
                <Truck className="mr-1 h-4 w-4" />
                Sevkiyat Oluştur ({selectedSacks.length})
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPickListIds([...selectedIds])}>
                <ClipboardList className="mr-1 h-4 w-4" />
                Çeki Listesi Bas ({selectedIds.size})
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                Seçimi temizle
              </Button>
            </>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            Havuzdaki mühürlü çuvalları seç → sevkiyat kur; ya da çeki listesi bas.
          </span>
        </div>
      )}

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
                <SackResultCard
                  key={s.id}
                  sack={s}
                  selected={selectedIds.has(s.id)}
                  onToggleSelect={toggleSelect}
                />
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

      <PickListPrintDialog sackIds={pickListIds} onOpenChange={(o) => !o && setPickListIds(null)} />
      <CreateShipmentFromSacksDialog
        sackIds={createIds}
        onOpenChange={(o) => !o && setCreateIds(null)}
        onCreated={() => setSelectedIds(new Set())}
      />
    </div>
  );
}
