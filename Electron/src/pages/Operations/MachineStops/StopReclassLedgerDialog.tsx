// =============================================================================
// DEĞİŞİKLİK DEFTERİ — `MachineStopReclass` (from→to · kim · ne zaman · gerekçe), salt okuma
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { machineStopService } from "./service";
import { LOSS_CLASS_META, formatDateTime, type MachineStop, type StopLossClass } from "./types";

interface Props {
  target: MachineStop;
  labelOf: (code: string | null) => string;
  onClose: () => void;
}

function Cls({ v }: { v: StopLossClass | null }) {
  return v ? <Badge className={LOSS_CLASS_META[v].badgeClass}>{LOSS_CLASS_META[v].label}</Badge> : <span className="text-muted-foreground">—</span>;
}

export function StopReclassLedgerDialog({ target, labelOf, onClose }: Props) {
  const q = useQuery({ queryKey: ["machine-stops", "reclasses", target.id], queryFn: () => machineStopService.reclasses(target.id) });
  const rows = q.data?.data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Değişiklik defteri — {target.machine.name} · {formatDateTime(target.startedAt)}</DialogTitle>
          <DialogDescription>
            Bugünkü karar: {labelOf(target.reasonCode)}
            {target.classifiedBy ? ` (${target.classifiedBy.fullName}, ${formatDateTime(target.classifiedAt)})` : ""}. Satırlar append-only; geri alma karşı kayıttır.
          </DialogDescription>
        </DialogHeader>
        {q.isError ? (
          <p className="text-destructive text-sm">Defter okunamadı — bu bir “değişiklik yok” cevabı DEĞİLDİR.</p>
        ) : q.isLoading ? (
          <p className="text-muted-foreground text-sm">Yükleniyor…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Yeniden sınıflandırma yok.</p>
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground font-mono text-xs">{formatDateTime(r.createdAt)}</span>
                  <span>{r.actedBy?.fullName ?? "—"}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <span>{labelOf(r.fromReasonCode)}</span>
                  <Cls v={r.fromLossClass} />
                  <span className="text-muted-foreground">→</span>
                  <span>{labelOf(r.toReasonCode)}</span>
                  <Cls v={r.toLossClass} />
                </span>
                {r.reason && <span className="text-muted-foreground text-xs">{r.reason}</span>}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
