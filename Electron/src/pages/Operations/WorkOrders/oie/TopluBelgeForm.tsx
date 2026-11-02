// Toplu okutma listesi (K8): belge başına kompakt satır (müşteri · parti no · metre · gramaj), satır açılıp düzenlenir;
// "Hepsini kaydet" her belge için ayrı kayıt (sözleşme 3) çağırır, sonuç satır başına — biri düşerse diğerleri sürer.
import { TERIM } from "@/lib/terim";
import { useEffect, useState } from "react";
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
import { initialDocDraft, type DocDraft } from "./docDraft";
import { AUTO_PRINT_TEXT, printRefakatCard, useRefakatAutoPrint } from "./refakatPrint";
import { saveDoc, saveErrorHint } from "./saveDoc";
import { BulkRow, type RowResult } from "./BulkRow";
import { useFormApproval } from "./useFormApproval";

interface Props {
  noteIds: string[];
  route: { id: string; name: string };
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

export function TopluBelgeForm({ noteIds, route }: Props) {
  const notes = useNotes(noteIds);
  const { catalog, isLoading: catalogLoading } = useKursunGramajCatalog();
  const approval = useFormApproval();
  const autoPrint = useRefakatAutoPrint();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, DocDraft>>({});
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [busy, setBusy] = useState(false);
  const attempt = useAttemptToken();
  // Satır taslağı belge okununca ve gramaj kataloğu gelince bir kez dolar.
  const loaded = notes.map((q) => q.data);
  useEffect(() => {
    if (catalogLoading) return;
    const add: Record<string, DocDraft> = {};
    for (const n of loaded) if (n && !isReading(n) && !drafts[n.id]) add[n.id] = initialDocDraft(n, catalog.options);
    if (Object.keys(add).length) setDrafts((d) => ({ ...d, ...add }));
  }, [loaded, catalogLoading, catalog.options, drafts]);

  const saveAll = async () => {
    setBusy(true);
    const errors: unknown[] = [];
    for (const n of loaded) {
      const draft = n ? drafts[n.id] : undefined;
      if (!n || !draft || results[n.id]?.kind === "OK") continue;
      try {
        const out = await saveDoc({ note: n, draft, routeTemplateId: route.id, formApproval: approval.value, gramajPropertyId: catalog.propertyId, clientToken: attempt.keyed(n.id) });
        setResults((r) => ({ ...r, [n.id]: out.kind === "WORK_ORDER" ? { kind: "OK", text: `${TERIM.terbiyeIsEmri.tekil} ${out.result.workOrderNo}`, workOrderId: out.result.workOrderId } : { kind: "OK", text: "Taslak kaydedildi (onay Gelen Belgeler'den)" } }));
        if (out.kind === "WORK_ORDER" && autoPrint) toast.message(`${out.result.workOrderNo}: ${AUTO_PRINT_TEXT[await printRefakatCard(out.result.workOrderId)]}`);
      } catch (e) {
        errors.push(e);
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
  const pending = loaded.filter((n) => n && results[n.id]?.kind !== "OK").length;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="oie-bulk-form">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <p className="mb-3 text-sm">Rota <b>{route.name}</b> · {noteIds.length} belge{waiting ? " · okunanlar geldikçe satırlar dolar" : ""}</p>
        <div className="flex flex-col gap-2">
          {noteIds.map((id, i) => (
            <BulkRow key={id} note={loaded[i]} draft={drafts[id]} result={results[id]} gramajOptions={catalog.options} disabled={busy}
              onChange={(d) => setDrafts((all) => ({ ...all, [id]: d }))} />
          ))}
        </div>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-3">
        <Button onClick={() => void saveAll()} disabled={busy || pending === 0 || Object.keys(drafts).length === 0} data-testid="oie-bulk-save">
          <Save className="mr-1 h-4 w-4" /> {busy ? "Kaydediliyor…" : `Hepsini kaydet (${pending})`}
        </Button>
      </div>
    </div>
  );
}
