// Taslak gelen belgeyi sil — yalnız DRAFT (deftere hiç yazmamış taslak; backend claim'i DRAFT değilse 409 verir).
// Taramalar silinmez, taslaktan çözülür; belge numarası yeniden verilmez. Hata apiClient toast'undan görünür.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { deleteDraftNote, INCOMING_DOCUMENT_QUERY_KEY } from "./service";
import type { DeliveryNoteDetail } from "./types";

export function DeleteDraftNoteAction({ note, listPath }: { note: Pick<DeliveryNoteDetail, "id" | "noteNo" | "status" | "lines" | "scans">; listPath: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => deleteDraftNote(note.id),
    onSuccess: () => {
      toast.success(`${note.noteNo} taslağı silindi.`);
      // Silinen belgenin sorguları düşer, kalanlar yalnız bayat işaretlenir (refetch YOK): sayfa henüz bağlıyken
      // tazeleme yeniden render ettirir ve silinen detay yeniden çekilip 404 toast'ı basar (PackingLotHeader emsali).
      // Liste sayfası bağlanınca bayat sorgusunu kendisi çeker.
      void navigate(listPath);
      const isDeletedNote = (key: readonly unknown[]) => key[0] === INCOMING_DOCUMENT_QUERY_KEY && key[2] === note.id;
      qc.removeQueries({ predicate: (q) => isDeletedNote(q.queryKey) });
      void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY], refetchType: "none" });
    },
    // 409 (başka oturum onayladı): bayat DRAFT görünümünde kalma — detay yeni durumu çeksin, Sil kalksın.
    onError: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "detail", note.id] });
    },
  });
  if (note.status !== "DRAFT") return null;
  return (
    <>
      <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)} data-testid="note-delete-draft">
        <Trash2 className="mr-1 h-4 w-4" />
        Sil
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        title={`${note.noteNo} taslağı silinsin mi?`}
        description={
          `Taslak ve ${note.lines.length} satırı kalıcı silinir; geri alınamaz.` +
          (note.scans.length > 0 ? `\n${note.scans.length} sayfa fotoğrafı silinmez, yeni belgede kullanılabilir.` : "") +
          `\n${note.noteNo} numarası yeniden verilmez.`
        }
        confirmLabel="Sil"
        isPending={remove.isPending}
        onConfirm={() => remove.mutateAsync().then(() => setOpen(false))}
      />
    </>
  );
}
