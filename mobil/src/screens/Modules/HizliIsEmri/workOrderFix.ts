// İş emri düzeltme menüsünün saf kuralları (hareket defteri D5) — ekrandan bağımsız, testli.
import type { ReasonPreset } from '../../../services/reasonPreset.service';
import type { ReasonPresetValue } from '../../../components/reasonPresets/ReasonPresetPicker';
import type { TargetColorPreview } from '../../../services/workOrder.service';

export const MIN_REASON_LENGTH = 3;

/**
 * Seçiciden gövdeye: chip seçildiyse görünen metin katalog satırının tam metni,
 * serbest metinde yazılan metin. Kod seçicinin verdiği gibi gider (sunucu doğrular).
 */
export function reasonPayload(
  value: ReasonPresetValue,
  presets: readonly ReasonPreset[],
): { reason: string; reasonCode: string | null } {
  const typed = value.text.trim();
  if (typed) return { reason: typed, reasonCode: value.code };
  const hit = value.code ? presets.find((p) => p.code === value.code) : undefined;
  return { reason: (hit?.fullText ?? hit?.label ?? '').trim(), reasonCode: value.code };
}

export function reasonReady(value: ReasonPresetValue, presets: readonly ReasonPreset[]): boolean {
  return reasonPayload(value, presets).reason.length >= MIN_REASON_LENGTH;
}

/**
 * Renk kaydı kapısı: önizleme engel diyorsa kaydedilmez; kısmi boyada operatör
 * onayı ister (409 tostu yerine kartta seçim). Önizleme yoksa (yükleniyor) kapalı.
 */
export function colorSaveGate(
  preview: TargetColorPreview | undefined,
  partialConfirmed: boolean,
): { canSave: boolean; needsConfirm: boolean } {
  if (!preview || preview.blocked) return { canSave: false, needsConfirm: false };
  const needsConfirm = preview.partial !== null;
  return { canSave: !needsConfirm || partialConfirmed, needsConfirm };
}

/** En girişi: boş = temizle (null); sayı 0 < en ≤ 1000 cm; aksi hâlde geçersiz (undefined). */
export function parseWidth(raw: string): number | null | undefined {
  const t = raw.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n <= 1000 ? n : undefined;
}

/** Tablet İptal: panel yetkisi olmayan kullanıcı yalnız hiç işlem görmemiş iş emrini iptal eder (S3). */
export function tabletCancelAllowed(
  wo: { status: string; locks?: { materialCommitted?: boolean } | null },
  hasPanelWrite: boolean,
): boolean {
  if (hasPanelWrite) return true;
  return wo.status === 'PLANNED' && !wo.locks?.materialCommitted;
}

/** Top Çıkar toplu sonucu: kaçı çıktı, kaçı reddedildi (ilk sebep), iş emri Planlandı'ya döndü mü. */
export function detachResultMessage(ok: number, failed: string[], reverted: boolean): { type: 'success' | 'error'; text: string } {
  const head = ok > 0 ? `${ok} top iş emrinden çıkarıldı` : 'Hiçbir top çıkarılamadı';
  const tail = failed.length > 0 ? ` · ${failed.length} top çıkarılamadı: ${failed[0]}` : '';
  const rev = reverted ? ' · iş emrinde top kalmadı, Planlandı\'ya döndü' : '';
  return { type: failed.length > 0 ? 'error' : 'success', text: head + rev + tail };
}
