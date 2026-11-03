// Başlık: sahip/gönderen DOĞRUDAN MODAL seçici + eşleme önerisi; metin alanları odak çıkınca yazılır (PATCH yalnız değişeni).
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { SuggestionChips } from "./SuggestionChips";
import { retentionDocNoWarning } from "./photoRetention";
import type { DeliveryNoteDetail, HeaderPatch, NoteMatchSuggestions } from "./types";

interface Props {
  note: DeliveryNoteDetail;
  suggestions: NoteMatchSuggestions | undefined;
  editable: boolean;
  onPatch: (p: HeaderPatch) => void;
}

type TextKey = "senderDocNo" | "customerBatchNo" | "customerOrderNo" | "processText" | "senderText";
// `max` = backend Zod sınırı = kolon VarChar'ı (taşan değer sunucuda 400 olurdu; giriş baştan keser).
const TEXT_FIELDS: Array<{ key: TextKey; label: string; max: number }> = [
  { key: "senderText", label: "Gönderen (belgedeki ad)", max: 160 },
  { key: "senderDocNo", label: "Belge no", max: 64 },
  { key: "customerBatchNo", label: "Müşteri parti no", max: 64 },
  { key: "customerOrderNo", label: "Müşteri sipariş no", max: 64 },
  { key: "processText", label: "İşlem", max: 120 },
];

export function NoteHeaderForm({ note, suggestions, editable, onPatch }: Props) {
  // K28: fotoğraf onaydan sonra küçülür/silinir → belge no'yu şimdi kontrol ettir (yalnız düzenlenebilir taslakta).
  const docNoWarning = editable ? retentionDocNoWarning(note.photoRetention) : null;
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
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="note-header">
      <div className="flex min-w-0 flex-col gap-1">
        <Label>Sahip (malın sahibi müşteri) *</Label>
        <CustomerPickerField value={note.ownerCustomerId} onChange={(id) => onPatch({ ownerCustomerId: id })} disabled={!editable} placeholder="Sahip seç" />
        {editable && <SuggestionChips suggestion={suggestions?.owner} currentId={note.ownerCustomerId} onPick={(c) => onPatch({ ownerCustomerId: c.id })} />}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <Label>Gönderen firma</Label>
        <CustomerPickerField value={note.senderCustomerId} onChange={(id) => onPatch({ senderCustomerId: id })} disabled={!editable} placeholder="Gönderen seç" clearable={editable} />
        {editable && <SuggestionChips suggestion={suggestions?.sender} currentId={note.senderCustomerId} onPick={(c) => onPatch({ senderCustomerId: c.id })} />}
      </div>
      {TEXT_FIELDS.map((f) => (
        <div key={`${f.key}:${note.updatedAt}`} className="flex min-w-0 flex-col gap-1">
          <Label>{f.label}</Label>
          <Input
            defaultValue={note[f.key] ?? ""}
            maxLength={f.max}
            aria-label={f.label}
            disabled={!editable}
            onBlur={(e) => blurText(f.key, e.target.value)}
            className={f.key === "senderDocNo" && docNoWarning ? "border-amber-500 ring-2 ring-amber-400" : undefined}
            data-highlight={f.key === "senderDocNo" && docNoWarning ? "retention" : undefined}
          />
          {f.key === "senderDocNo" && docNoWarning && (
            <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="docno-retention-warning">{docNoWarning}</p>
          )}
        </div>
      ))}
      <div key={`date:${note.updatedAt}`} className="flex min-w-0 flex-col gap-1">
        <Label>Belge tarihi</Label>
        <DatePickerInput
          value={note.senderDocDate?.slice(0, 10) ?? ""}
          disabled={!editable}
          onChange={(v) => v !== (note.senderDocDate?.slice(0, 10) ?? "") && onPatch({ senderDocDate: v || null })}
        />
      </div>
      <div key={`pages:${note.updatedAt}`} className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label>Sayfa sayısı</Label>
          <Input type="number" min={1} defaultValue={note.pageCount ?? ""} disabled={!editable} onBlur={(e) => blurInt("pageCount", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Beyan top adedi</Label>
          <Input type="number" min={1} defaultValue={note.declaredTopCount ?? ""} disabled={!editable} onBlur={(e) => blurInt("declaredTopCount", e.target.value)} />
        </div>
      </div>
    </div>
  );
}
