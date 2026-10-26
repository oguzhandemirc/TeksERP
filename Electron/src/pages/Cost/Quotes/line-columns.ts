// Maliyet sütunları yalnız SUNUCU alanı gönderdiyse çizilir: `cost:read` yoksa `costPerMTry`/`markupPct`/
// `suggestedUnitPrice` yanıtta YOKTUR (quoteViewFor). Panel izni ikinci kez yorumlamaz — "alan yoksa sütun yok".
import type { QuoteLine } from "./quote-types";

export function hasCostColumns(lines: ReadonlyArray<Partial<QuoteLine>>): boolean {
  return lines.some((l) => "costPerMTry" in l || "suggestedUnitPrice" in l);
}
