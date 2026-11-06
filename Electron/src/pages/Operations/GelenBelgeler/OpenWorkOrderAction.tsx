// "İE aç" (belgeden iş emri, D4-D2): her partinin canlı İE'si varsa açılacak parti kalmamıştır → düğme pasif + gerekçe
// (2026-11-06 ekran denetimi: tüm partileri İE'ye dönmüş belgede düğme hâlâ çağırıyordu). Bağ bilgisi `/partiler`den.
import { useState } from "react";
import { Factory } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { TERIM } from "@/lib/terim";
import { WorkOrderFromNoteDialog } from "./WorkOrderFromNoteDialog";
import { allPartiesHaveWorkOrder, useNoteParties } from "./useNoteParties";

export function OpenWorkOrderAction({ noteId }: { noteId: string }) {
  const [open, setOpen] = useState(false);
  const done = allPartiesHaveWorkOrder(useNoteParties(noteId).data);
  const reason = `Açılacak parti yok: her partinin ${TERIM.terbiyeIsEmri.tekilKucuk} açık.`;
  return (
    <PermissionGate permission="workorder:write">
      <span className="flex items-center gap-2">
        {done && <span className="max-w-56 text-xs text-muted-foreground" data-testid="note-work-order-done">{reason}</span>}
        <Button variant="outline" onClick={() => setOpen(true)} disabled={done} title={done ? reason : undefined} data-testid="note-open-work-order">
          <Factory className="mr-1 h-4 w-4" />
          {TERIM.terbiyeIsEmri.tekil} aç
        </Button>
      </span>
      {open && <WorkOrderFromNoteDialog noteId={noteId} open onOpenChange={setOpen} />}
    </PermissionGate>
  );
}
