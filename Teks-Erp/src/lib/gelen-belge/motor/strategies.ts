// Kaynak: ocr-test prototipi src/ocr-engine/strategies.ts (kullanıcının kendi kodu), vendor 2026-10-28 (D3a).
// Dış bağımlılık yok; yalnız göreli import. Değişiklikler: çift tırnak, proje lint/boyut kuralları, Türkçe yorumlar korundu.
/**
 * Stratejiler: anchor / regex / roi. Her biri ham aday listesi üretir; değerlendirme extract.ts'te.
 */
import type { AnchorStrategy, FieldSpec, OcrElement, OcrLine, OcrRect, OcrResult, RegexStrategy, RoiStrategy, Row, Strategy } from "./types";
import { buildAnchorContext, findLabelMatches, findValueBelow, findValueRight, lineElements, type AnchorContext } from "./anchor";
import { averageConfidence, linesInRoi, unionRect } from "./geometry";

export interface RawCandidate {
  raw: string;
  ocrConfidence: number | null;
  labelSimilarity: number;
  rect?: OcrRect;
  anchor?: string;
  strategyIndex: number;
  kind: Strategy["kind"];
}

export interface StrategyContext {
  ocr: OcrResult;
  rows: Row[];
  fullText: string;
  /** Diğer alanların etiketleri (ham). */
  otherLabels: string[];
  warnings: string[];
}

/** En fazla kaç etiket eşleşmesi denenir. */
const MAX_LABEL_MATCHES = 3;
const MAX_REGEX_MATCHES = 5;

export function runStrategy(strategy: Strategy, index: number, field: FieldSpec, ctx: StrategyContext): RawCandidate[] {
  switch (strategy.kind) {
    case "anchor":
      return runAnchor(strategy, index, ctx);
    case "regex":
      return runRegex(strategy, index, field, ctx);
    case "roi":
      return runRoi(strategy, index, ctx);
    default:
      ctx.warnings.push(`${field.key}: bilinmeyen strateji`);
      return [];
  }
}

function runAnchor(strategy: AnchorStrategy, index: number, ctx: StrategyContext): RawCandidate[] {
  const actx: AnchorContext = buildAnchorContext(ctx.ocr, ctx.rows, ctx.otherLabels);
  const matches = findLabelMatches(actx, strategy.labels, strategy.minLabelSimilarity ?? 0.8, strategy.window).slice(0, MAX_LABEL_MATCHES);
  const direction = strategy.direction ?? 'rightOrBelow';
  const out: RawCandidate[] = [];
  for (const m of matches) {
    const cands = [];
    if (direction === 'right' || direction === 'sameLine' || direction === 'rightOrBelow') cands.push(findValueRight(m, actx, strategy));
    if (direction === 'below' || direction === 'rightOrBelow') cands.push(findValueBelow(m, actx, strategy));
    for (const c of cands) {
      if (!c) continue;
      out.push({
        raw: c.raw,
        ocrConfidence: averageConfidence(c.elements),
        labelSimilarity: m.similarity,
        rect: c.rect,
        anchor: m.matchedText,
        strategyIndex: index,
        kind: 'anchor',
      });
    }
  }
  return out;
}

/** Okuma sıralı metni ve her satırın metin içindeki [start, end) aralığını üretir. */
function buildIndexedText(rows: Row[], filter?: (l: OcrLine) => boolean): { text: string; spans: Array<{ line: OcrLine; start: number; end: number }> } {
  const spans: Array<{ line: OcrLine; start: number; end: number }> = [];
  const rowTexts: string[] = [];
  let offset = 0;
  for (const r of rows) {
    const lines = filter ? r.lines.filter(filter) : r.lines;
    if (lines.length === 0) continue;
    const parts: string[] = [];
    let pos = offset;
    lines.forEach((l, i) => {
      const t = l.text.trim();
      if (i > 0) pos += 2; // '  ' ayracı
      spans.push({ line: l, start: pos, end: pos + t.length });
      pos += t.length;
      parts.push(t);
    });
    const rowText = parts.join('  ');
    rowTexts.push(rowText);
    offset += rowText.length + 1; // '\n'
  }
  return { text: rowTexts.join('\n'), spans };
}

function runRegex(strategy: RegexStrategy, index: number, field: FieldSpec, ctx: StrategyContext): RawCandidate[] {
  let roiLines: Set<OcrLine> | null = null;
  if (strategy.roi) roiLines = new Set(linesInRoi(ctx.rows, strategy.roi, ctx.ocr));
  const indexed = buildIndexedText(ctx.rows, roiLines ? (l) => roiLines!.has(l) : undefined);
  const text = indexed.text;
  let flags = strategy.flags ?? 'i';
  if (!flags.includes('g')) flags += 'g';
  let re: RegExp;
  try {
    re = new RegExp(strategy.pattern, flags);
  } catch (e) {
    ctx.warnings.push(`${field.key}: regex derlenemedi (${strategy.pattern})`);
    return [];
  }
  const out: RawCandidate[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && out.length < MAX_REGEX_MATCHES) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const group = strategy.group ?? (m.length > 1 && m[1] !== undefined ? 1 : 0);
    const raw = m[group] ?? m[0];
    if (!raw) continue;
    // Grup metninin tam metindeki konumu: eşleşme içinde ilk geçtiği yer
    const groupStart = m.index + Math.max(0, m[0].indexOf(raw));
    const src = locateElements(raw, groupStart, groupStart + raw.length, indexed.spans);
    out.push({
      raw,
      ocrConfidence: src.elements.length > 0 ? averageConfidence(src.elements) : null,
      labelSimilarity: 0.95,
      rect: src.elements.length > 0 ? unionRect(src.elements.map((e) => e.rect)) : undefined,
      strategyIndex: index,
      kind: 'regex',
    });
  }
  return out;
}

/** Metin aralığıyla çakışan satırlardaki, eşleşen parçayı içeren elementleri bulur (güven/kutu için). */
function locateElements(raw: string, start: number, end: number, spans: Array<{ line: OcrLine; start: number; end: number }>): { elements: OcrElement[] } {
  const lines = spans.filter((s) => s.start < end && s.end > start).map((s) => s.line);
  const tokens = raw.split(/\s+/).filter(Boolean);
  const elements: OcrElement[] = [];
  for (const line of lines) {
    for (const el of lineElements(line)) {
      if (tokens.some((t) => el.text.includes(t) || (t.length >= 3 && t.includes(el.text)))) elements.push(el);
    }
  }
  if (elements.length === 0) return { elements: lines.flatMap(lineElements) };
  return { elements };
}

function runRoi(strategy: RoiStrategy, index: number, ctx: StrategyContext): RawCandidate[] {
  const lines = linesInRoi(ctx.rows, strategy.roi, ctx.ocr);
  if (lines.length === 0) return [];
  const raw = lines.map((l) => l.text.trim()).filter(Boolean).join(strategy.joinWith ?? ' ');
  return [
    {
      raw,
      ocrConfidence: averageConfidence(lines.flatMap(lineElements)),
      labelSimilarity: 1,
      rect: unionRect(lines.map((l) => l.rect)),
      strategyIndex: index,
      kind: 'roi',
    },
  ];
}
