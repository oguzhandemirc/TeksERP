import { Printer, Truck } from "lucide-react";
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

export function WorkOrderDocumentsDialog({
  open,
  onOpenChange,
  onPrintTravelerCard,
  steps,
  onPrintDispatch,
}: Props) {
  const dispatches: DispatchEntry[] = (steps ?? []).flatMap((step) =>
    (step.dispatches ?? []).map((d) => ({
      ...d,
      stationName: step.station?.name ?? "—",
    })),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Belgeler</DialogTitle>
          <DialogDescription>
            İş emrinden çıkarılabilecek belgeler.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <button
            type="button"
            onClick={onPrintTravelerCard}
            className="flex w-full items-start gap-3 rounded-md border bg-background p-3 text-left hover:bg-muted/50"
          >
            <Printer className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 space-y-0.5">
              <div className="text-sm font-medium">Refakat Kartını Yazdır</div>
              <div className="text-xs text-muted-foreground">
                Üretim sahasında topla birlikte dolaşan barkodlu kart.
              </div>
            </div>
          </button>

          {dispatches.length > 0 && (
            <div className="space-y-1">
              <div className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Fason Sevk İrsaliyeleri ({dispatches.length})
              </div>
              <ul className="space-y-1.5">
                {dispatches.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => onPrintDispatch(d.id)}
                      className="flex w-full items-start gap-3 rounded-md border bg-background p-3 text-left hover:bg-muted/50"
                    >
                      <Truck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="font-mono font-medium">
                            {d.dispatchNo}
                          </span>
                          <span className="tabular-nums font-medium">
                            {formatNumber(d.totalQty, 0)} m
                          </span>
                        </div>
                        <div className="text-xs">
                          <span className="font-medium">{d.subcontractor.name}</span>
                          <span className="text-muted-foreground">
                            {" · "}
                            {d.stationName}
                            {" · "}
                            {safeFormat(d.dispatchedAt, "dd.MM.yyyy HH:mm")}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                          <span>
                            Plaka:{" "}
                            <span className="font-mono text-foreground">
                              {d.plateNumber || "—"}
                            </span>
                          </span>
                          <span>
                            Sürücü:{" "}
                            <span className="text-foreground">
                              {d.driverName || "—"}
                            </span>
                          </span>
                        </div>
                        {(d.dyehouseNote ?? d.woDyehouseNote) && (
                          <div className="text-[11px] text-muted-foreground">
                            Boyahane Notu:{" "}
                            <span className="whitespace-pre-wrap font-medium text-orange-700">
                              {d.dyehouseNote ?? d.woDyehouseNote}
                            </span>
                          </div>
                        )}
                      </div>
                      <Printer className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
