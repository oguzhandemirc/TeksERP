// Detay: DRAFT belgeye "Sayfa ekle" — sıradaki sayfa numarasıyla yükleme modalı (düğme ya da detay ⋯ menüsünden).
import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadDialog } from "./UploadDialog";
import { nextPageNo } from "./submitUpload";
import type { DeliveryNoteDetail } from "./types";

type PagesNote = Pick<DeliveryNoteDetail, "id" | "noteNo" | "scans">;

/** Yalnız açıkken bağlanır: ilk sayfa no bağlanırken dondurulur — yoklama yarıda kalan gönderimin tekrarı numaraları kaydırmasın. */
export function AddPagesDialog({ note, onOpenChange, onDone }: { note: PagesNote; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [firstPageNo] = useState(() => nextPageNo(note.scans));
  return <UploadDialog open onOpenChange={onOpenChange} target={{ kind: "pages", noteId: note.id, noteNo: note.noteNo, firstPageNo }} onDone={onDone} />;
}

export function AddPagesAction({ note, onDone }: { note: PagesNote; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ImagePlus className="mr-1 h-4 w-4" />
        Sayfa ekle
      </Button>
      {open && <AddPagesDialog note={note} onOpenChange={setOpen} onDone={onDone} />}
    </>
  );
}
