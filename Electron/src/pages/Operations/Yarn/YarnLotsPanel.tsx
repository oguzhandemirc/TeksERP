// =============================================================================
// İPLİK LOTLARI — "Lotlar" sekmesi (devere Faz 2): liste (türetilen bakiye) · elle aç · pasife al
// =============================================================================
// Lot DURUM kaydıdır, bakiyesi hareketlerden türetilir (sunucu). Silme yok — pasife alma.
// Süzme sunucuda (kalem · arama · aktiflik · kalite CSV), cursor'lu; izin: liste `warehouse:read`, yazma `yarn:write`,
// kalite geçişi `quality:write` (rozet + satır menüsü: `YarnLotQualityMenu`).
// =============================================================================
import { useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { ToolbarToggle } from "@/components/data-table/ToolbarToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";
import { useEmanetEnabled } from "@/hooks/usePricingEnabled";
import { YARN_ITEM_FILTER } from "./YarnFilterBar";
import { useYarnLotTable } from "./YarnLotTable";
import { qualityFilterParam, YARN_LOT_QUALITY_FILTER_ALL, YARN_LOT_QUALITY_FILTER_OPTIONS } from "./yarnLotQuality";
import { createYarnLot, listYarnLots, updateYarnLot, type YarnLotRow } from "./service";
import { ListFooter, ListToolbar } from "@/components/layout/ListPage";

const LOTS_KEY = ["yarn", "lots"] as const;

/** "Lot Aç" sayfa başlığındadır (ikinci birincil düğme filtre satırında durmaz); panel yalnız diyaloğu çizer. */
export function YarnLotsPanel({ creating = false, onCreatingChange = () => {} }: { creating?: boolean; onCreatingChange?: (open: boolean) => void } = {}) {
  const qc = useQueryClient();
  const [itemId, setItemId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showPassive, setShowPassive] = useState(false);
  const [quality, setQuality] = useState(YARN_LOT_QUALITY_FILTER_ALL);
  const q = useInfiniteQuery({
    queryKey: [...LOTS_KEY, itemId, search, showPassive, quality],
    queryFn: ({ pageParam }) => listYarnLots({ limit: 50, cursor: pageParam, itemId: itemId ?? undefined, search: search || undefined, isActive: showPassive ? undefined : true, qualityStatus: qualityFilterParam(quality) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor ?? undefined,
  });
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const invalidate = () => void qc.invalidateQueries({ queryKey: LOTS_KEY });
  const toggle = useMutation({
    mutationFn: (r: YarnLotRow) => updateYarnLot(r.id, { isActive: !r.isActive }),
    onSuccess: (res) => {
      toast.success(res.data.isActive ? `"${res.data.lotNo}" lotu aktif` : `"${res.data.lotNo}" lotu pasife alındı — yeni giriş yazılamaz, hareketleri durur`);
      invalidate();
    },
  });
  const table = useYarnLotTable(rows, { onToggle: (r) => toggle.mutate(r), busy: toggle.isPending, onDone: invalidate });

  return (
    <>
      <ListToolbar className="flex-row flex-wrap items-center">
        <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Lot no ya da kalem ara" />
        <div className="w-56 [&_button]:h-8 [&_button]:text-xs">
          <ReferenceSelect<Item> value={itemId} onChange={setItemId} service={itemService} queryKey="items-yarn-lots" getLabel={(it) => `${it.code} — ${it.name}`} placeholder="İplik (hepsi)" extraFilters={YARN_ITEM_FILTER} />
        </div>
        <SelectChip
          id="yarn-lot-quality"
          label="Kalite"
          value={quality === YARN_LOT_QUALITY_FILTER_ALL ? null : quality}
          options={YARN_LOT_QUALITY_FILTER_OPTIONS.filter((o) => o.value !== YARN_LOT_QUALITY_FILTER_ALL)}
          onChange={(v) => setQuality(v ?? YARN_LOT_QUALITY_FILTER_ALL)}
        />
        <ToolbarToggle checked={showPassive} onCheckedChange={setShowPassive} label="Pasifleri de göster" />
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="İplik lotları" />
        </div>
      </ListToolbar>
      <DataTable
        table={table}
        rowClassName={(r) => (r.isActive ? undefined : "opacity-60")}
        exportName="İplik lotları"
        isLoading={q.isLoading}
        isError={q.isError}
        errorText="Lot listesi yüklenemedi."
        onRetry={() => void q.refetch()}
        emptyText="Lot yok."
        emptyDescription="Lotlar mal kabulde iplik satırına lot numarası yazılınca kendiliğinden doğar; elle de açılabilir."
        loadMore={{ hasMore: Boolean(q.hasNextPage), isFetchingMore: q.isFetchingNextPage, onLoadMore: () => q.fetchNextPage() }}
      />
      <ListFooter loaded={rows.length} hasMore={rows.length > 0 ? Boolean(q.hasNextPage) : undefined} isFetchingMore={q.isFetchingNextPage} />
      {creating && <CreateLotDialog defaultItemId={itemId} onClose={() => onCreatingChange(false)} onDone={invalidate} />}
    </>
  );
}

function CreateLotDialog({ defaultItemId, onClose, onDone }: { defaultItemId: string | null; onClose: () => void; onDone: () => void }) {
  const [itemId, setItemId] = useState<string | null>(defaultItemId);
  const [lotNo, setLotNo] = useState("");
  const [notes, setNotes] = useState("");
  // G3 emanet: sahip yalnız modül açıkken sorulur; kapalıyken alan gövdeye GİRMEZ (bayt bayt eski).
  const emanet = useEmanetEnabled();
  const [ownerCustomerId, setOwnerCustomerId] = useState<string | null>(null);
  const m = useMutation({
    // `lotNo` irsaliye metni olduğu gibi — TRIM sunucuda da yapılır, normalize edilmez.
    mutationFn: () => createYarnLot({ itemId: itemId!, lotNo: lotNo.trim(), notes: notes.trim() || null, ...(emanet && ownerCustomerId ? { ownerCustomerId } : {}) }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Lot açıldı");
      onDone();
      onClose();
    },
  });
  const ok = !!itemId && lotNo.trim().length > 0 && lotNo.trim().length <= 64;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lot aç</DialogTitle>
          <DialogDescription>Lot numarası irsaliyedeki gibi yazılır (ayrıştırılmaz); aynı iplikte aynı numara ikinci kez açılamaz. Tedarikçi mal kabulde kendiliğinden bağlanır.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ReferenceSelect<Item> value={itemId} onChange={setItemId} service={itemService} queryKey="items-yarn-lot-create" getLabel={(it) => `${it.code} — ${it.name}`} placeholder="İplik seç" extraFilters={YARN_ITEM_FILTER} />
          <Input placeholder="Lot no (ör. YAN 1029-K)" maxLength={64} value={lotNo} onChange={(e) => setLotNo(e.target.value)} aria-label="Lot numarası" />
          <Input placeholder="Not (isteğe bağlı)" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {emanet && (
            <ReferenceSelect<Customer> value={ownerCustomerId} onChange={setOwnerCustomerId} service={customerService} queryKey="customers-yarn-lot-owner" getLabel={(c) => c.name} placeholder="Sahibi (emanet iplikse müşteri) — boş: bizim iplik" nullable noneLabel="Bizim iplik" />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={m.isPending}>
            Vazgeç
          </Button>
          <Button onClick={() => m.mutate()} disabled={!ok || m.isPending}>
            Aç
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
