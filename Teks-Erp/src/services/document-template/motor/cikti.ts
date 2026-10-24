// =============================================================================
// Liquid çıktı kaçışı — `{{ }}`, `{% echo %}` ve `{% cycle %}` aynı kapıdan geçer
// =============================================================================
// Şablon verisi HER ZAMAN HTML-kaçışlı basılır; kaçışı yalnız BİZİM filtrelerimizin
// ürettiği `SafeHtml` atlar (satır kırma, barkod işareti, CSS dizesi). Bağlam düz
// JSON olduğu için veri bu sınıfın örneğini taşıyamaz → şablon kaçışı atlatamaz.

import { Drop } from "liquidjs";
import { stripRawMarkers } from "../../document-render/template-html.sanitize";

/** Şablon yazarına gösterilecek Türkçe hata (filtre argümanı, nesne basma…); motor mesajı olduğu gibi taşır. */
export class TemplateUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateUserError";
  }
}

/**
 * Filtrenin ya da `capture`'ın kaçırdığı/ürettiği güvenli parça; çıktı kaçışı onu olduğu gibi
 * yazar. `Drop` + `valueOf`: karşılaştırma (`==`, `blank`) metin değeri üzerinden çalışır.
 */
export class SafeHtml extends Drop {
  constructor(readonly html: string) {
    super();
  }
  override valueOf(): string {
    return this.html;
  }
  toString(): string {
    return this.html;
  }
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};

/** HTML metin/öznitelik kaçışı. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Şablon değerinin metin hâli: null → "", dizi → öğeler art arda; nesne basılamaz (alt alan seçilmeli). */
export function toText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (v instanceof SafeHtml) return v.html;
  if (Array.isArray(v)) return v.map(toText).join("");
  throw new TemplateUserError("Nesne doğrudan basılamaz; alt alanlarından birini seçin");
}

/** LiquidJS `outputEscape` — veri değerinden sunucu işaret karakterleri de ayıklanır (sahte SVG yeri üretilemesin). */
export function escapeOutput(this: { context?: { memoryLimit: { use(n: number): void } } } | void, v: unknown): string {
  const s = v instanceof SafeHtml ? v.html : escapeHtml(stripRawMarkers(toText(v)));
  // Filtre olarak çağrıldığında çıktı da bellek sayacına yazılır (capture ile katlanan dize).
  if (this && this.context) this.context.memoryLimit.use(s.length);
  return s;
}
