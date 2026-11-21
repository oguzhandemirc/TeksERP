// =============================================================================
// DEVERE DÖNÜŞ KABULÜ — kusurlu levent reddi saf yardımcıları (ek-2 r)
// =============================================================================
// Ret sayfası taslağı → panelle AYNI ret ucu gövdesi. Tablet karar VERMEZ: reddedilebilirlik, dönen iplik ve
// foto zorunluluğu sunucu önizlemesinde; burada yalnız gönder düğmesinin açık/kapalı hâli ve deneme parmak izi.
// =============================================================================
import type { ReasonPresetValue } from '../../../components/reasonPresets/ReasonPresetPicker';
import type { ReasonPreset } from '../../../services/reasonPreset.service';
import { REJECT_MAX_PHOTOS, type RejectFields, type RejectLookup } from '../../../services/devereKabul.service';

/** Sunucu tavanı `WARPING_REJECT_PHOTO_MAX_BYTES` (5 MB) — aşan fotoğraf eklenmeden reddedilir. */
export const REJECT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const REJECT_NOTES_MAX = 500;

export interface RejectPhoto { uri: string; base64: string }

export interface RejectDraft {
  target: RejectLookup;
  reason: ReasonPresetValue;
  /** true = "yeniden sarılsın", false = "iptal — iplik deverecide kalsın". */
  expectRework: boolean;
  notes: string;
  photos: RejectPhoto[];
}

export function newRejectDraft(target: RejectLookup): RejectDraft {
  return { target, reason: { code: null, text: '' }, expectRework: true, notes: '', photos: [] };
}

export function rejectFields(d: RejectDraft): RejectFields {
  return {
    warpingOrderId: d.target.order.id,
    beamIds: [d.target.beam.id],
    reasonCode: d.reason.code ?? '',
    reasonText: d.reason.text.trim() || null,
    notes: d.notes.trim() || null,
    expectRework: d.expectRework,
  };
}

/** Gönder kapalıysa nedeni (günlük Türkçe); açıksa null. Son söz sunucu önizlemesinin `rejectable`ında. */
export function rejectBlockText(d: RejectDraft, presets: readonly ReasonPreset[], photoRequired: boolean): string | null {
  if (!d.reason.code) return 'Ret sebebini seçin.';
  const preset = presets.find((p) => p.code === d.reason.code);
  if (preset?.requiresText && !d.reason.text.trim()) return 'Sebebi kısaca yazın.';
  if (photoRequired && d.photos.length === 0) return 'Bu kurulumda fotoğraf zorunlu — en az bir fotoğraf çekin.';
  if (d.photos.length > REJECT_MAX_PHOTOS) return `En çok ${REJECT_MAX_PHOTOS} fotoğraf eklenir.`;
  if (d.notes.trim().length > REJECT_NOTES_MAX) return `Not en çok ${REJECT_NOTES_MAX} karakter.`;
  return null;
}

/** Base64 metnin bayt boyu (dolgu düşülür). */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** Fotoğraf eklenebilir mi — değilse operatör metni. */
export function photoAddBlock(d: RejectDraft, b64: string): string | null {
  if (d.photos.length >= REJECT_MAX_PHOTOS) return `En çok ${REJECT_MAX_PHOTOS} fotoğraf eklenir.`;
  if (base64Bytes(b64) > REJECT_PHOTO_MAX_BYTES) return 'Fotoğraf 5 MB sınırını aşıyor — yeniden çekin.';
  return null;
}

export function rejectPhotosBody(d: RejectDraft): { fileName: string; contentBase64: string }[] {
  return d.photos.map((p, i) => ({ fileName: `ret-${i + 1}.jpg`, contentBase64: p.base64 }));
}

/**
 * Deneme parmak izi = sunucunun replay kimliği (sipariş · sarımlar · sebep · kip). Not/foto/metin girmez:
 * aynı reddi notu düzeltip yeniden göndermek aynı denemedir (sunucu replay'i ilk kaydı döner).
 */
export function rejectFingerprint(f: RejectFields): string {
  return ['ret', f.warpingOrderId, [...f.beamIds].sort().join(','), f.reasonCode.trim(), String(f.expectRework)].join('|');
}
