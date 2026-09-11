import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { swatchService, type KartelaStockReduction } from "./swatchService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId?: string;
  colorId?: string;
}

const DATE_FMT = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" });

/**
 * Kartela stok düşüm geçmişi. Geri alma düşümü silmez: düşüm satırı kalır, üstüne
 * ters damga yazılır ve kalemlerdeki kartelalar stoğa döner. Geri alınamayan
 * düşümün gerekçesi (kartelası sevkiyatta / kabulü iptal) satırda listelenir.
 */
export function KartelaReductionHistoryDialog({ open, onOpenChange, itemId, colorId }: Props) {
  const query = useQuery({
    queryKey: ["kartela", "stock-reductions", itemId, colorId],
    queryFn: () => swatchService.listStockReductions({ itemId, colorId }),
    enabled: open,
  });
  const rows = query.data?.data ?? [];

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
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {query.isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Yükleniyor…</div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Düşüm kaydı yok.</div>
          ) : (
            rows.map((r) => <ReductionRow key={r.id} row={r} />)
          )}
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
      {!row.reversedAt && row.blockingReasons.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-destructive">
          {row.blockingReasons.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {!row.reversedAt && row.cardNumbers.length === 0 && (
        <div className="text-xs text-muted-foreground">
          Kalem dökümü yok (eski düşüm) — geri alınamaz.
        </div>
      )}
      {confirming && <ReverseConfirm row={row} onClose={() => setConfirming(false)} />}
    </div>
  );
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
      void qc.invalidateQueries({ queryKey: ["kartela", "stock"] });
      void qc.invalidateQueries({ queryKey: ["kartela", "stock-reductions"] });
    },
  });

  return (
    <div className="flex items-center gap-2 pt-1">
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
  );
}
