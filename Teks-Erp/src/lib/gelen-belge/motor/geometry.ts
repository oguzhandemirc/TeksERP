// Kaynak: ocr-test prototipi src/ocr-engine/geometry.ts (kullanıcının kendi kodu), vendor 2026-10-28 (D3a).
// Dış bağımlılık yok; yalnız göreli import. Değişiklikler: çift tırnak, proje lint/boyut kuralları, Türkçe yorumlar korundu.
/**
 * Kutu işlemleri ve okuma sırası (row) üretimi.
 * ML Kit blok sırası sütun-öncelikli olabilir; bu yüzden satırlar y/x'e göre yeniden dizilir.
 */
import type { NormRect, OcrLine, OcrRect, OcrResult, Row } from "./types";

export function centerX(r: OcrRect): number {
  return r.x + r.width / 2;
}
export function centerY(r: OcrRect): number {
  return r.y + r.height / 2;
}
export function right(r: OcrRect): number {
  return r.x + r.width;
}
export function bottom(r: OcrRect): number {
  return r.y + r.height;
}

/** Birden çok kutunun birleşimi. */
export function unionRect(rects: OcrRect[]): OcrRect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, right(r));
    y1 = Math.max(y1, bottom(r));
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Yatay çakışma uzunluğu (piksel; çakışma yoksa ≤ 0). */
export function horizontalOverlap(a: OcrRect, b: OcrRect): number {
  return Math.min(right(a), right(b)) - Math.max(a.x, b.x);
}

/** Normalize (0..1) dikdörtgeni piksel uzayına çevirir. */
export function normToPixels(n: NormRect, ocr: Pick<OcrResult, "imageWidth" | "imageHeight">): OcrRect {
  return { x: n.x * ocr.imageWidth, y: n.y * ocr.imageHeight, width: n.w * ocr.imageWidth, height: n.h * ocr.imageHeight };
}

/** Kutunun merkezi normalize bölgenin içinde mi? */
export function centerInNormRect(r: OcrRect, n: NormRect, ocr: Pick<OcrResult, "imageWidth" | "imageHeight">): boolean {
  const p = normToPixels(n, ocr);
  const cx = centerX(r), cy = centerY(r);
  return cx >= p.x && cx <= right(p) && cy >= p.y && cy <= bottom(p);
}

/** OCR çıktısındaki tüm satırları düz liste olarak toplar. */
export function collectLines(ocr: OcrResult): OcrLine[] {
  const out: OcrLine[] = [];
  for (const b of ocr.blocks) for (const l of b.lines) out.push(l);
  return out;
}

/**
 * Satırları okuma sırasına dizer: merkez y'ye göre sırala; dikey mesafesi
 * 0.5 × ortalama satır yüksekliğinden küçük olanlar aynı row'a; row içinde x'e göre sırala.
 */
export function buildRows(ocr: OcrResult): Row[] {
  const lines = collectLines(ocr).filter((l) => l.text.trim().length > 0);
  if (lines.length === 0) return [];
  const avgH = lines.reduce((s, l) => s + l.rect.height, 0) / lines.length;
  const tol = 0.5 * Math.max(avgH, 1);
  const sorted = [...lines].sort((a, b) => centerY(a.rect) - centerY(b.rect));
  const rows: Row[] = [];
  let current: OcrLine[] = [];
  let currentCy = 0;
  const flush = () => {
    if (current.length === 0) return;
    current.sort((a, b) => a.rect.x - b.rect.x);
    const u = unionRect(current.map((l) => l.rect));
    rows.push({ y: u.y, height: u.height, lines: current, text: current.map((l) => l.text.trim()).join("  ") });
    current = [];
  };
  for (const l of sorted) {
    const cy = centerY(l.rect);
    if (current.length === 0) {
      current.push(l);
      currentCy = cy;
      continue;
    }
    if (Math.abs(cy - currentCy) < tol) {
      current.push(l);
      // Row merkezini kayan ortalama ile güncelle
      currentCy = (currentCy * (current.length - 1) + cy) / current.length;
    } else {
      flush();
      current.push(l);
      currentCy = cy;
    }
  }
  flush();
  return rows;
}

/** Row'ları '\n' ile birleştirip tam metni verir. */
export function rowsToText(rows: Row[]): string {
  return rows.map((r) => r.text).join('\n');
}

/** Okuma sıralı tam metin (regex/sınıflandırma için). */
export function readingOrderText(ocr: OcrResult): string {
  return rowsToText(buildRows(ocr));
}

/** Normalize bölge içindeki satırları (okuma sırasında) döner. */
export function linesInRoi(rows: Row[], roi: NormRect, ocr: Pick<OcrResult, "imageWidth" | "imageHeight">): OcrLine[] {
  const out: OcrLine[] = [];
  for (const r of rows) for (const l of r.lines) if (centerInNormRect(l.rect, roi, ocr)) out.push(l);
  return out;
}

/** Elementlerin ortalama güveni; hiç güven yoksa null. */
export function averageConfidence(items: Array<{ confidence: number | null }>): number | null {
  const vals = items.map((e) => e.confidence).filter((c): c is number => typeof c === "number" && !Number.isNaN(c));
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}
