// Metre ↔ kg aynı kutu — backend `Teks-Erp/src/lib/gelen-belge/motor/olcu-cakisma.ts` aynası (tanıtmada erken uyarı; sunucu
// ayrıca etiket stratejisini denetler ve `teachErrors` ile reddeder). Saf: kutuyu çağıran verir (OCR çerçevesi).
import type { Rect } from '../../../../types/inboundDocTeach';
import type { FieldKey } from './teachDraft';

export const METER_FAMILY_FIELDS: readonly FieldKey[] = ['toplamMetre', 'hedefMetraj'];
export const KG_FAMILY_FIELDS: readonly FieldKey[] = ['toplamKg', 'hedefKg'];
/** Kesişim küçük kutunun alanına oranla bu eşik ve üstündeyse "aynı hücre". */
export const SAME_CELL_RATIO = 0.5;

/** İki kutunun kesişimi / küçük kutunun alanı (0..1). */
export function sameCellRatio(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const small = Math.min(a.width * a.height, b.width * b.height);
  return w <= 0 || h <= 0 || small <= 0 ? 0 : (w * h) / small;
}

/** Aynı kutuya düşen (metre, kg) alan çiftleri. */
export function clashingPairs(box: (k: FieldKey) => Rect | null): { meter: FieldKey; kg: FieldKey }[] {
  const out: { meter: FieldKey; kg: FieldKey }[] = [];
  for (const kg of KG_FAMILY_FIELDS) {
    const kb = box(kg);
    if (!kb) continue;
    for (const meter of METER_FAMILY_FIELDS) {
      const mb = box(meter);
      if (mb && sameCellRatio(kb, mb) >= SAME_CELL_RATIO) out.push({ meter, kg });
    }
  }
  return out;
}
