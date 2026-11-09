// "Onayla" → sonuç. Toplam/sayfa kapısı 409'unda gerekçe istenir (tek hata yüzeyi: diyalog; apiClient toast'u bastırılır).
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorText } from "@/lib/api-error";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { approveNote, getIncomingDocumentSettings, getSuggestions, INCOMING_DOCUMENT_QUERY_KEY, INCOMING_DOCUMENT_SETTINGS_QUERY_KEY } from "./service";
import { approveErrorText, approvePrecheck, needsVarianceReason, summarizeApprove, summarizeAutoWorkOrders, unusableDefaultSource, type ApproveOutcome, type AutoWorkOrderSummary } from "./approveFlow";
import { CUSTOMER_DEFAULTS_PATH } from "./paths";
import { perDocumentPrecheck, perDocumentSummary } from "./partiMetre";
import { DuplicateGateConfirm, duplicateGateConflict, withDuplicateConfirm } from "./DuplicateDocNo";
import type { DeliveryNoteHeader, DeliveryNoteLine, PerDocumentGate, ProcessChoice } from "./types";
import type { PhotoRetentionMode } from "./photoRetentionTypes";
import { retentionDocNoWarning } from "./photoRetention";
import type { DuplicateConfirms, DuplicateGateConflict } from "./mukerrerTypes";

interface Props {
  noteId: string;
  /** Ön kontrol sayacı için (ürünsüz / gözden geçirilmemiş açık satır). */
  lines: readonly DeliveryNoteLine[];
  /** Operatörün seçtiği gramajlar (H9) — onayda PROCESS sözlüğüne öğretilir. */
  processChoices?: readonly ProcessChoice[];
  /** Seçim sayacının adı: yalnız kurşun katalogda "kurşun gramajı", çeşit grupları varsa "işlem seçimi" (D4-D1). */
  choiceNoun?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
  /** Belge başına tek kayıt (PER_DOCUMENT): satır kapıları yerine metre/parti özeti; null/undefined = bugünkü diyalog. */
  perDocument?: { note: Pick<DeliveryNoteHeader, "kursunMeters" | "ourBatchNo">; gate: PerDocumentGate } | null;
  /** K28: saklama kipi FULL değilse belge no vurgulu + uyarı; verilmezse (eski backend) bugünkü diyalog. */
  retention?: { docNo: string | null; mode?: PhotoRetentionMode } | null;
}

function RetentionDocNo({ retention }: { retention: Props["retention"] }) {
  const text = retentionDocNoWarning(retention?.mode);
  if (!retention || !text) return null;
  return (
    <div className="rounded border-2 border-amber-400 bg-amber-50 px-2 py-1 text-sm dark:bg-amber-950" data-testid="approve-retention-docno">
      <p>
        Belge no: <span className="font-semibold">{retention.docNo || "— (boş)"}</span>
      </p>
      <p className="text-xs text-amber-900 dark:text-amber-200">{text}</p>
    </div>
  );
}

const TONE_CLASS = {
  info: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  block: "bg-destructive/10 text-destructive",
} as const;

function ProcessChoicesNote({ count, noun }: { count: number; noun: string }) {
  if (count === 0) return null;
  return <p className="text-xs text-muted-foreground" data-testid="approve-process-choices">Seçilen {count} {noun} bu işlem metinleri için hatırlanacak (topa değer yazılmaz).</p>;
}

/**
 * Diyalog her açılışta ayarı ve etkin varsayılanı (E4: eşleşme yanıtı, müşteri > fabrika) tazeler: sayaç onay anındaki
 * kipe/ürüne göre konuşur; hüküm yine backend'de. Aynı anahtar → detay sayfasının önbelleği de tazelenir.
 */
function useApprovePrecheck(noteId: string, lines: readonly DeliveryNoteLine[], open: boolean, perDocument: Props["perDocument"]) {
  const settings = useQuery({ queryKey: INCOMING_DOCUMENT_SETTINGS_QUERY_KEY, queryFn: getIncomingDocumentSettings, enabled: open, refetchOnMount: "always", staleTime: 0 });
  const match = useQuery({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "eslestirme", noteId], queryFn: () => getSuggestions(noteId), enabled: open, refetchOnMount: "always", staleTime: 0 });
  return perDocument ? perDocumentPrecheck(perDocument.note, perDocument.gate) : approvePrecheck(lines, settings.data, match.data?.defaultItem);
}

/** Hata metni; kullanılamaz MÜŞTERİ varsayılanında (E4) yetkiliye yönetim ekranı bağlantısı (fabrika yolu backend mesajında). */
function ApproveError({ text, source }: { text: string | null; source: "CUSTOMER" | "FACTORY" | null }) {
  const { hasPermission } = useRoleAccess();
  if (!text) return null;
  return (
    <>
      <p className="rounded bg-destructive/10 px-2 py-1 text-sm text-destructive" data-testid="approve-error">{text}</p>
      {source === "CUSTOMER" && hasPermission("gelen-belge:template") && (
        <Button variant="outline" size="sm" asChild className="self-start">
          <Link to={CUSTOMER_DEFAULTS_PATH} data-testid="approve-error-fix-link">Müşteri varsayılan ürünlerini aç</Link>
        </Button>
      )}
    </>
  );
}

/** Onay sonrası otomatik iş emri sonucu (ayar kapalıysa / eski backend → çizilmez). */
function AutoWorkOrderBox({ auto }: { auto: AutoWorkOrderSummary | null }) {
  if (!auto) return null;
  const warn = "text-amber-800 dark:text-amber-300";
  return (
    <div className="rounded border p-2 text-xs" data-testid="approve-auto-wo" data-tone={auto.tone}>
      <p className={`font-medium ${auto.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : warn}`}>{auto.title}</p>
      {auto.lines.length > 0 && (
        <ul className="mt-1 max-h-40 overflow-y-auto">
          {auto.lines.map((l) => <li key={l.key} className={l.tone === "ok" ? "" : warn}>{l.text}</li>)}
        </ul>
      )}
    </div>
  );
}

type Outcome = { o: ApproveOutcome; warnings: string[]; auto: AutoWorkOrderSummary | null };

/** Onay sonucu: uyarılar (K27 operatör onayı dahil), düşen satırlar, otomatik iş emri özeti. */
function ApproveResultBody({ outcome }: { outcome: Outcome }) {
  return (
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
      <AutoWorkOrderBox auto={outcome.auto} />
    </div>
  );
}

export function ApproveDialog({ noteId, lines, processChoices = [], choiceNoun = "kurşun gramajı", open, onOpenChange, onDone, perDocument, retention }: Props) {
  const [reason, setReason] = useState("");
  const [askReason, setAskReason] = useState(false);
  // Hata metni + kullanılamaz varsayılanın kaynağı (E4; müşteri ise yönetim ekranı bağlantısı çıkar).
  const [error, setError] = useState<{ text: string; source: "CUSTOMER" | "FACTORY" | null } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Mükerrer kapısı 409'u (K27 belge no · müşteri parti no): künye kutusu; "Yine de" önceki onaylarla birlikte yeniden gönderir.
  const [dup, setDup] = useState<DuplicateGateConflict | null>(null);
  const pre = useApprovePrecheck(noteId, lines, open, perDocument);
  const run = useMutation({
    mutationFn: (confirms: DuplicateConfirms) => Object.keys(confirms).length
      ? approveNote(noteId, askReason ? reason.trim() : null, processChoices, confirms)
      : approveNote(noteId, askReason ? reason.trim() : null, processChoices),
    onSuccess: ({ result, warnings }) => {
      setOutcome({ o: summarizeApprove(result), warnings, auto: summarizeAutoWorkOrders(result.autoWorkOrders) });
      setError(null);
      setDup(null);
      onDone();
    },
    onError: (e) => {
      const conflict = duplicateGateConflict(e);
      setDup(conflict);
      if (conflict) { setError(null); return; }
      setError({ text: approveErrorText(e, apiErrorText(e, "Onay tamamlanamadı.")), source: unusableDefaultSource(e) });
      if (needsVarianceReason(e)) setAskReason(true);
    },
  });
  const close = (o: boolean) => {
    if (!o) {
      setOutcome(null);
      setError(null);
      setAskReason(false);
      setReason("");
      setDup(null);
    }
    onOpenChange(o);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{outcome ? "Onay sonucu" : "Belgeyi onayla"}</DialogTitle>
          <DialogDescription>{outcome ? outcome.o.title : perDocument ? "Belge tek kayıt olarak sahibin emanet topu olur; satırlar bilgi olarak kalır. Bu işlem geri alınmaz." : "Her açık satır sahibin emanet topu olarak stoğa girer. Bu işlem geri alınmaz; düşen satır ayrı listelenir."}</DialogDescription>
        </DialogHeader>
        {outcome ? (
          <ApproveResultBody outcome={outcome} />
        ) : (
          <div className="flex flex-col gap-2">
            <RetentionDocNo retention={retention} />{perDocument && <p className="rounded border px-2 py-1 text-sm font-medium" data-testid="approve-per-document">{perDocumentSummary(perDocument.note)}</p>}
            {pre.messages.length > 0 && (
              <ul className="flex flex-col gap-1" data-testid="approve-precheck" data-blocked={pre.blocked ? "1" : "0"}>
                {pre.messages.map((m) => (
                  <li key={m.text} className={`rounded px-2 py-1 text-xs ${TONE_CLASS[m.tone]}`} data-tone={m.tone}>{m.text}</li>
                ))}
              </ul>
            )}
            <ProcessChoicesNote count={processChoices.length} noun={choiceNoun} />
            <ApproveError text={error?.text ?? null} source={error?.source ?? null} />
            {dup && <DuplicateGateConfirm conflict={dup} busy={run.isPending} onConfirm={() => run.mutate(withDuplicateConfirm(run.variables, dup))} onCancel={() => setDup(null)} />}
            {askReason && (
              <Textarea aria-label="Fark gerekçesi" placeholder="Fark gerekçesi (ör. belgedeki toplam yanlış yazılmış)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            )}
          </div>
        )}
        <DialogFooter>
          {outcome ? (
            <Button onClick={() => close(false)}>Kapat</Button>
          ) : (
            <Button onClick={() => run.mutate({})} disabled={run.isPending || pre.blocked || (askReason && reason.trim().length < 3)}>
              {askReason ? "Gerekçeyle onayla" : "Onayla"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
