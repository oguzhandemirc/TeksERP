// D3a (2026-10-28): çok bölgeli sayfa ayırma — tek fotoğrafta iki belge (0246: çıkış çeki listesi + ürün sevk fişi).
// Sezgisel: büyük yatay boşluk bandı + her iki yanda yeterli içerik. Yanlış bölme panelde "ayır/birleştir" ile düzeltilir
// (TASARIM-KARARI §5 "bilinmeyen yerleşim", §8 riskler).
import type { OcrBlock, OcrLine, OcrPoint, OcrRect, OcrResult, PageRegion } from "./types";
import { bottom, collectLines } from "./geometry";

export interface SplitRegionsOptions {
  /** Boşluk bandı asgari oranı (görüntü yüksekliğine göre); varsayılan 0,10. */
  minGapRatio?: number;
  /** Her bölgede asgari satır sayısı; varsayılan 8. */
  minLines?: number;
  /** Her bölgenin toplam satırlardaki asgari payı; varsayılan 0,20 (imza/altbilgi kuyruğu bölge sayılmaz). */
  minShare?: number;
}

function shiftRect(r: OcrRect, dy: number): OcrRect {
  return { x: r.x, y: r.y - dy, width: r.width, height: r.height };
}
function shiftCorners(c: OcrPoint[] | undefined, dy: number): OcrPoint[] | undefined {
  return c ? c.map((p) => ({ x: p.x, y: p.y - dy })) : undefined;
}
function shiftLine(l: OcrLine, dy: number): OcrLine {
  return {
    ...l,
    rect: shiftRect(l.rect, dy),
    corners: shiftCorners(l.corners, dy),
    elements: l.elements.map((e) => ({ ...e, rect: shiftRect(e.rect, dy), corners: shiftCorners(e.corners, dy) })),
  };
}

/** Bloğu bölgeye kırpar: yalnız bölgedeki satırlar kalır (ML Kit çok satırlı blok olabilir). */
function sliceBlocks(ocr: OcrResult, keep: Set<OcrLine>, dy: number): OcrBlock[] {
  const out: OcrBlock[] = [];
  for (const b of ocr.blocks) {
    const lines = b.lines.filter((l) => keep.has(l));
    if (lines.length === 0) continue;
    const shifted = lines.map((l) => shiftLine(l, dy));
    const x0 = Math.min(...shifted.map((l) => l.rect.x));
    const y0 = Math.min(...shifted.map((l) => l.rect.y));
    const x1 = Math.max(...shifted.map((l) => l.rect.x + l.rect.width));
    const y1 = Math.max(...shifted.map((l) => bottom(l.rect)));
    out.push({ text: shifted.map((l) => l.text).join("\n"), rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, lines: shifted });
  }
  return out;
}

/** Satırları y'ye göre tarar; nitelikli boşluk bantlarının y konumlarını (bandın ortası) döner. */
function findCuts(lines: OcrLine[], ocr: OcrResult, opts: Required<SplitRegionsOptions>): number[] {
  const sorted = [...lines].sort((a, b) => a.rect.y - b.rect.y);
  const minGap = opts.minGapRatio * ocr.imageHeight;
  const cuts: number[] = [];
  let maxBottom = -Infinity;
  let above = 0;
  for (const l of sorted) {
    if (above > 0 && l.rect.y - maxBottom >= minGap) {
      const below = sorted.length - above;
      const enough = (n: number) => n >= opts.minLines && n / sorted.length >= opts.minShare;
      if (enough(above) && enough(below)) cuts.push((maxBottom + l.rect.y) / 2);
    }
    maxBottom = Math.max(maxBottom, bottom(l.rect));
    above++;
  }
  return cuts;
}

/** Tek fotoğrafı belge bölgelerine ayırır; bölünmezse tek bölge (orijinal ocr) döner. */
export function splitRegions(ocr: OcrResult, options: SplitRegionsOptions = {}): PageRegion[] {
  const opts: Required<SplitRegionsOptions> = {
    minGapRatio: options.minGapRatio ?? 0.1,
    minLines: options.minLines ?? 8,
    minShare: options.minShare ?? 0.2,
  };
  const lines = collectLines(ocr).filter((l) => l.text.trim().length > 0);
  const full: OcrRect = { x: 0, y: 0, width: ocr.imageWidth, height: ocr.imageHeight };
  const cuts = lines.length > 0 ? findCuts(lines, ocr, opts) : [];
  if (cuts.length === 0) return [{ regionNo: 1, rect: full, ocr, lineCount: lines.length }];
  const bounds = [0, ...cuts, ocr.imageHeight];
  const regions: PageRegion[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const top = bounds[i]!;
    const bot = bounds[i + 1]!;
    const keep = new Set(lines.filter((l) => l.rect.y >= top && l.rect.y < bot));
    const blocks = sliceBlocks(ocr, keep, top);
    regions.push({
      regionNo: i + 1,
      rect: { x: 0, y: top, width: ocr.imageWidth, height: bot - top },
      ocr: { ...ocr, text: blocks.map((b) => b.text).join("\n"), blocks, imageHeight: bot - top },
      lineCount: keep.size,
    });
  }
  return regions;
}
