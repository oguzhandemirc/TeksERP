// =============================================================================
// D4-E2b ölçülen en (cm) — saf yardımcılar
// =============================================================================
// Alan İSTEĞE BAĞLIDIR: boşsa gövdeye anahtar HİÇ girmez (eski APK ile bayt-aynı);
// yalnız `capturesWidth=true` adımda çizilir (backend E2a; eski backend alanı göndermez).
// =============================================================================

/** Alan yalnız `capturesWidth === true` adımda; eski backend anahtarı göndermez → gizli. */
export function widthCaptureEnabled(summary: { capturesWidth?: boolean } | null | undefined): boolean {
  return summary?.capturesWidth === true;
}

export type WidthParse = { ok: true; value: number | null } | { ok: false; message: string };

/** Metin → cm. Boş = null (gönderilmez); sayı değilse ya da ≤ 0 ise operatöre Türkçe sebep. */
export function parseMeasuredWidth(text: string): WidthParse {
  const t = text.trim().replace(',', '.');
  if (t === '') return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, message: 'Ölçülen en sayı olmalı' };
  if (n <= 0) return { ok: false, message: 'Ölçülen en sıfırdan büyük olmalı (boş bırakılabilir)' };
  return { ok: true, value: n };
}

/** Değer yoksa gövde AYNEN döner (anahtar eklenmez); varsa `measuredWidthCm` eklenir. */
export function withMeasuredWidth<T extends object>(vars: T, widthCm: number | null): T | (T & { measuredWidthCm: number }) {
  return widthCm == null ? vars : { ...vars, measuredWidthCm: widthCm };
}

const WIDTH_ERROR_TEXT: Record<string, string> = {
  WIDTH_CAPTURE_DISABLED: 'Bu istasyon en ölçmüyor — ölçülen en gönderilemez. Alanı boş bırakıp yeniden deneyin.',
  WIDTH_ALREADY_RECORDED: 'Bu topun eni zaten kaydedildi. Değiştirmek için adımı yeniden açın.',
};

/** En hatasının ekran metni; en hatası değilse null (çağıran genel metni basar). */
export function measuredWidthErrorText(err: unknown): string | null {
  const e = err as { details?: { code?: unknown }; message?: unknown } | null;
  const code = typeof e?.details?.code === 'string' ? e.details.code : null;
  if (!code) return null;
  if (code === 'WIDTH_OUT_OF_RANGE') {
    // Sunucu sınırı (mevcut en + eşik) metne yazar — Türkçe ve sayılı; aynen gösterilir.
    return typeof e?.message === 'string' && e.message ? e.message : 'Ölçülen en izin verilen aralığın dışında';
  }
  return WIDTH_ERROR_TEXT[code] ?? null;
}
