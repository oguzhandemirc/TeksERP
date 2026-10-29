// "Onayla" → sonuç. Toplam/sayfa kapısı 409'unda gerekçe istenir (tek hata yüzeyi: diyalog; apiClient toast'u bastırılır).
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorText } from "@/lib/api-error";
import { approveNote, getIncomingDocumentSettings, INCOMING_DOCUMENT_SETTINGS_QUERY_KEY } from "./service";
import { approveErrorText, approvePrecheck, needsVarianceReason, summarizeApprove, type ApproveOutcome } from "./approveFlow";
import type { DeliveryNoteLine, ProcessChoice } from "./types";

interface Props {
  noteId: string;
  /** Ön kontrol sayacı için (ürünsüz / gözden geçirilmemiş açık satır). */
  lines: readonly DeliveryNoteLine[];
  /** Operatörün seçtiği gramajlar (H9) — onayda PROCESS sözlüğüne öğretilir. */
  processChoices?: readonly ProcessChoice[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}

const TONE_CLASS = {
  info: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  block: "bg-destructive/10 text-destructive",
} as const;

function ProcessChoicesNote({ count }: { count: number }) {
  if (count === 0) return null;
  return <p className="text-xs text-muted-foreground" data-testid="approve-process-choices">Seçilen {count} kurşun gramajı bu işlem metinleri için hatırlanacak (topa değer yazılmaz).</p>;
}

export function ApproveDialog({ noteId, lines, processChoices = [], open, onOpenChange, onDone }: Props) {
  const [reason, setReason] = useState("");
  const [askReason, setAskReason] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ o: ApproveOutcome; warnings: string[] } | null>(null);
  // Diyalog her açılışta ayarı tazeler: sayaç onay anındaki kipe/ürüne göre konuşur; hüküm yine backend'de.
  const settings = useQuery({ queryKey: INCOMING_DOCUMENT_SETTINGS_QUERY_KEY, queryFn: getIncomingDocumentSettings, enabled: open, refetchOnMount: "always", staleTime: 0 });
  const pre = approvePrecheck(lines, settings.data);
  const run = useMutation({
    mutationFn: () => approveNote(noteId, askReason ? reason.trim() : null, processChoices),
    onSuccess: ({ result, warnings }) => {
      setOutcome({ o: summarizeApprove(result), warnings });
      setError(null);
      onDone();
    },
    onError: (e) => {
      setError(approveErrorText(e, apiErrorText(e, "Onay tamamlanamadı.")));
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
            {pre.messages.length > 0 && (
              <ul className="flex flex-col gap-1" data-testid="approve-precheck" data-blocked={pre.blocked ? "1" : "0"}>
                {pre.messages.map((m) => (
                  <li key={m.text} className={`rounded px-2 py-1 text-xs ${TONE_CLASS[m.tone]}`} data-tone={m.tone}>{m.text}</li>
                ))}
              </ul>
            )}
            <ProcessChoicesNote count={processChoices.length} />
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
            <Button onClick={() => run.mutate()} disabled={run.isPending || pre.blocked || (askReason && reason.trim().length < 3)}>
              {askReason ? "Gerekçeyle onayla" : "Onayla"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
