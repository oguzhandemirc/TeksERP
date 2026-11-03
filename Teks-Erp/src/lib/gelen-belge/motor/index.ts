// Kaynak: ocr-test prototipi src/ocr-engine/index.ts (kullanıcının kendi kodu), vendor 2026-10-28 (D3a).
/**
 * Gelen belge çıkarım motoru — kamuya açık API. Sözleşme: ./types.ts
 * Saf TS; DB/route/React Native bağımlılığı YOK. Şablonlar VERİDİR (templates/*.json; D8 yönetir).
 */
export * from "./types";
export { loadTemplates, validateTemplate } from "./templates";
export { classifyDocument, classifyWithFallback } from "./classify";
export { extractFields } from "./extract";
export { mergeExtractions } from "./merge";
export { buildRows, rowsToText, readingOrderText } from "./geometry";
export { buildRowsTilted, pageMedianAngle } from "./rows-tilted";
export { extractTable } from "./table";
export { splitRegions } from "./regions";
export { deriveGridCells } from "./grid";
export { computeNoteTotals, sumCanonical, canonicalEquals } from "./totals";
export { extractDocument, foreignDocuments, tableToTotalsInput } from "./document";
export { extractSections, findPageMarker, rowKey, DEFAULT_PAGE_PATTERN } from "./sections";
export type { SectionResult, SectionsResult } from "./sections";
export type { DocumentExtraction, ForeignDocument, RegionExtraction } from "./document";
export { normalizeForMatch, turkishUpper, turkishLower, similarity, levenshtein, stripDiacritics } from "./text-normalize";
export { canonicalizeValue, parseNumber, parseDate, canonicalizeCode, matchEnum } from "./normalizers";
export type { CanonicalizeSpec } from "./normalizers";
export { suggestTemplate, findLabelFor, mergeTemplateForUpdate, ASSIGNABLE_FIELDS, ASSIGNABLE_FIELD_KEYS, TABLE_COLUMN_KEYS, UPDATE_KEEP_PARTS } from "./suggest";
export type { AssignableField, TableColumnKey, TemplateSuggestInput, TemplateSuggestion, UpdateKeepPart } from "./suggest";
