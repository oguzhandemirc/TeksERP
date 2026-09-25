// =============================================================================
// İŞ EMRİ HAREKETLERİ — detay/yan panelden açılan zaman çizelgesi
// =============================================================================
// Kaynak: `GET /api/work-orders/:id/events` — iş emrinin kendi defteri + kendi
// defteri olan olaylar (sipariş bağı, parti, fason, Tambur, kapanış künyesi).
// Gövde ayrı ekranla ORTAK (`WorkOrderEventsPanel`); burada yalnız kabuk.
// =============================================================================
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { WorkOrderEventsPanel } from "./WorkOrderEventsPanel";

interface Props {
  /** Seçili iş emri — `null` ise panel kapalıdır. */
  workOrder: { id: string; workOrderNumber: string } | null;
  onClose: () => void;
}

export function WorkOrderEventsSheet({ workOrder, onClose }: Props) {
  return (
    <Sheet open={Boolean(workOrder)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-[860px] flex-col sm:max-w-[860px]">
        <SheetHeader>
          <SheetTitle className="pr-8">{workOrder ? `${workOrder.workOrderNumber} — Hareketler` : "…"}</SheetTitle>
        </SheetHeader>
        {workOrder && (
          <>
            <p className="mt-2 text-xs text-muted-foreground">
              Hareketler değiştirilmez: bir düzeltme, yeni bir satır olarak eklenir.
            </p>
            <WorkOrderEventsPanel workOrder={workOrder} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
