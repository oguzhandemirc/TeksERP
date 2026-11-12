// =============================================================================
// GELEN BELGE — fotoğraftaki barkod (2026-11-09). Tablet sayfanın barkodlarını (expo-camera ML Kit) yüklemeye `barcodes`
// olarak ekler; motor şablonda `fromBarcode` işaretli alana barkod değerini KESİN değer yazar (biçime uyuyorsa), işaretsiz
// alanda barkod OCR değerine eşitse alanı TEYİTLİ sayar. Barkod yokken çıkarım bugünküyle aynıdır.
// =============================================================================
import { z } from "zod";
import type { FieldResult, FieldSpec } from "./motor/types";
import { canonicalizeValue } from "./motor/normalizers";
import { validateValue, isHardIssue } from "./motor/validators";
import { rejectImplausibleValue } from "./motor/value-guard";

export interface OcrBarcode {
  format: string;
  value: string;
}

// Motor tiplerine barkod alanları (types.ts boy tavanında; genişletme bu dosya derlemedeyken geçerli — extract.ts içe aktarır).
declare module "./motor/types" {
  interface OcrResult {
    /** Fotoğraftaki barkodlar (tablet ML Kit, ≤ 10, temiz değer). */
    barcodes?: OcrBarcode[];
  }
  interface FieldSpec {
    /** Fotoğraftaki barkod biçime uyuyorsa KESİN değer (OCR'ı geçer); panel "Barkoddan al". */
    fromBarcode?: boolean;
  }
  interface FieldSource {
    /** Değer fotoğraftaki barkodla aynı (teyitli). */
    barcodeConfirmed?: boolean;
  }
}

export const MAX_PAGE_BARCODES = 10;
const MAX_BARCODE_CHARS = 120;

/** Yükleme gövdesi `barcodes` (katı; ihlal 400 — tablet barkodsuz yeniden gönderir). */
export const PageBarcodesSchema = z.array(z.strictObject({
  format: z.string().trim().min(1).max(24),
  value: z.string().max(MAX_BARCODE_CHARS),
}), "Barkod listesi dizi olmalı").max(MAX_PAGE_BARCODES, `En çok ${MAX_PAGE_BARCODES} barkod`);

/** Barkod metni → aday: denetim karakteri, Code 39 başlangıç/bitiş yıldızı ve boşluk atılır; boş → null. */
export function cleanBarcodeValue(raw: string): string | null {
  const v = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\*/g, "").replace(/\s+/g, "").trim();
  return v ? v.slice(0, MAX_BARCODE_CHARS) : null;
}

/** Saklı/ham listeyi süz: temiz, tekil, ≤ 10 (şema dışı öğe atılır). */
export function normalizeBarcodes(list: readonly { format?: unknown; value?: unknown }[] | null | undefined): OcrBarcode[] {
  const out: OcrBarcode[] = [];
  const seen = new Set<string>();
  for (const b of list ?? []) {
    if (typeof b?.value !== "string") continue;
    const value = cleanBarcodeValue(b.value);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ format: typeof b.format === "string" ? b.format.slice(0, 24) : "unknown", value });
    if (out.length >= MAX_PAGE_BARCODES) break;
  }
  return out;
}

/** Alanın anchor stratejilerindeki tanıtma biçimleri (`valueShape`); geçersiz ifade yok sayılır. */
function shapesOf(field: FieldSpec): RegExp[] {
  const out: RegExp[] = [];
  for (const s of field.strategies) {
    if (s.kind !== "anchor" || !s.valueShape) continue;
    try { out.push(new RegExp(s.valueShape, "u")); } catch { /* bozuk biçim: kısıt sayılmaz */ }
  }
  return out;
}

/** Barkod değeri alanın biçim kuralına uyuyorsa kanonik değeri; uymuyorsa null (tip/pattern/makullük + tanıtma biçimi). */
export function barcodeValueFor(field: FieldSpec, raw: string): string | null {
  const shapes = shapesOf(field);
  if (shapes.length && !shapes.some((re) => re.test(raw))) return null;
  const canon = canonicalizeValue(field.type, raw, field);
  if (canon.value === null || canon.issues.some(isHardIssue)) return null;
  if (validateValue(field, canon.value).some(isHardIssue)) return null;
  const probe: FieldResult = { key: field.key, value: canon.value, raw, confidence: 1, needsReview: false, source: { strategy: "barcode" }, issues: [] };
  return rejectImplausibleValue(probe, field).value;
}

/** OCR'ın düşük güven/konum izleri; barkod teyidi bunları siler (sert sorunlar kalır). */
const SOFT_ISSUES = new Set(["low-confidence", "low-ocr-confidence", "position-fallback", "corrected-by-shape"]);

/**
 * Alanın OCR sonucuna barkodu uygula. `fromBarcode` işaretli: biçime uyan ilk barkod KESİN değer (OCR'ı geçer; birden çok
 * farklı uyan varsa OCR'a eşit olan, yoksa ilki + gözden geçirme). İşaretsiz: OCR değerine eşit barkod → teyitli.
 */
export function applyBarcodes(field: FieldSpec, ocr: FieldResult, barcodes: readonly OcrBarcode[] | undefined): FieldResult {
  if (!barcodes?.length) return ocr;
  const fits: string[] = [];
  for (const b of barcodes) {
    const clean = cleanBarcodeValue(b.value);
    const v = clean === null ? null : barcodeValueFor(field, clean);
    if (v !== null && !fits.includes(v)) fits.push(v);
  }
  if (!fits.length) return ocr;
  const same = ocr.value !== null ? fits.find((v) => v === ocr.value) : undefined;
  if (field.fromBarcode) {
    const value = same ?? fits[0]!;
    const ambiguous = same === undefined && fits.length > 1;
    return {
      key: field.key, value, raw: value, confidence: ambiguous ? 0.8 : 1, needsReview: ambiguous,
      source: { strategy: "barcode", barcodeConfirmed: same !== undefined },
      issues: ambiguous ? ["barcode-ambiguous"] : [],
      ...(ocr.candidates ? { candidates: ocr.candidates } : {}),
    };
  }
  if (same === undefined) return ocr;
  const issues = ocr.issues.filter((i) => !SOFT_ISSUES.has(i));
  return { ...ocr, confidence: 1, needsReview: issues.some(isHardIssue), issues, source: { ...ocr.source, barcodeConfirmed: true } };
}
