// =============================================================================
// TeksERP - System Setting / devere teslim süresi yedeği (devere-levent S1)
// =============================================================================
// Geçmişi olmayan çözgü kartında "devereye ver" günü için yedek süre. 0 = yok (bugünkü davranış: gün ölçülemedi).
// Ayrı dosya: devere ek dilimleri aynı `modules.ts`e çarpışmasın (emsal `devere-settle.ts`).
// =============================================================================
import prisma from "../../lib/prisma";
import { asNumber } from "./core";
import { SETTING_KEYS } from "./keys";

export const DEFAULT_DEVERE_DEFAULT_LEAD_DAYS = 0;
export const DEVERE_DEFAULT_LEAD_DAYS_MAX = 120;

/** HAM değer — satır yok / çöp / aralık dışı → 0. Tüketici `<= 0`ı "yok" okur. */
export async function readDevereDefaultLeadDays(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_DEFAULT_LEAD_DAYS }, select: { value: true } });
  if (!setting) return DEFAULT_DEVERE_DEFAULT_LEAD_DAYS;
  const n = asNumber(setting.value);
  return n === null || !Number.isFinite(n) || n < 0 || n > DEVERE_DEFAULT_LEAD_DAYS_MAX ? DEFAULT_DEVERE_DEFAULT_LEAD_DAYS : n;
}
