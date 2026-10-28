// Çıkarım → taslak eşlemesi (D3b, saf; DB yok): motor çıktısı (`DocumentExtraction`) → DRAFT başlık + satır girdisi.
// Bölge ≥ 2 satırları blok numarasını SÜRDÜRÜR (tek taslak; panel "bölgeyi ayır"). Metrajı okunamayan satır
// yazılmaz (`meters > 0` CHECK), uyarıya düşer; el yazısı ızgarasında her satır needsReview.
import { parseNumber, type DocumentExtraction, type FieldResult, type OcrRect, type RegionExtraction } from "./motor";


export interface DraftLine {
  blockNo: number;
  lineKind: "TOP" | "ARABA";
  senderRollNo: string | null;
  meters: string;
  weightKg: string | null;
  widthCm: string | null;
  itemText: string | null;
  colorText: string | null;
  confidence: number;
  needsReview: boolean;
  sourceRects: Record<string, OcrRect>;
  ocrRaw: Record<string, string | null>;
}

export interface DraftHeader {
  ownerText: string | null;
  senderDocNo: string | null;
  senderDocDate: Date | null;
  customerBatchNo: string | null;
  processText: string | null;
  declaredTopCount: number | null;
  templateScore: number | null;
  totalsDeclared: { blocks: Array<{ blockNo: number; count: string | null; kg: string | null; m: string | null }> };
  warnings: string[];
  /** Bölge başına özet (şablon kimliği, puan, başlık alanları) — scan.ocrResult zarfına; panel "bölgeyi ayır" buradan okur. */
  regions: Array<{ regionNo: number; templateId: string | null; score: number; fields: Record<string, string | null> }>;
}

export interface DraftFromOcr {
  header: DraftHeader;
  lines: DraftLine[];
}

const OWNER_KEYS = ["firma", "musteri", "musteriAdi", "sayin"];
const DOC_NO_KEYS = ["fisNo", "irsaliyeNo", "evrakNo", "sevkNo", "belgeNo", "isEmriNo"];
const DATE_KEYS = ["tarih", "sevkTarihi"];
const BATCH_KEYS = ["hamPartiNo", "partiNo", "musteriPartiNo"];
const PROCESS_KEYS = ["islem", "yapilanIslem"];
const TOP_COUNT_KEYS = ["topAdet", "cikisAdet"];
const METER_KEYS = ["m", "metre"];
const WIDTH_KEYS = ["en", "cm"];

export const clip = (v: string | null | undefined, max: number): string | null => {
  const t = v?.trim();
  return t ? t.slice(0, max) : null;
};
const pick = (fields: Record<string, FieldResult> | undefined, keys: string[]): string | null => {
  for (const k of keys) {
    const v = fields?.[k]?.value;
    if (v) return v;
  }
  return null;
};
const dayOf = (v: string | null): Date | null => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const positive = (v: string | null | undefined): string | null => (v && Number(v) > 0 && Number.isFinite(Number(v)) ? v : null);

function tableLines(reg: RegionExtraction, blockOffset: number, out: DraftLine[], warnings: string[]): number {
  let maxBlock = 0;
  for (const t of reg.tables) {
    for (const b of t.blocks) {
      const blockNo = blockOffset + b.blockNo;
      maxBlock = Math.max(maxBlock, b.blockNo);
      for (const r of b.rows) {
        const cells = r.cells;
        const meters = positive(METER_KEYS.map((k) => cells[k]?.value).find((v) => v) ?? null);
        if (!meters) {
          warnings.push(`LINE_SKIPPED_NO_METERS: blok ${blockNo} satır ${r.index} metraj okunamadı`);
          continue;
        }
        const widthCell = WIDTH_KEYS.map((k) => cells[k]).find((c) => c);
        const confs = Object.values(cells).map((c) => c.confidence).filter((c) => Number.isFinite(c));
        const rects: Record<string, OcrRect> = { row: r.rect };
        const raw: Record<string, string | null> = {};
        for (const [k, c] of Object.entries(cells)) {
          rects[k] = c.rect;
          raw[k] = c.raw;
        }
        out.push({
          blockNo,
          lineKind: "TOP",
          senderRollNo: clip(cells.topNo?.raw ?? cells.siraNo?.raw, 64),
          meters,
          weightKg: positive(cells.kg?.value),
          widthCm: positive(widthCell?.value),
          itemText: null,
          colorText: null,
          confidence: confs.length ? Math.min(...confs) : 0,
          needsReview: r.needsReview,
          sourceRects: rects,
          ocrRaw: raw,
        });
      }
    }
  }
  return maxBlock;
}

/** El yazısı ızgarası: basılı sıra numarası başına bir satır; yalnız sayı adayı olan hücre satır olur (hepsi needsReview). */
function gridLines(reg: RegionExtraction, blockNo: number, out: DraftLine[], warnings: string[]): void {
  const g = reg.grid;
  if (!g) return;
  const bySeq = new Map<number, typeof g.cells>();
  for (const c of g.cells) bySeq.set(c.seqNo, [...(bySeq.get(c.seqNo) ?? []), c]);
  let skipped = 0;
  for (const [seqNo, cells] of [...bySeq.entries()].sort((a, b) => a[0] - b[0])) {
    const meterCell = cells.find((c) => METER_KEYS.includes(c.key));
    const cand = meterCell?.candidates.map((x) => ({ ...x, parsed: parseNumber(x.text).value })).find((x) => positive(x.parsed));
    if (!meterCell || !cand) {
      if (cells.some((c) => c.candidates.length > 0)) skipped++;
      continue;
    }
    const widthCell = cells.find((c) => WIDTH_KEYS.includes(c.key));
    const widthCand = widthCell?.candidates.map((x) => parseNumber(x.text).value).find((v) => positive(v)) ?? null;
    const rects: Record<string, OcrRect> = {};
    const raw: Record<string, string | null> = {};
    for (const c of cells) {
      rects[c.key] = c.rect;
      raw[c.key] = c.candidates.map((x) => x.text).join(" | ") || null;
    }
    out.push({
      blockNo,
      lineKind: "TOP",
      senderRollNo: String(seqNo),
      meters: cand.parsed!,
      weightKg: null,
      widthCm: positive(widthCand),
      itemText: null,
      colorText: null,
      confidence: Math.max(0, Math.min(1, cand.confidence ?? 0)),
      needsReview: true,
      sourceRects: rects,
      ocrRaw: raw,
    });
  }
  if (skipped) warnings.push(`GRID_CELLS_UNREAD: ${skipped} hücrede sayı adayı yok (elle girilir)`);
}

/** Motor çıktısını taslak başlık + satırlara çevirir; bölge ≥ 2 satırları blok numarasını SÜRDÜRÜR (tek taslak, panel ayırır). */
export function draftFromExtraction(doc: DocumentExtraction): DraftFromOcr {
  const first = doc.regions[0];
  const f = first?.fields?.fields;
  const warnings = [...doc.warnings];
  const lines: DraftLine[] = [];
  const totalsBlocks: DraftHeader["totalsDeclared"]["blocks"] = [];
  let blockOffset = 0;
  const regions: DraftHeader["regions"] = [];
  for (const reg of doc.regions) {
    const prefix = doc.regions.length > 1 ? `R${reg.region.regionNo}: ` : "";
    const regionWarnings: string[] = [];
    const maxBlock = tableLines(reg, blockOffset, lines, regionWarnings);
    if (reg.totals) {
      for (const b of reg.totals.blocks) totalsBlocks.push({ blockNo: blockOffset + b.blockNo, count: b.declared?.count ?? null, kg: b.declared?.kg ?? null, m: b.declared?.m ?? null });
    }
    const gridBlock = blockOffset + Math.max(1, maxBlock + (maxBlock > 0 ? 1 : 0));
    gridLines(reg, gridBlock, lines, regionWarnings);
    blockOffset = Math.max(blockOffset + maxBlock, lines.length ? Math.max(...lines.map((l) => l.blockNo)) : blockOffset);
    for (const w of [...reg.warnings, ...regionWarnings]) warnings.push(prefix + w);
    const fields: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(reg.fields?.fields ?? {})) fields[k] = v.value;
    regions.push({ regionNo: reg.region.regionNo, templateId: reg.templateId, score: reg.classificationScore, fields });
  }
  const topCount = pick(f, TOP_COUNT_KEYS);
  return {
    header: {
      ownerText: clip(pick(f, OWNER_KEYS), 160),
      senderDocNo: clip(pick(f, DOC_NO_KEYS), 64),
      senderDocDate: dayOf(pick(f, DATE_KEYS)),
      customerBatchNo: clip(pick(f, BATCH_KEYS), 64),
      processText: clip(pick(f, PROCESS_KEYS), 120),
      declaredTopCount: topCount && /^\d{1,4}$/.test(topCount) ? Number(topCount) : null,
      templateScore: first ? Math.round(first.classificationScore * 10000) / 10000 : null,
      totalsDeclared: { blocks: totalsBlocks },
      warnings,
      regions,
    },
    lines,
  };
}

