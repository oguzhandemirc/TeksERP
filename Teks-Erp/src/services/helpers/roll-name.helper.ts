// =============================================================================
// Saha #20 — top adı (birleşik ürün tanımı) format şablonu
// =============================================================================
// Şablon token'ları: {item} {color} {width} {quality}. Boş/eksik parça atlanır,
// fazla boşluk sadeleşir. Örn şablon "{item} {color} {width}":
//   { item: "PATOS", color: "055-BEYAZ", width: 150 } → "PATOS 055-BEYAZ 150"
//   { item: "PATOS", color: null,        width: 150 } → "PATOS 150"  (renksiz)
// width sayıysa "cm" eklenmez (şablonda elle "{width}cm" yazılabilir).
// =============================================================================

export interface RollNameParts {
  item?: string | null;
  color?: string | null;
  width?: number | string | null;
  quality?: string | null;
}

export function renderRollName(template: string, parts: RollNameParts): string {
  const tokens: Record<string, string> = {
    item: parts.item?.toString().trim() ?? "",
    color: parts.color?.toString().trim() ?? "",
    width: parts.width == null || parts.width === "" ? "" : String(parts.width),
    quality: parts.quality?.toString().trim() ?? "",
  };
  const rendered = template.replace(/\{(item|color|width|quality)\}/g, (_, key: string) => tokens[key] ?? "");
  // Boş token sonrası kalan fazla boşlukları sadeleştir; baş/son boşluk kırp.
  return rendered.replace(/\s{2,}/g, " ").replace(/\s+([-/·])\s+/g, " $1 ").trim();
}
