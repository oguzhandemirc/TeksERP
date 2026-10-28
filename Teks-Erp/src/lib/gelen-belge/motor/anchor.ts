// Kaynak: ocr-test prototipi src/ocr-engine/anchor.ts (kullanıcının kendi kodu), vendor 2026-10-28 (D3a).
// Dış bağımlılık yok; yalnız göreli import. Değişiklikler: çift tırnak, proje lint/boyut kuralları, Türkçe yorumlar korundu.
/**
 * Etiket (anchor) bulma ve yöne göre değer arama.
 * Etiket, bir satırın tamamı ya da satır içindeki ardışık element penceresi olabilir.
 */
import type { AnchorStrategy, NormRect, OcrElement, OcrLine, OcrRect, OcrResult, Row } from "./types";
import { bottom, centerInNormRect, centerY, horizontalOverlap, right, unionRect } from "./geometry";
import { normalizeForMatch, similarity } from "./text-normalize";

/** Element metnini etiket parçası ve ayraçtan sonra kalan değer parçasına ayırır ("No:12345" → "No:" + "12345"). */
export function splitElement(text: string): { labelPart: string; remainder: string } {
  const m = /^(.*?[:=])(\S.*)$/.exec(text);
  if (m && m[1].replace(/[:=]/g, "").trim().length > 0) return { labelPart: m[1], remainder: m[2] };
  return { labelPart: text, remainder: "" };
}

export interface LabelMatch {
  /** Şablondaki etiket. */
  label: string;
  /** OCR'da eşleşen metin. */
  matchedText: string;
  similarity: number;
  rowIndex: number;
  line: OcrLine;
  rect: OcrRect;
  /** Eşleşen element aralığı [start, end). */
  elementStart: number;
  elementEnd: number;
  /** Son elementte ayraçtan sonra kalan değer metni. */
  remainder: string;
}

export interface ValueCandidate {
  raw: string;
  elements: OcrElement[];
  rect: OcrRect;
  direction: "right" | "below";
}

/** Arama bağlamı: okuma sıralı row'lar ve satır→row indeksi. */
export interface AnchorContext {
  ocr: OcrResult;
  rows: Row[];
  rowIndexOf: Map<OcrLine, number>;
  /** Normalize edilmiş diğer-alan etiketleri (stopAtLabels ve alt-pencere eleme için). */
  otherLabels: string[];
}

export function buildAnchorContext(ocr: OcrResult, rows: Row[], otherLabels: string[]): AnchorContext {
  const rowIndexOf = new Map<OcrLine, number>();
  rows.forEach((r, i) => r.lines.forEach((l) => rowIndexOf.set(l, i)));
  return { ocr, rows, rowIndexOf, otherLabels: otherLabels.map(normalizeForMatch).filter(Boolean) };
}

/** Satırın elementleri; element yoksa satırın kendisi tek element sayılır. */
export function lineElements(line: OcrLine): OcrElement[] {
  if (line.elements && line.elements.length > 0) return line.elements;
  return [{ text: line.text, rect: line.rect, confidence: line.confidence }];
}

const MAX_LABEL_WINDOW = 6;

/**
 * Tüm satırlarda etiketi arar. Tüm element n-gram pencereleri (ve ayraçla bölünmüş son element) değerlendirilir.
 * Sonuç benzerliğe göre azalan, eşitlikte üst-sol öncelikli sıralanır.
 */
export function findLabelMatches(
  ctx: AnchorContext,
  labels: string[],
  minSimilarity: number,
  window?: NormRect,
): LabelMatch[] {
  const normLabels = labels.map((l) => ({ label: l, norm: normalizeForMatch(l) })).filter((l) => l.norm.length > 0);
  const out: LabelMatch[] = [];
  ctx.rows.forEach((row, rowIndex) => {
    for (const line of row.lines) {
      const els = lineElements(line);
      const n = els.length;
      for (let start = 0; start < n; start++) {
        let best: LabelMatch | null = null;
        for (let end = start + 1; end <= Math.min(n, start + MAX_LABEL_WINDOW); end++) {
          const last = splitElement(els[end - 1].text);
          const parts = els.slice(start, end - 1).map((e) => e.text);
          parts.push(last.labelPart);
          const text = parts.join(" ");
          const norm = normalizeForMatch(text);
          if (!norm) continue;
          for (const { label, norm: ln } of normLabels) {
            // Uzunluk farkı çok büyükse hesaplama (hız + sahte eşleşme)
            if (Math.abs(norm.length - ln.length) > Math.max(3, ln.length * 0.5)) continue;
            const sim = similarity(norm, ln);
            if (sim < minSimilarity) continue;
            const rect = unionRect(els.slice(start, end).map((e) => e.rect));
            if (window && !centerInNormRect(rect, window, ctx.ocr)) continue;
            const m: LabelMatch = {
              label, matchedText: text, similarity: sim, rowIndex, line, rect,
              elementStart: start, elementEnd: end, remainder: last.remainder,
            };
            // Eşit benzerlikte daha uzun (daha özgül) pencere tercih edilir ("Kumaş" < "Kumaş Adı")
            if (!best || sim > best.similarity || (sim === best.similarity && end - start > best.elementEnd - best.elementStart)) best = m;
          }
        }
        if (best) out.push(best);
      }
    }
  });
  // Alt-pencere eleme: (1) aynı satırda aynı alanın daha uzun ve en az o kadar iyi eşleşmesinin içinde kalan pencere
  // ("Metraj" ⊂ "Toplam Metraj (m)"); (2) komşu elementle genişletilince BAŞKA bir etiketle daha iyi eşleşen pencere
  const filtered = out.filter(
    (m) =>
      !out.some(
        (o) => o !== m && o.line === m.line && o.elementStart <= m.elementStart && o.elementEnd >= m.elementEnd &&
          o.elementEnd - o.elementStart > m.elementEnd - m.elementStart && o.similarity >= m.similarity,
      ) && !isSubWindowOfOtherLabel(m, ctx),
  );
  filtered.sort((a, b) => b.similarity - a.similarity || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  return filtered;
}

function isSubWindowOfOtherLabel(m: LabelMatch, ctx: AnchorContext): boolean {
  if (ctx.otherLabels.length === 0) return false;
  const els = lineElements(m.line);
  const variants: string[] = [];
  const core = els.slice(m.elementStart, m.elementEnd - 1).map((e) => e.text);
  core.push(splitElement(els[m.elementEnd - 1].text).labelPart);
  if (m.elementStart > 0) variants.push([els[m.elementStart - 1].text, ...core].join(" "));
  if (m.elementEnd < els.length && m.remainder === "") variants.push([...core, splitElement(els[m.elementEnd].text).labelPart].join(" "));
  for (const v of variants) {
    const nv = normalizeForMatch(v);
    for (const ol of ctx.otherLabels) {
      // Eşitlikte de uzun (daha özgül) etiket kazanır: "Kumaş" ⊂ "Kumaş Kodu"
      if (similarity(nv, ol) >= m.similarity) return true;
    }
  }
  return false;
}

/**
 * Element dizisinde başka bir alanın etiketinin başladığı ilk indeks; yoksa elements.length.
 * Kısa (< 3 karakter) etiketlerde yalnız tam eşleşme kabul edilir.
 */
export function findStopIndex(elements: OcrElement[], otherLabels: string[], minSim = 0.85): number {
  if (otherLabels.length === 0) return elements.length;
  for (let i = 0; i < elements.length; i++) {
    for (let n = 1; n <= 3 && i + n <= elements.length; n++) {
      const parts = elements.slice(i, i + n - 1).map((e) => e.text);
      parts.push(splitElement(elements[i + n - 1].text).labelPart);
      const norm = normalizeForMatch(parts.join(" "));
      if (!norm) continue;
      for (const ol of otherLabels) {
        const sim = similarity(norm, ol);
        if (ol.length < 3 ? sim === 1 : sim >= minSim) return i;
      }
    }
  }
  return elements.length;
}

function makeCandidate(elements: OcrElement[], direction: "right" | "below", firstOverride?: string): ValueCandidate | null {
  if (elements.length === 0) return null;
  const texts = elements.map((e, i) => (i === 0 && firstOverride !== undefined ? firstOverride : e.text));
  const raw = texts.join(" ").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  return { raw, elements, rect: unionRect(elements.map((e) => e.rect)), direction };
}

/** Değer metninin başındaki ayraçları ayıklar (": 12345" → "12345"). */
function stripLeadingSeparators(elements: OcrElement[]): OcrElement[] {
  let i = 0;
  while (i < elements.length && /^[\s:=\-–—.]*$/.test(elements[i].text)) i++;
  return elements.slice(i);
}

/** sameLine / right: etiketten sonra aynı satırda kalanlar; yoksa aynı dikey bantta sağdaki en yakın satır(lar). */
export function findValueRight(m: LabelMatch, ctx: AnchorContext, strategy: AnchorStrategy): ValueCandidate | null {
  const stop = strategy.stopAtLabels ?? true;
  const maxDistance = strategy.maxDistance ?? 2.5;
  const els = lineElements(m.line);
  // 1) Aynı satırda etiket penceresinden sonra kalanlar
  let rest: OcrElement[] = [];
  let firstOverride: string | undefined;
  // D3a: yalnız noktalama kalıntısı ("ADI:..." → "...") değer değildir; sağdaki kutuya bakılır
  if (m.remainder && /[^\s.:;=\-–—_]/.test(m.remainder)) {
    const lastEl = els[m.elementEnd - 1];
    rest = [{ ...lastEl, text: m.remainder }, ...els.slice(m.elementEnd)];
    firstOverride = m.remainder;
  } else rest = stripLeadingSeparators(els.slice(m.elementEnd));
  if (rest.length > 0) {
    const cut = stop ? findStopIndex(rest, ctx.otherLabels) : rest.length;
    const c = makeCandidate(rest.slice(0, cut), "right", firstOverride);
    if (c) return c;
    // Değer başka bir etiketle kesildi ve boş kaldı → sağdaki satırlara bakma, alt arama denenmeli
    if (cut === 0) return null;
  }
  // 2) Etiket kutusunun dikey bandında, sağında başlayan en yakın satırlar
  const labelH = Math.max(m.rect.height, 1);
  const labelCy = centerY(m.rect);
  const labelRight = right(m.rect);
  const maxGap = maxDistance * labelH * 4;
  const band: Array<{ line: OcrLine; gap: number }> = [];
  for (const row of ctx.rows) {
    for (const line of row.lines) {
      if (line === m.line) continue;
      if (Math.abs(centerY(line.rect) - labelCy) > 0.6 * labelH) continue;
      const gap = line.rect.x - labelRight;
      if (gap < -0.3 * labelH || gap > maxGap) continue;
      band.push({ line, gap });
    }
  }
  if (band.length === 0) return null;
  band.sort((a, b) => a.gap - b.gap);
  const taken: OcrElement[] = [];
  let prevRight = labelRight;
  for (const b of band) {
    if (taken.length > 0 && b.line.rect.x - prevRight > 1.5 * labelH) break;
    taken.push(...lineElements(b.line));
    prevRight = right(b.line.rect);
  }
  const cleaned = stripLeadingSeparators(taken);
  const cut = stop ? findStopIndex(cleaned, ctx.otherLabels) : cleaned.length;
  return makeCandidate(cleaned.slice(0, cut), "right");
}

/** below: etiketin altında, yatayda etiketle çakışan ya da sol kenarı etiket soluna yakın ilk takeLines satır. */
export function findValueBelow(m: LabelMatch, ctx: AnchorContext, strategy: AnchorStrategy): ValueCandidate | null {
  const stop = strategy.stopAtLabels ?? true;
  const maxDistance = strategy.maxDistance ?? 2.5;
  const takeLines = Math.max(1, strategy.takeLines ?? 1);
  const labelH = Math.max(m.rect.height, 1);
  const labelBottom = bottom(m.rect);
  const byRow = new Map<number, OcrLine[]>();
  for (const row of ctx.rows) {
    for (const line of row.lines) {
      const ri = ctx.rowIndexOf.get(line) ?? -1;
      if (ri === m.rowIndex || line === m.line) continue;
      if (centerY(line.rect) <= centerY(m.rect)) continue;
      const gap = line.rect.y - labelBottom;
      if (gap > maxDistance * labelH) continue;
      const aligned = horizontalOverlap(line.rect, m.rect) > 0 || Math.abs(line.rect.x - m.rect.x) <= 1.5 * labelH;
      if (!aligned) continue;
      const arr = byRow.get(ri) ?? [];
      arr.push(line);
      byRow.set(ri, arr);
    }
  }
  const rowIdx = [...byRow.keys()].sort((a, b) => a - b);
  const collected: OcrElement[] = [];
  let rowsTaken = 0;
  for (const ri of rowIdx) {
    if (rowsTaken >= takeLines) break;
    const lines = byRow.get(ri)!.sort((a, b) => a.rect.x - b.rect.x);
    const els = stripLeadingSeparators(lines.flatMap(lineElements));
    const cut = stop ? findStopIndex(els, ctx.otherLabels) : els.length;
    const part = els.slice(0, cut);
    if (part.length > 0) {
      collected.push(...part);
      rowsTaken++;
    }
    if (cut < els.length) break; // bu satırda başka bir etiket başladı
  }
  return makeCandidate(collected, "below");
}
