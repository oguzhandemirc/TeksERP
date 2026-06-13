// =============================================================================
// Saha #20 — top adı (birleşik ürün tanımı) format şablonu (Electron)
// =============================================================================
// Backend src/services/helpers/roll-name.helper.ts ile AYNI mantık. Token'lar:
// {item} {color} {width} {quality}. Boş parça atlanır, fazla boşluk sadeleşir.
// Şablon useRollNameTemplate() ile feature-flag'ten okunur.
// =============================================================================

export interface RollNameParts {
  item?: string | null;
  color?: string | null;
  width?: number | string | null;
  quality?: string | null;
}

export function formatRollName(template: string, parts: RollNameParts): string {
  const tokens: Record<string, string> = {
    item: parts.item?.toString().trim() ?? "",
    color: parts.color?.toString().trim() ?? "",
    width: parts.width == null || parts.width === "" ? "" : String(parts.width),
    quality: parts.quality?.toString().trim() ?? "",
  };
  const rendered = template.replace(
    /\{(item|color|width|quality)\}/g,
    (_, key: string) => tokens[key] ?? "",
  );
  return rendered.replace(/\s{2,}/g, " ").replace(/\s+([-/·])\s+/g, " $1 ").trim();
}
