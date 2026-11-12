// Tanıtmada fotoğrafı yalnız GÖRÜNTÜDE çeyrek adımla döndürmek için saf kutu dönüşümü. Öneri ucuna giden kutular `rect` (OCR dik
// çerçevesi) ve kelime sırasıdır; bu dönüşüm yalnız çizim/dokunma kutusuna (`photoRect`) uygulanır — şablon dönmeden bağımsız kalır.
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 0..3'e katlar (negatif ve 4+ dahil). */
export const normTurns = (q: number): number => ((Math.round(q) % 4) + 4) % 4;

/** W×H görüntüsünün `quarterTurns` × 90° saat yönünde dönmüş boyutu. */
export function rotatedSize(w: number, h: number, quarterTurns: number): { width: number; height: number } {
  return normTurns(quarterTurns) % 2 === 1 ? { width: h, height: w } : { width: w, height: h };
}

/** W×H çerçevesindeki kutuyu görüntüyle birlikte `quarterTurns` × 90° SAAT YÖNÜNDE döndürür (sonuç dönmüş çerçevede). */
export function rotateBox(box: Box, w: number, h: number, quarterTurns: number): Box {
  const { x, y, width: bw, height: bh } = box;
  switch (normTurns(quarterTurns)) {
    case 1:
      return { x: h - y - bh, y: x, width: bh, height: bw };
    case 2:
      return { x: w - x - bw, y: h - y - bh, width: bw, height: bh };
    case 3:
      return { x: y, y: w - x - bw, width: bh, height: bw };
    default:
      return { x, y, width: bw, height: bh };
  }
}
