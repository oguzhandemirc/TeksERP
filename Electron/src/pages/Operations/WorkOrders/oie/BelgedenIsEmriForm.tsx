// Belgeden iş emri formu (K6/K7): okutulan belge okunurken bekler, okununca formun kutuları dolar ("Belgeden" rozeti +
// küçük önizleme). Kaydet: ayar WITH_WORK_ORDER → belge + top + iş emri tek seferde; değilse taslağa yazılır (bugünkü).
import { TERIM } from "@/lib/terim";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { useKursunGramajCatalog } from "@/lib/kursun-gramaj";
import { useTabsStore } from "@/store/tabs";
import { belgeOkutStage } from "@/pages/Operations/GelenBelgeler/belgeOkut";
import { INCOMING_DOCUMENT_QUERY_KEY } from "@/pages/Operations/GelenBelgeler/service";
import { ScanReadBanner } from "@/pages/Operations/GelenBelgeler/ScanReadBanner";
import { useNoteDetail } from "@/pages/Operations/GelenBelgeler/useNoteDetail";
import { DocFields, FromDocBadge } from "./DocFields";
import { DocThumb } from "./DocThumb";
import { docDraftReasons, initialDocDraft, type DocDraft } from "./docDraft";
import { AUTO_PRINT_TEXT, printRefakatCard, useRefakatAutoPrint } from "./refakatPrint";
import { DRAFT_SAVED_TEXT, saveDoc, saveErrorHint, type SaveOutcome } from "./saveDoc";
import { useFormApproval } from "./useFormApproval";

interface Props {
  noteId: string;
  route: { id: string; name: string };
}

function useSave(noteId: string, route: Props["route"]) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const approval = useFormApproval();
  const autoPrint = useRefakatAutoPrint();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const { catalog } = useKursunGramajCatalog();
  return useMutation({
    mutationFn: (v: { note: NonNullable<ReturnType<typeof useNoteDetail>["note"]["data"]>; draft: DocDraft }): Promise<SaveOutcome> =>
      saveDoc({ ...v, routeTemplateId: route.id, formApproval: approval.value, gramajPropertyId: catalog.propertyId, clientToken: attempt.token() }),
    onError: (e) => attempt.onFailure(e),
    onSuccess: async (out) => {
      attempt.onSuccess();
      void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] });
      if (out.kind !== "WORK_ORDER") return;
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      toast.success(`${TERIM.terbiyeIsEmri.tekil} açıldı: ${out.result.workOrderNo}`);
      if (autoPrint) toast.message(AUTO_PRINT_TEXT[await printRefakatCard(out.result.workOrderId)]);
      navigateActive(`/operations/work-orders/${out.result.workOrderId}`);
    },
  });
}

export function BelgedenIsEmriForm({ noteId, route }: Props) {
  const { note, invalidate } = useNoteDetail(noteId);
  const n = note.data;
  const stage = n ? belgeOkutStage(n) : "READING";
  const { catalog, isLoading: catalogLoading } = useKursunGramajCatalog();
  const [draft, setDraft] = useState<DocDraft | null>(null);
  const save = useSave(noteId, route);
  const navigateActive = useTabsStore((s) => s.navigateActive);
  // Taslak bir kez, okuma bitince ve gramaj kataloğu gelince dolar (varsayılan gramaj ön seçimi kaçmasın).
  useEffect(() => {
    if (n && !draft && stage !== "READING" && !catalogLoading) setDraft(initialDocDraft(n, catalog.options));
  }, [n, draft, stage, catalogLoading, catalog.options]);
  if (!n) return <p className="p-6 text-sm text-muted-foreground">{note.isError ? "Belge yüklenemedi." : "Yükleniyor…"}</p>;
  if (stage === "CLOSED") return <p className="p-6 text-sm text-muted-foreground">Belge artık taslak değil ({n.noteNo}).</p>;
  const reasons = draft ? docDraftReasons(draft) : [];
  const saved = save.data?.kind === "DRAFT_SAVED";
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="oie-doc-form">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-[1fr_260px]">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <FromDocBadge />
              <span>Belge <b>{n.noteNo}</b> · Rota <b>{route.name}</b></span>
            </div>
            {stage === "READING" || !draft ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="oie-reading">
                <Loader2 className="h-4 w-4 animate-spin" /> Belge okunuyor… Okuma bitince kutular kendiliğinden dolar.
              </p>
            ) : (
              <>
                {stage === "READ_FAILED" && <ScanReadBanner scans={n.scans} lines={n.lines} editable canRequeue onRequeued={() => void invalidate()} />}
                <DocFields note={n} draft={draft} onChange={setDraft} gramajOptions={catalog.options} disabled={save.isPending || saved} />
              </>
            )}
          </div>
          <DocThumb scans={n.scans} />
        </div>
      </div>
      <SaveBar
        reasons={reasons}
        ready={Boolean(draft) && stage !== "READING" && !saved}
        pending={save.isPending}
        error={save.isError ? (saveErrorHint(save.error) ?? apiErrorText(save.error, "Kaydedilemedi.")) : null}
        savedAsDraft={saved}
        onSave={() => draft && save.mutate({ note: n, draft })}
        onOpenNote={() => navigateActive(`/operations/gelen-belgeler/${noteId}`)}
      />
    </div>
  );
}

interface SaveBarProps {
  reasons: string[];
  ready: boolean;
  pending: boolean;
  error: string | null;
  savedAsDraft: boolean;
  onSave: () => void;
  onOpenNote: () => void;
}

function SaveBar({ reasons, ready, pending, error, savedAsDraft, onSave, onOpenNote }: SaveBarProps) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t px-6 py-3">
      {ready && reasons.length > 0 && (
        <ul className="text-xs text-amber-800 dark:text-amber-300" data-testid="oie-reasons">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      )}
      {error && <p role="alert" className="rounded bg-destructive/10 px-2 py-1 text-sm text-destructive" data-testid="oie-error">{error}</p>}
      {savedAsDraft && <p className="text-sm text-emerald-700 dark:text-emerald-400" data-testid="oie-draft-saved">{DRAFT_SAVED_TEXT}</p>}
      <div className="flex justify-end gap-2">
        {savedAsDraft && (
          <Button variant="outline" onClick={onOpenNote} data-testid="oie-open-note"><ExternalLink className="mr-1 h-4 w-4" /> Gelen Belgeler'de aç</Button>
        )}
        <Button onClick={onSave} disabled={!ready || pending || reasons.length > 0} data-testid="oie-save">
          <Save className="mr-1 h-4 w-4" /> {pending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>
    </div>
  );
}
