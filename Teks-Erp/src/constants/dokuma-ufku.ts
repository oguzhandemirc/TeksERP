// =============================================================================
// DOKUMA UFKU — TEK KAYNAK, AYRI AD (rapor sözleşmesi ②, `docs/kurallar/dokuma.md`)
// =============================================================================
// Tezgah verisinin (duruş · koşum · indirme · karne) toplanmaya başladığı fabrika
// günü: rapor "her şey tutuyor" demez, "şu günden sonrası ölçülü" der ve ufuktan
// önceki satırları `meta.ufukOncesiSatir` ile beyan eder.
// ⚠️ DEFTER UFKU DEĞİL: `constants/ledger-horizon.ts` depo defterinin kapısıdır
// ("depoya yazan son kapısız yol ne zaman kapandı"); bu sabit "tezgah verisi ne zaman
// başladı" sorusuna cevaptır. İki farklı güvenilirlik sınırı tek sayıya çökertilmez —
// dokuma raporu `LEDGER_HORIZON_DAY`/`DEFTER_UFKU` OKUMAZ (AST bekçisi ölçer).
// Gün Europe/Istanbul fabrika günüdür (`constants/time.ts`).
// =============================================================================
import { resolveRangeStart } from "./time";

/** Fabrika günü (YYYY-MM-DD) — Faz 1b elle duruş/koşum yazma yüzeyi ve karne dilimlerinin indiği gün. Değiştirmek HÜKÜMDÜR (arşiv notu ister). */
export const LOOM_HORIZON_DAY = "2026-09-14";

/** Ufkun fabrika-günü BAŞLANGICI (mutlak an). */
export function loomHorizonStart(): Date {
  return resolveRangeStart(LOOM_HORIZON_DAY);
}
