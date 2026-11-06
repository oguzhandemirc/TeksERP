// "Taslağı iptal et" — yalnız DRAFT (deftere hiç yazmamış taslak; backend claim'i DRAFT değilse 409 verir).
// Taramalar silinmez, taslaktan çözülür; belge numarası yeniden verilmez. Sayılar sunucu önizlemesinden (parti tek kaynak).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { deleteDraftNote, INCOMING_DOCUMENT_QUERY_KEY, previewBulkDeleteNotes } from "./service";
import type { BulkDeletePreviewItem, DeliveryNoteDetail } from "./types";

type NoteLike = Pick<DeliveryNoteDetail, "id" | "noteNo" | "status" | "lines" | "scans">;

/** Onay metni: önizleme gelmeden (ya da alınamazsa) yerel satır sayısı; parti yalnız sunucu söylerse. */
function describe(note: NoteLike, p: BulkDeletePreviewItem | undefined): string {
  const lines = p?.lineCount ?? note.lines.length;
  const scans = p?.scanCount ?? note.scans.length;
  const content = [`${lines} satır`, p?.partyCount != null ? `${p.partyCount} parti` : null].filter(Boolean).join(" · ");
  return (
    `Taslak (${content}) kalıcı olarak kaldırılır; geri alınamaz. Hiç top doğmadığı için stok etkilenmez.` +
    (scans > 0 ? `\n${scans} sayfa fotoğrafı silinmez; aynı belge yeniden okutulunca yeni kayda bağlanır.` : "") +
    `\n${note.noteNo} numarası yeniden verilmez.` +
    (p && !p.deletable ? `\n${p.reason ?? "Bu belge artık taslak değil."}` : "")
  );
}

export function DeleteDraftNoteAction({ note, listPath }: { note: NoteLike; listPath: string }) {
  const [open, setOpen] = useState(false);
  const preview = useQuery({
    queryKey: ["gelen-belge-toplu-sil-onizleme", [note.id]],
    queryFn: () => previewBulkDeleteNotes([note.id]),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });
  const p = preview.data?.items[0];
  const qc = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => deleteDraftNote(note.id),
    onSuccess: () => {
      toast.success(`${note.noteNo} taslağı iptal edildi.`);
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
      <Button variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setOpen(true)} data-testid="note-delete-draft">
        <FileX className="mr-1 h-4 w-4" />
        Taslağı iptal et
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        title={`${note.noteNo} taslağı iptal edilsin mi?`}
        description={describe(note, p)}
        confirmLabel="Taslağı iptal et"
        cancelLabel="Vazgeç"
        isPending={remove.isPending}
        confirmDisabled={preview.isLoading || (p != null && !p.deletable)}
        onConfirm={() => remove.mutateAsync().then(() => setOpen(false))}
      />
    </>
  );
}
