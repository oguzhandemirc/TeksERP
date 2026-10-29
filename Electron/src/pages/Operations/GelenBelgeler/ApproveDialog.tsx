// "Onayla" → sonuç. Toplam/sayfa kapısı 409'unda gerekçe istenir (tek hata yüzeyi: diyalog; apiClient toast'u bastırılır).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorText } from "@/lib/api-error";
import { approveNote } from "./service";
import { needsVarianceReason, summarizeApprove, type ApproveOutcome } from "./approveFlow";

interface Props {
  noteId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}

export function ApproveDialog({ noteId, open, onOpenChange, onDone }: Props) {
  const [reason, setReason] = useState("");
  const [askReason, setAskReason] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ o: ApproveOutcome; warnings: string[] } | null>(null);
  const run = useMutation({
    mutationFn: () => approveNote(noteId, askReason ? reason.trim() : null),
    onSuccess: ({ result, warnings }) => {
      setOutcome({ o: summarizeApprove(result), warnings });
      setError(null);
      onDone();
    },
    onError: (e) => {
      setError(apiErrorText(e, "Onay tamamlanamadı."));
      if (needsVarianceReason(e)) setAskReason(true);
    },
  });
  const close = (o: boolean) => {
    if (!o) {
      setOutcome(null);
      setError(null);
      setAskReason(false);
      setReason("");
    }
    onOpenChange(o);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{outcome ? "Onay sonucu" : "Belgeyi onayla"}</DialogTitle>
          <DialogDescription>{outcome ? outcome.o.title : "Her açık satır sahibin emanet topu olarak stoğa girer. Bu işlem geri alınmaz; düşen satır ayrı listelenir."}</DialogDescription>
        </DialogHeader>
        {outcome ? (
          <div className="flex flex-col gap-2 text-sm" data-testid="approve-result" data-status={outcome.o.status}>
            {outcome.warnings.map((w) => (
              <p key={w} className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">{w}</p>
            ))}
            {outcome.o.failed.length > 0 && (
              <ul className="max-h-48 overflow-y-auto rounded border p-2 text-xs">
                {outcome.o.failed.map((f) => (
                  <li key={`${f.blockNo}/${f.lineNo}`} className="text-destructive">
                    Blok {f.blockNo}, satır {f.lineNo}: {f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {error && <p className="rounded bg-destructive/10 px-2 py-1 text-sm text-destructive" data-testid="approve-error">{error}</p>}
            {askReason && (
              <Textarea aria-label="Fark gerekçesi" placeholder="Fark gerekçesi (ör. belgedeki toplam yanlış yazılmış)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            )}
          </div>
        )}
        <DialogFooter>
          {outcome ? (
            <Button onClick={() => close(false)}>Kapat</Button>
          ) : (
            <Button onClick={() => run.mutate()} disabled={run.isPending || (askReason && reason.trim().length < 3)}>
              {askReason ? "Gerekçeyle onayla" : "Onayla"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
