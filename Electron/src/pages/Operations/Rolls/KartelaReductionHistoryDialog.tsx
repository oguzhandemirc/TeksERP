import { useState } from "react";
import axios from "axios";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PermissionGate } from "@/components/PermissionGate";
import { AutoLoadMore } from "@/components/data-table/AutoLoadMore";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { swatchService, type KartelaStockReduction } from "./swatchService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId?: string;
  colorId?: string;
}

const DATE_FMT = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" });
const PAGE_SIZE = 30;
const REDUCTIONS_KEY = ["kartela", "stock-reductions"] as const;

/**
 * Kartela stok düşüm geçmişi. Geri alma düşümü silmez: düşüm satırı kalır, üstüne
 * ters damga yazılır ve kalemlerdeki kartelalar stoğa döner. Geri alınamayan
 * düşümün gerekçesi (kalemsiz / sevkiyatta / kabulü iptal) satırda listelenir.
 */
export function KartelaReductionHistoryDialog({ open, onOpenChange, itemId, colorId }: Props) {
  const q = useInfiniteQuery({
    queryKey: [...REDUCTIONS_KEY, itemId, colorId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      swatchService.listStockReductions({ itemId, colorId, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    enabled: open,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const { rootRef, sentinelRef } = useInfiniteScroll({
    hasMore: Boolean(q.hasNextPage),
    isLoading: q.isFetchingNextPage,
    onLoadMore: () => void q.fetchNextPage(),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Düşüm Geçmişi</DialogTitle>
          <DialogDescription>
            Elle yapılan kartela stok düşümleri. Geri alınan düşüm listede kalır; kartelalar
            stoğa döner.
          </DialogDescription>
        </DialogHeader>
        <div ref={rootRef} className="max-h-[60vh] space-y-2 overflow-y-auto">
          {q.isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Yükleniyor…</div>
          ) : q.isError && rows.length === 0 ? (
            // ⚠️ Satır VARSA liste silinmez (evin kalıbı `AccountsPage`): 3. sayfa
            // hatasında ekrandaki satırları ve kaydırma konumunu atmak hatadan
            // daha çok iş kaybettirir — uyarı şeridi üstte gösterilir.
            <div className="space-y-2 py-8 text-center text-sm text-destructive">
              <p>Düşüm geçmişi yüklenemedi.</p>
              <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
                Tekrar dene
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Düşüm kaydı yok.</div>
          ) : (
            <>
              {q.isError && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive">
                  <span>Sonraki sayfa yüklenemedi — liste olduğu gibi duruyor.</span>
                  <Button variant="outline" size="sm" className="h-7" onClick={() => void q.refetch()}>
                    Tekrar dene
                  </Button>
                </div>
              )}
              {rows.map((r) => (
                <ReductionRow key={r.id} row={r} />
              ))}
            </>
          )}
          <AutoLoadMore ref={sentinelRef} hasMore={Boolean(q.hasNextPage)} isFetchingMore={q.isFetchingNextPage} count={rows.length} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReductionRow({ row }: { row: KartelaStockReduction }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-1.5 rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 shrink-0 rounded-full border border-black/10"
          style={{ backgroundColor: row.color?.hex ?? "transparent" }}
        />
        <span className="min-w-0 flex-1 truncate font-medium">
          {row.item.name} · {row.color?.name ?? "Renksiz"}
        </span>
        <span className="shrink-0 tabular-nums font-semibold">−{row.count}</span>
        {row.reversedAt ? (
          <Badge variant="secondary">Geri alındı</Badge>
        ) : (
          <PermissionGate permission="kartela:write">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1"
              disabled={!row.reversible || confirming}
              onClick={() => setConfirming(true)}
            >
              <Undo2 className="h-3.5 w-3.5" /> Geri al
            </Button>
          </PermissionGate>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {DATE_FMT.format(new Date(row.createdAt))} · {row.createdBy ?? "—"} · {row.reason}
      </div>
      {row.cardNumbers.length > 0 && (
        <div className="text-xs text-muted-foreground">Kartelalar: {row.cardNumbers.join(", ")}</div>
      )}
      {row.reversedAt && (
        <div className="text-xs text-muted-foreground">
          Geri alma: {DATE_FMT.format(new Date(row.reversedAt))} · {row.reversedBy ?? "—"} ·{" "}
          {row.reverseReason}
        </div>
      )}
      {!row.reversedAt && <BlockingList reasons={row.blockingReasons} />}
      {confirming && <ReverseConfirm row={row} onClose={() => setConfirming(false)} />}
    </div>
  );
}

function BlockingList({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="list-disc pl-5 text-xs text-destructive">
      {reasons.map((b) => (
        <li key={b}>{b}</li>
      ))}
    </ul>
  );
}

/** 409 gövdesindeki `details.blocked` — backend engel dökümü (kart no + gerekçe). */
function blockedFromError(error: unknown): string[] {
  if (!axios.isAxiosError(error)) return [];
  const blocked = (error.response?.data as { details?: { blocked?: unknown } } | undefined)?.details?.blocked;
  return Array.isArray(blocked) ? blocked.filter((b): b is string => typeof b === "string") : [];
}

function ReverseConfirm({ row, onClose }: { row: KartelaStockReduction; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const reasonValid = reason.trim().length >= 3;

  const mut = useMutation({
    mutationFn: () => swatchService.reverseStockReduction(row.id, reason.trim()),
    onSuccess: (res) => {
      toast.success(res.message ?? "Düşüm geri alındı");
      onClose();
    },
    // Başarı da 409 da listeyi değiştirebilir (başka biri geri almış / kabul iptal) — ikisinde de tazele.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["kartela", "stock"] });
      void qc.invalidateQueries({ queryKey: REDUCTIONS_KEY });
    },
  });
  const blocked = mut.isError ? blockedFromError(mut.error) : [];

  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Geri alma gerekçesi…"
          className="h-8 text-xs"
        />
        <Button variant="ghost" size="sm" onClick={onClose} disabled={mut.isPending}>
          Vazgeç
        </Button>
        <Button size="sm" onClick={() => mut.mutate()} disabled={!reasonValid || mut.isPending}>
          {mut.isPending ? "Geri alınıyor…" : `${row.count} kartelayı stoğa döndür`}
        </Button>
      </div>
      <BlockingList reasons={blocked} />
    </div>
  );
}
