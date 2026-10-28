// D3a (2026-10-28): tek giriş noktası — bölgeleme → sınıflandırma → başlık alanları → tablo → ızgara → toplam.
// DB/route yok; saf fonksiyon. Çağıran (D3b okuma işi) sonucu CustomerDeliveryNote DRAFT'a yazar.
import type { DocumentTemplate, ExtractionResult, GridResult, NoteTotalsBlockInput, NoteTotalsResult, OcrResult, PageRegion, TableResult } from "./types";
import { classifyWithFallback } from "./classify";
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
  warnings: string[];
}

export interface DocumentExtraction {
  regions: RegionExtraction[];
  warnings: string[];
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

function extractRegion(region: PageRegion, templates: DocumentTemplate[], fallbackId: string | null): RegionExtraction {
  const cls = classifyWithFallback(region.ocr, templates, fallbackId);
  const template = templates.find((t) => t.id === cls.templateId) ?? null;
  const warnings: string[] = [];
  if (!template) {
    return { region, templateId: null, classificationScore: cls.score, fields: null, tables: [], grid: null, totals: null, warnings: ["TEMPLATE_NOT_FOUND: şablon eşleşmedi"] };
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
  return { region, templateId: template.id, classificationScore: cls.score, fields, tables, grid, totals, warnings };
}

/** Fotoğrafın tamamını işler: bölgeler ayrı belge sayılır, her biri kendi şablonuyla çıkarılır. */
export function extractDocument(ocr: OcrResult, templates: DocumentTemplate[], fallbackId: string | null = "genel"): DocumentExtraction {
  const regions = splitRegions(ocr);
  const out = regions.map((r) => extractRegion(r, templates, fallbackId));
  const warnings = regions.length > 1 ? [`MULTI_REGION: fotoğrafta ${regions.length} belge bölgesi ayrıldı`] : [];
  return { regions: out, warnings };
}
