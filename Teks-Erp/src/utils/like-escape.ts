/**
 * Katlamasız LIKE/ILIKE/Prisma `contains` terimi: `% _ \` jokerleri `\` ile KAÇIRILIR (PG varsayılan
 * ESCAPE karakteri; Prisma `contains` değeri `%…%` içine aynen koyar). Silmek yerine kaçırmak: adında
 * gerçekten `%`/`_` geçen kayıt da bulunur. Katlamalı yol `search-fold.ts` `foldSearchTerm`dir
 * (o dosya istemcilerle bayt-eşit ikizdir; bu yalnız-backend yardımcı oraya girmez).
 */
export function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
