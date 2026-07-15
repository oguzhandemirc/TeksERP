import { FileText, Printer, Truck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { safeFormat, formatNumber } from "@/lib/format";
import type { StepDispatch, WorkOrderStepLite } from "./types";

interface DispatchEntry extends StepDispatch {
  stationName: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Refakat kartı yazdırma seçeneği — modalda buton olarak gösterilir. */
  onPrintTravelerCard: () => void;
  /** WO adımlarındaki tüm aktif fason sevkler — her biri yazdırılabilir belge. */
  steps?: WorkOrderStepLite[];
  /** Fason sevk irsaliyesi yazdırma. Dialog kapatılıp print dialog açılır. */
  onPrintDispatch: (dispatchId: string) => void;
}

/** Adım adından "(Fason)" ekini temizler — grup başlığı zaten adımın kendisidir. */
function stripFason(s: string): string {
  return s.replace(/\s*\(fason\)\s*$/i, "");
}

/**
 * İş emri belgeleri — belge türüne göre gruplu grid: (1) iş emri belgeleri (refakat
 * kartı), (2..N) her FASON ADIMI kendi grubu (Zımpara / Boyahane irsaliyeleri).
 * Fason satırı sade: irsaliye no + firma, sağda miktar + tarih (plaka/sürücü/talimat
 * irsaliyenin basılı hâlinde; seçim ekranında yok).
 */
export function WorkOrderDocumentsDialog({
  open,
  onOpenChange,
  onPrintTravelerCard,
  steps,
  onPrintDispatch,
}: Props) {
  // Fason irsaliyelerini ADIMA göre grupla + grupları ROTA sırasına (stepSequence)
  // diz — Zımpara (adım 1) → Boyahane (adım 2)…, sevk tarihine göre değil. Grup içi
  // sevkler yeni → eski.
  const stationGroups = [...(steps ?? [])]
    .sort((a, b) => a.stepSequence - b.stepSequence)
    .filter((s) => (s.dispatches?.length ?? 0) > 0)
    .map((step): [string, DispatchEntry[]] => [
      stripFason(step.station?.name ?? "—"),
      [...(step.dispatches ?? [])]
        .map((d) => ({ ...d, stationName: step.station?.name ?? "—" }))
        .sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt)),
    ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Belgeler</DialogTitle>
          <DialogDescription>İş emrinden çıkarılabilecek belgeler.</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(240px,1fr))] items-start gap-5 overflow-y-auto px-6 py-4">
          {/* İş emri belgeleri */}
          <section className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              İş Emri Belgeleri
            </div>
            <button
              type="button"
              onClick={onPrintTravelerCard}
              className="flex w-full items-start gap-3 rounded-md border bg-background p-3 text-left hover:bg-muted/50"
            >
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="text-sm font-medium">Refakat Kartını Yazdır</div>
                <div className="text-xs text-muted-foreground">
                  Üretim sahasında topla birlikte dolaşan barkodlu kart.
                </div>
              </div>
              <Printer className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </section>

          {/* Fason irsaliyeleri — her fason adımı ayrı grup */}
          {stationGroups.length === 0 ? (
            <section className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Fason Sevk İrsaliyeleri (0)
              </div>
              <div className="rounded-md border border-dashed p-3 text-center text-xs italic text-muted-foreground">
                Bu iş emrinde fason sevk irsaliyesi yok.
              </div>
            </section>
          ) : (
            stationGroups.map(([station, list]) => (
              <section key={station} className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {station} İrsaliyeleri ({list.length})
                </div>
                <ul className="space-y-1.5">
                  {list.map((d) => (
                    <li key={d.id}>
                      <DispatchDocRow dispatch={d} onPrint={() => onPrintDispatch(d.id)} />
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

/** Tek fason sevk irsaliyesi satırı — no + firma; sağda miktar + tarih; yazdır. */
function DispatchDocRow({
  dispatch,
  onPrint,
}: {
  dispatch: DispatchEntry;
  onPrint: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPrint}
      className="flex w-full items-center gap-3 rounded-md border bg-background p-2.5 text-left hover:bg-muted/50"
    >
      <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-sm font-medium">{dispatch.dispatchNo}</div>
        <div className="truncate text-xs text-muted-foreground">{dispatch.subcontractor.name}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-medium tabular-nums">{formatNumber(dispatch.totalQty, 0)} m</div>
        <div className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
          {safeFormat(dispatch.dispatchedAt, "dd.MM.yyyy · HH:mm")}
        </div>
      </div>
      <Printer className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
