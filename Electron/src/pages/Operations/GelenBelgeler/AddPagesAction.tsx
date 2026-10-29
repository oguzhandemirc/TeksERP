// Detay: DRAFT belgeye "Sayfa ekle" — sıradaki sayfa numarasıyla yükleme modalı.
import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadDialog } from "./UploadDialog";
import { nextPageNo } from "./submitUpload";
import type { DeliveryNoteDetail } from "./types";

export function AddPagesAction({ note, onDone }: { note: DeliveryNoteDetail; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  // Açılışta dondurulur: yoklama yarıda kalan gönderimin tekrarında sayfa numaralarını kaydırmasın.
  const [firstPageNo, setFirstPageNo] = useState(1);
  return (
    <>
      <Button variant="outline" onClick={() => { setFirstPageNo(nextPageNo(note.scans)); setOpen(true); }}>
        <ImagePlus className="mr-1 h-4 w-4" />
        Sayfa ekle
      </Button>
      {open && (
        <UploadDialog
          open={open}
          onOpenChange={setOpen}
          target={{ kind: "pages", noteId: note.id, noteNo: note.noteNo, firstPageNo }}
          onDone={onDone}
        />
      )}
    </>
  );
}
