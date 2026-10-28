// D3a (2026-10-28): TABLO stratejisi — basılı çeki listesi satırları (0245: 2 blok, 21/21; 0246: 1 satır + TOPLAM).
// Başlık satırı → blok; satırlar eğime duyarlı gruplanır (rows-tilted.ts); hücreler başlık kolonuna yatay çakışmayla
// atanır; "T.Adet"/"TOPLAM" satırı beyan edilen toplamdır ve deftere DEĞİL computeNoteTotals'a gider.
import type { DeclaredTotals, FieldSpec, OcrLine, OcrRect, OcrResult, Row, TableBlock, TableCell, TableColumnSpec, TableResult, TableRow, TableSpec } from "./types";
import { collectLines, unionRect, averageConfidence } from "./geometry";
import { buildRowsTilted } from "./rows-tilted";
import { assignToColumn, isNumericText, labelSimilarity, matchesLabel, LABEL_MIN_SIMILARITY } from "./labels";
import { evaluateCandidate } from "./extract";
import { lineElements } from "./anchor";
import { canonicalEquals, sumCanonical } from "./totals";

interface ColumnRect {
  key: string;
  rect: OcrRect;
}
interface BlockDraft {
  headerRect: OcrRect;
  columns: ColumnRect[];
  rows: Row[];
  totalsRows: Row[];
}

const DEFAULT_MIN_CONFIDENCE = 0.85;

/** Satır, spec kolon başlıklarından kaçını taşıyor; eşleşen kolonların kutuları. */
function matchHeader(row: Row, spec: TableSpec): ColumnRect[] {
  const out: ColumnRect[] = [];
  for (const col of spec.columns) {
    let best: { sim: number; rect: OcrRect } | null = null;
    for (const line of row.lines) {
      const sim = labelSimilarity(line.text, col.headers);
      if (sim >= LABEL_MIN_SIMILARITY && (!best || sim > best.sim)) best = { sim, rect: line.rect };
    }
    if (best) out.push({ key: col.key, rect: best.rect });
  }
  return out;
}

function isTotalsRow(row: Row, spec: TableSpec): boolean {
  if (!spec.totals) return false;
  return row.lines.some((l) => matchesLabel(l.text, spec.totals!.labels));
}

/** Satırları başlık/veri/toplam olarak bloklara böler; başlıktan önceki toplam satırları "sahipsiz" döner. */
function partition(rows: Row[], spec: TableSpec): { blocks: BlockDraft[]; orphanTotals: Row[] } {
  const minHeader = spec.minHeaderMatches ?? 2;
  const blocks: BlockDraft[] = [];
  const orphanTotals: Row[] = [];
  let current: BlockDraft | null = null;
  for (const row of rows) {
    const header = matchHeader(row, spec);
    if (header.length >= minHeader) {
      current = { headerRect: unionRect(header.map((h) => h.rect)), columns: header, rows: [], totalsRows: [] };
      blocks.push(current);
      continue;
    }
    if (isTotalsRow(row, spec)) {
      if (current) current.totalsRows.push(row);
      else orphanTotals.push(row);
      continue;
    }
    if (current) current.rows.push(row);
  }
  return { blocks: blocks.filter((b) => b.rows.length > 0 || b.totalsRows.length > 0), orphanTotals };
}

function columnField(col: TableColumnSpec): FieldSpec {
  return { key: col.key, label: col.label, type: col.type, pattern: col.pattern, strategies: [] };
}

function makeCell(col: TableColumnSpec, lines: OcrLine[]): TableCell {
  const raw = lines.map((l) => l.text.trim()).join(" ");
  const fr = evaluateCandidate(
    columnField(col),
    { raw, ocrConfidence: averageConfidence(lines.flatMap(lineElements)), labelSimilarity: 1, strategyIndex: 0, kind: "roi" },
    DEFAULT_MIN_CONFIDENCE,
  );
  return { key: col.key, raw, value: fr.value, rect: unionRect(lines.map((l) => l.rect)), confidence: fr.confidence, needsReview: fr.needsReview };
}

/** Satırın kutularını kolonlara dağıtır; kolon başına birden çok kutu düşerse birleştirilir. */
function assignCells(row: Row, draft: BlockDraft, spec: TableSpec): Record<string, TableCell> {
  const tolerance = Math.max(...draft.columns.map((c) => c.rect.width)) * 0.75;
  const byKey = new Map<string, OcrLine[]>();
  for (const line of row.lines) {
    const key = assignToColumn(line.rect, draft.columns, tolerance);
    if (!key) continue;
    const arr = byKey.get(key) ?? [];
    arr.push(line);
    byKey.set(key, arr);
  }
  const cells: Record<string, TableCell> = {};
  for (const col of spec.columns) {
    const lines = byKey.get(col.key);
    if (lines && lines.length > 0) cells[col.key] = makeCell(col, lines);
  }
  return cells;
}

function rowAccepted(cells: Record<string, TableCell>, spec: TableSpec): boolean {
  const required = spec.columns.filter((c) => c.required);
  const minCells = spec.minCells ?? Math.max(2, required.length);
  if (Object.keys(cells).length < minCells) return false;
  return required.every((c) => cells[c.key]?.value !== null && cells[c.key]?.value !== undefined);
}

/**
 * Toplam satırından beyan: yalnız etiketin SAĞINDAKİ sayılar; kg/m önce kolon çakışmasıyla, çakışmayan ondalıklar
 * x sırasıyla şablondaki ölçü kolonu sırasına (0245 üst satır: "T.Adet 16 819,20 3.935,00" kolon hizasında değildir);
 * adet countKey ya da artakalan tam sayı.
 */
function readDeclared(row: Row, draft: BlockDraft, spec: TableSpec): DeclaredTotals {
  const tolerance = Math.max(...draft.columns.map((c) => c.rect.width)) * 0.75;
  const measureKeys = spec.columns.filter((c) => c.key === "kg" || c.key === "m").map((c) => c.key);
  const label = row.lines.find((l) => matchesLabel(l.text, spec.totals?.labels ?? []));
  const out: DeclaredTotals = { count: null, kg: null, m: null, rect: unionRect(row.lines.map((l) => l.rect)) };
  const leftovers: Array<{ value: string; x: number }> = [];
  for (const line of row.lines) {
    if (!isNumericText(line.text) || (label && line.rect.x <= label.rect.x)) continue;
    const key = assignToColumn(line.rect, draft.columns, tolerance);
    const col = spec.columns.find((c) => c.key === key) ?? { key: "n", label: "n", type: "decimal" as const, headers: [] };
    const value = makeCell(col, [line]).value;
    if (value === null) continue;
    if (key === "kg" && measureKeys.includes("kg")) out.kg = value;
    else if (key === "m" && measureKeys.includes("m")) out.m = value;
    else if (spec.totals?.countKey && key === spec.totals.countKey) out.count = value;
    // Başka bir ONDALIK kolona ("Miktar 3" en) hizalanan sayı adet DEĞİLDİR; hizasız ya da tam sayı/kod kolonundaki ("Top No"
    // altındaki "5") artakalır
    else if (key === null || col.type !== "decimal") leftovers.push({ value, x: line.rect.x });
  }
  leftovers.sort((a, b) => a.x - b.x);
  // Kolon hizasında olmayan toplam satırı: etiketten sonra önce adet (tam sayı), sonra ölçüler şablon sırasıyla
  const missing = measureKeys.filter((k) => out[k as "kg" | "m"] === null);
  if (out.count === null && leftovers.length > missing.length && /^\d+$/.test(leftovers[0]!.value)) out.count = leftovers.shift()!.value;
  for (const key of missing) {
    const next = leftovers.shift();
    if (next) out[key as "kg" | "m"] = next.value;
  }
  return out;
}

function buildBlock(draft: BlockDraft, blockNo: number, spec: TableSpec, warnings: string[]): TableBlock {
  const rows: TableRow[] = [];
  let skipped = 0;
  for (const row of draft.rows) {
    const cells = assignCells(row, draft, spec);
    if (!rowAccepted(cells, spec)) {
      // Yalnız bütün zorunlu kolonları dolu olup değeri çözülemeyen satır sayılır; başlık alanındaki yarım satırlar gürültüdür
      if (spec.columns.filter((c) => c.required).every((c) => cells[c.key])) skipped++;
      continue;
    }
    rows.push({
      index: rows.length + 1,
      cells,
      rect: unionRect(Object.values(cells).map((c) => c.rect)),
      needsReview: Object.values(cells).some((c) => c.needsReview),
    });
  }
  if (skipped > 0) warnings.push(`TABLE_ROWS_SKIPPED blok ${blockNo}: ${skipped} satır değeri çözülemediği için atlandı`);
  const declared = draft.totalsRows.length > 0 ? readDeclared(draft.totalsRows[0]!, draft, spec) : null;
  if (draft.totalsRows.length > 1) warnings.push(`TABLE_TOTALS_AMBIGUOUS blok ${blockNo}: ${draft.totalsRows.length} toplam satırı, ilki alındı`);
  return { blockNo, headerRect: draft.headerRect, rows, declared };
}

/** Beyansız bloklar arasında satıra konumca en yakın olanı: önce hemen ALTINDAKİ başlık (0245 yerleşimi), yoksa en yakın. */
function nearestBlock(row: Row, blocks: TableBlock[]): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.declared !== null) continue;
    const dy = b.headerRect.y - row.y;
    const dist = dy >= 0 ? dy : 1e6 + Math.abs(dy);
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}

/**
 * Sahipsiz toplam satırı (0245: üstteki "T.Adet 16 …") önce Σ'sı tutan beyansız bloğa bağlanır; tutmazsa konumca en yakın
 * beyansız bloğa (karşılaştırma computeNoteTotals'a kalır → TOTAL_MISMATCH; OCR'ın tek rakam hatası UNVERIFIED'da gizlenmez).
 */
function attachOrphans(orphans: Row[], drafts: BlockDraft[], blocks: TableBlock[], spec: TableSpec): string[] {
  const warnings: string[] = [];
  for (const row of orphans) {
    let attached = false;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (b.declared !== null) continue;
      const declared = readDeclared(row, drafts[i]!, spec);
      const sumKg = sumCanonical(b.rows.map((r) => r.cells.kg?.value ?? null));
      const sumM = sumCanonical(b.rows.map((r) => r.cells.m?.value ?? null));
      const kgOk = declared.kg === null || canonicalEquals(declared.kg, sumKg);
      const mOk = declared.m === null || canonicalEquals(declared.m, sumM);
      if ((declared.kg !== null || declared.m !== null) && kgOk && mOk) {
        b.declared = declared;
        attached = true;
        break;
      }
    }
    if (attached) continue;
    const i = nearestBlock(row, blocks);
    if (i >= 0) {
      const declared = readDeclared(row, drafts[i]!, spec);
      if (declared.kg !== null || declared.m !== null) {
        blocks[i]!.declared = declared;
        continue;
      }
    }
    warnings.push(`TABLE_TOTALS_ORPHAN: "${row.text}" toplam satırı hiçbir bloğa bağlanamadı`);
  }
  return warnings;
}

/** Şablondaki tablo tanımını OCR sonucuna uygular. */
export function extractTable(ocr: OcrResult, spec: TableSpec): TableResult {
  const warnings: string[] = [];
  const rows = buildRowsTilted(collectLines(ocr));
  const { blocks: drafts, orphanTotals } = partition(rows, spec);
  const blocks = drafts.map((d, i) => buildBlock(d, i + 1, spec, warnings));
  warnings.push(...attachOrphans(orphanTotals, drafts, blocks, spec));
  if (blocks.length === 0) warnings.push(`TABLE_NOT_FOUND ${spec.key}: başlık satırı bulunamadı`);
  return { key: spec.key, blocks, warnings };
}
