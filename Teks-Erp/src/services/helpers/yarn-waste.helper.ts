// =============================================================================
// İPLİK BAŞINA FİRE — tek çözücü (Seyitoğlu 3. bölüm I2, 2026-11-12)
// =============================================================================
// "Bu ipliğin kg/m'sine hangi fire yüzdesi uygulanır?" sorusunun TEK cevabı. Maliyet motoru
// (`fabric-cost.helper` warpKg/weftKgs) bunu çağırır; ham ihtiyaç, iplik ihtiyaç raporu ve üretim
// önerisi iplik özeti motorun `yarnUsagePerM`inden okuduğu için aynı cevabı görür (kopya yok).
// Öncelik: istek ezmesi (ELLE/OLCULMUS) > iplik kartı (`Item.yarnWastePct`) > yapı/kart/parametre zinciri.
// İplik firesi boşken zincir aynen döner → sayı ve `inputHash` bayt-aynı. Kalite firesi
// (`fabricWastePct`) ve dokuma firesi (`dokuma.weavingWastePct`) AYRI kavramdır; burada okunmaz.
// =============================================================================
import type { Prisma } from "@prisma/client";

/** İplik firesi üst sınırı (%) — DB CHECK `items_yarn_waste_pct_ck` aynası. */
export const YARN_WASTE_PCT_MAX = 50;

/** Uygulanan firenin kaynağı: `IPLIK` = iplik kartı, `KART` = çözgü/atkı fire zinciri (yapı/kart/parametre/elle). */
export type YarnWasteSource = "IPLIK" | "KART";

/** Zincirin kaynağı istek ezmesiyse (Hızlı Hesaplayıcı what-if, ölçülmüş fire uygulaması) iplik firesi EZMEZ. */
const REQUEST_OVERRIDE_SOURCES = new Set(["ELLE", "OLCULMUS"]);

export function resolveYarnWastePct(
  yarnWastePct: Prisma.Decimal | null | undefined,
  chain: { value: Prisma.Decimal | null; source: string },
): { value: Prisma.Decimal | null; source: YarnWasteSource } {
  if (yarnWastePct != null && !REQUEST_OVERRIDE_SOURCES.has(chain.source)) return { value: yarnWastePct, source: "IPLIK" };
  return { value: chain.value, source: "KART" };
}
