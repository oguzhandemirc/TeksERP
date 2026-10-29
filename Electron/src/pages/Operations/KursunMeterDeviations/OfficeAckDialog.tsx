// Ofis onayı — sebep metni isteğe bağlı (≤300). İkinci onay sunucuda 409 `METER_ALREADY_ACKED` (Türkçe toast), liste tazelenir.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtDiff, fmtMeters } from "./deviation-labels";
import type { MeterDeviationRow } from "./types";

interface Props {
  target: MeterDeviationRow;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (reasonText: string | null) => void;
}

export function OfficeAckDialog({ target, isPending, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Metre sapmasını onayla</DialogTitle>
          <DialogDescription>
            Top {target.barcode ?? "—"}: çıkış {fmtMeters(target.outMeters)}, fark {fmtDiff(target.diffMeters)}. Onaydan sonra adım kapatılabilir; onay geri alınmaz (adım yeniden açılırsa damgalanır).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="ack-reason">Açıklama (isteğe bağlı)</Label>
          <Textarea id="ack-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Ör. kumaş çekti, müşteriye bildirildi" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button disabled={isPending} onClick={() => onConfirm(reason.trim() || null)}>
            Onayla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
