import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquareText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";

const MAX = 500;

/**
 * Çuval yorumu modalı — çuvala KAYITLI serbest not, "kendimiz için".
 *
 * Yorum ekranlarda YER KAPLAMAZ: çağıran taraf bir buton gösterir, düzenleme
 * burada olur. Çuvalın DURUMU fark etmez — sevkiyata atanmış / sevk edilmiş
 * çuvala da yazılır (backend'de `touchWarehouseSackTx` guard'ı bilinçli yok:
 * yorum ne ölçüm ne içerik). Boş bırakıp kaydetmek yorumu SİLER.
 */
export function SackNoteDialog({
  sack,
  onOpenChange,
}: {
  /** null → kapalı. `notes` mevcut not (yoksa null). */
  sack: { id: string; sackNo: string; notes: string | null } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const open = sack !== null;
  const saved = sack?.notes ?? "";
  const [text, setText] = useState(saved);

  // Modal her açılışta o çuvalın güncel notuyla başlar.
  useEffect(() => {
    setText(saved);
  }, [sack?.id, saved]);

  const dirty = text.trim() !== saved.trim();

  const mut = useMutation({
    mutationFn: () => sackHubService.setSackNotes(sack!.id, text.trim() || null),
    onSuccess: (res) => {
      toast.success(res.data.notes ? "Çuval notu kaydedildi." : "Çuval notu temizlendi.");
      invalidateSackHub(qc);
      void qc.invalidateQueries({ queryKey: ["sack-notes", sack!.id] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onOpenChange(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-muted-foreground" />
            Çuval Notu — {sack?.sackNo}
          </DialogTitle>
          <DialogDescription>Kendimiz için. Boş kaydetmek notu siler.</DialogDescription>
        </DialogHeader>

        <div>
          <textarea
            value={text}
            maxLength={MAX}
            rows={5}
            autoFocus
            disabled={mut.isPending}
            onChange={(e) => setText(e.target.value)}
            placeholder="Çuval notu…"
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="mt-1 text-right text-[10px] text-muted-foreground">
            {text.trim().length} / {MAX}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            İptal
          </Button>
          <Button type="button" size="sm" disabled={!dirty || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "…" : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
