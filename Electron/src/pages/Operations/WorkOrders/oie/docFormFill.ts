// S16d: klasik iş emri formunda "Belge okut" — okuma özeti (`okuma-ozeti`) form kutularına YERİNDE dolar. Saf parçalar:
// doldurma yaması, "Belgeden" rozeti ve form ucunun (S16a) ek gövdesi. Kural sunucudadır; tablet aynası `mobil/.../woCreate/woForm.ts`.
import type { DocDraft } from "./docDraft";
import type { NoteWorkOrderBody } from "./service";

/** S16a: tanıtmada işaretlenen form alanları (sayılar sunucuda çözülür; TR metni de kabul). */
export interface DocFormFields {
  hedefMetraj?: number | string | null;
  hedefKg?: number | string | null;
  en?: number | string | null;
  desenText?: string | null;
  renkText?: string | null;
  not?: string | null;
}

/** S16a: `desenRenkEslesme = ONER` iken adı/kodu tutan katalog kaydı. */
export interface DocFormSuggestions {
  targetItem?: { id: string; name: string; code?: string | null } | null;
  targetColor?: { id: string; name: string } | null;
}

/** K30-T: belgenin kullanıcı şablonuyla tanınıp tanınmadığı (eski sunucu ve sistem şablonu → alan yok). */
export type Tanitim = { durum: "TANITILDI"; sablonKodu: string; sablonAdi: string } | { durum: "TANITILMAMIS" };

/** `GET /irsaliyeler/:id/okuma-ozeti` yanıtının formun kullandığı parçası (hepsi isteğe bağlı). */
export interface DocReadSummary {
  state?: string;
  formFields?: DocFormFields | null;
  suggestions?: DocFormSuggestions | null;
  tanitim?: Tanitim | null;
}

/** Belgeden dolabilen klasik form kutuları. */
export type DocFillKey = "targetItemId" | "targetColorId" | "width" | "targetQuantity" | "targetWeight";
const NUMERIC: readonly DocFillKey[] = ["width", "targetQuantity", "targetWeight"];
const ORDER: readonly DocFillKey[] = ["targetItemId", "targetColorId", "width", "targetQuantity", "targetWeight"];

/** Formun o anki değerleri (sayı kutusu metin de taşıyabilir: `register` ham değeri). */
export type DocFillValues = Partial<Record<DocFillKey, string | number | null | undefined>>;
/** Son okumada forma YAZILAN değerler — rozet, form değeri hâlâ buna eşitken görünür. */
export type AppliedDoc = Partial<Record<DocFillKey, string | number>>;

export interface FillOptions {
  /** Hedef metraj/kg kutuları bu kurulumda yok (`useTargetQuantityEnabled` kapalı). */
  targetQuantityEnabled: boolean;
  /** Sipariş bağlıyken hedef kumaş kalemden gelir ve kilitlidir — belge ezmez. */
  itemLocked: boolean;
}

/** Sunucu sayıyı çözer; ham metin gelirse TR biçimi ("1.234,5") da kabul. ≤0 / çözülemeyen → null. */
export function parseFormNumber(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const t = v.trim().replace(/\s/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Belgenin önerdiği değerler (yalnız dolu olanlar). */
export function docOffer(s: DocReadSummary | null | undefined, o: FillOptions): AppliedDoc {
  const f = s?.formFields ?? {};
  const g = s?.suggestions ?? {};
  const out: AppliedDoc = {};
  if (!o.itemLocked && g.targetItem?.id) out.targetItemId = g.targetItem.id;
  // Renk ürüne bağlıdır: ürün kilitliyse (sipariş) önerilen renk o ürünün olmayabilir → yazılmaz.
  if (!o.itemLocked && g.targetColor?.id) out.targetColorId = g.targetColor.id;
  const en = parseFormNumber(f.en);
  if (en !== null) out.width = en;
  if (o.targetQuantityEnabled) {
    const q = parseFormNumber(f.hedefMetraj);
    const kg = parseFormNumber(f.hedefKg);
    if (q !== null) out.targetQuantity = q;
    if (kg !== null) out.targetWeight = kg;
  }
  return out;
}

const isEmpty = (v: unknown): boolean => v === null || v === undefined || v === "";

/** İki değer aynı mı — sayı kutularında "280" ile 280 eşittir; kimliklerde düz metin karşılaştırması. */
export function sameValue(k: DocFillKey, a: unknown, b: unknown): boolean {
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b);
  if (NUMERIC.includes(k)) return parseFormNumber(a as string | number) === parseFormNumber(b as string | number);
  return String(a) === String(b);
}

/**
 * Okuma özetini forma uygular: kutu boşsa ya da önceki okumanın değerini (elle değişmemiş) taşıyorsa yeni değer yazılır;
 * kullanıcının düzelttiği kutu EZİLMEZ. Önceki okumadan kalıp yeni belgede olmayan dokunulmamış değer boşalır.
 * Belgeden yazılıp elle BOŞALTILAN kutu da dokunulmuştur: yeniden dolmaz (izi `applied`da kalır, rozet düşer).
 */
export function applyReadSummary(current: DocFillValues, prev: AppliedDoc, s: DocReadSummary | null | undefined, o: FillOptions): { patch: Partial<Record<DocFillKey, string | number | null>>; applied: AppliedDoc } {
  const offer = docOffer(s, o);
  const patch: Partial<Record<DocFillKey, string | number | null>> = {};
  const applied: AppliedDoc = {};
  for (const k of ORDER) {
    const wrote = prev[k] !== undefined;
    const untouched = wrote ? sameValue(k, current[k], prev[k]) : isEmpty(current[k]);
    if (!untouched) {
      if (wrote) applied[k] = prev[k];
      continue;
    }
    const v = offer[k];
    if (v !== undefined) {
      if (!sameValue(k, current[k], v)) patch[k] = v;
      applied[k] = v;
    } else if (prev[k] !== undefined && !isEmpty(current[k])) patch[k] = null;
  }
  return { patch, applied };
}

/** "Belgeden" rozeti taşıyan kutular: belgeden yazılan değer hâlâ kutuda. Elle düzeltilen kutunun rozeti düşer. */
export function docMarks(current: DocFillValues, applied: AppliedDoc): Set<DocFillKey> {
  return new Set(ORDER.filter((k) => applied[k] !== undefined && sameValue(k, current[k], applied[k])));
}

/** Belgede okunan not (Not kutusu boşsa dolar). */
export const docNoteText = (s: DocReadSummary | null | undefined): string => (s?.formFields?.not ?? "").trim();

/** Okunan desen/renk yazısı — katalog önerisi yoksa operatöre ipucu. */
export function docTextHints(s: DocReadSummary | null | undefined): { desen: string | null; renk: string | null } {
  const t = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return { desen: s?.suggestions?.targetItem ? null : t(s?.formFields?.desenText), renk: s?.suggestions?.targetColor ? null : t(s?.formFields?.renkText) };
}

/** Klasik formun kurduğu yükten form ucuna giden kısım (`buildPayload` çıktısının alt kümesi). */
export interface ClassicPayloadPart {
  targetItemId: string | null;
  targetColorId: string | null;
  width: number | null;
  targetQuantity: number | null;
  targetWeight: number | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  foldType: string | null;
  orderLineIds?: string[];
  targetValues?: Array<{ propertyId: string; valueId: string }>;
}

export type FormEndpointExtras = Pick<NoteWorkOrderBody, "targetItemId" | "targetColorId" | "width" | "targetQuantity" | "targetWeight" | "plannedStartDate" | "plannedEndDate" | "foldType" | "orderLineIds">;

/**
 * S16a form ucunun ek alanları: boş olan hiç gitmez (sunucu bugünkü varsayılanı uygular). Her partiye ayrı iş emri
 * (PER_PARTY) kipinde hedef metraj/kg belge toplamıdır — sunucu 400 verir, gönderilmez.
 */
export function formEndpointExtras(p: ClassicPayloadPart, perParty: boolean): FormEndpointExtras {
  const pos = (n: number | null) => (n !== null && Number.isFinite(n) && n > 0 ? n : undefined);
  const out: FormEndpointExtras = {};
  if (p.targetItemId) out.targetItemId = p.targetItemId;
  if (p.targetColorId) out.targetColorId = p.targetColorId;
  if (pos(p.width) !== undefined) out.width = p.width!;
  if (!perParty && pos(p.targetQuantity) !== undefined) out.targetQuantity = p.targetQuantity!;
  if (!perParty && pos(p.targetWeight) !== undefined) out.targetWeight = p.targetWeight!;
  if (p.plannedStartDate) out.plannedStartDate = p.plannedStartDate;
  if (p.plannedEndDate) out.plannedEndDate = p.plannedEndDate;
  if (p.foldType) out.foldType = p.foldType;
  if (p.orderLineIds?.length) out.orderLineIds = p.orderLineIds;
  return out;
}

/**
 * Yeniden okuma (tanıtma sonrası) belge kartını tazeler: yalnız BOŞ kutular yeni okumadan dolar; kullanıcının seçtiği
 * müşteri/parti/metre ve yazdığı not korunur.
 */
export function mergeDocDraft(d: DocDraft, fresh: DocDraft, note: string): DocDraft {
  const next = { ...d };
  if (!d.ownerCustomerId && fresh.ownerCustomerId) Object.assign(next, { ownerCustomerId: fresh.ownerCustomerId, ownerFromDoc: fresh.ownerFromDoc });
  if (!d.ourBatchNo && fresh.ourBatchNo) Object.assign(next, { ourBatchNo: fresh.ourBatchNo, ourBatchNoKey: fresh.ourBatchNoKey });
  if (d.meters === null && fresh.meters !== null) Object.assign(next, { meters: fresh.meters, metersSource: fresh.metersSource, metersReview: fresh.metersReview });
  if (!d.notes.trim() && note) next.notes = note;
  return next;
}
