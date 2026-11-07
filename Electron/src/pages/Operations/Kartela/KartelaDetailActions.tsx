// Detay çekmecesindeki yazma eylemleri — `kartela:write` yoksa çizilmez (PermissionGate).
import { useState } from "react";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { CancelDispatchDialog, CancelReceiptDialog } from "./KartelaCancelDialogs";

/** Kabul edilmemiş, iptal edilmemiş sevk iptal edilebilir (kabullü sevkte önce kabul iptali — backend 409). */
export function DispatchCancelAction({ dispatch }: {
  dispatch: { id: string; dispatchNo: string; cancelledAt: string | null; items: unknown[]; receipts: unknown[] };
}) {
  const [open, setOpen] = useState(false);
  if (dispatch.cancelledAt || dispatch.receipts.length > 0) return null;
  return (
    <PermissionGate permission="kartela:write">
      <Button type="button" size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={() => setOpen(true)}>
        <Ban className="h-4 w-4" /> Sevki İptal Et
      </Button>
      <CancelDispatchDialog
        dispatch={open ? { id: dispatch.id, dispatchNo: dispatch.dispatchNo, itemCount: dispatch.items.length } : null}
        onOpenChange={setOpen}
      />
    </PermissionGate>
  );
}

export function ReceiptCancelAction({ receipt }: { receipt: { id: string; cancelledAt: string | null } }) {
  const [open, setOpen] = useState(false);
  if (receipt.cancelledAt) return null;
  return (
    <PermissionGate permission="kartela:write">
      <div className="mt-3">
        <Button type="button" size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={() => setOpen(true)}>
          <Ban className="h-4 w-4" /> Kabulü İptal Et
        </Button>
      </div>
      <CancelReceiptDialog receiptId={open ? receipt.id : null} onOpenChange={setOpen} />
    </PermissionGate>
  );
}
