// Leventler listesinden "Devereciye geri gönder" (devere ek P): satırın devere siparişini ve kabullerini yükleyip
// sipariş sayfasındaki ret diyaloğunu (`BeamRejectDialog`) AYNEN açar; başarıda ret belgesi basılır.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorMessage } from "@/services/apiClient";
import { BeamRejectDialog } from "@/pages/Operations/WarpingOrders/BeamRejectDialog";
import { BeamRejectionDocDialog } from "@/pages/Operations/WarpingOrders/BeamRejectionDocDialog";
import { rejectableBeams } from "@/pages/Operations/WarpingOrders/rejection-model";
import { useWarpingReceipts } from "@/pages/Operations/WarpingOrders/receive-service";
import { useWarpingOrder } from "@/pages/Operations/WarpingOrders/service";
import type { WarpingBeamRejection } from "@/pages/Operations/WarpingOrders/rejection-types";
import { WARP_BEAMS_QUERY_KEY } from "./useWarpBeamMutations";
import type { WarpBeam } from "./types";

/** Menü kapısı: devere siparişinden doğmuş, depoda HAZIR sarım (son karar sunucu önizlemesinde). */
export function isBeamRejectable(b: WarpBeam): boolean {
  return Boolean(b.warpingOrderId) && b.status === "READY";
}

export function BeamRejectLauncher({ beam, onClose }: { beam: WarpBeam; onClose: () => void }) {
  const qc = useQueryClient();
  const orderId = beam.warpingOrderId ?? "";
  const order = useWarpingOrder(orderId || undefined);
  const receipts = useWarpingReceipts(orderId);
  const [doc, setDoc] = useState<WarpingBeamRejection | null>(null);
  if (doc) return <BeamRejectionDocDialog docId={doc.id} initial={doc} autoPrint onClose={onClose} />;
  if (order.data && receipts.data) {
    return (
      <BeamRejectDialog
        order={order.data}
        options={rejectableBeams(receipts.data.receipts)}
        initialBeamId={beam.id}
        onClose={onClose}
        onCreated={(d) => {
          void qc.invalidateQueries({ queryKey: [WARP_BEAMS_QUERY_KEY] });
          setDoc(d);
        }}
      />
    );
  }
  const err = order.error ?? receipts.error;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{beam.beamNo} — devereciye geri gönder</DialogTitle></DialogHeader>
        {err ? <p role="alert" className="text-sm text-destructive">{apiErrorMessage(err)}</p> : <p className="text-sm text-muted-foreground">Devere siparişi yükleniyor…</p>}
      </DialogContent>
    </Dialog>
  );
}
