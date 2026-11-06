// =============================================================================
// GELEN BELGE — okuma önizlemesi için şablon alan raporu (tablet İş Emirleri ekranı, 2026-11-06)
// =============================================================================
// Saf: şablonun alanları × ilk okunmuş bölgenin değerleri → "bulundu / bulunamadı" listesi. Tablet bulunanı yeşil,
// bulunamayanı kırmızı gösterir. Blok/bölüm alanı (her partide yeniden okunur) başlıkta boş olabilir — boşsa rapora
// girmez (yanlış kırmızı göstermemek için); doluysa bulundu sayılır.
// =============================================================================
import type { DocumentTemplate } from "./motor";

export interface TemplateFieldReport {
  key: string;
  label: string;
  /** Okunan değer (kırpılmış); bulunamadıysa null. */
  value: string | null;
  required: boolean;
}

/** Şablon alan sırası korunur; boş/yalnız boşluk değer bulunamadı sayılır. */
export function fieldReport(
  template: Pick<DocumentTemplate, "fields" | "blockFields" | "sections">,
  regionFields: Readonly<Record<string, string | null>> | null | undefined,
): TemplateFieldReport[] {
  const perBlock = new Set([...(template.blockFields ?? []), ...(template.sections?.fields ?? [])]);
  const out: TemplateFieldReport[] = [];
  for (const f of template.fields) {
    const raw = regionFields?.[f.key];
    const value = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
    if (value === null && perBlock.has(f.key)) continue;
    out.push({ key: f.key, label: f.label, value, required: f.required === true });
  }
  return out;
}
