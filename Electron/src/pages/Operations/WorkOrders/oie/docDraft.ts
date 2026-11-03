// Belgeden iş emri formunun saf parçaları: okunan taslaktan form taslağı, kaydetme kapısı, sözleşme 3 gövdesi ve
// ayrı onay kipinde (SEPARATE) taslağa yazılacak başlık yaması. Kural sunucudadır; kapı yalnız düğmeyi ve nedeni seçer.
import type { DeliveryNoteDetail, HeaderPatch, KursunMetersSource } from "@/pages/Operations/GelenBelgeler/types";
import { FOLD_PROPERTY_CODE } from "@/lib/fold-catalog";
import type { DefaultTarget } from "@/lib/station-default-targets";
import type { NoteWorkOrderBody } from "./service";
import { multiPartyBody, multiPartyReasons, multiPartyTotal, type MultiPartyDraft } from "./partyDraft";

/** Sözleşme 4: belgede okunan metinden müşteri önerisi (eski backend göndermez). */
export interface OwnerSuggestion {
  customerId: string;
  name: string;
  matchedText: string;
  /** OWNER_TEXT: okunan sahip alanı (güçlü, alan dolar) · FULL_TEXT: sayfa metninde geçiyor (yalnız "bu müşteri mi?" sorulur). Eski backend göndermez → alan dolar (bugünkü). */
  source?: "OWNER_TEXT" | "FULL_TEXT";
}

/** Öneri sahip alanına doğrudan yazılır mı — tam metin eşleşmesi yazılmaz, onay çipi olarak sorulur. */
export const suggestionFillsOwner = (s: OwnerSuggestion | null | undefined): boolean => !!s && s.source !== "FULL_TEXT";

export type FormApproval = "SEPARATE" | "WITH_WORK_ORDER";

export interface DocDraft {
  ownerCustomerId: string | null;
  /** Müşteri belgeden mi geldi (öneri ya da taslakta kayıtlı) — "Belgeden" rozeti. */
  ownerFromDoc: boolean;
  ourBatchNo: string | null;
  /** Aday anahtarı; `MANUAL` = elle yazıldı (gövdeye anahtarsız gider). */
  ourBatchNoKey: string | null;
  meters: number | null;
  metersSource: KursunMetersSource | null;
  /** Okunan metre gözden geçirilmeli ve henüz doğrulanmadı. */
  metersReview: boolean;
  gramajId: string | null;
  /** S3: gramaj elle seçildi — müşteri değişince müşteri varsayılanı artık EZMEZ. */
  gramajTouched?: boolean;
  /** K22: ön seçimin tohumlandığı müşteri ("" = müşterisiz); müşteri değişince yeniden tohumlanır. */
  gramajSeededFor?: string;
  notes: string;
}

type NoteLike = Pick<DeliveryNoteDetail, "ownerCustomerId" | "ourBatchNo" | "ourBatchNoKey" | "kursunMeters" | "kursunMetersSource" | "kursunMetersReview"> & {
  ownerSuggestion?: OwnerSuggestion | null;
};

export interface GramajChoice {
  id: string;
  isDefault?: boolean;
}

/** Rotada kurşun adımı yoksa gramaj kutusu da varsayılan da yok (sunucu kurşunsuz rotada hedefi 400'le reddeder). `undefined` = bilinmiyor (bugünkü). */
const NO_GRAMAJ: readonly never[] = Object.freeze([]);
export function routeGramajOptions<T>(options: readonly T[], routeHasKursun: boolean | undefined): readonly T[] {
  return routeHasKursun === false ? NO_GRAMAJ : options;
}

function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Gramaj ön seçimi sunucu çözücüsünden tohumlanır (`seedDraftGramaj`); taslak gramajsız doğar. */
export function initialDocDraft(note: NoteLike): DocDraft {
  const suggested = suggestionFillsOwner(note.ownerSuggestion) ? note.ownerSuggestion!.customerId : null;
  const owner = note.ownerCustomerId ?? suggested;
  return {
    ownerCustomerId: owner,
    ownerFromDoc: note.ownerCustomerId === null && suggested !== null,
    ourBatchNo: note.ourBatchNo ?? null,
    ourBatchNoKey: note.ourBatchNoKey ?? null,
    meters: toNumber(note.kursunMeters),
    metersSource: note.kursunMetersSource ?? null,
    metersReview: note.kursunMetersReview === true,
    gramajId: null,
    notes: "",
  };
}

/**
 * K22: çözücü cevabından gramaj teklifi. `undefined` = cevap yok (bekle) · `null` = teklif yok. Kurşunsuz rotada
 * (`gramajOptions` boş) ya da katalogda olmayan değer teklif edilmez.
 */
export function gramajOffer(
  targets: readonly DefaultTarget[] | null | undefined,
  gramajPropertyId: string | null,
  gramajOptions: readonly GramajChoice[],
): string | null | undefined {
  if (targets === undefined) return undefined;
  if (!targets || !gramajPropertyId) return null;
  const id = targets.find((t) => t.propertyId === gramajPropertyId)?.valueId ?? null;
  return id && gramajOptions.some((o) => o.id === id) ? id : null;
}

/** Teklif taslağa yazılır: gramaj elle seçilmediyse ve bu müşteri için henüz tohumlanmadıysa (müşteri değişince yeniden). */
export function seedDraftGramaj(d: DocDraft, offer: string | null | undefined): DocDraft {
  const owner = d.ownerCustomerId ?? "";
  if (offer === undefined || d.gramajTouched || d.gramajSeededFor === owner) return d;
  return { ...d, gramajId: offer, gramajSeededFor: owner };
}

/** Formda alanı olmayan seçim varsayılanları (gramaj ve kat dışı) gövdeye aynen gider; kat sunucuda `foldType`a çözülür. */
export function passThroughTargets(targets: readonly DefaultTarget[] | null | undefined, gramajPropertyId: string | null): Array<{ propertyId: string; valueId: string }> {
  return (targets ?? [])
    .filter((t) => t.valueType === "CHOICE" && t.valueId && t.propertyId !== gramajPropertyId && t.propertyCode !== FOLD_PROPERTY_CODE)
    .map((t) => ({ propertyId: t.propertyId, valueId: t.valueId! }));
}

/** Kaydı bekleten nedenler (boş = kaydedilebilir). Review'lı metre DAİMA doğrulama ister. Çok partide metre parti satırlarındandır. */
export function docDraftReasons(d: DocDraft, multi?: MultiPartyDraft | null): string[] {
  const out: string[] = [];
  if (!d.ownerCustomerId) out.push("Müşteriyi seçin.");
  if (multi) out.push(...multiPartyReasons(multi));
  else if (d.meters === null) out.push("Kurşun metresi yok — metreyi girin.");
  else if (d.metersReview) out.push("Kurşun metresini doğrulayın (Gözden geçir).");
  return out;
}

/** Yerel taslağa başlık yamasını uygular (BatchNoPicker / KursunMetersCard yerel kipte). */
export function applyPatch(d: DocDraft, p: HeaderPatch): DocDraft {
  const next = { ...d };
  if ("ownerCustomerId" in p) {
    next.ownerCustomerId = p.ownerCustomerId ?? null;
    next.ownerFromDoc = false;
  }
  if ("ourBatchNo" in p) {
    next.ourBatchNo = p.ourBatchNo ?? null;
    next.ourBatchNoKey = p.ourBatchNo ? (p.ourBatchNoKey ?? "MANUAL") : null;
  }
  if (p.kursunMeters !== undefined) {
    next.meters = p.kursunMeters;
    next.metersSource = "MANUAL";
    next.metersReview = false;
  }
  if (p.kursunMetersReviewed) next.metersReview = false;
  return next;
}

export function noteWorkOrderBody(
  d: DocDraft,
  ctx: { clientToken: string; routeTemplateId: string; gramajPropertyId: string | null; passThrough?: ReadonlyArray<{ propertyId: string; valueId: string }> },
  multi?: MultiPartyDraft | null,
): NoteWorkOrderBody {
  const meters = multi ? multiPartyTotal(multi) : d.meters;
  if (!d.ownerCustomerId || meters === null) throw new Error("Eksik alan");
  const batchKey = d.ourBatchNo && d.ourBatchNoKey && d.ourBatchNoKey !== "MANUAL" ? d.ourBatchNoKey : undefined;
  return {
    clientToken: ctx.clientToken,
    ownerCustomerId: d.ownerCustomerId,
    // Parti no hep açık gider: null = formda temizlendi (sunucu okumada yazılan adayı silsin).
    ourBatchNo: d.ourBatchNo ?? null,
    ...(batchKey ? { ourBatchNoKey: batchKey } : {}),
    kursunMeters: String(meters),
    routeTemplateId: ctx.routeTemplateId,
    ...(multi ? multiPartyBody(multi) : {}),
    // K22: hedef değerleri HEP açık gider (boş = "Hedef yok"); sunucu anahtarsız gövdeye değer dayatmaz.
    targetValues: [...(d.gramajId && ctx.gramajPropertyId ? [{ propertyId: ctx.gramajPropertyId, valueId: d.gramajId }] : []), ...(ctx.passThrough ?? [])],
    ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
  };
}

/** Ayrı onay kipinde formdaki değerler taslağa yazılır (onay Gelen Belgeler'den); yalnız değişenler gider. */
export function separateHeaderPatch(d: DocDraft, note: NoteLike): HeaderPatch {
  const p: HeaderPatch = {};
  if (d.ownerCustomerId !== note.ownerCustomerId) p.ownerCustomerId = d.ownerCustomerId;
  if (d.ourBatchNo !== (note.ourBatchNo ?? null) || d.ourBatchNoKey !== (note.ourBatchNoKey ?? null)) {
    p.ourBatchNo = d.ourBatchNo;
    if (d.ourBatchNo && d.ourBatchNoKey && d.ourBatchNoKey !== "MANUAL") p.ourBatchNoKey = d.ourBatchNoKey;
  }
  if (d.meters !== null && d.metersSource === "MANUAL" && d.meters !== toNumber(note.kursunMeters)) p.kursunMeters = d.meters;
  else if (note.kursunMetersReview && !d.metersReview) p.kursunMetersReviewed = true;
  return p;
}
