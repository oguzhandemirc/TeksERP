// S16d: klasik iş emri formunda okutulan belgenin durumu — okuma bekleme, özetin form kutularına yerinde uygulanması,
// "Belgeden" rozetleri, belge kartı taslağı (müşteri/parti/metre/not) ve kayıt (belge okutulduysa S16a form ucu).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { TERIM } from "@/lib/terim";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { useTabsStore } from "@/store/tabs";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import { belgeOkutStage, type BelgeOkutStage } from "@/pages/Operations/GelenBelgeler/belgeOkut";
import { getDeliveryNote, INCOMING_DOCUMENT_QUERY_KEY } from "@/pages/Operations/GelenBelgeler/service";
import { duplicateGateConflict, duplicateGateText, withDuplicateConfirm } from "@/pages/Operations/GelenBelgeler/DuplicateDocNo";
import type { DeliveryNoteDetail } from "@/pages/Operations/GelenBelgeler/types";
import type { WorkOrderFormValues } from "../schema";
import { FromDocBadge } from "./DocFields";
import { docDraftReasons, initialDocDraft, type DocDraft } from "./docDraft";
import { applyReadSummary, docMarks, docNoteText, formEndpointExtras, mergeDocDraft, type AppliedDoc, type ClassicPayloadPart, type DocFillKey, type DocReadSummary } from "./docFormFill";
import { initialMultiParty, type MultiPartyDraft } from "./partyDraft";
import { AUTO_PRINT_TEXT, printRefakatCard, useRefakatAutoPrint } from "./refakatPrint";
import { draftSavedText, saveDoc, saveErrorHint, type SaveDocInput } from "./saveDoc";
import { getNoteParties, getReadSummary } from "./service";
import { useFormApproval } from "./useFormApproval";

const FILL_KEYS: DocFillKey[] = ["targetItemId", "targetColorId", "width", "targetQuantity", "targetWeight"];
/** Tanıt sekmesi açıkken özet yoklamasının üst sınırı: tanıtma yarıda kalırsa yoklama sonsuza dek sürmez ("Yeniden oku" kalır). */
export const AWAIT_TEACH_MAX_MS = 10 * 60_000;

interface Options {
  /** Formda seçili rota şablonu; yoksa rotasız (yalnız "Okutmayla" kipinde sunucu kabul eder). */
  routeTemplateId: string | null;
  itemLocked: boolean;
  targetQuantityEnabled: boolean;
}

/** Özet her geldiğinde (ilk okuma ya da tanıtma sonrası yeniden) form kutularına uygulanır; elle düzeltilen kutu ezilmez. */
function useSummaryFill(form: UseFormReturn<WorkOrderFormValues>, sum: { data: DocReadSummary | undefined; dataUpdatedAt: number }, o: Options, onTaught: () => void) {
  const { data, dataUpdatedAt: updatedAt } = sum;
  const [applied, setApplied] = useState<AppliedDoc>({});
  const appliedRef = useRef<AppliedDoc>({});
  const lastSummary = useRef<number>(0);
  const taughtRef = useRef(onTaught);
  taughtRef.current = onTaught;
  useEffect(() => {
    if (!data || updatedAt === lastSummary.current) return;
    lastSummary.current = updatedAt;
    const current = Object.fromEntries(FILL_KEYS.map((k) => [k, form.getValues(k)]));
    const r = applyReadSummary(current, appliedRef.current, data, o);
    for (const k of FILL_KEYS) if (k in r.patch) form.setValue(k, r.patch[k] as never, { shouldDirty: true });
    appliedRef.current = r.applied;
    setApplied(r.applied);
    if (data.tanitim?.durum === "TANITILDI") taughtRef.current();
  }, [data, updatedAt, form, o]);
  return {
    applied,
    reset: () => {
      appliedRef.current = {};
      lastSummary.current = 0;
      setApplied({});
    },
  };
}

/** Tanıt sekmesine gidildi: özet tanıtılana dek (en çok AWAIT_TEACH_MAX_MS) yoklanır; dönünce form kendiliğinden yeniden dolar. */
function useAwaitTeach() {
  const [awaiting, setAwaiting] = useState(false);
  useEffect(() => {
    if (!awaiting) return undefined;
    const t = setTimeout(() => setAwaiting(false), AWAIT_TEACH_MAX_MS);
    return () => clearTimeout(t);
  }, [awaiting]);
  return [awaiting, setAwaiting] as const;
}

export function useFormDocScan(form: UseFormReturn<WorkOrderFormValues>, o: Options) {
  const [noteId, setNoteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DocDraft | null>(null);
  const [multi, setMulti] = useState<MultiPartyDraft | null | undefined>(undefined);
  const [awaitingTeach, setAwaitingTeach] = useAwaitTeach();
  const tabActive = useIsTabActive();
  const approval = useFormApproval();
  const qc = useQueryClient();
  const note = useQuery({
    queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "detail", noteId],
    queryFn: () => getDeliveryNote(noteId as string),
    enabled: Boolean(noteId),
    refetchInterval: (q) => (tabActive && q.state.data && belgeOkutStage(q.state.data) === "READING" ? 3000 : false),
  });
  const stage: BelgeOkutStage | null = note.data ? belgeOkutStage(note.data) : noteId ? "READING" : null;
  const read = Boolean(noteId) && stage !== null && stage !== "READING";
  const summary = useQuery({
    queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "okuma-ozeti", noteId],
    queryFn: () => getReadSummary(noteId as string),
    enabled: read,
    retry: false,
    refetchInterval: awaitingTeach && tabActive ? 5000 : false,
  });
  const parties = useQuery({
    queryKey: [INCOMING_DOCUMENT_QUERY_KEY, noteId, "partiler"],
    queryFn: () => getNoteParties(noteId as string),
    enabled: read && approval.value === "WITH_WORK_ORDER",
  });

  const fill = useSummaryFill(form, summary, o, () => setAwaitingTeach(false));
  // Belge kartı okuma bitince bir kez dolar; sonraki okumalar yalnız boş kutuları tamamlar.
  useEffect(() => {
    if (!read || !note.data) return;
    const fresh = initialDocDraft(note.data);
    const text = docNoteText(summary.data);
    setDraft((d) => (d ? mergeDocDraft(d, fresh, text) : { ...fresh, notes: text }));
  }, [read, note.data, summary.data]);
  useEffect(() => {
    if (multi === undefined && parties.isFetched) setMulti(initialMultiParty(parties.data));
  }, [multi, parties.isFetched, parties.data]);

  const watched = form.watch(FILL_KEYS);
  const marks = docMarks(Object.fromEntries(FILL_KEYS.map((k, i) => [k, watched[i]])), fill.applied);
  const multiDraft = approval.value === "WITH_WORK_ORDER" ? (multi ?? null) : null;
  const submit = useDocSubmit();

  return {
    noteId,
    note: note.data as DeliveryNoteDetail | undefined,
    noteError: note.isError,
    stage,
    summary: summary.data as DocReadSummary | undefined,
    summaryLoading: summary.isLoading && read,
    draft,
    setDraft,
    multiDraft,
    parties: parties.data ?? null,
    setMulti,
    approval: approval.value,
    awaitingTeach,
    reasons: draft ? docDraftReasons(draft, multiDraft) : [],
    start: (id: string) => {
      fill.reset();
      setDraft(null);
      setMulti(undefined);
      setAwaitingTeach(false);
      setNoteId(id);
    },
    awaitTeach: () => setAwaitingTeach(true),
    reread: () => void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] }),
    /** Etiketin yanına "Belgeden" rozeti (değer hâlâ belgeden yazılan değerse). */
    label: (text: string, k: DocFillKey): ReactNode => (marks.has(k) ? <span className="inline-flex items-center gap-1.5">{text} <FromDocBadge /></span> : text),
    /** Belge okutulduysa kayıt form ucuna gider; dönen söz kayıt bitince (ya da hata gösterilince) çözülür. */
    submit: (payload: ClassicPayloadPart): Promise<void> => {
      if (!noteId || !note.data || !draft || !read) {
        toast.error("Belge henüz okunuyor — okuma bitince kaydedin.");
        return Promise.resolve();
      }
      const perParty = multiDraft?.mode === "PER_PARTY";
      const extra = { ...formEndpointExtras(payload, perParty), targetValues: payload.targetValues ?? [] };
      return submit({ note: note.data, draft, multi: multiDraft, routeTemplateId: o.routeTemplateId, formApproval: approval.value, gramajPropertyId: null, extra });
    },
  };
}
export type FormDocScan = ReturnType<typeof useFormDocScan>;

/** Kayıt sonucu tek yüzeyde: iş emri açıldı → detayına; ayrı onay → taslak bilgisi; mükerrer belge no → "Yine de kaydet". */
function useDocSubmit() {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const autoPrint = useRefakatAutoPrint();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const run = async (input: Omit<SaveDocInput, "clientToken">): Promise<void> => {
    try {
      const out = await saveDoc({ ...input, clientToken: attempt.token() });
      attempt.onSuccess();
      void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] });
      if (out.kind === "DRAFT_SAVED") {
        toast.success(draftSavedText());
        return;
      }
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      const many = out.result.workOrders ?? [];
      toast.success(many.length > 1 ? `${many.length} ${TERIM.terbiyeIsEmri.tekilKucuk} açıldı: ${many.map((w) => w.workOrderNo).join(", ")}` : `${TERIM.terbiyeIsEmri.tekil} açıldı: ${out.result.workOrderNo}`);
      navigateActive(`/operations/work-orders/${out.result.workOrderId}`);
      if (autoPrint) toast.message(AUTO_PRINT_TEXT[await printRefakatCard(out.result.workOrderId)]);
    } catch (e) {
      attempt.onFailure(e);
      const dup = duplicateGateConflict(e);
      if (dup) {
        // Parti no BLOCK'u yalnız bilgi; WARN'larda "Yine de" önceki onaylarla birlikte yeniden gönderir.
        toast.error(duplicateGateText(dup), dup.confirmable
          ? { action: { label: dup.gate === "docNo" ? "Yine de kaydet" : "Yine de aç", onClick: () => void run({ ...input, confirms: withDuplicateConfirm(input.confirms, dup) }) } }
          : undefined);
        return;
      }
      toast.error(saveErrorHint(e) ?? apiErrorText(e, "Kaydedilemedi."));
    }
  };
  return run;
}
