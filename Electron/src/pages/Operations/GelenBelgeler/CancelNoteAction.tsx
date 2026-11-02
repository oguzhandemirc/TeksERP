// Onaylı/kısmi belgede "İptal et" (K15) — izin `gelen-belge:cancel` (SoD); önizleme diyaloğu açılmadan hiçbir şey yazılmaz.
import { useState } from "react";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { CancelNoteDialog } from "./CancelNoteDialog";
import { isCancellable } from "./noteStatus";
import type { NoteStatus } from "./types";

export function CancelNoteAction({ note }: { note: { id: string; noteNo: string; status: NoteStatus } }) {
  const [open, setOpen] = useState(false);
  if (!isCancellable(note.status)) return null;
  return (
    <PermissionGate permission="gelen-belge:cancel">
      <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)} data-testid="note-cancel">
        <Ban className="mr-1 h-4 w-4" />
        İptal et
      </Button>
      {open && <CancelNoteDialog note={note} open onOpenChange={setOpen} />}
    </PermissionGate>
  );
}

/** İptal edilmiş belgenin sebebi (K15). `cancelReason` alanı yalnız iptal yüzeyinin sözleşmesidir; eski sunucu göndermez. */
export function CancelReasonLine({ note }: { note: { status: NoteStatus; cancelReason?: string | null } }) {
  if (note.status !== "CANCELLED" || !note.cancelReason) return null;
  return <p className="text-xs text-destructive" data-testid="note-cancel-reason">İptal sebebi: {note.cancelReason}</p>;
}
