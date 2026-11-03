// Bir belgenin kaydı (tekli form ve toplu satır aynı yoldan): WITH_WORK_ORDER → sözleşme 3 ucu (belge + top + iş emri tek
// seferde); SEPARATE (varsayılan, bugünkü) → formdaki değerler taslağa yazılır, onay Gelen Belgeler'den. Hata fırlatılır.
import { TERIM } from "@/lib/terim";
import { updateNoteHeader } from "@/pages/Operations/GelenBelgeler/service";
import type { DeliveryNoteDetail } from "@/pages/Operations/GelenBelgeler/types";
import { docDraftReasons, noteWorkOrderBody, separateHeaderPatch, type DocDraft, type FormApproval } from "./docDraft";
import type { MultiPartyDraft } from "./partyDraft";
import { createWorkOrderFromNote, errorCode, FORM_APPROVAL_DISABLED, type NoteWorkOrderResult } from "./service";

export type SaveOutcome = { kind: "WORK_ORDER"; result: NoteWorkOrderResult } | { kind: "DRAFT_SAVED" };

export interface SaveDocInput {
  note: DeliveryNoteDetail;
  draft: DocDraft;
  routeTemplateId: string;
  formApproval: FormApproval;
  gramajPropertyId: string | null;
  /** K22: formda alanı olmayan çözücü değerleri (gövdeye aynen). */
  passThrough?: ReadonlyArray<{ propertyId: string; valueId: string }>;
  /** Mantıksal deneme token'ı (çağıranın `useAttemptToken`ı; belirsiz hatada yapışır). */
  clientToken: string;
  /** S1 çok partili belge: parti satırları + kip (yalnız WITH_WORK_ORDER'da gövdeye girer). */
  multi?: MultiPartyDraft | null;
}

export async function saveDoc(i: SaveDocInput): Promise<SaveOutcome> {
  const multi = i.formApproval === "WITH_WORK_ORDER" ? (i.multi ?? null) : null;
  const reasons = docDraftReasons(i.draft, multi);
  if (reasons.length > 0) throw new Error(reasons.join(" "));
  if (i.formApproval === "WITH_WORK_ORDER") {
    const body = noteWorkOrderBody(i.draft, { clientToken: i.clientToken, routeTemplateId: i.routeTemplateId, gramajPropertyId: i.gramajPropertyId, passThrough: i.passThrough }, multi);
    return { kind: "WORK_ORDER", result: await createWorkOrderFromNote(i.note.id, body) };
  }
  const patch = separateHeaderPatch(i.draft, i.note);
  if (Object.keys(patch).length > 0) await updateNoteHeader(i.note.id, patch);
  return { kind: "DRAFT_SAVED" };
}

// K20: ad okuma anında rejimden çözülür (modül düzeyinde donmaz).
export const draftSavedText = (): string => `Belge taslak olarak kaydedildi. Bu fabrikada belge ayrı onaylanır: onay Gelen Belgeler ekranından verilince ${TERIM.terbiyeIsEmri.tekilKucuk} açılır.`;
/** İş emrini açan kayıt düğmesi (WITH_WORK_ORDER); ayrı onayda düğme "Taslak kaydet". */
export const saveLabel = (): string => `${TERIM.terbiyeIsEmri.tekil} oluştur`;

/** Sunucu ayarı formdan sonra kapandıysa (403) anlaşılır cümle; değilse null (sunucu cümlesi kullanılır). */
export function saveErrorHint(e: unknown): string | null {
  if (errorCode(e) === FORM_APPROVAL_DISABLED) return `Belgeyi ${TERIM.terbiyeIsEmri.cekimKucuk.vasita} birlikte kaydetme ayarı kapalı — belge Gelen Belgeler'den onaylanmalı.`;
  return null;
}
