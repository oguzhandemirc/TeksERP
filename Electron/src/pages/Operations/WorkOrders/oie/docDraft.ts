// Belgeden iş emri formunun saf parçaları: okunan taslaktan form taslağı, kaydetme kapısı, sözleşme 3 gövdesi ve
// ayrı onay kipinde (SEPARATE) taslağa yazılacak başlık yaması. Kural sunucudadır; kapı yalnız düğmeyi ve nedeni seçer.
import type { DeliveryNoteDetail, HeaderPatch, KursunMetersSource } from "@/pages/Operations/GelenBelgeler/types";
import type { NoteWorkOrderBody } from "./service";

/** Sözleşme 4: belgede okunan metinden müşteri önerisi (eski backend göndermez). */
export interface OwnerSuggestion {
  customerId: string;
  name: string;
  matchedText: string;
}

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
  notes: string;
}

type NoteLike = Pick<DeliveryNoteDetail, "ownerCustomerId" | "ourBatchNo" | "ourBatchNoKey" | "kursunMeters" | "kursunMetersSource" | "kursunMetersReview"> & {
  ownerSuggestion?: OwnerSuggestion | null;
};

export interface GramajChoice {
  id: string;
  isDefault?: boolean;
}

/** Sözleşme 5: istasyondaki TEK varsayılan gramaj; alan yoksa (eski backend) hiçbiri seçilmez. */
export function defaultGramajId(options: readonly GramajChoice[]): string | null {
  return options.find((o) => o.isDefault === true)?.id ?? null;
}

function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function initialDocDraft(note: NoteLike, gramajOptions: readonly GramajChoice[]): DocDraft {
  const suggested = note.ownerSuggestion?.customerId ?? null;
  const owner = note.ownerCustomerId ?? suggested;
  return {
    ownerCustomerId: owner,
    ownerFromDoc: note.ownerCustomerId === null && suggested !== null,
    ourBatchNo: note.ourBatchNo ?? null,
    ourBatchNoKey: note.ourBatchNoKey ?? null,
    meters: toNumber(note.kursunMeters),
    metersSource: note.kursunMetersSource ?? null,
    metersReview: note.kursunMetersReview === true,
    gramajId: defaultGramajId(gramajOptions),
    notes: "",
  };
}

/** Kaydı bekleten nedenler (boş = kaydedilebilir). Review'lı metre DAİMA doğrulama ister. */
export function docDraftReasons(d: DocDraft): string[] {
  const out: string[] = [];
  if (!d.ownerCustomerId) out.push("Müşteriyi seçin.");
  if (d.meters === null) out.push("Kurşun metresi yok — metreyi girin.");
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
  ctx: { clientToken: string; routeTemplateId: string; gramajPropertyId: string | null },
): NoteWorkOrderBody {
  if (!d.ownerCustomerId || d.meters === null) throw new Error("Eksik alan");
  const batchKey = d.ourBatchNo && d.ourBatchNoKey && d.ourBatchNoKey !== "MANUAL" ? d.ourBatchNoKey : undefined;
  return {
    clientToken: ctx.clientToken,
    ownerCustomerId: d.ownerCustomerId,
    ...(d.ourBatchNo ? { ourBatchNo: d.ourBatchNo } : {}),
    ...(batchKey ? { ourBatchNoKey: batchKey } : {}),
    kursunMeters: String(d.meters),
    routeTemplateId: ctx.routeTemplateId,
    ...(d.gramajId && ctx.gramajPropertyId ? { targetValues: [{ propertyId: ctx.gramajPropertyId, valueId: d.gramajId }] } : {}),
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
