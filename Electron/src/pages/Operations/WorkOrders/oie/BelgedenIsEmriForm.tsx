// Belgeden iş emri formu (K6/K7): okutulan belge okunurken bekler, okununca formun kutuları dolar ("Belgeden" rozeti +
// küçük önizleme). Kaydet: ayar WITH_WORK_ORDER → belge + top + iş emri tek seferde; değilse taslağa yazılır (bugünkü).
import { TERIM } from "@/lib/terim";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { DuplicateDocNoConfirm, duplicateDocNoConflict } from "@/pages/Operations/GelenBelgeler/DuplicateDocNo";
import type { DuplicateDocNoNotice } from "@/pages/Operations/GelenBelgeler/mukerrerTypes";
import { useNoteDetail } from "@/pages/Operations/GelenBelgeler/useNoteDetail";
import { DocFields, FromDocBadge } from "./DocFields";
import { DocThumb } from "./DocThumb";
import { docDraftReasons, gramajOffer, initialDocDraft, passThroughTargets, routeGramajOptions, seedDraftGramaj, type DocDraft } from "./docDraft";
import { useOieDefaultTargets } from "./useOieDefaults";
import type { DefaultTarget } from "@/lib/station-default-targets";
import { AUTO_PRINT_TEXT, printRefakatCard, useRefakatAutoPrint } from "./refakatPrint";
import { draftSavedText, saveLabel, saveDoc, saveErrorHint, type SaveOutcome } from "./saveDoc";
import { useFormApproval } from "./useFormApproval";
import { PartyList } from "./PartyList";
import { initialMultiParty, type MultiPartyDraft } from "./partyDraft";
import { getNoteParties } from "./service";
import type { RouteRef } from "./nav";
import { TeachButton, UnknownTypeStrip } from "@/pages/Operations/GelenBelgeler/tanit/TeachEntry";

interface Props {
  noteId: string;
  route: RouteRef;
}

function useSave(noteId: string, route: Props["route"]) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const approval = useFormApproval();
  const autoPrint = useRefakatAutoPrint();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const { catalog } = useKursunGramajCatalog();
  return useMutation({
    mutationFn: (v: { note: NonNullable<ReturnType<typeof useNoteDetail>["note"]["data"]>; draft: DocDraft; multi: MultiPartyDraft | null; targets: readonly DefaultTarget[] | null; confirmDuplicateDocNo?: boolean }): Promise<SaveOutcome> =>
      saveDoc({ ...v, routeTemplateId: route.id, formApproval: approval.value, gramajPropertyId: catalog.propertyId, passThrough: passThroughTargets(v.targets, catalog.propertyId), clientToken: attempt.token() }),
    onError: (e) => attempt.onFailure(e),
    onSuccess: async (out) => {
      attempt.onSuccess();
      void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] });
      if (out.kind !== "WORK_ORDER") return;
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      const many = out.result.workOrders ?? [];
      toast.success(many.length > 1 ? `${many.length} ${TERIM.terbiyeIsEmri.tekilKucuk} açıldı: ${many.map((w) => w.workOrderNo).join(", ")}` : `${TERIM.terbiyeIsEmri.tekil} açıldı: ${out.result.workOrderNo}`);
      if (autoPrint) toast.message(AUTO_PRINT_TEXT[await printRefakatCard(out.result.workOrderId)]);
      navigateActive(`/operations/work-orders/${out.result.workOrderId}`);
    },
  });
}

export function BelgedenIsEmriForm({ noteId, route }: Props) {
  const { note, invalidate } = useNoteDetail(noteId);
  const approval = useFormApproval();
  const n = note.data;
  const stage = n ? belgeOkutStage(n) : "READING";
  const { catalog, isLoading: catalogLoading } = useKursunGramajCatalog();
  // Kurşunsuz rotada gramaj kutusu ve varsayılanı yok (sunucu hedefi 400'le reddeder).
  const gramajOptions = routeGramajOptions(catalog.options, route.hasKursun);
  const [draft, setDraft] = useState<DocDraft | null>(null);
  // K22: ön seçim sunucu çözücüsünden (müşteri > istasyon yeteneği > değer varsayılanı); panel kural yazmaz.
  const targetsFor = useOieDefaultTargets(route.id, [draft?.ownerCustomerId ?? null]);
  const targets = draft ? targetsFor(draft.ownerCustomerId) : undefined;
  const offer = catalogLoading ? undefined : gramajOffer(targets, catalog.propertyId, gramajOptions);
  const [multi, setMulti] = useState<MultiPartyDraft | null | undefined>(undefined);
  // S1: çok partili belge — parti özeti okuma bitince bir kez; eski backend (404) → null = bugünkü tek partili form.
  const parties = useQuery({ queryKey: ["gelen-belge", noteId, "partiler"], queryFn: () => getNoteParties(noteId), enabled: stage !== "READING" && approval.value === "WITH_WORK_ORDER" });
  const save = useSave(noteId, route);
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const openTab = useTabsStore((s) => s.openTab);
  // Taslak bir kez, okuma bitince dolar; gramaj teklifi geldikçe (müşteri değişince yeniden) tohumlanır.
  useEffect(() => {
    if (n && !draft && stage !== "READING") setDraft(initialDocDraft(n));
  }, [n, draft, stage]);
  useEffect(() => {
    if (draft && seedDraftGramaj(draft, offer) !== draft) setDraft(seedDraftGramaj(draft, offer));
  }, [draft, offer]);
  useEffect(() => {
    if (multi === undefined && parties.isFetched) setMulti(initialMultiParty(parties.data));
  }, [multi, parties.isFetched, parties.data]);
  if (!n) return <p className="p-6 text-sm text-muted-foreground">{note.isError ? "Belge yüklenemedi." : "Yükleniyor…"}</p>;
  if (stage === "CLOSED") return <p className="p-6 text-sm text-muted-foreground">Belge artık taslak değil ({n.noteNo}).</p>;
  const multiDraft = approval.value === "WITH_WORK_ORDER" ? (multi ?? null) : null;
  const reasons = draft ? docDraftReasons(draft, multiDraft) : [];
  const saved = save.data?.kind === "DRAFT_SAVED";
  // K27 WARN: işi süren aynı belge no'lu eş → genel hata yerine karar kutusu; onay aynı girdiyi bayrakla yeniden gönderir.
  const dup = save.isError ? duplicateDocNoConflict(save.error) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="oie-doc-form">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-[1fr_260px]">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <FromDocBadge />
              <span>Belge <b>{n.noteNo}</b> · Rota <b>{route.name}</b></span>
              {/* S1b: okunmuş belgede tanıtma yeni sekmede açılır (form kaybolmaz). */}
              {stage !== "READING" && <TeachButton note={n} go={(p) => openTab(p)} />}
            </div>
            {stage !== "READING" && <UnknownTypeStrip note={n} go={(p) => openTab(p)} />}
            {stage === "READING" || !draft ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="oie-reading">
                <Loader2 className="h-4 w-4 animate-spin" /> Belge okunuyor… Okuma bitince kutular kendiliğinden dolar.
              </p>
            ) : (
              <>
                {stage === "READ_FAILED" && <ScanReadBanner scans={n.scans} lines={n.lines} editable canRequeue onRequeued={() => void invalidate()} />}
                {stage === "NO_SERVICE" && <p className="text-sm text-amber-800 dark:text-amber-300" data-testid="oie-no-service">Bu kurulumda belge okuma servisi yok; değerleri elle girin.</p>}
                <DocFields note={n} draft={draft} onChange={setDraft} gramajOptions={gramajOptions} disabled={save.isPending || saved} />
                {multiDraft && parties.data && <PartyList view={parties.data} value={multiDraft} onChange={setMulti} disabled={save.isPending || saved} />}
              </>
            )}
          </div>
          <DocThumb scans={n.scans} />
        </div>
      </div>
      <SaveBar
        reasons={reasons}
        ready={Boolean(draft) && stage !== "READING" && !saved && targets !== undefined}
        pending={save.isPending}
        dup={dup}
        onConfirmDuplicate={() => save.variables && save.mutate({ ...save.variables, confirmDuplicateDocNo: true })}
        error={save.isError && !dup ? (saveErrorHint(save.error) ?? apiErrorText(save.error, "Kaydedilemedi.")) : null}
        savedAsDraft={saved}
        label={approval.value === "WITH_WORK_ORDER" ? saveLabel() : "Taslak kaydet"}
        onSave={() => draft && targets !== undefined && save.mutate({ note: n, draft, multi: multiDraft, targets })}
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
  dup: DuplicateDocNoNotice | null;
  onConfirmDuplicate: () => void;
  savedAsDraft: boolean;
  /** WITH_WORK_ORDER: kayıt iş emrini açar → "<Terbiye İş Emri> oluştur"; ayrı onayda yalnız taslak yazılır. */
  label: string;
  onSave: () => void;
  onOpenNote: () => void;
}

function SaveBar({ reasons, ready, pending, error, dup, onConfirmDuplicate, savedAsDraft, label, onSave, onOpenNote }: SaveBarProps) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t px-6 py-3">
      {ready && reasons.length > 0 && (
        <ul className="text-xs text-amber-800 dark:text-amber-300" data-testid="oie-reasons">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      )}
      {error && <p role="alert" className="rounded bg-destructive/10 px-2 py-1 text-sm text-destructive" data-testid="oie-error">{error}</p>}
      {dup && <DuplicateDocNoConfirm conflict={dup} busy={pending} onConfirm={onConfirmDuplicate} />}
      {savedAsDraft && <p className="text-sm text-emerald-700 dark:text-emerald-400" data-testid="oie-draft-saved">{draftSavedText()}</p>}
      <div className="flex justify-end gap-2">
        {savedAsDraft && (
          <Button variant="outline" onClick={onOpenNote} data-testid="oie-open-note"><ExternalLink className="mr-1 h-4 w-4" /> Gelen Belgeler'de aç</Button>
        )}
        <Button onClick={onSave} disabled={!ready || pending || reasons.length > 0} data-testid="oie-save">
          <Save className="mr-1 h-4 w-4" /> {pending ? "Kaydediliyor…" : label}
        </Button>
      </div>
    </div>
  );
}
