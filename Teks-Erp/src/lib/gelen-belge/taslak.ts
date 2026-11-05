// Çıkarım → taslak eşlemesi (D3b, saf; DB yok): motor çıktısı (`DocumentExtraction`) → DRAFT başlık + satır girdisi.
// Bölge ≥ 2 satırları blok numarasını SÜRDÜRÜR (tek taslak; panel "bölgeyi ayır"). Metrajı okunamayan satır
// yazılmaz (`meters > 0` CHECK), uyarıya düşer; el yazısı ızgarasında her satır needsReview.
import { parseNumber, type DocumentExtraction, type DocumentTemplate, type FieldResult, type ForeignDocument, type OcrRect, type RegionExtraction } from "./motor";
import { documentDeclared, positive, type DocumentDeclared } from "./taslak-belge-beyan";
import { clampOutlierFactor, markGridSuspects, METER_KEYS } from "./taslak-supheli";
import { blockDiffWarning, FIELD_LABEL, firstBlockValue } from "./blok-alani";
import { batchNoCandidates, type BatchNoCandidate } from "./parti-no";
import { resolveKursunMeters, type KursunMeterResult } from "./kursun-metre";
import { templateByCode } from "./sablon-bul";
import { pageInfo, sectionDeclaredBlocks, sectionOfRow, type SectionIdentity } from "./taslak-bolum";

// Şüpheli değer kuralı ayrı dosyada (max-lines); çağıranlar buradan alır.
export { clampOutlierFactor, DEFAULT_OUTLIER_FACTOR, OUTLIER_FACTOR_MAX, OUTLIER_FACTOR_MIN, SUSPECT_MARK, suspectGridReasons, suspectGridSeqs, type SuspectReason } from "./taslak-supheli";

export interface DraftOptions {
  /** Şüpheli değer oranı; verilmezse `DEFAULT_OUTLIER_FACTOR`. */
  outlierFactor?: number;
  /** Tablosuz belgede satır metresi/kg kaynağı (fabrika ayarı); verilmezse OUTPUT = bugünkü (şablonun `m`/`kg` sırası). */
  headerLineSource?: "OUTPUT" | "INPUT";
  /** Sınıflandırmada kullanılan şablon kümesi (dosya + kullanıcı); aday/metre kaynağı buradan, yoksa dosya şablonları. */
  templates?: readonly DocumentTemplate[];
}

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
  /** Müşterinin basılı "Sipariş No"su — çok bloklu belgede İLK bloğun değeri (fark `BLOCK_IDS_DIFFER` uyarısıyla). */
  customerOrderNo: string | null;
  processText: string | null;
  declaredTopCount: number | null;
  templateScore: number | null;
  /** `document`: başlıktaki belge geneli beyan (şablon `headerTotals`; yalnız ilk bölge, sıfır/okunamayan değer yok sayılır). */
  totalsDeclared: { blocks: Array<{ blockNo: number; count: string | null; kg: string | null; m: string | null } & Partial<SectionIdentity>>; document?: DocumentDeclared };
  /** Sayfa damgası ("1/2"; bölümlü şablonda okunur) — `of` taslağın `totalsDeclared.pages`ına gider (uyarı; `pageCount` elle beyandır). */
  page: { no: number; of: number } | null;
  /** Sayfa bölüm başlığı olmadan başladı: blok 1 satırları önceki sayfanın SON bölümüne eklenir. */
  continuesPrevious: boolean;
  warnings: string[];
  /** Bölge başına özet (şablon kimliği, puan, başlık alanları) — scan.ocrResult zarfına; panel "bölgeyi ayır" buradan okur. */
  regions: Array<{ regionNo: number; templateId: string | null; score: number; fields: Record<string, string | null>; blocks?: Array<{ blockNo: number; fields: Record<string, string | null> }> }>;
  /** İlk bölgenin parti no adayları (şablon sırası); seçim taslak doldurmada (hatırlanan anahtar DB'de). */
  batchNoCandidates: BatchNoCandidate[];
  /** İlk bölgenin kurşun metresi (ÇIKIŞ → TOPLAM → Σ satır). */
  kursun: KursunMeterResult;
}

export interface DraftFromOcr {
  header: DraftHeader;
  lines: DraftLine[];
}

const OWNER_KEYS = ["firma", "musteri", "musteriAdi", "sayin"];
const SENDER_KEYS = ["gonderen", "gonderici", "gonderenFirma"];
const DOC_NO_KEYS = ["fisNo", "irsaliyeNo", "evrakNo", "sevkNo", "belgeNo", "isEmriNo"];
const DATE_KEYS = ["tarih", "sevkTarihi"];
/** Müşteri parti no alanları (sunucu tamamlamasının parti karşılaştırması da bunu okur). */
export const BATCH_KEYS: readonly string[] = ["hamPartiNo", "partiNo", "musteriPartiNo"];
const PROCESS_KEYS = ["islem", "yapilanIslem"];
const TOP_COUNT_KEYS = ["topAdet", "girisAdet", "cikisAdet"];
const WIDTH_KEYS = ["en", "cm"];

export const clip = (v: string | null | undefined, max: number): string | null => {
  const t = v?.trim();
  return t ? t.slice(0, max) : null;
};
const pick = (fields: Record<string, FieldResult> | undefined, keys: readonly string[]): string | null => {
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

function tableLines(reg: RegionExtraction, blockOffset: number, out: DraftLine[], warnings: string[]): number {
  let maxBlock = 0;
  // Yalnız ≥ 2 blokta satıra yazılır: tek blokta başlık işlemi zaten aynıdır (bugünkü davranış, satır null).
  const blockProcess = new Map<number, string>();
  const sectionOf = sectionOfRow(reg);
  if (reg.blockFields.length >= 2) {
    for (const bf of reg.blockFields) {
      const v = clip(bf.fields.islem?.value, 120);
      if (v) blockProcess.set(bf.blockNo, v);
    }
  }
  for (const t of reg.tables) {
    for (const b of t.blocks) {
      for (const r of b.rows) {
        // Bölümlü şablonda satırın blok no'su BÖLÜMÜNDEN (parti); bölümsüzde tablo bloğu (bugünkü).
        const local = sectionOf ? sectionOf(b.blockNo, r.index) : b.blockNo;
        const blockNo = blockOffset + local;
        maxBlock = Math.max(maxBlock, local);
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
          processText: blockProcess.get(local) ?? null,
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
function gridLines(reg: RegionExtraction, blockNo: number, out: DraftLine[], ctx: { warnings: string[]; factor: number }): void {
  const { warnings } = ctx;
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
  const suspect = markGridSuspects(out.filter((l) => l.blockNo === blockNo), ctx.factor);
  if (suspect) warnings.push(suspect);
}

/** "Ürün sevk fişi (giriş/çıkış toplamlı)" → "Ürün sevk fişi"; belge no varsa etiketiyle. */
export function foreignDocumentWarning(f: ForeignDocument): string {
  const name = f.templateName.replace(/\s*\(.*\)\s*$/, "").trim() || f.templateId;
  const key = DOC_NO_KEYS.find((k) => f.fields[k]?.value);
  const no = key ? ` (${FIELD_LABEL[key] ?? key} ${f.fields[key]!.value})` : "";
  return `SECOND_DOCUMENT_TRACE: bu sayfada ikinci bir belge izi var: ${name}${no} — bu taslağa ayrı belge olarak alınmadı; ayrı fotoğrafla yükleyin`;
}

/**
 * Tablosuz belge (ürün sevk fişi: tek top başlıkta): şablonun `headerLine` eşlemesiyle TEK satır; metre pozitif olmalı,
 * satır her zaman needsReview. Adet > 1 → satır yok + uyarı (top dökümü yok); adet okunamadı → tek top + uyarı.
 */
function headerOnlyLine(reg: RegionExtraction, out: DraftLine[], warnings: string[], source: DraftOptions["headerLineSource"]): void {
  const spec = reg.headerLine;
  const f = reg.fields?.fields;
  if (!spec || !f) return;
  const count = f[spec.count]?.value ?? null;
  const first = (keys: string[] | undefined) => (keys ?? []).map((k) => f[k]).find((x) => x?.value && positive(x.value));
  // INPUT: şablonun giriş-önce sırası (tanımlıysa); aksi bugünkü çıkış-önce sıra.
  const input = source === "INPUT";
  const m = first(input && spec.inputM ? spec.inputM : spec.m);
  if (count !== null && count !== "1") {
    warnings.push(`HEADER_LINE_SKIPPED: belgede ${count} top yazıyor, top dökümü yok — satırları elle girin`);
    return;
  }
  if (count === null && m) warnings.push("HEADER_LINE_COUNT_UNREAD: top adedi okunamadı — tek top varsayıldı, belgeyle karşılaştırın");
  if (!m) {
    warnings.push("HEADER_LINE_SKIPPED: toplam metre okunamadı — satırı elle girin");
    return;
  }
  const kg = first(input && spec.inputKg ? spec.inputKg : spec.kg);
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
export function draftFromExtraction(doc: DocumentExtraction, opts: DraftOptions = {}): DraftFromOcr {
  const factor = clampOutlierFactor(opts.outlierFactor);
  const first = doc.regions[0];
  const f = first?.fields?.fields;
  const warnings = [...doc.warnings, ...(doc.foreignDocuments ?? []).map(foreignDocumentWarning)];
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
    if (reg === first && maxBlock === 0 && !reg.grid) headerOnlyLine(reg, lines, regionWarnings, opts.headerLineSource);
    const secBlocks = sectionDeclaredBlocks(reg, blockOffset);
    if (secBlocks) totalsBlocks.push(...secBlocks);
    else if (reg.totals) {
      for (const b of reg.totals.blocks) totalsBlocks.push({ blockNo: blockOffset + b.blockNo, count: b.declared?.count ?? null, kg: b.declared?.kg ?? null, m: b.declared?.m ?? null });
    }
    const gridBlock = blockOffset + Math.max(1, maxBlock + (maxBlock > 0 ? 1 : 0));
    const before = lines.length;
    gridLines(reg, gridBlock, lines, { warnings: regionWarnings, factor });
    // El yazısı ızgaralı sayfada hiç satır çıkmadıysa sessiz kalma (0243: tek el yazısı hücre görülmedi).
    if (reg.grid && lines.length === before && maxBlock === 0) regionWarnings.push("GRID_EMPTY: el yazısı hücrelerden satır çıkmadı — satırları belgeye bakarak elle girin");
    blockOffset = Math.max(blockOffset + maxBlock, lines.length ? Math.max(...lines.map((l) => l.blockNo)) : blockOffset);
    for (const w of [...reg.warnings, ...regionWarnings]) warnings.push(prefix + w);
    const fields: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(reg.fields?.fields ?? {})) fields[k] = v.value;
    const blocks = reg.blockFields.map((b) => ({ blockNo: blockOffset0 + b.blockNo, fields: Object.fromEntries(Object.entries(b.fields).map(([k, v]) => [k, v.value])) }));
    regions.push({ regionNo: reg.region.regionNo, templateId: reg.templateId, score: reg.classificationScore, fields, ...(blocks.length ? { blocks } : {}) });
  }
  // Bölümlü şablonda yazan top adedi bölüm başınadır (blocks[].topCount); başlığa tek sayı konmaz.
  const topCount = first?.sections ? null : pick(f, TOP_COUNT_KEYS);
  const pg = pageInfo(first);
  const docDecl = documentDeclared(first);
  const tpl = opts.templates?.find((t) => t.id === first?.templateId) ?? templateByCode(first?.templateId);
  return {
    header: {
      ownerText: clip(pick(f, OWNER_KEYS), 160),
      senderText: clip(pick(f, SENDER_KEYS), 160),
      senderDocNo: clip(pick(f, DOC_NO_KEYS), 64),
      senderDocDate: dayOf(pick(f, DATE_KEYS)),
      customerBatchNo: clip(pick(f, BATCH_KEYS), 64),
      customerOrderNo: clip(firstBlockValue(first, "siparisNo"), 64),
      processText: clip(pick(f, PROCESS_KEYS), 120),
      declaredTopCount: topCount && /^\d{1,4}$/.test(topCount) ? Number(topCount) : null,
      templateScore: first ? Math.round(first.classificationScore * 10000) / 10000 : null,
      totalsDeclared: { blocks: totalsBlocks, ...(docDecl ? { document: docDecl } : {}) },
      warnings,
      page: pg.page,
      continuesPrevious: pg.continuesPrevious,
      regions,
      batchNoCandidates: batchNoCandidates(tpl, regions[0]?.fields ?? {}),
      kursun: resolveKursunMeters({ template: tpl, fields: regions[0]?.fields ?? {}, totalsDeclared: { blocks: totalsBlocks }, lineMeters: lines.map((l) => l.meters) }),
    },
    lines,
  };
}


// Yan dönük sayfa kutularının fotoğraf çerçevesine dönüşü ayrı dosyada (max-lines); çağıranlar buradan alır.
export { linesToPhotoFrame, rectToPhotoFrame } from "./taslak-foto-cerceve";

// Üst üste binen çekim süzgeci ayrı dosyada (max-lines); çağıranlar buradan alır.
export { dropOverlapDuplicates, type ExistingLineForOverlap } from "./taslak-ortusme";
