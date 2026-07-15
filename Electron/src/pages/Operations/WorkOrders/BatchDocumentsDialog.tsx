import { Printer, Truck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { safeFormat, formatNumber } from "@/lib/format";
import type { BatchLaneDispatch } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchNumber: string;
  /** Partinin aktif fason sevkleri — her biri yazdırılabilir irsaliye. */
  dispatches: BatchLaneDispatch[];
  /** Fason sevk irsaliyesi yazdırma (dispatchId). */
  onPrintDispatch: (dispatchId: string) => void;
}

/** Adım adından "(Fason)" ekini temizler — grup başlığı zaten adımın kendisidir. */
function stripFason(s: string): string {
  return s.replace(/\s*\(fason\)\s*$/i, "");
}

/**
 * Parti sevk belgeleri — İş Emri "Belgeler" modalının parti-ölçekli eşi. Bir partide
 * birden fazla fason sevk irsaliyesi olabilir; her FASON ADIMI kendi grubu olur
 * (Zımpara / Boyahane…), rota sırasına (stepSequence) dizilir. Satıra tıkla → yazdır.
 */
export function BatchDocumentsDialog({
  open,
  onOpenChange,
  batchNumber,
  dispatches,
  onPrintDispatch,
}: Props) {
  // Adıma göre grupla; grupları stepSequence'e (Zımpara→Boyahane), grup içini yeni→eski diz.
  const byStep = new Map<string, { seq: number; name: string; list: BatchLaneDispatch[] }>();
  for (const d of dispatches) {
    const name = stripFason(d.stepName ?? "—");
    const g = byStep.get(name) ?? { seq: d.stepSequence, name, list: [] };
    g.seq = Math.min(g.seq, d.stepSequence);
    g.list.push(d);
    byStep.set(name, g);
  }
  const groups = [...byStep.values()].sort((a, b) => a.seq - b.seq);
  for (const g of groups) g.list.sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Sevk Belgeleri</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{batchNumber}</span> partisinin fason sevk irsaliyeleri —
            her fason adımı ayrı grup.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(240px,1fr))] items-start gap-5 overflow-y-auto px-6 py-4">
          {groups.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-center text-xs italic text-muted-foreground">
              Bu partide fason sevk irsaliyesi yok.
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.name} className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.name} İrsaliyeleri ({g.list.length})
                </div>
                <ul className="space-y-1.5">
                  {g.list.map((d) => (
                    <li key={d.dispatchId}>
                      <button
                        type="button"
                        onClick={() => onPrintDispatch(d.dispatchId)}
                        className="flex w-full items-center gap-3 rounded-md border bg-background p-2.5 text-left hover:bg-muted/50"
                      >
                        <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-sm font-medium">{d.dispatchNo}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {d.subcontractorName}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-medium tabular-nums">
                            {formatNumber(d.totalQty, 0)} m
                          </div>
                          <div className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                            {safeFormat(d.dispatchedAt, "dd.MM.yyyy · HH:mm")}
                          </div>
                        </div>
                        <Printer className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
