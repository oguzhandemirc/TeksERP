// D3a (2026-10-28): el yazısı ızgarası — yapı basılı, değer el yazısı (0243 kesim takip, 0244 kumaş irsaliyesi).
// Basılı sıra numaraları ve kolon başlıkları Paddle'la güvenilir; hücre rect'i komşu basılı numaradan türer
// (TASARIM-KARARI §5). Hücre DAİMA needsReview; OCR adayı yalnız öneridir. Eksik numara komşulardan ara değerlenir.
import type { GridCell, GridResult, GridSpec, OcrLine, OcrRect, OcrResult, Row } from "./types";
import { centerX, centerY, collectLines } from "./geometry";
import { buildRowsTilted } from "./rows-tilted";
import { labelSimilarity, lineCenterInside, matchesLabel, isNumericText, LABEL_MIN_SIMILARITY } from "./labels";

interface HeaderEntry {
  kind: "seq" | "value";
  key: string;
  rect: OcrRect;
  /** Kolon şeridi: komşu başlıklarla orta nokta sınırları. */
  x0: number;
  x1: number;
}
interface SeqColumn {
  header: HeaderEntry;
  values: HeaderEntry[];
  used: OcrLine[];
  /** numara → merkez y */
  ys: Map<number, number>;
  pitch: number;
}

const SEQ_MIN_CONFIDENCE = 0.8;
const SEQ_RE = /^(\d{1,3})\.?$/;

/** En çok sıra-başlığı taşıyan satır = ızgara başlık satırı; girdileri x sıralı, şeritleri komşu orta noktalarından. */
function findHeader(rows: Row[], spec: GridSpec, imageWidth: number): HeaderEntry[] {
  let best: { entries: HeaderEntry[]; seqCount: number } | null = null;
  for (const row of rows) {
    const entries: HeaderEntry[] = [];
    for (const line of row.lines) {
      if (labelSimilarity(line.text, spec.seqHeaders) >= LABEL_MIN_SIMILARITY) {
        entries.push({ kind: "seq", key: "seq", rect: line.rect, x0: 0, x1: 0 });
        continue;
      }
      const col = spec.valueColumns.find((c) => labelSimilarity(line.text, c.headers) >= LABEL_MIN_SIMILARITY);
      if (col) entries.push({ kind: "value", key: col.key, rect: line.rect, x0: 0, x1: 0 });
    }
    const seqCount = entries.filter((e) => e.kind === "seq").length;
    if (seqCount >= 1 && (!best || seqCount > best.seqCount)) best = { entries, seqCount };
  }
  if (!best) return [];
  const sorted = best.entries.sort((a, b) => a.rect.x - b.rect.x);
  sorted.forEach((e, i) => {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    e.x0 = prev ? (prev.rect.x + prev.rect.width + e.rect.x) / 2 : Math.max(0, e.rect.x - e.rect.width);
    e.x1 = next ? (e.rect.x + e.rect.width + next.rect.x) / 2 : Math.min(imageWidth, e.rect.x + 2 * e.rect.width);
  });
  return sorted;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Sıra kolonunun altındaki basılı numaralar (güvenli, tam sayı) → numara→y haritası; pitch = ardışık fark medyanı. */
function collectSeq(header: HeaderEntry, lines: OcrLine[]): { ys: Map<number, number>; pitch: number; used: OcrLine[] } {
  const ys = new Map<number, number>();
  const used: OcrLine[] = [];
  // Başlık satırı eğik olabilir (0243: y 389..440); her kolon KENDİ başlığının altına bakar
  const headerBottom = header.rect.y + header.rect.height;
  for (const l of lines) {
    const m = SEQ_RE.exec(l.text.trim());
    if (!m || (l.confidence ?? 0) < SEQ_MIN_CONFIDENCE) continue;
    const cx = centerX(l.rect);
    if (cx < header.x0 || cx > header.x1 || centerY(l.rect) <= headerBottom) continue;
    const n = Number(m[1]);
    // Aynı numara iki kez okunduysa İLK OKUNAN (OCR kutu sırası) kalır; y karşılaştırması yapılmaz
    if (!ys.has(n)) {
      ys.set(n, centerY(l.rect));
      used.push(l);
    }
  }
  // Sapanlar (el yazısı "71" sıra kolonuna düşmüş, "03" yanlış okunmuş): y sırasında EN UZUN ARTAN numara dizisi kalır
  for (const n of outliers([...ys.entries()])) ys.delete(n);
  const ordered = [...ys.entries()].sort((a, b) => a[0] - b[0]);
  const steps: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const dn = ordered[i]![0] - ordered[i - 1]![0];
    const dy = ordered[i]![1] - ordered[i - 1]![1];
    if (dn > 0 && dy > 0) steps.push(dy / dn);
  }
  return { ys, pitch: median(steps), used };
}

/** y sırasına göre en uzun artan alt diziye GİRMEYEN numaralar (atılacaklar). */
function outliers(entries: Array<[number, number]>): number[] {
  const byY = [...entries].sort((a, b) => a[1] - b[1]);
  const len = byY.map(() => 1);
  const prev = byY.map(() => -1);
  for (let i = 0; i < byY.length; i++) {
    for (let j = 0; j < i; j++) {
      if (byY[j]![0] < byY[i]![0] && len[j]! + 1 > len[i]!) {
        len[i] = len[j]! + 1;
        prev[i] = j;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < byY.length; i++) if (len[i]! > len[best]!) best = i;
  const keep = new Set<number>();
  for (let i = best; i >= 0; i = prev[i]!) keep.add(byY[i]![0]);
  return byY.map((e) => e[0]).filter((n) => !keep.has(n));
}

/**
 * Eksik numaraları komşulardan doğrusal ara değerler; kolon başını önceki kolonun son numarasına (ilk kolonda 1'e),
 * sonunu sonraki kolonun ilk numarasına kadar pitch ile uzatır (okunamayan basılı numara: 0243 "1" güven 0,53).
 */
function fillSequence(col: SeqColumn, neighbours: { prevLast: number | null; nextFirst: number | null }, imageHeight: number): void {
  const nums = [...col.ys.keys()].sort((a, b) => a - b);
  if (nums.length === 0 || col.pitch <= 0) return;
  const first = nums[0]!;
  const last = nums[nums.length - 1]!;
  const { nextFirst } = neighbours;
  const startTarget = neighbours.prevLast !== null ? neighbours.prevLast + 1 : 1;
  const headerBottom = col.header.rect.y + col.header.rect.height;
  for (let n = first - 1; n >= startTarget; n--) {
    const y = col.ys.get(n + 1)! - col.pitch;
    if (y - col.pitch / 2 < headerBottom) break;
    col.ys.set(n, y);
  }
  for (let n = first; n <= last; n++) {
    if (col.ys.has(n)) continue;
    const lo = nums.filter((k) => k < n).pop()!;
    const hi = nums.find((k) => k > n)!;
    const y = col.ys.get(lo)! + ((col.ys.get(hi)! - col.ys.get(lo)!) * (n - lo)) / (hi - lo);
    col.ys.set(n, y);
  }
  const target = nextFirst !== null ? nextFirst - 1 : last;
  for (let n = last + 1; n <= target; n++) {
    const y = col.ys.get(n - 1)! + col.pitch;
    if (y + col.pitch / 2 > imageHeight) break;
    col.ys.set(n, y);
  }
}

function buildCells(col: SeqColumn, lines: OcrLine[], seqLines: Set<OcrLine>): GridCell[] {
  const cells: GridCell[] = [];
  for (const [seqNo, cy] of [...col.ys.entries()].sort((a, b) => a[0] - b[0])) {
    for (const v of col.values) {
      const rect: OcrRect = { x: v.x0, y: cy - col.pitch / 2, width: v.x1 - v.x0, height: col.pitch };
      const candidates = lines
        .filter((l) => !seqLines.has(l) && lineCenterInside(l, rect))
        .map((l) => ({ text: l.text, confidence: l.confidence, rect: l.rect }));
      cells.push({ seqNo, key: v.key, rect, candidates, needsReview: true });
    }
  }
  return cells;
}

/** Basılı sıra numaralarından el yazısı hücre rect'leri türetir. */
export function deriveGridCells(ocr: OcrResult, spec: GridSpec): GridResult {
  const warnings: string[] = [];
  const lines = collectLines(ocr).filter((l) => l.text.trim().length > 0);
  const rows = buildRowsTilted(lines);
  const header = findHeader(rows, spec, ocr.imageWidth);
  if (header.length === 0) return { cells: [], seqColumns: [], warnings: ["GRID_NOT_FOUND: sıra numarası başlığı bulunamadı"] };
  const columns: SeqColumn[] = [];
  for (const h of header) {
    if (h.kind === "seq") columns.push({ header: h, values: [], ...collectSeq(h, lines) });
    else if (columns.length > 0) columns[columns.length - 1]!.values.push(h);
  }
  // Yalnız sıra kolonunda KULLANILAN numaralar hücre adayı olmaktan çıkar; "170" gibi el yazısı değer 1-3 haneli olsa da adaydır
  const seqLines = new Set<OcrLine>(columns.flatMap((c) => c.used));
  columns.forEach((c, i) => {
    const prev = columns[i - 1];
    const next = columns[i + 1];
    fillSequence(
      c,
      {
        prevLast: prev && prev.ys.size > 0 ? Math.max(...prev.ys.keys()) : null,
        nextFirst: next && next.ys.size > 0 ? Math.min(...next.ys.keys()) : null,
      },
      ocr.imageHeight,
    );
  });
  const cells = columns.flatMap((c) => buildCells(c, lines, seqLines));
  if (spec.totalsLabels && spec.totalsLabels.length > 0) {
    const totalsRow = rows.find((r) => r.lines.some((l) => matchesLabel(l.text, spec.totalsLabels!)));
    if (totalsRow && !totalsRow.lines.some((l) => isNumericText(l.text))) {
      warnings.push("TOTAL_UNVERIFIED: el yazısı toplam okunamadı, operatör sağlaması gerekir");
    }
  }
  return {
    cells,
    seqColumns: columns
      .filter((c) => c.ys.size > 0)
      .map((c) => ({ rect: c.header.rect, first: Math.min(...c.ys.keys()), last: Math.max(...c.ys.keys()) })),
    warnings,
  };
}
