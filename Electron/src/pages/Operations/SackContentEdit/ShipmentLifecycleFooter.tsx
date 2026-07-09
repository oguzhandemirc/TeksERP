import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DoorOpen, PackageCheck, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShipmentConfirmationEnabled } from "@/hooks/usePricingEnabled";
import { DispatchConfirmDialog } from "@/pages/Operations/SackStore/DispatchConfirmDialog";
import { packingService } from "./service";
import { invalidateShipmentData } from "./useShipmentDetail";
import type { ShipmentDetail } from "./types";

const fmtM = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });

/** Sevke Hazır invariant'larını client-side önizle (backend yine de doğrular). */
function readyBlockers(detail: ShipmentDetail): string[] {
  const out: string[] = [];
  const hasContent = detail.summary.rollCount + detail.summary.swatchCount > 0;
  if (!hasContent) out.push("içeride top/kartela yok");
  if (detail.sacks.length === 0) out.push("hiç çuval yok");
  if (detail.rolls.some((r) => !r.sackId)) out.push("çuvalsız top var");
  if (detail.swatches.some((s) => !s.sackId)) out.push("çuvalsız kartela var");
  if (detail.sacks.some((s) => s.rollCount + s.swatchCount === 0)) out.push("içi boş çuval var");
  if (detail.sacks.some((s) => !s.manualCode?.trim())) out.push("kodsuz çuval var");
  if (detail.destination === "EXPORT" && detail.sacks.some((s) => s.weightKg == null))
    out.push("tartılmamış çuval var (yurtdışı)");
  return out;
}

/**
 * Paketleme yaşam döngüsü ayağı — PREPARING'de "Çuval Depoya Kaldır" (markReady),
 * sonra onay-akışı bayrağına göre READY→Kapı Önü / READY→Sevk / AT_DOOR→Sevk.
 * Sevk yıkıcıdır: ortak DispatchConfirmDialog çuval dökümünü canlı listeler.
 */
export function ShipmentLifecycleFooter({ detail }: { detail: ShipmentDetail }) {
  const qc = useQueryClient();
  const confirmationEnabled = useShipmentConfirmationEnabled();
  const [dispatchOpen, setDispatchOpen] = useState(false);

  const blockers = readyBlockers(detail);
  const canReady = blockers.length === 0;

  const readyMut = useMutation({
    mutationFn: () => packingService.markReady(detail.id),
    onSuccess: () => {
      toast.success("Çuval depoya kaldırıldı");
      invalidateShipmentData(qc, detail.id);
    },
  });
  const doorMut = useMutation({
    mutationFn: () => packingService.moveToDoor(detail.id),
    onSuccess: () => {
      toast.success("Kapı önüne kondu");
      invalidateShipmentData(qc, detail.id);
    },
  });

  if (detail.status === "DISPATCHED" || detail.status === "CANCELLED") return null;

  const showDispatch =
    detail.status === "AT_DOOR" || (detail.status === "READY" && !confirmationEnabled);
  const showDoor = detail.status === "READY" && confirmationEnabled;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-card px-6 py-3">
      <div className="text-xs text-muted-foreground">
        {detail.summary.rollCount} top · {detail.sacks.length} çuval ·{" "}
        {fmtM(detail.summary.totalMeters)} m
        {detail.status === "PREPARING" && !canReady && (
          <span className="ml-2 text-amber-600">Sevke hazır değil: {blockers.join(", ")}.</span>
        )}
      </div>

      <div className="flex gap-2">
        {detail.status === "PREPARING" && (
          <Button disabled={!canReady || readyMut.isPending} onClick={() => readyMut.mutate()}>
            <Warehouse className="mr-1 h-4 w-4" /> Çuval Depoya Kaldır
          </Button>
        )}
        {showDoor && (
          <Button variant="outline" disabled={doorMut.isPending} onClick={() => doorMut.mutate()}>
            <DoorOpen className="mr-1 h-4 w-4" /> Kapı Önüne Koy
          </Button>
        )}
        {showDispatch && (
          <Button variant="destructive" onClick={() => setDispatchOpen(true)}>
            <PackageCheck className="mr-1 h-4 w-4" /> Sevk Et
          </Button>
        )}
      </div>

      <DispatchConfirmDialog
        shipment={
          dispatchOpen
            ? {
                id: detail.id,
                shipmentNo: detail.shipmentNo,
                customerName: detail.customer.name,
                branchName: detail.branch?.name ?? null,
              }
            : null
        }
        onOpenChange={(o) => setDispatchOpen(o)}
        onDispatched={() => setDispatchOpen(false)}
      />
    </div>
  );
}
