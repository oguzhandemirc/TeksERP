import { useMemo, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScanField } from "@/components/scanner/ScanField";
import { classifyBarcode } from "@/lib/scanner/barcode-kind";
import { useScanSeed } from "@/hooks/useScanSeed";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { sackHubService } from "./service";
import { SackFilters } from "./SackFilters";
import { SackListRow } from "./SackListRow";
import { SelectionActionBar } from "./SelectionActionBar";
import { RollLocateCard } from "./RollLocateCard";
import { PickListPrintDialog } from "./PickListPrintDialog";
import { CreateShipmentDialog } from "./CreateShipmentDialog";
import { isWarehouseSack, type LocatedRoll, type SackSearchParams, type SackSearchRow } from "./types";

const PAGE_SIZE = 30;

interface Props {
  onEditSack: (sack: SackSearchRow) => void;
}

/**
 * Çuval listesi (ana görünüm) — filtre + arama + çoklu seçim → sevkiyat. Depodaki
 * çuvallar seçilebilir/düzenlenebilir; sevkteki çuvallar salt görüntülenir.
 */
export function SacksListView({ onEditSack }: Props) {
  const [filters, setFilters] = useState<SackSearchParams>({ scope: "POOL" });
  const debounced = useDebouncedValue(filters, 300);
  const [barcode, setBarcode] = useState("");
  const [located, setLocated] = useState<LocatedRoll | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickListIds, setPickListIds] = useState<string[] | null>(null);
  const [shipSacks, setShipSacks] = useState<SackSearchRow[] | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["sack-search", debounced],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => sackHubService.search({ ...debounced, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : undefined),
    staleTime: 30_000,
  });
  const sacks = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  const selectedRows = useMemo(() => sacks.filter((s) => selectedIds.has(s.id)), [sacks, selectedIds]);
  const warehouseVisible = useMemo(() => sacks.filter(isWarehouseSack), [sacks]);
  const allVisibleSelected = warehouseVisible.length > 0 && warehouseVisible.every((s) => selectedIds.has(s.id));

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSelectVisible = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) warehouseVisible.forEach((s) => next.delete(s.id));
      else warehouseVisible.forEach((s) => next.add(s.id));
      return next;
    });

  // Barkod okut — top: nerede?; çuval kodu (CV-): filtreye uygula.
  const locate = useMutation({
    mutationFn: (code: string) => sackHubService.locateRoll(code),
    onSuccess: (res) => setLocated(res.data),
    onError: () => setLocated(null),
  });
  const handleScan = (code: string) => {
    if (classifyBarcode(code).kind === "SACK") {
      setFilters((f) => ({ ...f, sackCode: code }));
      setBarcode("");
      toast.info(`Çuval kodu filtreye uygulandı: ${code}`);
      return;
    }
    locate.mutate(code);
  };

  // Scan-anywhere yönlendirmeleri (eski Çuval Arama + Paketleme hedefleri birleşti).
  useScanSeed("scanCode", (code) => { setBarcode(code); handleScan(code); });
  useScanSeed("focusBarcode", (code) => { setBarcode(code); handleScan(code); });
  useScanSeed("scanCodeDispatched", (code) => {
    setFilters((f) => ({ ...f, sackCode: code, scope: "DISPATCHED" }));
    toast.info(`Sevk edilmiş çuval filtreye uygulandı: ${code}`);
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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

      <SackFilters filters={filters} onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))} />

      {located && <RollLocateCard roll={located} onClear={() => setLocated(null)} />}

      <div className="flex items-center justify-between gap-2 border-b bg-muted/20 px-6 py-2 text-xs">
        <span className="text-muted-foreground">
          {sacks.length} çuval{query.hasNextPage ? "+" : ""} · depodaki çuvalları seç → sevk kur ya da tıkla → düzenle
        </span>
        {warehouseVisible.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={toggleSelectVisible}>
            {allVisibleSelected ? "Görünen seçimini kaldır" : "Görünen depo çuvallarını seç"}
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
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
                <SackListRow
                  key={s.id}
                  sack={s}
                  selected={selectedIds.has(s.id)}
                  onToggleSelect={toggleSelect}
                  onEdit={onEditSack}
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
                    <ChevronDown className="h-4 w-4" /> Daha Fazla Yükle
                  </>
                ) : (
                  "Liste sonu"
                )}
              </Button>
            </div>
          </>
        )}
      </div>

      <SelectionActionBar
        selected={selectedRows}
        onShip={() => setShipSacks(selectedRows)}
        onPickList={() => setPickListIds(selectedRows.map((s) => s.id))}
        onClear={() => setSelectedIds(new Set())}
      />

      <PickListPrintDialog sackIds={pickListIds} onOpenChange={(o) => !o && setPickListIds(null)} />
      <CreateShipmentDialog
        sacks={shipSacks}
        onOpenChange={(o) => !o && setShipSacks(null)}
        onCreated={() => {
          setShipSacks(null);
          setSelectedIds(new Set());
        }}
      />
    </div>
  );
}
