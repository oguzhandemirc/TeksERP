// Belge önizlemesinde parti sekmesi (2026-11-09) — saf parçalar: partinin top satırları, fotoğrafta hangi sayfa + hangi
// kutu (satırların okuma kutularının birleşimi) ve kutuyu ekrana getiren yakınlaştırma. Kutu çerçeveye sığmıyorsa (yerel
// fotoğraf okunan görüntüyle aynı değil) vurgu YOK — yanlış yeri göstermektense hiç göstermemek.
import type { InboundNoteLine, InboundNoteScan } from '../../../../services/inboundDoc.service';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Size {
  w: number;
  h: number;
}

/** Partinin top satırları (özet/parti kaydı satırı hariç), satır sırasıyla. */
export function partyLines(lines: readonly InboundNoteLine[] | undefined, blockNo: number): InboundNoteLine[] {
  return (lines ?? [])
    .filter((l) => l.blockNo === blockNo && l.summary !== true && l.lineKind !== 'ARABA')
    .sort((a, b) => a.lineNo - b.lineNo);
}

function union(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export interface PartyFocus {
  /** Gönderilen sayfalar dizisinde (`done.sent`) partinin ilk satırının sayfası. */
  pageIndex: number;
  rect: Rect;
  /** Kutu çerçevesi taramada yazılıysa (küçültülmüş foto); yoksa null → görüntünün kendi boyutu. */
  frame: Size | null;
}

/**
 * Partinin fotoğraftaki yeri: ilk okunmuş satırının taraması → yerel sayfa (sha256), o sayfadaki satırların kutularının
 * birleşimi. Satır kutusu / tarama / yerel sayfa yoksa null (vurgu yok, sekme yine çalışır).
 */
export function partyFocus(lines: readonly InboundNoteLine[], scans: readonly InboundNoteScan[] | undefined, pages: readonly { sha256: string }[]): PartyFocus | null {
  const first = lines.find((l) => l.scanId && l.sourceRects && Object.keys(l.sourceRects).length > 0);
  const scan = first ? scans?.find((s) => s.id === first.scanId) : undefined;
  if (!first || !scan) return null;
  const pageIndex = pages.findIndex((p) => p.sha256 === scan.sha256);
  if (pageIndex < 0) return null;
  const rects = lines.filter((l) => l.scanId === first.scanId).flatMap((l) => Object.values(l.sourceRects ?? {}));
  const rect = union(rects.filter((r) => [r.x, r.y, r.width, r.height].every(Number.isFinite)));
  if (!rect) return null;
  const w = scan.rectFrameWidth;
  const h = scan.rectFrameHeight;
  return { pageIndex, rect, frame: w && h && w > 0 && h > 0 ? { w, h } : null };
}

export interface FocusGeometry {
  /** Kutunun `contain` ile çizilen görüntü üstündeki yeri (kap koordinatı, 1x). */
  box: Rect;
  scale: number;
  tx: number;
  ty: number;
}

const SLACK = 1.02;
const MAX_FOCUS_SCALE = 2.5;
const PAD = 0.06;

/**
 * Kutunun kap içindeki yeri + kutuyu ortalayan yakınlaştırma (dönüşüm sırası: translate, sonra merkez etrafında scale).
 * Kutu çerçeveyi taşıyorsa (farklı görüntü) null.
 */
export function focusGeometry(rect: Rect, frame: Size, box: Size): FocusGeometry | null {
  if (frame.w <= 0 || frame.h <= 0 || box.w <= 0 || box.h <= 0) return null;
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > frame.w * SLACK || rect.y + rect.height > frame.h * SLACK) return null;
  const k = Math.min(box.w / frame.w, box.h / frame.h);
  const ox = (box.w - frame.w * k) / 2;
  const oy = (box.h - frame.h * k) / 2;
  // Bölüm başlığı (parti no satırı) tablonun hemen üstündedir: kutu yukarı biraz genişletilir.
  const padY = frame.h * PAD;
  const y = Math.max(0, rect.y - padY);
  const r: Rect = { x: ox + rect.x * k, y: oy + y * k, width: rect.width * k, height: (rect.y + rect.height - y) * k };
  const scale = Math.max(1, Math.min(MAX_FOCUS_SCALE, 0.9 * Math.min(box.w / Math.max(r.width, 1), box.h / Math.max(r.height, 1))));
  const cx = r.x + r.width / 2 - box.w / 2;
  const cy = r.y + r.height / 2 - box.h / 2;
  return { box: r, scale, tx: -scale * cx, ty: -scale * cy };
}
