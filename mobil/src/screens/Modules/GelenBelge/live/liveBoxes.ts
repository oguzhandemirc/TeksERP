// Canlı okuma (L3) — karede görülen kelimelerin önizleme üzerindeki sarı kutuları (saf). Koordinat dönüşümü TEK yerde
// (`frameToView`, önizleme FIT_CENTER); dörtgen → eksene hizalı kutu. Kutu sayısı tavanlı: çizim kareyi yavaşlatmasın.
import { frameToView } from '../../../../services/liveCamera';
import type { ClientOcr } from '../../../../services/deviceOcr';

export const LIVE_MAX_BOXES = 300;

export interface ViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function wordRects(ocr: Pick<ClientOcr, 'width' | 'height' | 'words'> | null, view: { width: number; height: number }): ViewRect[] {
  if (!ocr) return [];
  const t = frameToView(ocr, view);
  if (!t) return [];
  const out: ViewRect[] = [];
  for (const w of ocr.words) {
    if (out.length >= LIVE_MAX_BOXES) break;
    if (!w.c.length) continue;
    const xs = w.c.map((p) => p[0]);
    const ys = w.c.map((p) => p[1]);
    const left = Math.min(...xs) * t.scale + t.dx;
    const top = Math.min(...ys) * t.scale + t.dy;
    out.push({ left, top, width: (Math.max(...xs) - Math.min(...xs)) * t.scale, height: (Math.max(...ys) - Math.min(...ys)) * t.scale });
  }
  return out;
}
