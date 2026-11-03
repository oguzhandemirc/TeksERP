// Belgeden iş emri formunun kutuları: müşteri · parti no · kurşun metresi · gramaj · not. Değerler YEREL taslakta tutulur
// (kayıt sözleşme 3 ucuyla tek seferde); P2 kartları (BatchNoPicker, KursunMetersCard) yerel yamayla yeniden kullanılır.
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { GramajChoiceButtons } from "@/components/kursun/GramajChoiceButtons";
import type { GramajOption } from "@/lib/kursun-gramaj";
import { BatchNoPicker } from "@/pages/Operations/GelenBelgeler/BatchNoPicker";
import { KursunMetersCard } from "@/pages/Operations/GelenBelgeler/KursunMetersCard";
import type { DeliveryNoteDetail, HeaderPatch } from "@/pages/Operations/GelenBelgeler/types";
import { Button } from "@/components/ui/button";
import { applyPatch, suggestionFillsOwner, type DocDraft, type OwnerSuggestion } from "./docDraft";

interface Props {
  note: DeliveryNoteDetail;
  draft: DocDraft;
  onChange: (d: DocDraft) => void;
  gramajOptions: readonly GramajOption[];
  disabled?: boolean;
}

export function FromDocBadge() {
  return <Badge variant="muted" data-testid="from-doc-badge">Belgeden</Badge>;
}

/** P2 kartlarının okuduğu not görünümü: belge adayları + yerel taslak değerleri. */
function viewNote(note: DeliveryNoteDetail, d: DocDraft): DeliveryNoteDetail {
  return {
    ...note,
    ourBatchNo: d.ourBatchNo,
    ourBatchNoKey: d.ourBatchNoKey,
    kursunMeters: d.meters === null ? null : String(d.meters),
    kursunMetersSource: d.metersSource,
    kursunMetersReview: d.metersReview,
  };
}

function OwnerField({ note, draft, onChange, disabled }: Omit<Props, "gramajOptions">) {
  const suggestion = (note as { ownerSuggestion?: OwnerSuggestion | null }).ownerSuggestion ?? null;
  // Tam metin eşleşmesi (adres/antet satırı olabilir) alana yazılmaz; operatöre sorulur.
  const ask = suggestion && !suggestionFillsOwner(suggestion) && draft.ownerCustomerId !== suggestion.customerId ? suggestion : null;
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3" data-testid="oie-owner">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Müşteri</span>
        {draft.ownerFromDoc && <FromDocBadge />}
      </div>
      <CustomerPickerField value={draft.ownerCustomerId} onChange={(id) => onChange(applyPatch(draft, { ownerCustomerId: id }))} disabled={disabled} placeholder="Müşteri seç" />
      {draft.ownerFromDoc && suggestion && (
        <p className="text-xs text-muted-foreground" data-testid="oie-owner-matched">Belgede okunan: “{suggestion.matchedText}” → {suggestion.name}</p>
      )}
      {ask && (
        <div className="flex flex-wrap items-center gap-2 rounded bg-sky-50 px-2 py-1 text-xs dark:bg-sky-950/40" data-testid="oie-owner-ask">
          <span>Belgede “{ask.matchedText}” geçiyor — <b>{ask.name}</b> mi?</span>
          <Button type="button" size="sm" variant="outline" disabled={disabled} data-testid="oie-owner-ask-yes"
            onClick={() => onChange({ ...applyPatch(draft, { ownerCustomerId: ask.customerId }), ownerFromDoc: true })}>Evet, seç</Button>
        </div>
      )}
      {!draft.ownerCustomerId && <p className="text-xs text-amber-800 dark:text-amber-300">Belgeden müşteri çıkarılamadı — seçin.</p>}
    </div>
  );
}

export function DocFields({ note, draft, onChange, gramajOptions, disabled }: Props) {
  const view = viewNote(note, draft);
  const patch = (p: HeaderPatch) => onChange(applyPatch(draft, p));
  return (
    <div className="flex flex-col gap-3" data-testid="oie-doc-fields">
      <OwnerField note={note} draft={draft} onChange={onChange} disabled={disabled} />
      <BatchNoPicker note={view} editable={!disabled} onPatch={patch} />
      <KursunMetersCard note={view} editable={!disabled} onPatch={async (p) => patch(p)} />
      {gramajOptions.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border p-3" data-testid="oie-gramaj">
          <span className="text-sm font-medium">Kurşun gramajı</span>
          <GramajChoiceButtons options={gramajOptions} value={draft.gramajId} onChange={(id) => onChange({ ...draft, gramajId: id, gramajTouched: true })} emptyLabel="Hedef yok" disabled={disabled} />
        </div>
      )}
      <Input aria-label="Not" placeholder="Not (isteğe bağlı)" maxLength={500} value={draft.notes} disabled={disabled} onChange={(e) => onChange({ ...draft, notes: e.target.value })} />
    </div>
  );
}
