// =============================================================================
// İPLİK LOTLARI — "Lotlar" sekmesi (devere Faz 2): liste (türetilen bakiye) · elle aç · pasife al
// =============================================================================
// Lot DURUM kaydıdır, bakiyesi hareketlerden türetilir (sunucu). Silme yok — pasife alma.
// Süzme sunucuda (kalem · arama · aktiflik · kalite CSV), cursor'lu; izin: liste `warehouse:read`, yazma `yarn:write`,
// kalite geçişi `quality:write` (rozet + satır menüsü: `YarnLotQualityMenu`).
// =============================================================================
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PermissionGate } from "@/components/PermissionGate";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";
import { useEmanetEnabled } from "@/hooks/usePricingEnabled";
import { LabeledSelect } from "@/components/forms/LabeledSelect";
import { YARN_ITEM_FILTER } from "./YarnFilterBar";
import { YarnLotQualityMenu } from "./YarnLotQualityMenu";
import { lotQualityOf, qualityFilterParam, YARN_LOT_QUALITY, YARN_LOT_QUALITY_FILTER_ALL, YARN_LOT_QUALITY_FILTER_OPTIONS } from "./yarnLotQuality";
import { createYarnLot, listYarnLots, updateYarnLot, type YarnLotRow } from "./service";
import { kg } from "./qty";

const LOTS_KEY = ["yarn", "lots"] as const;

export function YarnLotsPanel() {
  const qc = useQueryClient();
  const [itemId, setItemId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showPassive, setShowPassive] = useState(false);
  const [quality, setQuality] = useState(YARN_LOT_QUALITY_FILTER_ALL);
  const [creating, setCreating] = useState(false);
  const q = useInfiniteQuery({
    queryKey: [...LOTS_KEY, itemId, search, showPassive, quality],
    queryFn: ({ pageParam }) => listYarnLots({ limit: 50, cursor: pageParam, itemId: itemId ?? undefined, search: search || undefined, isActive: showPassive ? undefined : true, qualityStatus: qualityFilterParam(quality) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const invalidate = () => void qc.invalidateQueries({ queryKey: LOTS_KEY });
  const toggle = useMutation({
    mutationFn: (r: YarnLotRow) => updateYarnLot(r.id, { isActive: !r.isActive }),
    onSuccess: (res) => {
      toast.success(res.data.isActive ? `"${res.data.lotNo}" lotu aktif` : `"${res.data.lotNo}" lotu pasife alındı — yeni giriş yazılamaz, hareketleri durur`);
      invalidate();
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-72">
          <ReferenceSelect<Item> value={itemId} onChange={setItemId} service={itemService} queryKey="items-yarn-lots" getLabel={(it) => `${it.code} — ${it.name}`} placeholder="İplik (hepsi)" extraFilters={YARN_ITEM_FILTER} />
        </div>
        <Input className="w-56" placeholder="Lot no / kalem ara" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Lot ara" />
        <LabeledSelect label="Kalite" value={quality} options={YARN_LOT_QUALITY_FILTER_OPTIONS} onChange={setQuality} />
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={showPassive} onChange={(e) => setShowPassive(e.target.checked)} /> Pasifleri de göster
        </label>
        <PermissionGate permission="yarn:write">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> Lot Aç
          </Button>
        </PermissionGate>
      </div>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">Lot listesi yüklenemedi.</p>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">Lot yok — lotlar mal kabulde iplik satırına lot numarası yazılınca kendiliğinden doğar; elle de açılabilir.</div>
      ) : (
        <LotTable rows={rows} onToggle={(r) => toggle.mutate(r)} busy={toggle.isPending} onDone={invalidate} />
      )}
      {q.hasNextPage && (
        <Button variant="outline" size="sm" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          Daha fazla
        </Button>
      )}
      {creating && <CreateLotDialog defaultItemId={itemId} onClose={() => setCreating(false)} onDone={invalidate} />}
    </div>
  );
}

function LotTable({ rows, onToggle, busy, onDone }: { rows: YarnLotRow[]; onToggle: (r: YarnLotRow) => void; busy: boolean; onDone: () => void }) {
  return (
        <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-2 text-left">Lot</th>
            <th className="p-2 text-left">İplik</th>
            <th className="p-2 text-left">Tedarikçi</th>
            <th className="p-2 text-right">Bakiye (kg)</th>
            <th className="p-2 text-left">Durum</th>
            <th className="p-2 text-left">Kalite</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-t ${r.isActive ? "" : "opacity-60"}`}>
              <td className="p-2 font-mono">{r.lotNo}</td>
              <td className="p-2">
                {r.item.name} <span className="font-mono text-xs text-muted-foreground">{r.item.code}</span>
              </td>
              <td className="p-2">
                {r.supplier?.name ?? <span className="text-muted-foreground">—</span>}
                {r.ownerCustomer && <div className="text-xs text-amber-700">Emanet: {r.ownerCustomer.name}</div>}
              </td>
              {/* Türetilen bakiye — sunucu Σ hareket; eksi görünüyorsa mutabakat §41 kırmızıdır. */}
              <td className="p-2 text-right tabular-nums">{kg(r.balanceKg)}</td>
              <td className="p-2">{r.isActive ? <Badge variant="outline">Aktif</Badge> : <Badge variant="secondary">Pasif</Badge>}</td>
              <td className="p-2">
                <Badge variant="outline" className={YARN_LOT_QUALITY[lotQualityOf(r)].cls} title={r.qualityNote ?? undefined}>{YARN_LOT_QUALITY[lotQualityOf(r)].label}</Badge>
                {(r.qualityNote || r.qualityDecidedAt) && (
                  <div className="max-w-[16rem] truncate text-xs text-muted-foreground" title={r.qualityNote ?? undefined}>
                    {r.qualityDecidedAt ? new Date(r.qualityDecidedAt).toLocaleDateString("tr-TR") : null}{r.qualityDecidedAt && r.qualityNote ? " · " : ""}{r.qualityNote}
                  </div>
                )}
              </td>
              <td className="p-2 text-right">
                <YarnLotQualityMenu row={r} onDone={onDone} />
                <PermissionGate permission="yarn:write">
                  <Button size="sm" variant="ghost" onClick={() => onToggle(r)} disabled={busy}>
                    {r.isActive ? "Pasife al" : "Aktifleştir"}
                  </Button>
                </PermissionGate>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
