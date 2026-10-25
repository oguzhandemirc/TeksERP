// =============================================================================
// BAĞIMSIZ MUAYENE KONAĞI — bağdaştırıcı (K4P-EKRAN, plan §4.1 konak b; saf, React'sız)
// =============================================================================
// Doğmuş top okutulur, aynı `InspectionPanel` açılır, muayene `POST /quality-inspections`
// ile yazılır. İstasyon türüne bağlanmaz; oturum istasyonu yalnız VERİ (muayeneye açıksa).
// Çevrimdışı kuyruk YOK (plan v1): taslak cihazda kalır, top yeniden okutulabilir.
// =============================================================================
import type { CreateInspectionRequest, InspectionPreview, InspectionWidthSource } from '../../../services/qualityInspection.service';
import type { InspectionDraft } from '../../../components/inspection/inspectionDraft';
import { draftToWireDefects } from '../../../components/inspection/inspectionWire';
import { inspectionDraftKey } from '../../../components/inspection/inspectionDraftStore';

export const STANDALONE_INSPECTION_HOST = 'standalone';

export interface StandaloneGateInput {
  moduleEnabled: boolean;
  hasPermission: (code: string) => boolean;
}

/** Ekran kapısı — modül ∧ `mobile:muayene` (menü girişiyle aynı iki koşul; istasyon türü okunmaz). */
export function standaloneInspectionVisible({ moduleEnabled, hasPermission }: StandaloneGateInput): boolean {
  return moduleEnabled && hasPermission('mobile:muayene');
}

/** Taslak top başına: başka top okutulunca önceki topun emeği kaybolmaz. */
export function standaloneDraftKey(rollId: string): string {
  return inspectionDraftKey(STANDALONE_INSPECTION_HOST, rollId);
}

/** Yazma gövdesi. Aşama gönderilmez: sunucu topun durumundan türetir (önizlemenin baktığı aşamayla aynı). */
export function standaloneCreateBody(
  rollId: string,
  draft: InspectionDraft,
  clientToken: string,
  station: { id: string; canInspect?: unknown } | null | undefined,
): CreateInspectionRequest {
  const note = draft.note.trim();
  return {
    rollId,
    defects: draftToWireDefects(draft),
    ...(draft.inspectedLengthM != null ? { inspectedLengthM: draft.inspectedLengthM } : {}),
    ...(note ? { note } : {}),
    // İstasyon kapı değil veri; muayeneye kapalı istasyonu göndermek kaydı reddettirirdi.
    ...(station?.canInspect === true ? { stationId: station.id } : {}),
    clientToken,
  };
}

export function activeInspectionText(active: { revision: number }): string {
  return `Bu topun r${active.revision} muayenesi var — panelden düzeltilir`;
}

export const OFFLINE_TEXT = 'Çevrimdışı — muayene kaydedilemez. Taslak bu cihazda kalır.';

/** Kayıt hatası → operatör metni (kod `details.code`ten). */
export function saveErrorText(err: unknown): string {
  const e = err as { status?: number; message?: string; details?: { code?: string } } | null;
  const code = e?.details?.code;
  if (code === 'INSPECTION_ALREADY_ACTIVE') return 'Bu topun muayenesi var — panelden düzeltilir';
  if (code === 'MODULE_DISABLED') return 'Kalite güvence modülü kapalı';
  if (e?.status === undefined || e.status >= 500) return 'Sunucuya ulaşılamadı — tekrar KAYDET (aynı kayıt, çift yazılmaz)';
  return e.message || 'Muayene kaydedilemedi';
}

export function saveBlockReason(input: { rollId: string | null; isOnline: boolean; active: unknown; busy: boolean }): string | null {
  if (!input.rollId) return 'Önce top okutun';
  if (input.active) return 'Aktif muayene var';
  if (!input.isOnline) return 'Çevrimdışı';
  if (input.busy) return 'Kaydediliyor';
  return null;
}

const WIDTH_SOURCE: Record<InspectionWidthSource, string> = { ITEM_CARD: 'kart', ROLL_MEASURED: 'ölçü', MANUAL: 'elle', UNKNOWN: '' };

// Hermes'te yerel ayar biçimi garanti değil — ondalık virgülü elle (özet şeridindeki `fmtPer100` emsali).
const fmt1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1).replace('.', ',') : '—');

export interface StripRoll {
  barcode: string | null;
  currentQty: number;
  qualityGrade?: string | null;
  item?: { name: string } | null;
}

/** Top şeridi: "T… · KUMAŞ · 96,0 m · en 280 (kart) · 1.KALİTE" — en önizlemeden (sunucu çözer). */
export function rollStripParts(roll: StripRoll, preview: Pick<InspectionPreview, 'widthCm' | 'widthSource'> | null | undefined): string[] {
  const width = preview?.widthCm != null ? Number(preview.widthCm) : null;
  const src = preview ? WIDTH_SOURCE[preview.widthSource] : '';
  const widthText = width != null && Number.isFinite(width) ? `en ${Math.round(width)}${src ? ` (${src})` : ''}` : preview ? 'en bilinmiyor' : 'en …';
  return [roll.barcode ?? '—', roll.item?.name ?? '—', `${fmt1(Number(roll.currentQty))} m`, widthText, roll.qualityGrade || '—'];
}
