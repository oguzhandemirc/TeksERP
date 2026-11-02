// D3a (2026-10-28): tek giriş noktası — bölgeleme → sınıflandırma → başlık alanları → tablo → ızgara → toplam.
// DB/route yok; saf fonksiyon. Çağıran (D3b okuma işi) sonucu CustomerDeliveryNote DRAFT'a yazar.
import type { DocumentTemplate, ExtractionResult, FieldResult, GridResult, HeaderLineSpec, NoteTotalsBlockInput, NoteTotalsResult, OcrBlock, OcrResult, PageRegion, TableResult } from "./types";
import { classifyWithFallback, scoreTemplate } from "./classify";
import { readingOrderText } from "./geometry";
import { normalizeForMatch } from "./text-normalize";
import { extractFields } from "./extract";
import { extractTable } from "./table";
import { deriveGridCells } from "./grid";
import { computeNoteTotals } from "./totals";
import { splitRegions } from "./regions";

export interface RegionExtraction {
  region: PageRegion;
  templateId: string | null;
  classificationScore: number;
  fields: ExtractionResult | null;
  tables: TableResult[];
  grid: GridResult | null;
  totals: NoteTotalsResult | null;
  /** Şablon `blockFields` beyan ettiyse tablo bloğu başına (ilk tablonun blokları) yeniden okunan alanlar; aksi boş. */
  blockFields: Array<{ blockNo: number; fields: Record<string, FieldResult> }>;
  /** Tablosuz şablonun başlıktan tek satır eşlemesi (yoksa null). */
  headerLine: HeaderLineSpec | null;
  warnings: string[];
}

/** İlk bölgenin belgesi dışında sayfada izi görülen tanınmış belge (sayfa BÖLÜNMEZ; yalnız uyarı kaynağı). */
export interface ForeignDocument {
  templateId: string;
  templateName: string;
  /** İkinci bölge olarak ayrıldıysa bölge no; tek bölgeli sayfada yalnız metin izi → null. */
  regionNo: number | null;
  fields: Record<string, FieldResult>;
}

export interface DocumentExtraction {
  regions: RegionExtraction[];
  warnings: string[];
  /** İkinci belge izleri (çağıran uyarıya çevirir); yoksa boş. */
  foreignDocuments: ForeignDocument[];
}

/** Tablo bloklarını computeNoteTotals girdisine çevirir (kolon anahtarı sözleşmesi: "kg" ve "m"). */
export function tableToTotalsInput(table: TableResult, declaredTopCount: string | null = null): NoteTotalsBlockInput[] {
  return table.blocks.map((b) => ({
    blockNo: b.blockNo,
    declared: b.declared,
    lines: b.rows.map((r) => ({ meters: r.cells.m?.value ?? null, weightKg: r.cells.kg?.value ?? null })),
    declaredTopCount: b.blockNo === 1 ? declaredTopCount : null,
  }));
}

/** Satır merkezi [top, bottom) bandına düşen OCR satırlarıyla sınırlı sonuç (koordinatlar kaymaz). */
function sliceBand(ocr: OcrResult, top: number, bottom: number): OcrResult {
  const blocks: OcrBlock[] = [];
  for (const b of ocr.blocks) {
    const lines = b.lines.filter((l) => {
      const cy = l.rect.y + l.rect.height / 2;
      return cy >= top && cy < bottom;
    });
    if (lines.length > 0) blocks.push({ ...b, text: lines.map((l) => l.text).join("\n"), lines });
  }
  return { ...ocr, text: blocks.map((b) => b.text).join("\n"), blocks };
}

/**
 * Çok bloklu çeki listesinde her bloğun kendi başlık bandı (önceki bloğun son satırından bu bloğun tablo başlığına)
 * `blockFields` alanlarıyla yeniden okunur: başlık alanı ilk eşleşmeyi aldığı için 2. bloğun İşlem/Parti'si aksi kaybolur.
 */
function extractBlockFields(ocr: OcrResult, template: DocumentTemplate, table: TableResult | undefined): RegionExtraction["blockFields"] {
  const keys = new Set(template.blockFields ?? []);
  if (keys.size === 0 || !table || table.blocks.length === 0) return [];
  const sub: DocumentTemplate = { ...template, fields: template.fields.filter((f) => keys.has(f.key)) };
  let top = 0;
  return table.blocks.map((b) => {
    const band = sliceBand(ocr, top, b.headerRect.y);
    const ends = [b.headerRect, ...b.rows.map((r) => r.rect), ...(b.declared?.rect ? [b.declared.rect] : [])].map((r) => r.y + r.height);
    top = Math.max(...ends);
    return { blockNo: b.blockNo, fields: extractFields(band, sub).fields };
  });
}

function extractRegion(region: PageRegion, templates: DocumentTemplate[], fallbackId: string | null): RegionExtraction {
  const cls = classifyWithFallback(region.ocr, templates, fallbackId);
  const template = templates.find((t) => t.id === cls.templateId) ?? null;
  const warnings: string[] = [];
  if (!template) {
    return { region, templateId: null, classificationScore: cls.score, fields: null, tables: [], grid: null, totals: null, blockFields: [], headerLine: null, warnings: ["TEMPLATE_NOT_FOUND: şablon eşleşmedi"] };
  }
  if (cls.templateId === fallbackId) warnings.push("TEMPLATE_FALLBACK: gönderen şablonu yok, GENEL sözlük kullanıldı");
  const fields = extractFields(region.ocr, template);
  const tables = (template.tables ?? []).map((spec) => extractTable(region.ocr, spec));
  const grid = template.grid ? deriveGridCells(region.ocr, template.grid) : null;
  let totals: NoteTotalsResult | null = null;
  if (tables.length > 0) {
    const topCount = fields.fields.topAdet?.value ?? null;
    totals = computeNoteTotals(tables.flatMap((t) => tableToTotalsInput(t, topCount)));
    warnings.push(...totals.warnings);
  }
  for (const t of tables) warnings.push(...t.warnings);
  if (grid) warnings.push(...grid.warnings);
  warnings.push(...fields.warnings);
  const blockFields = extractBlockFields(region.ocr, template, tables[0]);
  return { region, templateId: template.id, classificationScore: cls.score, fields, tables, grid, totals, blockFields, headerLine: template.headerLine ?? null, warnings };
}

/** Fotoğrafın tamamını işler: bölgeler ayrı belge sayılır, her biri kendi şablonuyla çıkarılır. */
export function extractDocument(ocr: OcrResult, templates: DocumentTemplate[], fallbackId: string | null = "genel"): DocumentExtraction {
  let regions = splitRegions(ocr);
  // Tek belgenin içindeki geniş boşluk (ürün sevk fişinde giriş ile çıkış bloğu arası) bölge sanılmasın: ikinci+ bölge
  // tanınmış bir şablona oturmuyor ama sayfanın tamamı oturuyorsa sayfa TEK belgedir.
  if (regions.length > 1) {
    const known = (o: OcrResult) => {
      const c = classifyWithFallback(o, templates, fallbackId);
      return c.templateId !== null && c.templateId !== fallbackId;
    };
    if (regions.slice(1).some((r) => !known(r.ocr)) && known(ocr)) {
      regions = [{ regionNo: 1, rect: { x: 0, y: 0, width: ocr.imageWidth, height: ocr.imageHeight }, ocr, lineCount: regions.reduce((n, r) => n + r.lineCount, 0) }];
    }
  }
  const out = regions.map((r) => extractRegion(r, templates, fallbackId));
  const warnings = regions.length > 1 ? [`MULTI_REGION: fotoğrafta ${regions.length} belge bölgesi ayrıldı`] : [];
  return { regions: out, warnings, foreignDocuments: foreignDocuments(ocr, out, templates, fallbackId) };
}

/**
 * İkinci belge izi (iki belgeli fotokopi): ikinci+ bölgenin tanınmış şablonu ya da — sayfa tek bölge kaldıysa — ilk
 * bölgenin şablonu DIŞINDA tam sayfa metninde kendi eşiğini geçen gönderen şablonu. Sayfa bölünmez, satır doğmaz;
 * çağıran "ayrı fotoğrafla yükleyin" uyarısı yazar. GENEL yedek sözlük iz sayılmaz.
 */
export function foreignDocuments(ocr: OcrResult, regions: RegionExtraction[], templates: DocumentTemplate[], fallbackId: string | null): ForeignDocument[] {
  const first = regions[0];
  if (!first) return [];
  const known = (id: string | null): id is string => id !== null && id !== fallbackId;
  const out: ForeignDocument[] = [];
  for (const r of regions.slice(1)) {
    const t = templates.find((x) => x.id === r.templateId);
    if (t && known(r.templateId)) out.push({ templateId: t.id, templateName: t.name, regionNo: r.region.regionNo, fields: r.fields?.fields ?? {} });
  }
  if (regions.length > 1) return out;
  const text = readingOrderText(ocr);
  const norm = normalizeForMatch(text);
  for (const t of templates) {
    if (!known(t.id) || t.id === first.templateId) continue;
    if (scoreTemplate(text, norm, t) < (t.identifiers.minScore ?? 0.5)) continue;
    out.push({ templateId: t.id, templateName: t.name, regionNo: null, fields: extractFields(ocr, t).fields });
  }
  return out;
}
