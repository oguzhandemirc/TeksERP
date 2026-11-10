// D3a (2026-10-28): TABLO stratejisi — basılı çeki listesi satırları (0245: 2 blok, 21/21; 0246: 1 satır + TOPLAM).
// Başlık satırı → blok; satırlar eğime duyarlı gruplanır (rows-tilted.ts); hücreler başlık kolonuna yatay çakışmayla
// atanır; "T.Adet"/"TOPLAM" satırı beyan edilen toplamdır ve deftere DEĞİL computeNoteTotals'a gider.
import type { DeclaredTotals, FieldSpec, OcrElement, OcrLine, OcrRect, OcrResult, Row, TableBlock, TableCell, TableColumnSpec, TableResult, TableRow, TableSpec } from "./types";
import { collectLines, unionRect, averageConfidence } from "./geometry";
import { buildRowsTilted, pageMedianAngle } from "./rows-tilted";
import { assignToColumn, isNumericText, labelSimilarity, matchesLabel, totalsLabelOf, LABEL_MIN_SIMILARITY } from "./labels";
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
  /** Sağdaki bitişik sütuna taşmış devam satırları + o sütunun başlık kolonlarına x kayması. */
  spill?: { rows: Row[]; dx: number };
}

const DEFAULT_MIN_CONFIDENCE = 0.85;

/** Satır, spec kolon başlıklarından kaçını taşıyor; eşleşen kolonların kutuları. */
function matchHeader(row: Row, spec: TableSpec): ColumnRect[] {
  const best = (cands: ReadonlyArray<{ text: string; rect: OcrRect }>, col: TableColumnSpec) => {
    let hit: { sim: number; rect: OcrRect } | null = null;
    for (const c of cands) {
      const sim = labelSimilarity(c.text, col.headers);
      if (sim >= LABEL_MIN_SIMILARITY && (!hit || sim > hit.sim)) hit = { sim, rect: c.rect };
    }
    return hit;
  };
  const hits = spec.columns.map((col) => ({ col, hit: best(row.lines, col) }));
  // ML Kit bitişik başlıkları tek satıra birleştirir ("Kilo Metre", 214279 ikinci bölüm): satırla eşleşmeyen ya da başka kolonla
  // AYNI satıra düşen kolon kelimede aranır (yoksa iki kolon tek kutuyu paylaşır, hücreler ayrılamaz).
  const words = row.lines.flatMap((l) => (l.elements.length > 1 ? l.elements : []));
  const out: ColumnRect[] = [];
  for (const { col, hit } of hits) {
    const shared = hit !== null && hits.some((o) => o.col !== col && o.hit?.rect === hit.rect);
    const word = !hit || shared ? best(words, col) : null;
    const rect = word?.rect ?? hit?.rect;
    if (rect) out.push({ key: col.key, rect });
  }
  return out;
}

/**
 * OCR toplam etiketini adetle BİTİŞİK okuyabilir ("T.Adet16", 214279 2. prova): etiket benzerliği eşiğin altına düşer, satır
 * toplam sayılmaz ve beyan sessizce kaybolur. Sondaki rakam koşusu ayrılıp etiket yeniden eşlenir; ayrılan sayı adettir.
 */
export function gluedTotalsCount(text: string, labels: string[]): string | null {
  if (matchesLabel(text, labels)) return null;
  const m = /^(.*[^\d\s])(\d{1,4})$/.exec(text.trim());
  return m && matchesLabel(m[1]!, labels) ? m[2]! : null;
}

const isTotalsLabel = (text: string, labels: string[]): boolean => matchesLabel(text, labels) || gluedTotalsCount(text, labels) !== null;

/** Satırları başlık/veri olarak bloklara böler (toplam satırları önceden `findTotals` ile ayrılmıştır). */
function partition(rows: Row[], spec: TableSpec): { blocks: BlockDraft[] } {
  const minHeader = spec.minHeaderMatches ?? 2;
  const blocks: BlockDraft[] = [];
  let current: BlockDraft | null = null;
  for (const row of rows) {
    const header = matchHeader(row, spec);
    if (header.length >= minHeader) {
      current = { headerRect: unionRect(header.map((h) => h.rect)), columns: header, rows: [] };
      blocks.push(current);
      continue;
    }
    if (current) current.rows.push(row);
  }
  return { blocks: blocks.filter((b) => b.rows.length > 0) };
}

function columnField(col: TableColumnSpec): FieldSpec {
  return { key: col.key, label: col.label, type: col.type, pattern: col.pattern, strategies: [] };
}

// Hücre kenarındaki "|" "¦" "[" "]" tablo çizgisidir, rakam değil ("212,30|" → 212.301; "3.935,00|" toplamı düşürüyordu, 214279).
// YALNIZ baş/son: sayının içindeki karakter ("3.9|35,00") yutulmaz. Tablo hücresi okuması ve sayı sınaması bu tek temizleyiciden.
const RULE_EDGES = /^[|¦[\]]+\s*|\s*[|¦[\]]+$/g;
const cellText = (text: string): string => text.trim().replace(RULE_EDGES, "");
const isNumericCell = (text: string): boolean => isNumericText(cellText(text));

function makeCell(col: TableColumnSpec, lines: OcrLine[]): TableCell {
  const raw = lines.map((l) => cellText(l.text)).join(" ");
  const fr = evaluateCandidate(
    columnField(col),
    { raw, ocrConfidence: averageConfidence(lines.flatMap(lineElements)), labelSimilarity: 1, strategyIndex: 0, kind: "roi" },
    DEFAULT_MIN_CONFIDENCE,
  );
  return { key: col.key, raw, value: fr.value, rect: unionRect(lines.map((l) => l.rect)), confidence: fr.confidence, needsReview: fr.needsReview };
}

/** Satırın kutularını kolonlara dağıtır; kolon başına birden çok kutu düşerse birleştirilir. */
function assignCells(row: Row, draft: BlockDraft, spec: TableSpec, dx = 0): Record<string, TableCell> {
  const tolerance = Math.max(...draft.columns.map((c) => c.rect.width)) * 0.75;
  const byKey = new Map<string, OcrLine[]>();
  const colOf = (r: OcrRect) => assignToColumn({ ...r, x: r.x - dx }, draft.columns, tolerance);
  for (const line of row.lines) {
    // ML Kit bitişik hücreleri tek satır okur ("13,70 54,4" = Kilo + Metre, 214279): kelimeleri ≥ 2 ayrı kolona düşen satır bölünür.
    const els = lineElements(line);
    const cols = els.length > 1 ? els.map((e) => colOf(e.rect)) : [];
    const parts: Array<[string | null, OcrLine]> = new Set(cols.filter((c) => c !== null)).size > 1
      ? els.map((e, i) => [cols[i]!, elementLine(e)])
      : [[colOf(line.rect), line]];
    for (const [key, part] of parts) {
      if (!key) continue;
      const arr = byKey.get(key) ?? [];
      arr.push(part);
      byKey.set(key, arr);
    }
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

/** Kelimeyi tek kelimelik satıra çevirir (kolon ataması kutuyla yapılır). */
const elementLine = (e: OcrElement): OcrLine => ({ text: e.text, rect: e.rect, confidence: e.confidence, angle: e.angle ?? null, elements: [e] });

/**
 * Toplam satırının sayı parçaları. Cihaz OCR'ı (ML Kit) bitişik sayıları tek satıra ("819,20 3.935,00") ve etiketle adedi
 * ("|T.Adet 16") birleştirebilir (Gülkesim 214279, 2026-11-06) → yalnız SAYILARDAN oluşan satır kelimelerine, etiket satırı
 * etiketten SONRAKİ sayı kelimelerine bölünür; harfli karışık satır ("4 TOP") bölünmez.
 */
function numericParts(lines: ReadonlyArray<OcrLine>, label: OcrLine | undefined): OcrLine[] {
  const out: OcrLine[] = [];
  for (const line of lines) {
    if (isNumericCell(line.text)) { out.push(line); continue; }
    const els = lineElements(line);
    if (els.length < 2) continue;
    if (line === label) {
      let i = els.length;
      while (i > 0 && isNumericCell(els[i - 1]!.text)) i--;
      if (i > 0) out.push(...els.slice(i).map(elementLine));
    } else if (els.every((e) => isNumericCell(e.text))) {
      out.push(...els.map(elementLine));
    }
  }
  return out;
}

/**
 * Toplam satırından beyan: yalnız etiketin SAĞINDAKİ sayılar; kg/m önce kolon çakışmasıyla, çakışmayan ondalıklar
 * x sırasıyla şablondaki ölçü kolonu sırasına (0245 üst satır: "T.Adet 16 819,20 3.935,00" kolon hizasında değildir);
 * adet countKey ya da artakalan tam sayı.
 */
function readDeclared(row: Row, draft: BlockDraft, spec: TableSpec): DeclaredTotals {
  const tolerance = Math.max(...draft.columns.map((c) => c.rect.width)) * 0.75;
  const measureKeys = spec.columns.filter((c) => c.key === "kg" || c.key === "m").map((c) => c.key);
  // Eski şablon etiketi adetle kayıtlı olabilir ("T.Adet 5"): bitişik adet ("T.Adet16") yedeği de etiket kısmıyla eşler
  const labels = totalsLabels(spec);
  const label = row.lines.find((l) => isTotalsLabel(l.text, labels));
  const out: DeclaredTotals = { count: null, kg: null, m: null, rect: unionRect(row.lines.map((l) => l.rect)) };
  const leftovers: Array<{ value: string; x: number }> = [];
  for (const line of numericParts(row.lines, label)) {
    if (!isNumericCell(line.text) || (label && line.rect.x <= label.rect.x)) continue;
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
  if (out.count === null && label) out.count = gluedTotalsCount(label.text, labels);
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
  const all = [...draft.rows.map((row) => ({ row, dx: 0 })), ...(draft.spill?.rows ?? []).map((row) => ({ row, dx: draft.spill!.dx }))];
  for (const { row, dx } of all) {
    const cells = assignCells(row, draft, spec, dx);
    if (!rowAccepted(cells, spec)) {
      // Yalnız bütün zorunlu kolonları dolu olup değeri çözülemeyen satır sayılır; başlık alanındaki yarım satırlar gürültüdür
      // Rakamsız zorunlu hücre ("FASON" Metre sütununun hizasında) değer değil, künye yazısıdır → sayılmaz
      if (spec.columns.filter((c) => c.required).every((c) => cells[c.key] && /\d/.test(cells[c.key]!.raw))) skipped++;
      continue;
    }
    rows.push({
      index: rows.length + 1,
      cells,
      rect: unionRect(Object.values(cells).map((c) => c.rect)),
      needsReview: Object.values(cells).some((c) => c.needsReview),
      ...(dx !== 0 ? { spill: true } : {}),
    });
  }
  if (skipped > 0) warnings.push(`TABLE_ROWS_SKIPPED blok ${blockNo}: ${skipped} satır değeri çözülemediği için atlandı`);
  return { blockNo, headerRect: draft.headerRect, rows, declared: null };
}

const centerX = (r: OcrRect): number => r.x + r.width / 2;

/** Taşma satırının kolonlara x kayması: kayık satır kutularının en çoğunu bir başlık kolonuna oturtan aday (kutu − kolon merkezi). */
function spillShift(rows: Row[], draft: BlockDraft, spec: TableSpec): number | null {
  for (const row of rows) {
    const header = matchHeader(row, spec);
    if (header.length < (spec.minHeaderMatches ?? 2)) continue;
    const ds = header.map((h) => centerX(h.rect) - centerX(draft.columns.find((c) => c.key === h.key)?.rect ?? h.rect)).sort((a, b) => a - b);
    return ds[Math.floor(ds.length / 2)]!;
  }
  const lines = rows.flatMap((r) => r.lines);
  const overlaps = (l: OcrLine, dx: number) => draft.columns.some((c) => l.rect.x - dx < c.rect.x + c.rect.width && l.rect.x + l.rect.width - dx > c.rect.x);
  let best: { dx: number; hits: number } | null = null;
  for (const line of lines) {
    for (const col of draft.columns) {
      const dx = centerX(line.rect) - centerX(col.rect);
      if (dx <= 0) continue;
      const hits = lines.filter((l) => overlaps(l, dx)).length;
      if (!best || hits > best.hits) best = { dx, hits };
    }
  }
  return best?.dx ?? null;
}

/**
 * Sütun taşması (V6, 2026-11-06): tablo kağıdın sağındaki bitişik sütunda devam ediyorsa (başlıklı ya da başlıksız) o satırlar
 * son bloğun devamıdır. Tablonun sağ kenarını aşan veri kutuları ayrı satır akışına alınır; en az bir satır bütün zorunlu
 * kolonlarla okunuyorsa son bloğa `spill` olarak eklenir, okunmuyorsa satırlara dokunulmaz (bugünkü okuma bayt-aynı).
 */
function withSpill(rows: Row[], spec: TableSpec): { rows: Row[]; spill?: { rows: Row[]; dx: number } } {
  const all = partition(rows, spec).blocks;
  const left = (d: BlockDraft) => Math.min(...d.columns.map((c) => c.rect.x));
  const right = (d: BlockDraft) => Math.max(...d.columns.map((c) => c.rect.x + c.rect.width));
  // Taşan sütunda başlık tekrarı ayrı blok gibi görünür: başka bir bloğun tamamen sağındaki başlık taşmadır, kenarı o belirlemez.
  const blocks = all.filter((d) => !all.some((o) => o !== d && left(d) > right(o)));
  const last = blocks[blocks.length - 1];
  if (!last) return { rows };
  const tolerance = (d: BlockDraft) => Math.max(...d.columns.map((c) => c.rect.width)) * 0.75;
  const edge = Math.max(...blocks.map((d) => right(d) + tolerance(d)));
  const minHeader = spec.minHeaderMatches ?? 2;
  // Başlık satırının kolonları kenarın içindedir (kenar onlardan); toplam satırları (sayıları kenarı aşabilir) önceden ayrıldı.
  const spillLines = rows.flatMap((r) => r.lines.filter((l) => l.rect.x > edge));
  if (spillLines.length === 0) return { rows };
  const spillRows = buildRowsTilted(spillLines);
  const dx = spillShift(spillRows, last, spec);
  if (dx === null) return { rows };
  const minCells = Math.max(spec.minCells ?? 2, Math.min(3, spec.columns.length));
  const accepted = spillRows.filter((r) => matchHeader(r, spec).length < minHeader).filter((r) => {
    const cells = assignCells(r, last, spec, dx);
    return rowAccepted(cells, spec) && Object.keys(cells).length >= minCells;
  });
  if (accepted.length === 0) return { rows };
  const kept = rows.map((r) => ({ ...r, lines: r.lines.filter((l) => l.rect.x <= edge) })).filter((r) => r.lines.length > 0);
  return { rows: kept, spill: { rows: accepted, dx } };
}

/** Sayfadaki bir toplam satırı: etiket kutusu + etiketin SAĞINDA, eğim boyunca aynı basılı satırdaki sayı kutuları. */
interface TotalsHit {
  label: OcrLine;
  values: OcrLine[];
}

/** Etiket kısmı: sondaki sayı kelimeleri atılmış satır yazısı ("T.Adet 16 819,20 3.935,00" → "T.Adet"). */
function labelPart(line: OcrLine): string {
  const els = lineElements(line);
  let i = els.length;
  while (i > 0 && isNumericCell(els[i - 1]!.text)) i--;
  return i > 0 && i < els.length ? els.slice(0, i).map((e) => e.text).join(" ") : line.text;
}

const isTotalsLine = (line: OcrLine, labels: string[]): boolean => isTotalsLabel(line.text, labels) || isTotalsLabel(labelPart(line), labels);

/**
 * Toplam satırlarını KONUMDAN bağımsız bulur (214279, 2026-11-10): etiket şablondan (`totals.labels`, tanıtmadaki "Toplam satırı"),
 * değerler etiketin sağında sayfa eğimi boyunca aynı basılı satırda. Satır gruplaması değerleri ayırabilir (etiket kutusunun kendi
 * açısı sapık: "T.Adet 5" ↔ "141,7 586,00" ayrı satır) → eğim sayfa medyanından, bant etiket/değer yüksekliğinin 0,6'sı.
 */
// Eski şablon etiketi adetle kaydetmiş olabilir ("T.Adet 5"): eşleme etiket kısmıyla da.
const totalsLabels = (spec: TableSpec): string[] => [...new Set((spec.totals?.labels ?? []).flatMap((l) => [l, totalsLabelOf(l)]))];

function findTotals(lines: OcrLine[], rows: Row[], spec: TableSpec): TotalsHit[] {
  const labels = totalsLabels(spec);
  if (labels.length === 0) return [];
  const tan = Math.tan((pageMedianAngle(lines) * Math.PI) / 180);
  const labelLines = lines.filter((l) => isTotalsLine(l, labels));
  const isLabel = new Set(labelLines);
  const numeric = (l: OcrLine) => isNumericCell(l.text) || (lineElements(l).length > 1 && lineElements(l).every((e) => isNumericCell(e.text)));
  return labelLines.map((label) => {
    const cy = label.rect.y + label.rect.height / 2;
    const cx = label.rect.x + label.rect.width / 2;
    const right = label.rect.x + label.rect.width - 0.3 * label.rect.height;
    const rowMates = new Set(rows.find((r) => r.lines.includes(label))?.lines ?? []);
    const values = lines.filter((l) => {
      if (isLabel.has(l) || l.rect.x < right || !numeric(l)) return false;
      if (rowMates.has(l)) return true;
      const predicted = cy + tan * (l.rect.x + l.rect.width / 2 - cx);
      return Math.abs(l.rect.y + l.rect.height / 2 - predicted) < 0.6 * Math.max(label.rect.height, l.rect.height);
    });
    return { label, values };
  });
}

/**
 * Toplam satırının adet/kg/m'si: etiketin sağındaki değerler soldan sağa şablon sırasıyla (`totals.valueOrder`; varsayılan adet,
 * sonra tablonun ölçü kolonları kendi sırasıyla — Top/Kilo/Metre'de adet-kg-mt). Değer sayısı sıradan azsa ya da adet yerine
 * tam sayı düşmüyorsa eski kolon hizası okuması (`readDeclared`) kalır ("TOPLAM 241,00").
 */
function readTotals(hit: TotalsHit, draft: BlockDraft, spec: TableSpec): DeclaredTotals {
  const all = [hit.label, ...hit.values];
  const box = unionRect(all.map((l) => l.rect));
  const row: Row = { y: box.y, height: box.height, lines: all, text: all.map((l) => l.text).join("  ") };
  const measureKeys = spec.columns.filter((c) => c.key === "kg" || c.key === "m").map((c) => c.key as "kg" | "m");
  const order = spec.totals?.valueOrder ?? ["count", ...measureKeys];
  const glued = gluedTotalsCount(labelPart(hit.label), totalsLabels(spec));
  const parts = numericParts(all, hit.label).filter((l) => l.rect.x > hit.label.rect.x).sort((a, b) => a.rect.x - b.rect.x);
  const decimal: TableColumnSpec = { key: "n", label: "n", type: "decimal", headers: [] };
  const vals = [...(glued !== null ? [{ raw: glued, value: glued }] : []), ...parts.map((l) => ({ raw: cellText(l.text), value: makeCell(decimal, [l]).value }))];
  const out: DeclaredTotals = { count: null, kg: null, m: null, rect: box };
  // Adet yerine yazılı TAM SAYI düşmeli ("241,00 MT" adet değildir — Kömürhan "TOPLAM 241,00 MT 734,00 KG 0,00 MT")
  const strict = vals.length >= order.length && order.every((k, i) => vals[i]!.value !== null && (k !== "count" || /^\d+$/.test(vals[i]!.raw)));
  if (!strict) return readDeclared(row, draft, spec);
  order.forEach((k, i) => { out[k] = vals[i]!.value; });
  return out;
}

/**
 * Her toplam satırı bir partinin (bloğun) toplamıdır; atama TEK kural: adet = bloğun okunan satır sayısı (tek aday). Eşleşmeyen
 * toplamlar okuma sırasıyla kalan bloklara (çok blokta `TABLE_TOTALS_BY_ORDER` uyarısı), artan toplam `TABLE_TOTALS_ORPHAN`.
 * Σ satır ↔ beyan farkı ayrı denetimdir (computeNoteTotals TOTAL_MISMATCH · bölüm PARTİ TOPLAMI TUTMUYOR).
 */
function attachTotals(hits: TotalsHit[], drafts: BlockDraft[], blocks: TableBlock[], spec: TableSpec): string[] {
  const warnings: string[] = [];
  const sorted = [...hits].sort((a, b) => a.label.rect.y - b.label.rect.y || a.label.rect.x - b.label.rect.x);
  const rest: TotalsHit[] = [];
  for (const hit of sorted) {
    const open = blocks.map((b, i) => ({ b, i, d: readTotals(hit, drafts[i]!, spec) })).filter((x) => x.b.declared === null);
    const byCount = open.filter((x) => x.d.count !== null && Number(x.d.count) === x.b.rows.length);
    if (byCount.length === 1) byCount[0]!.b.declared = byCount[0]!.d;
    else rest.push(hit);
  }
  for (const hit of rest) {
    const i = blocks.findIndex((b) => b.declared === null);
    const choices = blocks.filter((b) => b.declared === null).length;
    const text = [hit.label, ...hit.values].map((l) => l.text).join(" ");
    if (i < 0) { warnings.push(`TABLE_TOTALS_ORPHAN: "${text}" toplam satırı hiçbir bloğa bağlanamadı`); continue; }
    const d = readTotals(hit, drafts[i]!, spec);
    if (d.count === null && d.kg === null && d.m === null) { warnings.push(`TABLE_TOTALS_ORPHAN: "${text}" toplam satırı okunamadı`); continue; }
    blocks[i]!.declared = d;
    // Tek açık blok kaldıysa bağ kesindir (fark varsa TOTAL_MISMATCH/PARTİ TOPLAMI söyler); seçim varken sıra yedeği uyarılır.
    if (choices > 1) warnings.push(`TABLE_TOTALS_BY_ORDER blok ${blocks[i]!.blockNo}: "${text}" toplam satırının adedi hiçbir partinin satır sayısını tutmadı; okuma sırasıyla bağlandı — partiyi kontrol edin`);
  }
  // Toplam satırı bağlandı ama metresi okunamadı: parti metresi sessizce Σ satıra düşmesin (214279 "3.935,00|")
  if (spec.columns.some((c) => c.key === "m")) {
    for (const b of blocks) {
      if (b.declared && b.declared.m === null && b.rows.length > 0) warnings.push(`TOTAL_UNVERIFIED blok ${b.blockNo}: toplam satırının metresi okunamadı — parti metresi satır toplamından, belgeyle karşılaştırın`);
    }
  }
  return warnings;
}

/** Şablondaki tablo tanımını OCR sonucuna uygular. */
export function extractTable(ocr: OcrResult, spec: TableSpec): TableResult {
  const warnings: string[] = [];
  const lines = collectLines(ocr);
  const allRows = buildRowsTilted(lines);
  // Toplam satırları satır akışından ÖNCE ayrılır: değerleri sahte top satırı olmaz, yerleri bloğu belirlemez.
  const hits = findTotals(lines, allRows, spec);
  const taken = new Set(hits.flatMap((h) => [h.label, ...h.values]));
  const split = withSpill(taken.size > 0 ? buildRowsTilted(lines.filter((l) => !taken.has(l))) : allRows, spec);
  const { blocks: drafts } = partition(split.rows, spec);
  if (split.spill && drafts.length > 0) drafts[drafts.length - 1]!.spill = split.spill;
  const blocks = drafts.map((d, i) => buildBlock(d, i + 1, spec, warnings));
  warnings.push(...attachTotals(hits, drafts, blocks, spec));
  if (blocks.length === 0) warnings.push(`TABLE_NOT_FOUND ${spec.key}: başlık satırı bulunamadı`);
  return { key: spec.key, blocks, warnings };
}
