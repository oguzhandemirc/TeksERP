// Klavye kaması (wedge) birleştirici — saf durum makinesi. Okuyucu metni üç yoldan gelir: tek seferde
// yapıştırma (Point Mobile COPYPASTE), tuş tuş yazma (KBDMSG / HID), ve sonda Enter. Enter ya da kısa
// sessizlik okumayı bitirir; kutu boşaltılır.

/** Son karakterden sonra bu kadar sessizlik = okuma bitti (tuş tuş okuyucu ~5–30 ms aralıkla yazar). */
export const WEDGE_IDLE_MS = 120;

export interface WedgeStep {
  /** Kutuya yazılacak yeni değer. */
  value: string;
  /** Biten okuma (varsa). */
  emit: string | null;
  /** Zamanlayıcı kurulsun mu. */
  armTimer: boolean;
}

/** Metin değişti: içinde satır sonu varsa önceki kısım biter; yoksa zamanlayıcı kurulur. */
export function onWedgeChange(next: string): WedgeStep {
  const m = next.match(/^([^\r\n]*)[\r\n]+([\s\S]*)$/);
  if (m) {
    const done = m[1].trim();
    return { value: m[2], emit: done || null, armTimer: m[2].length > 0 };
  }
  return { value: next, emit: null, armTimer: next.length > 0 };
}

/** Enter ya da zaman aşımı: biriken metin biter. */
export function onWedgeFlush(current: string): WedgeStep {
  const done = current.trim();
  return { value: '', emit: done || null, armTimer: false };
}
