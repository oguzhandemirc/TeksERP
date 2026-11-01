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
  /** Çok bloklu belgede satırın KENDİ bloğunun İşlem metni (başlık yalnız blok 1'i taşır); tek blokta null → başlığa düşer. */
  processText: string | null;
  confidence: number;
  needsReview: boolean;
  sourceRects: Record<string, OcrRect>;
  ocrRaw: Record<string, string | null>;
}

export interface DraftHeader {
  ownerText: string | null;
  /** Şablon gönderen başlığını tanımlıyorsa (`gonderen`/`gonderici`/`gonderenFirma` alanı) okunan ad; yoksa null. */
  senderText: string | null;
  senderDocNo: string | null;
  senderDocDate: Date | null;
  customerBatchNo: string | null;
  processText: string | null;
  declaredTopCount: number | null;
  templateScore: number | null;
  totalsDeclared: { blocks: Array<{ blockNo: number; count: string | null; kg: string | null; m: string | null }> };
  warnings: string[];
  /** Bölge başına özet (şablon kimliği, puan, başlık alanları) — scan.ocrResult zarfına; panel "bölgeyi ayır" buradan okur. */
  regions: Array<{ regionNo: number; templateId: string | null; score: number; fields: Record<string, string | null>; blocks?: Array<{ blockNo: number; fields: Record<string, string | null> }> }>;
}

export interface DraftFromOcr {
  header: DraftHeader;
  lines: DraftLine[];
}

const OWNER_KEYS = ["firma", "musteri", "musteriAdi", "sayin"];
const SENDER_KEYS = ["gonderen", "gonderici", "gonderenFirma"];
const DOC_NO_KEYS = ["fisNo", "irsaliyeNo", "evrakNo", "sevkNo", "belgeNo", "isEmriNo"];
const DATE_KEYS = ["tarih", "sevkTarihi"];
const BATCH_KEYS = ["hamPartiNo", "partiNo", "musteriPartiNo"];
const PROCESS_KEYS = ["islem", "yapilanIslem"];
const TOP_COUNT_KEYS = ["topAdet", "girisAdet", "cikisAdet"];
/** Blok başına okunup bloklar arasında farkı uyarılan iş kimliği alanları (sipariş · parti · boyahane iş emri · işlem). */
const BLOCK_ID_KEYS = ["siparisNo", "hamPartiNo", "isEmriNo", "islem"];
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
  // Yalnız ≥ 2 blokta satıra yazılır: tek blokta başlık işlemi zaten aynıdır (bugünkü davranış, satır null).
  const blockProcess = new Map<number, string>();
  if (reg.blockFields.length >= 2) {
    for (const bf of reg.blockFields) {
      const v = clip(bf.fields.islem?.value, 120);
      if (v) blockProcess.set(bf.blockNo, v);
    }
  }
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
          processText: blockProcess.get(b.blockNo) ?? null,
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
      processText: null,
      confidence: Math.max(0, Math.min(1, cand.confidence ?? 0)),
      needsReview: true,
      sourceRects: rects,
      ocrRaw: raw,
    });
  }
  if (skipped) warnings.push(`GRID_CELLS_UNREAD: ${skipped} hücrede sayı adayı yok (elle girilir)`);
  const suspects = suspectGridSeqs(out.filter((l) => l.blockNo === blockNo));
  if (suspects.length) warnings.push(`GRID_SUSPECT_VALUES: ${suspects.join(", ")} numaralı hücre(ler)in metresi şüpheli (harf karışmış ya da diğerlerinin çok altında) — önce bunları kontrol edin`);
}

/**
 * El yazısında OCR güveni yanlış rakamı doğrudan ayırmıyor (ölçüm 2026-11-02: yanlışlar 0,64–0,91, doğrular 0,59–0,98);
 * iki ucuz işaret ayırıyor: ham metinde harf ("1J6" → 1) ya da medyanın %25'inden küçük değer ("137" → 3). Yalnız UYARI.
 */
export function suspectGridSeqs(lines: Array<{ senderRollNo: string | null; meters: string; ocrRaw: Record<string, string | null> }>): string[] {
  const vals = lines.map((l) => Number(l.meters)).sort((a, b) => a - b);
  const median = vals.length ? vals[Math.floor(vals.length / 2)]! : 0;
  return lines
    .filter((l) => {
      const raw = Object.entries(l.ocrRaw).find(([k]) => METER_KEYS.includes(k))?.[1] ?? "";
      return /\p{L}/u.test(raw) || (vals.length >= 3 && Number(l.meters) < median * 0.25);
    })
    .map((l) => l.senderRollNo ?? "?");
}

/** Bloklar farklı sipariş/parti/iş emri/işlem taşıyorsa TEK uyarı (başlık yalnız blok 1'i taşır). */
function blockDiffWarning(reg: RegionExtraction, blockOffset: number): string | null {
  if (reg.blockFields.length < 2) return null;
  const differing = BLOCK_ID_KEYS.filter((k) => new Set(reg.blockFields.map((b) => b.fields[k]?.value ?? null).filter((v) => v !== null)).size > 1);
  if (differing.length === 0) return null;
  const desc = reg.blockFields
    .map((b) => `blok ${blockOffset + b.blockNo}: ${differing.map((k) => `${k}=${b.fields[k]?.value ?? "?"}`).join(" ")}`)
    .join(" · ");
  return `BLOCK_IDS_DIFFER: belgede ${reg.blockFields.length} blok farklı iş kimliği taşıyor (${desc}) — başlık yalnız ilk bloğu gösterir; satır işlemi kendi bloğundan`;
}

/**
 * Tablosuz belge (ürün sevk fişi: tek top başlıkta): şablonun `headerLine` eşlemesiyle TEK satır; metre pozitif olmalı,
 * satır her zaman needsReview. Adet > 1 → satır yok + uyarı (top dökümü yok); adet okunamadı → tek top + uyarı.
 */
function headerOnlyLine(reg: RegionExtraction, out: DraftLine[], warnings: string[]): void {
  const spec = reg.headerLine;
  const f = reg.fields?.fields;
  if (!spec || !f) return;
  const count = f[spec.count]?.value ?? null;
  const first = (keys: string[] | undefined) => (keys ?? []).map((k) => f[k]).find((x) => x?.value && positive(x.value));
  const m = first(spec.m);
  if (count !== null && count !== "1") {
    warnings.push(`HEADER_LINE_SKIPPED: belgede ${count} top yazıyor, top dökümü yok — satırları elle girin`);
    return;
  }
  if (count === null && m) warnings.push("HEADER_LINE_COUNT_UNREAD: top adedi okunamadı — tek top varsayıldı, belgeyle karşılaştırın");
  if (!m) {
    warnings.push("HEADER_LINE_SKIPPED: toplam metre okunamadı — satırı elle girin");
    return;
  }
  const kg = first(spec.kg);
  const en = first(spec.en);
  const used = [m, kg, en].filter((x): x is FieldResult => !!x);
  const rects: Record<string, OcrRect> = {};
  const raw: Record<string, string | null> = {};
  for (const x of used) {
    if (x.source.rect) rects[x.key] = x.source.rect;
    raw[x.key] = x.raw;
  }
  out.push({
    blockNo: 1, lineKind: "TOP", senderRollNo: null, meters: m.value!, weightKg: kg?.value ?? null, widthCm: en?.value ?? null,
    itemText: null, colorText: null, processText: null, confidence: Math.min(...used.map((x) => x.confidence)), needsReview: true,
    sourceRects: rects, ocrRaw: raw,
  });
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
    const blockOffset0 = blockOffset;
    const regionWarnings: string[] = [];
    const maxBlock = tableLines(reg, blockOffset, lines, regionWarnings);
    const diff = blockDiffWarning(reg, blockOffset);
    if (diff) regionWarnings.push(diff);
    // Başlıktan satır yalnız İLK bölgede: ikinci bölge başka belgedir (başka sahip) — aynı taslağa top eklenmez.
    if (reg === first && maxBlock === 0 && !reg.grid) headerOnlyLine(reg, lines, regionWarnings);
    if (reg.totals) {
      for (const b of reg.totals.blocks) totalsBlocks.push({ blockNo: blockOffset + b.blockNo, count: b.declared?.count ?? null, kg: b.declared?.kg ?? null, m: b.declared?.m ?? null });
    }
    const gridBlock = blockOffset + Math.max(1, maxBlock + (maxBlock > 0 ? 1 : 0));
    gridLines(reg, gridBlock, lines, regionWarnings);
    blockOffset = Math.max(blockOffset + maxBlock, lines.length ? Math.max(...lines.map((l) => l.blockNo)) : blockOffset);
    for (const w of [...reg.warnings, ...regionWarnings]) warnings.push(prefix + w);
    const fields: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(reg.fields?.fields ?? {})) fields[k] = v.value;
    const blocks = reg.blockFields.map((b) => ({ blockNo: blockOffset0 + b.blockNo, fields: Object.fromEntries(Object.entries(b.fields).map(([k, v]) => [k, v.value])) }));
    regions.push({ regionNo: reg.region.regionNo, templateId: reg.templateId, score: reg.classificationScore, fields, ...(blocks.length ? { blocks } : {}) });
  }
  const topCount = pick(f, TOP_COUNT_KEYS);
  return {
    header: {
      ownerText: clip(pick(f, OWNER_KEYS), 160),
      senderText: clip(pick(f, SENDER_KEYS), 160),
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


/**
 * Okuma servisi yan dönük sayfayı dikleştirip okuduysa (`rotation`), satır kutuları saklanan FOTOĞRAFIN çerçevesine
 * geri çevrilir: panel kutuyu dönmemiş fotoğrafın üstüne çizer. Şablon ayrıştırma DİK çerçevede kalır (bu adımdan önce).
 */
export function rectToPhotoFrame(r: OcrRect, rotation: number | undefined, uprightW: number, uprightH: number): OcrRect {
  switch (rotation) {
    case 90:
      return { x: r.y, y: uprightW - (r.x + r.width), width: r.height, height: r.width };
    case 270:
      return { x: uprightH - (r.y + r.height), y: r.x, width: r.height, height: r.width };
    case 180:
      return { x: uprightW - (r.x + r.width), y: uprightH - (r.y + r.height), width: r.width, height: r.height };
    default:
      return r;
  }
}

export function linesToPhotoFrame(lines: DraftLine[], ocr: { rotation?: number; imageWidth: number; imageHeight: number }): DraftLine[] {
  if (!ocr.rotation) return lines;
  return lines.map((l) => ({
    ...l,
    sourceRects: Object.fromEntries(Object.entries(l.sourceRects).map(([k, r]) => [k, rectToPhotoFrame(r, ocr.rotation, ocr.imageWidth, ocr.imageHeight)])),
  }));
}

/** Üst üste binen çekim denetimine giren mevcut satır (DB'den; sayılar ondalık metin). */
export interface ExistingLineForOverlap {
  senderRollNo: string | null;
  meters: string;
  weightKg: string | null;
  ocrRaw: unknown;
}

/** Top No anahtarı: yalnız Top No kolonundan okunmuş satırda (sıra no / ızgara sırası sayfa başına yeniden başlar). */
function overlapKey(l: { senderRollNo: string | null; ocrRaw: unknown }): string | null {
  const raw = l.ocrRaw as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || !raw.topNo) return null;
  const k = (l.senderRollNo ?? "").replace(/\s+/g, "").toUpperCase();
  return k || null;
}
const sameNum = (a: string | null, b: string | null): boolean => (a === null || b === null ? a === b : Number(a) === Number(b));

/**
 * Çok sayfalı taslakta üst üste binen çekim: yeni sayfanın satırı BAŞKA taramadan gelmiş satırla Top No + kg + metrede
 * birebir eşitse yazılmaz (her mevcut satır tek yeni satırı yutar); Top No aynı, sayılar farklıysa yazılır ama needsReview.
 * Aynı taramanın satırları birbiriyle karşılaştırılmaz (eşit metrajlı meşru toplar).
 */
export function dropOverlapDuplicates(lines: DraftLine[], existing: ExistingLineForOverlap[], pageNo: number): { lines: DraftLine[]; warnings: string[] } {
  const byKey = new Map<string, ExistingLineForOverlap[]>();
  for (const e of existing) {
    const k = overlapKey(e);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }
  const out: DraftLine[] = [];
  let skipped = 0;
  let conflicts = 0;
  for (const l of lines) {
    const k = overlapKey(l);
    const cands = k ? byKey.get(k) : undefined;
    if (!k || !cands) {
      out.push(l);
      continue;
    }
    const i = cands.findIndex((e) => sameNum(e.meters, l.meters) && sameNum(e.weightKg, l.weightKg));
    if (i >= 0) {
      cands.splice(i, 1);
      skipped++;
      continue;
    }
    conflicts++;
    out.push({ ...l, needsReview: true });
  }
  const warnings: string[] = [];
  if (skipped) warnings.push(`OVERLAP_DUPLICATE_SKIPPED: Sayfa ${pageNo}: ${skipped} satır başka sayfada zaten vardı (üst üste binen çekim) — atlandı`);
  if (conflicts) warnings.push(`OVERLAP_ROLL_NO_CONFLICT: Sayfa ${pageNo}: ${conflicts} satırın Top No'su başka sayfada farklı kg/metreyle var — gözden geçirin`);
  return { lines: out, warnings };
}
