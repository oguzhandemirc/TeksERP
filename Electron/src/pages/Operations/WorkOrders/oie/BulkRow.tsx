// Toplu okutma listesinin bir satırı: kompakt özet (müşteri seçicisi + parti no + metre + gramaj + sonuç); "Düzenle"
// tekli formun kutularını (DocFields) satırın altında açar.
import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import type { GramajOption } from "@/lib/kursun-gramaj";
import type { DeliveryNoteDetail } from "@/pages/Operations/GelenBelgeler/types";
import { DocFields } from "./DocFields";
import { applyPatch, docDraftReasons, type DocDraft } from "./docDraft";

/** DUPLICATE: K27 WARN 409 — karar satırın altındaki kutuda (TopluBelgeForm). */
export type RowResult = { kind: "OK"; text: string; workOrderId?: string } | { kind: "FAILED"; text: string } | { kind: "DUPLICATE"; text: string };

interface Props {
  note: DeliveryNoteDetail | undefined;
  draft: DocDraft | undefined;
  result: RowResult | undefined;
  gramajOptions: readonly GramajOption[];
  disabled: boolean;
  onChange: (d: DocDraft) => void;
}

function ResultCell({ result, reasons }: { result: RowResult | undefined; reasons: string[] }) {
  if (result?.kind === "OK") return <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400" data-testid="oie-row-ok"><CheckCircle2 className="h-4 w-4" />{result.text}</span>;
  if (result?.kind === "FAILED") return <span className="flex items-center gap-1 text-destructive" data-testid="oie-row-failed"><XCircle className="h-4 w-4" />{result.text}</span>;
  if (result?.kind === "DUPLICATE") return <span className="flex items-center gap-1 text-amber-800 dark:text-amber-300" data-testid="oie-row-duplicate"><XCircle className="h-4 w-4" />{result.text}</span>;
  if (reasons.length) return <span className="text-amber-800 dark:text-amber-300" data-testid="oie-row-reasons">{reasons.join(" ")}</span>;
  return <span className="text-muted-foreground">Hazır</span>;
}

export function BulkRow({ note, draft, result, gramajOptions, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  if (!note || !draft) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground" data-testid="oie-row-reading">
        <Loader2 className="h-4 w-4 animate-spin" /> {note?.noteNo ?? "Belge"} okunuyor…
      </div>
    );
  }
  const locked = disabled || result?.kind === "OK";
  const gramaj = gramajOptions.find((o) => o.id === draft.gramajId)?.name ?? "—";
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" data-testid="oie-row" data-note={note.id}>
      <div className="grid grid-cols-[90px_minmax(180px,1.4fr)_1fr_1fr_80px_minmax(160px,1.5fr)_auto] items-center gap-2 text-sm">
        <span className="font-medium">{note.noteNo}</span>
        <CustomerPickerField value={draft.ownerCustomerId} onChange={(id) => onChange(applyPatch(draft, { ownerCustomerId: id }))} disabled={locked} placeholder="Müşteri seç" />
        <span data-testid="oie-row-batch">{draft.ourBatchNo ?? "—"}</span>
        <span className="tabular-nums" data-testid="oie-row-meters">
          {draft.meters ?? "—"} m {draft.metersReview && <Badge variant="muted">doğrula</Badge>}
        </span>
        <span data-testid="oie-row-gramaj">{gramaj}</span>
        <ResultCell result={result} reasons={docDraftReasons(draft)} />
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(!open)} disabled={locked} aria-label="Satırı düzenle">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} Düzenle
        </Button>
      </div>
      {open && !locked && <DocFields note={note} draft={draft} onChange={onChange} gramajOptions={gramajOptions} />}
    </div>
  );
}
