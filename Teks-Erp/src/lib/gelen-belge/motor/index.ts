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
export { extractDocument, tableToTotalsInput } from "./document";
export type { DocumentExtraction, RegionExtraction } from "./document";
export { normalizeForMatch, turkishUpper, turkishLower, similarity, levenshtein, stripDiacritics } from "./text-normalize";
export { canonicalizeValue, parseNumber, parseDate, canonicalizeCode, matchEnum } from "./normalizers";
export type { CanonicalizeSpec } from "./normalizers";
