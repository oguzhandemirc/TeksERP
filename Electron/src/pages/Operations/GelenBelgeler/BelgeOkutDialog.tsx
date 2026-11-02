// İş emri ekranından "Belge okut" kartı (P3): yüklenen taslak okunurken bekler, okununca müşteri + parti no + kurşun
// metresi tek kartta; "Onayla" = onay ucuna SEÇİLEN rota (sunucu iş emrini o rotayla açar). İzinsizde onay çağrılmaz.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { apiErrorText } from "@/lib/api-error";
import { TERIM } from "@/lib/terim";
import { useTabsStore } from "@/store/tabs";
import { approveErrorText, needsVarianceReason, summarizeAutoWorkOrders } from "./approveFlow";
import { belgeOkutGate, belgeOkutStage, openedWorkOrderId } from "./belgeOkut";
import { BelgeOkutFields } from "./BelgeOkutFields";
import { ScanReadBanner } from "./ScanReadBanner";
import { SuggestionChips } from "./SuggestionChips";
import { approveNote, getIncomingDocumentSettings, INCOMING_DOCUMENT_QUERY_KEY, INCOMING_DOCUMENT_SETTINGS_QUERY_KEY } from "./service";
import { useNoteDetail } from "./useNoteDetail";
import type { DeliveryNoteDetail, HeaderPatch } from "./types";

interface Props {
  noteId: string;
  routeTemplateId: string;
  routeName: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const IE = TERIM.terbiyeIsEmri;

export function BelgeOkutDialog({ noteId, routeTemplateId, routeName, open, onOpenChange }: Props) {
  const { note, suggestions, header, invalidate } = useNoteDetail(noteId);
  const { hasPermission } = useRoleAccess();
  const settings = useQuery({ queryKey: INCOMING_DOCUMENT_SETTINGS_QUERY_KEY, queryFn: getIncomingDocumentSettings, staleTime: 60_000 });
  const qc = useQueryClient();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const [reason, setReason] = useState("");
  const approve = useMutation({
    mutationFn: () => approveNote(noteId, reason.trim() || null, [], { routeTemplateId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
    },
  });
  const n = note.data;
  const close = (o: boolean) => {
    if (approve.isPending) return;
    onOpenChange(o);
  };
  const goTo = (path: string) => {
    onOpenChange(false);
    navigateActive(path);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" data-testid="belge-okut-dialog">
        <DialogHeader>
          <DialogTitle>Belge okut{n ? ` — ${n.noteNo}` : ""}</DialogTitle>
          <DialogDescription>
            Rota: <b>{routeName ?? "seçilen rota şablonu"}</b>. Onaylanınca belge tek kayıt olarak girer ve {IE.tekilKucuk} bu rotayla açılır.
          </DialogDescription>
        </DialogHeader>
        {!n ? (
          <p className="text-sm text-muted-foreground">{note.isError ? "Belge yüklenemedi." : "Yükleniyor…"}</p>
        ) : approve.data ? (
          <ApproveResultView result={approve.data.result} warnings={approve.data.warnings} onGo={goTo} noteId={noteId} />
        ) : (
          <CardBody
            note={n}
            stage={belgeOkutStage(n)}
            editable={n.status === "DRAFT" && hasPermission("gelen-belge:write")}
            onPatch={(p) => header.mutateAsync(p)}
            ownerSuggestion={suggestions.data?.owner}
            onRequeued={() => void invalidate()}
          />
        )}
        {approve.isError && (
          <div className="flex flex-col gap-2">
            <p role="alert" className="rounded bg-destructive/10 px-2 py-1 text-sm text-destructive" data-testid="belge-okut-error">
              {approveErrorText(approve.error, apiErrorText(approve.error, "Onaylanamadı."))}
            </p>
            {needsVarianceReason(approve.error) && (
              <Input aria-label="Fark gerekçesi" placeholder="Fark gerekçesi" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </div>
        )}
        {n && !approve.data && (
          <Footer
            note={n}
            gate={belgeOkutGate(n, { canApprove: hasPermission("gelen-belge:approve"), entryMode: (settings.data as { entryMode?: string } | undefined)?.entryMode ?? "PER_LINE" })}
            ready={belgeOkutStage(n) === "READY"}
            pending={approve.isPending}
            onApprove={() => approve.mutate()}
            onSaveDraft={() => onOpenChange(false)}
            onOpenInList={() => goTo(`/operations/gelen-belgeler/${noteId}`)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface CardProps {
  note: DeliveryNoteDetail;
  stage: ReturnType<typeof belgeOkutStage>;
  editable: boolean;
  onPatch: (p: HeaderPatch) => Promise<unknown>;
  ownerSuggestion: Parameters<typeof SuggestionChips>[0]["suggestion"] | undefined;
  onRequeued: () => void;
}

function CardBody({ note, stage, editable, onPatch, ownerSuggestion, onRequeued }: CardProps) {
  if (stage === "READING") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="belge-okut-reading">
        <Loader2 className="h-4 w-4 animate-spin" /> Belge okunuyor… Okuma bitince kart kendiliğinden dolar.
      </p>
    );
  }
  if (stage === "CLOSED") return <p className="text-sm text-muted-foreground">Belge artık taslak değil.</p>;
  return (
    <div className="flex flex-col gap-3">
      {stage === "READ_FAILED" && <ScanReadBanner scans={note.scans} lines={note.lines} editable={editable} canRequeue={editable} onRequeued={onRequeued} />}
      <div className="flex flex-col gap-1" data-testid="belge-okut-owner">
        <span className="text-sm font-medium">Müşteri</span>
        <CustomerPickerField value={note.ownerCustomerId} onChange={(id) => void onPatch({ ownerCustomerId: id })} disabled={!editable} placeholder="Müşteri seç" />
        {editable && <SuggestionChips suggestion={ownerSuggestion} currentId={note.ownerCustomerId} onPick={(c) => void onPatch({ ownerCustomerId: c.id })} />}
      </div>
      <BelgeOkutFields note={note} editable={editable} onPatch={onPatch} />
    </div>
  );
}

interface FooterProps {
  note: DeliveryNoteDetail;
  gate: ReturnType<typeof belgeOkutGate>;
  ready: boolean;
  pending: boolean;
  onApprove: () => void;
  onSaveDraft: () => void;
  onOpenInList: () => void;
}

function Footer({ gate, ready, pending, onApprove, onSaveDraft, onOpenInList }: FooterProps) {
  return (
    <div className="flex flex-col gap-2">
      {ready && gate.reasons.length > 0 && (
        <ul className="text-xs text-amber-800 dark:text-amber-300" data-testid="belge-okut-reasons">
          {gate.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      <DialogFooter>
        {gate.action === "SAVE_DRAFT" && <Button onClick={onSaveDraft} data-testid="belge-okut-save-draft">Taslak olarak kaydet</Button>}
        {gate.action === "OPEN_IN_LIST" && (
          <Button variant="outline" onClick={onOpenInList} data-testid="belge-okut-open-list">
            <ExternalLink className="mr-1 h-4 w-4" /> Gelen Belgeler'de aç
          </Button>
        )}
        {gate.action === "APPROVE" && (
          <Button onClick={onApprove} disabled={!ready || gate.blocked || pending} data-testid="belge-okut-approve">
            <CheckCircle2 className="mr-1 h-4 w-4" />
            {pending ? "Onaylanıyor…" : `Onayla ve ${IE.tekilKucuk} aç`}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

interface ResultProps {
  result: Awaited<ReturnType<typeof approveNote>>["result"];
  warnings: string[];
  noteId: string;
  onGo: (path: string) => void;
}

function ApproveResultView({ result, warnings, noteId, onGo }: ResultProps) {
  const auto = summarizeAutoWorkOrders(result.autoWorkOrders);
  const woId = openedWorkOrderId(result.autoWorkOrders);
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="belge-okut-result">
      <p className="font-medium">Belge onaylandı ({result.note.noteNo}).</p>
      {auto ? (
        <>
          <p className={auto.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-800 dark:text-amber-300"}>{auto.title}</p>
          <ul className="text-xs text-muted-foreground">{auto.lines.map((l) => <li key={l.key}>{l.text}</li>)}</ul>
        </>
      ) : (
        <p className="text-amber-800 dark:text-amber-300">{IE.tekil} açılmadı; belgeden {IE.tekilKucuk} plan ekranından açın.</p>
      )}
      {warnings.map((w) => <p key={w} className="text-xs text-amber-800 dark:text-amber-300">{w}</p>)}
      <DialogFooter>
        <Button variant="outline" onClick={() => onGo(`/operations/gelen-belgeler/${noteId}`)}>Belgeyi aç</Button>
        {woId && <Button onClick={() => onGo(`/operations/work-orders/${woId}`)} data-testid="belge-okut-go-wo">{IE.cekim.yonelme} git</Button>}
      </DialogFooter>
    </div>
  );
}
