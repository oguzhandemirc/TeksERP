// S16b tablet tek iş emri formu — saf parçalar: giriş kipi (`gelenBelge.tabletIeGirisi`), seçici karoları, belgeden
// doldurma (`formFields` + `suggestions`), alan engelleri ve form ucunun ek gövde alanları. Kural sunucudadır; burası
// yalnız formu doldurur, düğmenin neden kapalı olduğunu söyler ve verilen alanı gövdeye koyar.
import { addDaysToKey, factoryDayKey, factoryDayStartIso, fmtDayKey } from '../../../../lib/factory-time';
import type { CreateWorkOrderFromNoteBody, DocFormFields, DocFormSuggestions, TabletWoEntry } from '../../../../services/inboundDoc.service';

export type { TabletWoEntry };
const ENTRIES: readonly TabletWoEntry[] = ['IKISI', 'BELGE', 'TOP'];

/** Tanınan ilk değer kazanır; hiçbiri yoksa IKISI = bugünkü ekran (eski sunucu alanı göndermez). */
export function resolveWoEntry(...values: readonly unknown[]): TabletWoEntry {
  for (const v of values) if (typeof v === 'string' && (ENTRIES as readonly string[]).includes(v)) return v as TabletWoEntry;
  return 'IKISI';
}

export interface HubTiles {
  /** Hızlı İE (top okutarak). */
  quick: boolean;
  /** Tek form ("<İE> oluştur", belge okutarak). */
  form: boolean;
  desk: boolean;
  /** Eski "Belge Tara" (kısayolsuz kurulum). */
  legacy: boolean;
}

/** Seçicinin sabit karoları. IKISI bugünkü ekranın BİREBİR aynısıdır. */
export function hubTiles(entry: TabletWoEntry, a: { canManual: boolean; shortcuts: number; loading: boolean }): HubTiles {
  // BELGE (fason): yalnız tek forma giden karolar; top yolu, belge masası ve eski Belge Tara gizli (1e kararı 2026-11-04).
  if (entry === 'BELGE') return { quick: false, form: true, desk: false, legacy: false };
  if (entry === 'TOP') return { quick: a.canManual, form: false, desk: false, legacy: false };
  return { quick: a.canManual, form: false, desk: a.shortcuts > 0, legacy: !a.loading && a.shortcuts === 0 };
}

/** Belgeden dolabilen (ve "belgeden" rozeti taşıyan) form alanları. */
export type DocFilledKey = 'width' | 'targetQuantity' | 'targetWeight' | 'note';

export interface WoFormExtras {
  targetItemId: string | null;
  targetItemLabel: string | null;
  targetColorId: string | null;
  /** Metin kutuları (ondalık `.` ya da `,`). */
  width: string;
  targetQuantity: string;
  targetWeight: string;
  foldType: string | null;
  /** Bağlanan sipariş kalemleri (isteğe bağlı; klasik/Hızlı İE ile aynı kural sunucuda). */
  orderLineIds: string[];
  /** Fabrika günü anahtarı (YYYY-MM-DD). */
  plannedStart: string | null;
  plannedEnd: string | null;
  note: string;
}

export interface WoFormState {
  extras: WoFormExtras;
  /** Değeri belgeden gelen alanlar (rozet). */
  fromDoc: DocFilledKey[];
  /** Kullanıcının elle değiştirdiği alanlar: sonraki belge okuması bunları ezmez. */
  touched: DocFilledKey[];
  suggestions: DocFormSuggestions;
  /** Belgede yazan desen/renk metni (öneri yoksa ipucu). */
  docText: { desen: string | null; renk: string | null };
  /** Bu notun okuması forma uygulandı (aynı okuma iki kez uygulanmaz). */
  appliedNoteId: string | null;
}

export const EMPTY_EXTRAS: WoFormExtras = {
  targetItemId: null,
  targetItemLabel: null,
  targetColorId: null,
  width: '',
  targetQuantity: '',
  targetWeight: '',
  foldType: null,
  orderLineIds: [],
  plannedStart: null,
  plannedEnd: null,
  note: '',
};

export function initialFormState(): WoFormState {
  return { extras: { ...EMPTY_EXTRAS, orderLineIds: [] }, fromDoc: [], touched: [], suggestions: {}, docText: { desen: null, renk: null }, appliedNoteId: null };
}

/** Sunucu sayıyı çözer; eski/ham metin gelirse TR biçimi ("1.234,5") de kabul. ≤0 / çözülemeyen → null. */
export function parseFormNumber(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const t = v.trim().replace(/\s/g, '');
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const numText = (n: number | null): string => (n === null ? '' : String(n));
const cleanText = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Okuma sonucunu forma uygular. Elle değiştirilen alan ezilmez; önceki belgeden gelip dokunulmamış alan yeni belgenin
 * değerini alır (yoksa boşalır). Öneriler alana YAZILMAZ — "X mi? Evet" çipiyle görevli onaylar.
 */
export function applyDocRead(s: WoFormState, noteId: string, fields: DocFormFields | null | undefined, suggestions: DocFormSuggestions | null | undefined): WoFormState {
  if (s.appliedNoteId === noteId) return s;
  const f = fields ?? {};
  const incoming: Record<DocFilledKey, string> = {
    width: numText(parseFormNumber(f.en)),
    targetQuantity: numText(parseFormNumber(f.hedefMetraj)),
    targetWeight: numText(parseFormNumber(f.hedefKg)),
    note: cleanText(f.not) ?? '',
  };
  const extras = { ...s.extras };
  const fromDoc: DocFilledKey[] = [];
  for (const k of Object.keys(incoming) as DocFilledKey[]) {
    if (s.touched.includes(k)) continue;
    extras[k] = incoming[k];
    if (incoming[k]) fromDoc.push(k);
  }
  return {
    ...s,
    extras,
    fromDoc,
    suggestions: { targetItem: suggestions?.targetItem ?? null, targetColor: suggestions?.targetColor ?? null },
    docText: { desen: cleanText(f.desenText), renk: cleanText(f.renkText) },
    appliedNoteId: noteId,
  };
}

/** Elle düzenleme: belgeden alanın rozeti düşer, sonraki okuma bu alanı ezmez. */
export function editExtras(s: WoFormState, patch: Partial<WoFormExtras>): WoFormState {
  const keys = (Object.keys(patch) as (keyof WoFormExtras)[]).filter((k): k is DocFilledKey => ['width', 'targetQuantity', 'targetWeight', 'note'].includes(k));
  return {
    ...s,
    extras: { ...s.extras, ...patch },
    fromDoc: s.fromDoc.filter((k) => !keys.includes(k)),
    touched: [...new Set([...s.touched, ...keys])],
  };
}

/** Belge değişti (çıkarıldı): belgeden gelen dokunulmamış alanlar ve öneriler temizlenir. */
export function clearDocRead(s: WoFormState): WoFormState {
  const extras = { ...s.extras };
  for (const k of s.fromDoc) extras[k] = '';
  return { ...s, extras, fromDoc: [], suggestions: {}, docText: { desen: null, renk: null }, appliedNoteId: null };
}

/** Sipariş kalemi seçildi: boş hedef kumaş / renk / en kalemden dolar (Hızlı İE ile aynı; dolu alan ezilmez). */
export function applyOrderLine(s: WoFormState, line: { itemId: string; itemName: string; colorId: string | null; width: number | null }): WoFormState {
  const e = s.extras;
  const patch: Partial<WoFormExtras> = {};
  if (!e.targetItemId) Object.assign(patch, { targetItemId: line.itemId, targetItemLabel: line.itemName });
  if (!e.targetColorId && line.colorId) patch.targetColorId = line.colorId;
  if (!e.width.trim() && line.width != null && line.width > 0) patch.width = String(line.width);
  return { ...s, extras: { ...e, ...patch } };
}

export interface ExtrasCtx {
  /** Rota seçildi mi (rotasız seçimi de seçimdir). */
  routeChosen: boolean;
  hasTambur: boolean;
  /** Çok partide "her parti ayrı İE": hedef metraj/kg belge toplamıdır, gönderilmez (S16a: 400). */
  perParty?: boolean;
}

/** Ek alanların engelleri (sunucu yine doğrular). */
export function extrasIssues(e: WoFormExtras, c: ExtrasCtx): string[] {
  const out: string[] = [];
  if (!c.routeChosen) out.push('Rotayı seçin.');
  const bad = (t: string) => t.trim() !== '' && parseFormNumber(t) === null;
  if (bad(e.width)) out.push('En sıfırdan büyük bir sayı olmalı.');
  if (!c.perParty && bad(e.targetQuantity)) out.push('Hedef metraj sıfırdan büyük bir sayı olmalı.');
  if (!c.perParty && bad(e.targetWeight)) out.push('Hedef kg sıfırdan büyük bir sayı olmalı.');
  if (c.hasTambur && !e.foldType) out.push('Kat tipini seçin.');
  if (e.plannedStart && e.plannedEnd && e.plannedEnd < e.plannedStart) out.push('Planlı bitiş başlangıçtan önce olamaz.');
  return out;
}

/** "İş emri oluştur" kapalıysa ilk neden (ipucu); null = açık. */
export function createBlockReason(a: { hasDoc: boolean; reading: boolean; issues: readonly string[] }): string | null {
  if (!a.hasDoc) return 'Önce "Belge okut" ile belgeyi okutun; bilgiler forma dolar.';
  if (a.reading) return 'Belge okunuyor…';
  return a.issues[0] ?? null;
}

export type ExtraBody = Pick<
  CreateWorkOrderFromNoteBody,
  'targetItemId' | 'targetColorId' | 'width' | 'targetQuantity' | 'targetWeight' | 'plannedStartDate' | 'plannedEndDate' | 'foldType' | 'notes' | 'orderLineIds'
>;

/** Form ucunun ek alanları: yalnız dolu olanlar gider (anahtarsız = sunucuda bugünkü türetme). */
export function buildExtraBody(e: WoFormExtras, c: { hasTambur: boolean; perParty?: boolean }): ExtraBody {
  const out: ExtraBody = {};
  if (e.targetItemId) out.targetItemId = e.targetItemId;
  if (e.targetColorId) out.targetColorId = e.targetColorId;
  const width = parseFormNumber(e.width);
  if (width !== null) out.width = width;
  // S16a: her parti ayrı İE kipinde hedef metraj/kg belge toplamıdır — yalnız tek İE kipinde gider.
  const qty = c.perParty ? null : parseFormNumber(e.targetQuantity);
  if (qty !== null) out.targetQuantity = qty;
  const kg = c.perParty ? null : parseFormNumber(e.targetWeight);
  if (kg !== null) out.targetWeight = kg;
  if (e.plannedStart) out.plannedStartDate = factoryDayStartIso(e.plannedStart);
  if (e.plannedEnd) out.plannedEndDate = factoryDayStartIso(e.plannedEnd);
  // Kat yalnız tamburlu rotada (Hızlı İE ile aynı sözleşme): rota değişince eski seçim gövdede kalmaz.
  if (c.hasTambur && e.foldType) out.foldType = e.foldType;
  if (e.orderLineIds.length) out.orderLineIds = [...e.orderLineIds];
  const note = e.note.trim();
  if (note) out.notes = note;
  return out;
}

/** Planlı gün seçenekleri (takvim paketi yok): bugünden itibaren `days` gün. */
export function plannedDayOptions(today: Date = new Date(), days = 21): { value: string; label: string }[] {
  const first = factoryDayKey(today);
  return Array.from({ length: days }, (_, i) => {
    const key = addDaysToKey(first, i);
    const head = i === 0 ? 'Bugün' : i === 1 ? 'Yarın' : `${i} gün sonra`;
    return { value: key, label: `${head} · ${fmtDayKey(key)}` };
  });
}
