// Toplu okutma listesi (K8): belge başına kompakt satır (müşteri · parti no · metre · gramaj), satır açılıp düzenlenir;
// "Hepsini kaydet" her belge için ayrı kayıt (sözleşme 3) çağırır, sonuç satır başına — biri düşerse diğerleri sürer.
import { TERIM } from "@/lib/terim";
import { useEffect, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { batchFailure } from "./batchToken";
import { useKursunGramajCatalog } from "@/lib/kursun-gramaj";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import { belgeOkutStage } from "@/pages/Operations/GelenBelgeler/belgeOkut";
import { getDeliveryNote, INCOMING_DOCUMENT_QUERY_KEY } from "@/pages/Operations/GelenBelgeler/service";
import type { DeliveryNoteDetail } from "@/pages/Operations/GelenBelgeler/types";
import { DuplicateGateConfirm, duplicateGateConflict, withDuplicateConfirm } from "@/pages/Operations/GelenBelgeler/DuplicateDocNo";
import type { DuplicateConfirms, DuplicateGateConflict } from "@/pages/Operations/GelenBelgeler/mukerrerTypes";
import { gramajOffer, initialDocDraft, passThroughTargets, routeGramajOptions, seedDraftGramaj, type DocDraft } from "./docDraft";
import { useOieDefaultTargets } from "./useOieDefaults";
import { AUTO_PRINT_TEXT, printRefakatCard, useRefakatAutoPrint } from "./refakatPrint";
import { saveDoc, saveErrorHint } from "./saveDoc";
import { BulkRow, type RowResult } from "./BulkRow";
import { useFormApproval } from "./useFormApproval";
import type { RouteRef } from "./nav";

interface Props {
  noteIds: string[];
  route: RouteRef;
}

const isReading = (n: DeliveryNoteDetail | undefined) => !n || belgeOkutStage(n) === "READING";

function useNotes(noteIds: string[]) {
  const tabActive = useIsTabActive();
  return useQueries({
    queries: noteIds.map((id) => ({
      queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "detail", id],
      queryFn: () => getDeliveryNote(id),
      refetchInterval: (q: { state: { data?: DeliveryNoteDetail } }) => (tabActive && isReading(q.state.data) ? 5000 : false),
    })),
  });
}

function conflictRowText(c: DuplicateGateConflict): string {
  if (c.gate === "docNo") return "Belge no işi süren başka belgede kayıtlı — aşağıdan karar verin.";
  return c.confirmable ? "Bu parti zaten var — aşağıdan karar verin." : "Bu parti zaten var; fabrika ayarı ikinci kez açılmasına izin vermiyor.";
}

export function TopluBelgeForm({ noteIds, route }: Props) {
  const notes = useNotes(noteIds);
  const { catalog, isLoading: catalogLoading } = useKursunGramajCatalog();
  const gramajOptions = routeGramajOptions(catalog.options, route.hasKursun);
  const approval = useFormApproval();
  const autoPrint = useRefakatAutoPrint();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, DocDraft>>({});
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [busy, setBusy] = useState(false);
  // Mükerrer kapısı 409'u satır başına; "Yine de" yalnız o satırı, satırın önceki onaylarıyla birlikte yeniden gönderir.
  const [conflicts, setConflicts] = useState<Record<string, DuplicateGateConflict>>({});
  const confirmsRef = useRef<Record<string, DuplicateConfirms>>({});
  const attempt = useAttemptToken();
  // Satır taslağı belge okununca bir kez dolar; gramaj teklifi (K22 çözücü, müşteri başına) geldikçe tohumlanır.
  const loaded = notes.map((q) => q.data);
  const targetsFor = useOieDefaultTargets(route.id, Object.values(drafts).map((d) => d.ownerCustomerId));
  useEffect(() => {
    const add: Record<string, DocDraft> = {};
    for (const n of loaded) if (n && !isReading(n) && !drafts[n.id]) add[n.id] = initialDocDraft(n);
    if (Object.keys(add).length) setDrafts((d) => ({ ...d, ...add }));
  }, [loaded, drafts]);
  useEffect(() => {
    if (catalogLoading) return;
    const seed = (d: DocDraft) => seedDraftGramaj(d, gramajOffer(targetsFor(d.ownerCustomerId), catalog.propertyId, gramajOptions));
    if (!Object.values(drafts).some((d) => seed(d) !== d)) return;
    setDrafts((all) => Object.fromEntries(Object.entries(all).map(([id, d]) => [id, seed(d)])));
  }, [drafts, targetsFor, catalogLoading, catalog.propertyId, gramajOptions]);

  const saveRows = async (only: string | null = null) => {
    setBusy(true);
    const errors: unknown[] = [];
    for (const n of loaded) {
      const draft = n ? drafts[n.id] : undefined;
      if (!n || !draft || results[n.id]?.kind === "OK" || (only !== null && n.id !== only)) continue;
      try {
        const passThrough = passThroughTargets(targetsFor(draft.ownerCustomerId), catalog.propertyId);
        const out = await saveDoc({ note: n, draft, routeTemplateId: route.id, formApproval: approval.value, gramajPropertyId: catalog.propertyId, passThrough, clientToken: attempt.keyed(n.id), confirms: only === n.id ? confirmsRef.current[n.id] : undefined });
        setConflicts(({ [n.id]: _, ...rest }) => rest);
        setResults((r) => ({ ...r, [n.id]: out.kind === "WORK_ORDER" ? { kind: "OK", text: `${TERIM.terbiyeIsEmri.tekil} ${out.result.workOrderNo}`, workOrderId: out.result.workOrderId } : { kind: "OK", text: "Taslak kaydedildi (onay Gelen Belgeler'den)" } }));
        if (out.kind === "WORK_ORDER" && autoPrint) toast.message(`${out.result.workOrderNo}: ${AUTO_PRINT_TEXT[await printRefakatCard(out.result.workOrderId)]}`);
      } catch (e) {
        errors.push(e);
        const conflict = duplicateGateConflict(e);
        setConflicts(({ [n.id]: _, ...rest }) => (conflict ? { ...rest, [n.id]: conflict } : rest));
        if (conflict) { setResults((r) => ({ ...r, [n.id]: { kind: "DUPLICATE", text: conflictRowText(conflict) } })); continue; }
        setResults((r) => ({ ...r, [n.id]: { kind: "FAILED", text: saveErrorHint(e) ?? apiErrorText(e, e instanceof Error ? e.message : "Kaydedilemedi.") } }));
      }
    }
    const failure = batchFailure(errors);
    if (failure === undefined) attempt.onSuccess();
    else attempt.onFailure(failure);
    setBusy(false);
    void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] });
    void qc.invalidateQueries({ queryKey: ["work-orders"] });
  };

  const waiting = loaded.some((n) => isReading(n));
  // Ön seçim cevabı gelmeden kayıt yok (gövde ekranda görünenle aynı olsun).
  const defaultsReady = Object.values(drafts).every((d) => targetsFor(d.ownerCustomerId) !== undefined);
  const pending = loaded.filter((n) => n && results[n.id]?.kind !== "OK").length;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="oie-bulk-form">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <p className="mb-3 text-sm">Rota <b>{route.name}</b> · {noteIds.length} belge{waiting ? " · okunanlar geldikçe satırlar dolar" : ""}</p>
        <div className="flex flex-col gap-2">
          {noteIds.map((id, i) => (
            <div key={id} className="flex flex-col gap-1">
              <BulkRow note={loaded[i]} draft={drafts[id]} result={results[id]} gramajOptions={gramajOptions} disabled={busy}
                onChange={(d) => setDrafts((all) => ({ ...all, [id]: d }))} />
              {conflicts[id] && <DuplicateGateConfirm conflict={conflicts[id]} busy={busy} onCancel={() => setConflicts(({ [id]: _, ...rest }) => rest)}
                onConfirm={() => { confirmsRef.current[id] = withDuplicateConfirm(confirmsRef.current[id], conflicts[id]!); void saveRows(id); }} />}
            </div>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-3">
        <Button onClick={() => void saveRows()} disabled={busy || pending === 0 || Object.keys(drafts).length === 0 || !defaultsReady} data-testid="oie-bulk-save">
          <Save className="mr-1 h-4 w-4" /> {busy ? "Kaydediliyor…" : `Hepsini kaydet (${pending})`}
        </Button>
      </div>
    </div>
  );
}
