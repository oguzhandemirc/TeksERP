// K30-D tablet İE formu alan kataloğu (saf): ⚙ "Alanlar" seçicisi, kişisel tercih blob'u (`tabletIeForm.gizli`) ve
// alanın yeri (üst form / altta kapalı "Diğer alanlar"). Zorunlular kapatılamaz; belgeden DEĞER dolan gizli alan üste çıkar
// (sessiz gönderim yok), yalnız öneri/yazı gelen gizli alan (hedef kumaş/renk) "Diğer alanlar"da kalır. Varsayılan HEPSİ AÇIK.
import type { DocFilledKey, WoFormExtras, WoFormState } from './woForm';

export type WoFieldKey =
  | 'musteri'
  | 'partiNo'
  | 'kursunMetresi'
  | 'gramaj'
  | 'rota'
  | 'rotaAdimlari'
  | 'makine'
  | 'siparis'
  | 'hedefKumas'
  | 'en'
  | 'hedefMetraj'
  | 'hedefKg'
  | 'hedefRenk'
  | 'hedefOzellik'
  | 'katTipi'
  | 'planBaslangic'
  | 'planBitis'
  | 'not';

export type WoFieldSection = 'Belge' | 'Üretim' | 'Plan';

export interface WoFieldDef {
  key: WoFieldKey;
  label: string;
  section: WoFieldSection;
  /** Kilitli: ⚙ listesinde kapatılamaz, hep üstte. */
  required: boolean;
  /** Görünürlük koşulu (ör. "Rotada tambur varsa"); yoksa her zaman. */
  when?: string;
  /** Formda henüz çizilmiyor (K30-D dilim 2 ekleyecek): ⚙ listesinde görünmez. */
  planned?: true;
}

export const WO_FIELDS: readonly WoFieldDef[] = [
  { key: 'musteri', label: 'Müşteri', section: 'Belge', required: true },
  { key: 'partiNo', label: 'Parti no', section: 'Belge', required: true },
  { key: 'kursunMetresi', label: 'Kurşun metresi', section: 'Belge', required: true },
  { key: 'gramaj', label: 'Kurşun gramajı', section: 'Belge', required: false, when: 'Rotada kurşun adımı varsa' },
  { key: 'rota', label: 'Üretim Rotası', section: 'Üretim', required: true },
  { key: 'rotaAdimlari', label: 'Üretim Rotası adımları', section: 'Üretim', required: false, when: 'Üretim Rotası seçilince' },
  { key: 'makine', label: 'Makine seç', section: 'Üretim', required: false, when: 'Kurşun adımının istasyonunda makine varsa' },
  { key: 'siparis', label: 'Sipariş', section: 'Üretim', required: false },
  { key: 'hedefKumas', label: 'Hedef kumaş', section: 'Üretim', required: false },
  { key: 'en', label: 'En (cm)', section: 'Üretim', required: false, when: 'Hedef en ayarı açıksa' },
  { key: 'hedefMetraj', label: 'Hedef metraj (m)', section: 'Üretim', required: false, when: 'Hedef metraj/kg ayarı açıksa' },
  { key: 'hedefKg', label: 'Hedef kg', section: 'Üretim', required: false, when: 'Hedef metraj/kg ayarı açıksa' },
  { key: 'hedefRenk', label: 'Hedef renk', section: 'Üretim', required: false },
  { key: 'hedefOzellik', label: 'Hedef özellikler', section: 'Üretim', required: false, when: 'Üretim Rotası seçilince' },
  { key: 'katTipi', label: 'Kat tipi', section: 'Üretim', required: false, when: 'Rotada tambur varsa ya da rotasızda' },
  { key: 'planBaslangic', label: 'Planlı başlangıç', section: 'Plan', required: false },
  { key: 'planBitis', label: 'Planlı bitiş', section: 'Plan', required: false },
  { key: 'not', label: 'Üretim notu', section: 'Plan', required: false },
];

export const WO_FIELD_SECTIONS: readonly WoFieldSection[] = ['Belge', 'Üretim', 'Plan'];
const BY_KEY = new Map(WO_FIELDS.map((f) => [f.key, f]));
export const PREF_KEY = 'tabletIeForm';

export const isRequiredField = (k: WoFieldKey): boolean => BY_KEY.get(k)?.required === true;

/** ⚙ listesinin bölümleri (yalnız formda çizilen alanlar). */
export function selectorSections(): { section: WoFieldSection; fields: WoFieldDef[] }[] {
  return WO_FIELD_SECTIONS.map((section) => ({ section, fields: WO_FIELDS.filter((f) => f.section === section && !f.planned) }));
}

export interface FieldContext {
  /** `workorder.targetQuantityEnabled` açık (kapalıyken belgeden değer gelse de kutu çizilmez). */
  showQuantity: boolean;
  /** `workorder.targetWidthEnabled` (kapalıysa hedef en kutusu çizilmez). */
  showWidth?: boolean;
  hasTambur: boolean;
  /** Rotada kurşun adımı var. */
  hasKursun: boolean;
  /** Rota seçili ve adımlı (rotasız değil). */
  hasRouteSteps: boolean;
  /** Kurşun adımının istasyonunda aktif makine var (çok partide parti başına seçildiği için yok sayılır). */
  hasMachine?: boolean;
  /** Bu formda hiç sorulmayan alanlar (Fason'da hedef kumaş; siparişten gelen / rotanın vermediği hedef renk): "Diğer alanlar"a da girmez. */
  unavailable?: readonly WoFieldKey[];
  /** Rotanın AUTO verdikleri düşünce seçilecek hedef özellik kalmadı (yüklenirken false). */
  noTargetProps?: boolean;
}

/** Alan bu formda çizilebilir mi (koşulu sağlanıyor mu). */
export function fieldApplicable(k: WoFieldKey, c: FieldContext): boolean {
  if (c.unavailable?.includes(k)) return false;
  switch (k) {
    case 'en':
      return c.showWidth !== false;
    case 'hedefMetraj':
    case 'hedefKg':
      return c.showQuantity;
    case 'katTipi':
      return c.hasTambur;
    case 'gramaj':
      return c.hasKursun;
    case 'makine':
      return c.hasMachine === true;
    case 'rotaAdimlari':
      return c.hasRouteSteps;
    case 'hedefOzellik':
      return c.hasRouteSteps && c.noTargetProps !== true;
    default:
      return true;
  }
}

/** Blob'daki gizli liste: dizi değilse boş; bilinmeyen anahtar, zorunlu alan ve tekrar atılır. */
export function parseHidden(blob: unknown): WoFieldKey[] {
  const raw = blob && typeof blob === 'object' ? (blob as Record<string, unknown>)[PREF_KEY] : undefined;
  const list = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).gizli : undefined;
  if (!Array.isArray(list)) return [];
  const out: WoFieldKey[] = [];
  for (const v of list) {
    if (typeof v !== 'string' || !BY_KEY.has(v as WoFieldKey)) continue;
    const k = v as WoFieldKey;
    if (!isRequiredField(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Kişisel aç/kapa anahtarları (varsayılan kapalı = bugünkü form; varsayılan blob'a yazılmaz). */
export interface PrefFlags {
  /** "Diğer alanlar" bölümünü gizle. */
  digerGizli?: boolean;
  /** Rota adımlarının boş not kutusunu gizle. */
  adimNotuGizli?: boolean;
}

/** Oku-birleştir-yaz: blob'un DİĞER anahtarları (panel teması, sıralar…) ve `tabletIeForm`un diğer alt anahtarları korunur. */
export function mergePrefBlob(blob: Record<string, unknown> | null | undefined, hidden: readonly WoFieldKey[], hedefDoldur = false, flags: PrefFlags = {}): Record<string, unknown> {
  const base = blob ?? {};
  const prev = base[PREF_KEY];
  const prevObj = prev && typeof prev === 'object' && !Array.isArray(prev) ? (prev as Record<string, unknown>) : {};
  const gizli = [...new Set(hidden.filter((k) => BY_KEY.has(k) && !isRequiredField(k)))];
  // Varsayılan (kapalı) anahtar yazılmaz: blob eski biçimde kalır.
  const { hedefDoldur: _eski, digerGizli: _eskiDiger, adimNotuGizli: _eskiNot, ...rest } = prevObj;
  const on = { ...(hedefDoldur ? { hedefDoldur: true } : {}), ...(flags.digerGizli ? { digerGizli: true } : {}), ...(flags.adimNotuGizli ? { adimNotuGizli: true } : {}) };
  return { ...base, [PREF_KEY]: { ...rest, gizli, ...on } };
}

/** Kişisel anahtar "Belgedeki gelen değerleri hedefe yaz" (`tabletIeForm.hedefDoldur`); yok/bozuk = KAPALI. */
export function parseFillTarget(blob: unknown): boolean {
  const raw = blob && typeof blob === 'object' ? (blob as Record<string, unknown>)[PREF_KEY] : undefined;
  return !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).hedefDoldur === true;
}

const flagOn = (blob: unknown, key: keyof PrefFlags): boolean => {
  const raw = blob && typeof blob === 'object' ? (blob as Record<string, unknown>)[PREF_KEY] : undefined;
  return !!raw && typeof raw === 'object' && (raw as Record<string, unknown>)[key] === true;
};

/** Kişisel anahtar "Diğer alanlar bölümünü gizle" (`tabletIeForm.digerGizli`); yok/bozuk = bölüm GÖRÜNÜR (bugünkü form). */
export const parseOtherHidden = (blob: unknown): boolean => flagOn(blob, 'digerGizli');

/** Kişisel anahtar "Rota adımı notunu gizle" (`tabletIeForm.adimNotuGizli`); yok/bozuk = not kutusu GÖRÜNÜR. */
export const parseStepNotesHidden = (blob: unknown): boolean => flagOn(blob, 'adimNotuGizli');

/**
 * "Diğer alanlar" bölümü çizilir mi: anahtar açıkken evet; kapalıyken gizli alanlardan biri gövdeye gidecek değer taşıyorsa
 * (sessiz gönderim yasak) ya da alt çubuk oraya yönlendirdiyse yine çizilir.
 */
export function otherSectionShown(otherHidden: boolean, otherValued: readonly WoFieldKey[], revealed = false): boolean {
  return !otherHidden || otherValued.length > 0 || revealed;
}

/** Gizli alanı aç/kapat; zorunlu alan kapatılamaz (liste aynen döner). */
export function toggleHidden(hidden: readonly WoFieldKey[], k: WoFieldKey): WoFieldKey[] {
  if (isRequiredField(k)) return [...hidden];
  return hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k];
}

const DOC_KEY_FIELD: Record<DocFilledKey, WoFieldKey> = { width: 'en', targetQuantity: 'hedefMetraj', targetWeight: 'hedefKg', note: 'not' };

/**
 * Bu okumada belgeden DEĞER dolan (gövdeye gidecek) alanlar. Okuma anının görüntüsü (`docShown`) kullanılır: görevli alanı
 * düzeltince rozet düşer ama alan okuma boyunca yerinde kalır. Yalnız öneri/yazı (`suggestions`, `docText`) gizli alanı üste
 * çıkarmaz — değer gövdeye gitmez; kullanıcı görmek isterse ⚙'tan açar (2026-11-09).
 */
export function docFilledFields(s: Pick<WoFormState, 'docShown'>): WoFieldKey[] {
  return s.docShown.map((k) => DOC_KEY_FIELD[k]);
}

export type FieldPlacement = 'top' | 'other';

/** Alanın yeri: zorunlu / açık / belgeden dolmuş → üst; gizli → altta "Diğer alanlar". */
export function placement(k: WoFieldKey, hidden: readonly WoFieldKey[], docKeys: readonly WoFieldKey[]): FieldPlacement {
  if (isRequiredField(k) || !hidden.includes(k) || docKeys.includes(k)) return 'top';
  return 'other';
}

/** "Diğer alanlar (n)" sayısı: gizli + bu formda çizilebilir + belgeden dolmamış alanlar. */
export function otherFields(hidden: readonly WoFieldKey[], docKeys: readonly WoFieldKey[], c: FieldContext): WoFieldKey[] {
  return WO_FIELDS.filter((f) => !f.planned && fieldApplicable(f.key, c) && placement(f.key, hidden, docKeys) === 'other').map((f) => f.key);
}

/**
 * Kullanıcının doldurduğu / değiştirdiği ve gövdeye gidecek alanlar. Gizli alanda böyle bir değer varsa "Diğer alanlar"
 * başlığı bunu söyler (gizli alandan sessiz gönderim yok). Kat tipi (otomatik ön seçim) ve gramaj (belge satırı) sayılmaz.
 */
export function valuedFields(e: WoFormExtras, c: { stepsEdited: boolean }): WoFieldKey[] {
  const filled = (t: string) => t.trim() !== '';
  const pairs: [WoFieldKey, boolean][] = [
    ['rotaAdimlari', c.stepsEdited],
    ['makine', e.machineId !== undefined],
    ['siparis', e.orderLineIds.length > 0],
    ['hedefKumas', !!e.targetItemId],
    ['en', filled(e.width)],
    ['hedefMetraj', filled(e.targetQuantity)],
    ['hedefKg', filled(e.targetWeight)],
    ['hedefRenk', !!e.targetColorId],
    ['hedefOzellik', e.propertyIds !== null],
    ['planBaslangic', !!e.plannedStart],
    ['planBitis', !!e.plannedEnd],
    ['not', filled(e.note)],
  ];
  return pairs.filter(([, v]) => v).map(([k]) => k);
}

export const fieldLabel = (k: WoFieldKey): string => BY_KEY.get(k)?.label ?? k;
