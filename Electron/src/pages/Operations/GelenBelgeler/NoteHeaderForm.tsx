// "Belge bilgileri" kartı: sahip/gönderen DOĞRUDAN MODAL seçici + eşleme önerisi; ikincil alanlar katlanır "Diğer bilgiler"de.
// Metin alanları odak çıkınca yazılır (PATCH yalnız değişeni).
import { useState, type ReactNode } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { SuggestionChips } from "./SuggestionChips";
import { hasSameBatch } from "./SameBatchStrip";
import { retentionDocNoWarning, retentionModeFor } from "./photoRetention";
import { FisNoDuzeltDialog } from "./FisNoDuzeltDialog";
import type { DeliveryNoteDetail, HeaderPatch, NoteMatchSuggestions } from "./types";

interface Props {
  note: DeliveryNoteDetail;
  suggestions: NoteMatchSuggestions | undefined;
  editable: boolean;
  /** Onaylı belgede fiş no / tarih düzeltme (izinli + APPROVED/PARTIAL); taslak formu zaten yazılabilir. */
  canFixIdentity?: boolean;
  onPatch: (p: HeaderPatch) => void;
}

type TextKey = "senderDocNo" | "customerBatchNo" | "customerOrderNo" | "processText" | "senderText";
interface TextField {
  key: TextKey;
  label: string;
  max: number;
}
// `max` = backend Zod sınırı = kolon VarChar'ı (taşan değer sunucuda 400 olurdu; giriş baştan keser).
const DOC_NO_FIELD: TextField = { key: "senderDocNo", label: "Gönderen belge no", max: 64 };
const OTHER_TEXT_FIELDS: TextField[] = [
  { key: "senderText", label: "Gönderen (belgedeki ad)", max: 160 },
  { key: "customerBatchNo", label: "Müşteri parti no", max: 64 },
  { key: "customerOrderNo", label: "Müşteri sipariş no", max: 64 },
  { key: "processText", label: "İşlem", max: 120 },
];

/** "Diğer bilgiler"deki bir alana dokunan okuma uyarısı (parti no · top adedi · eksik sayfa) ya da aynı partili belge → açık başlar. */
const OTHER_INFO_NOTICE_CODES: ReadonlySet<string> = new Set(["BATCH_NO_DIFFERS", "HEADER_LINE_COUNT_UNREAD", "PAGE_INCOMPLETE"]);
export function otherInfoNeedsAttention(note: Pick<DeliveryNoteDetail, "notices" | "sameBatch">): boolean {
  return (note.notices ?? []).some((n) => OTHER_INFO_NOTICE_CODES.has(n.code)) || hasSameBatch(note.sameBatch);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function TextInput({ note, field, editable, onBlur, highlight }: { note: DeliveryNoteDetail; field: TextField; editable: boolean; onBlur: (k: TextKey, v: string) => void; highlight?: boolean }) {
  return (
    <Input
      defaultValue={note[field.key] ?? ""}
      maxLength={field.max}
      aria-label={field.label}
      disabled={!editable}
      onBlur={(e) => onBlur(field.key, e.target.value)}
      className={highlight ? "border-amber-500 ring-2 ring-amber-400" : undefined}
      data-highlight={highlight ? "retention" : undefined}
    />
  );
}

/** Onaylı belgede kilitli fiş alanlarının yanındaki küçük "Düzelt" düğmesi + diyaloğu. */
function IdentityFixAction({ note }: { note: DeliveryNoteDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-end md:col-span-2">
      <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setOpen(true)} data-testid="fis-no-duzelt">
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        Fiş no / tarih düzelt
      </Button>
      <FisNoDuzeltDialog note={note} open={open} onOpenChange={setOpen} />
    </div>
  );
}

export function NoteHeaderForm({ note, suggestions, editable, canFixIdentity = false, onPatch }: Props) {
  // K28: fotoğraf onaydan sonra küçülür/silinir → belge no'yu şimdi kontrol ettir (yalnız düzenlenebilir taslakta).
  const docNoWarning = editable ? retentionDocNoWarning(retentionModeFor(note)) : null;
  const [otherOpen, setOtherOpen] = useState(() => otherInfoNeedsAttention(note));
  const blurText = (key: TextKey, v: string) => {
    const next = v.trim() || null;
    if (next !== (note[key] ?? null)) onPatch({ [key]: next });
  };
  const blurInt = (key: "pageCount" | "declaredTopCount", v: string) => {
    const n = v.trim() ? Math.trunc(Number(v)) : null;
    if (n !== null && !(n >= 1)) return;
    if (n !== note[key]) onPatch({ [key]: n });
  };
  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-4" data-testid="note-header" aria-labelledby="note-info-title">
      <h2 id="note-info-title" className="text-sm font-semibold">Belge bilgileri</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Sahip *">
          <CustomerPickerField value={note.ownerCustomerId} onChange={(id) => onPatch({ ownerCustomerId: id })} disabled={!editable} placeholder="Sahip seç" />
          {editable && <SuggestionChips suggestion={suggestions?.owner} currentId={note.ownerCustomerId} onPick={(c) => onPatch({ ownerCustomerId: c.id })} />}
        </Field>
        <Field label="Gönderen">
          <CustomerPickerField value={note.senderCustomerId} onChange={(id) => onPatch({ senderCustomerId: id })} disabled={!editable} placeholder="Gönderen seç" clearable={editable} />
          {editable && <SuggestionChips suggestion={suggestions?.sender} currentId={note.senderCustomerId} onPick={(c) => onPatch({ senderCustomerId: c.id })} />}
        </Field>
        <div key={`docno:${note.updatedAt}`} className="contents">
          <Field label={DOC_NO_FIELD.label}>
            <TextInput note={note} field={DOC_NO_FIELD} editable={editable} onBlur={blurText} highlight={!!docNoWarning} />
            {docNoWarning && <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="docno-retention-warning">{docNoWarning}</p>}
          </Field>
        </div>
        <div key={`date:${note.updatedAt}`} className="contents">
          <Field label="Belge tarihi">
            <DatePickerInput
              value={note.senderDocDate?.slice(0, 10) ?? ""}
              disabled={!editable}
              onChange={(v) => v !== (note.senderDocDate?.slice(0, 10) ?? "") && onPatch({ senderDocDate: v || null })}
            />
          </Field>
        </div>
        {canFixIdentity && !editable && <IdentityFixAction note={note} />}
      </div>
      <details open={otherOpen} onToggle={(e) => setOtherOpen(e.currentTarget.open)} className="group border-t pt-3" data-testid="note-other-info">
        <summary className="flex cursor-pointer select-none list-none items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
          Diğer bilgiler
        </summary>
        <div key={`other:${note.updatedAt}`} className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          {OTHER_TEXT_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <TextInput note={note} field={f} editable={editable} onBlur={blurText} />
            </Field>
          ))}
          <Field label="Sayfa sayısı">
            <Input type="number" min={1} aria-label="Sayfa sayısı" defaultValue={note.pageCount ?? ""} disabled={!editable} onBlur={(e) => blurInt("pageCount", e.target.value)} />
          </Field>
          <Field label="Beyan top adedi">
            <Input type="number" min={1} aria-label="Beyan top adedi" defaultValue={note.declaredTopCount ?? ""} disabled={!editable} onBlur={(e) => blurInt("declaredTopCount", e.target.value)} />
          </Field>
        </div>
      </details>
    </section>
  );
}
