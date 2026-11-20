// =============================================================================
// TeksERP - System Setting / devere kapanış varsayılanı (H1)
// =============================================================================
// Fason devere kapanışında gövdesiz (satırsız) planın kalan ipliğe önerdiği kader. Enum üçlü kalıbı + okuyucu
// `includes` sigortasıyla; varsayılan = bugünkü A1-a. Ayrı dosya: devere ek dilimleri aynı `defaults.ts`e çarpışmasın.
// =============================================================================
import prisma from "../../lib/prisma";
import { SETTING_KEYS } from "./keys";

/** `WASTE_UP_TO_PLAN` plan firesi kadar fire + kalanı deverecide (A1-a) · `KEEP` hepsi kalır · `RETURN` hepsi iade · `WASTE_ALL` hepsi fire. */
export type DevereSettleDefault = "WASTE_UP_TO_PLAN" | "KEEP" | "RETURN" | "WASTE_ALL";
export const DEVERE_SETTLE_DEFAULTS: DevereSettleDefault[] = ["WASTE_UP_TO_PLAN", "KEEP", "RETURN", "WASTE_ALL"];
/** Varsayılan `WASTE_UP_TO_PLAN` — BUGÜNKÜ davranış (D5b A1-a). */
export const DEFAULT_DEVERE_SETTLE_DEFAULT: DevereSettleDefault = "WASTE_UP_TO_PLAN";

export async function readDevereSettleDefault(tx?: Pick<typeof prisma, "systemSetting">): Promise<DevereSettleDefault> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_SETTLE_DEFAULT }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && DEVERE_SETTLE_DEFAULTS.includes(v as DevereSettleDefault) ? (v as DevereSettleDefault) : DEFAULT_DEVERE_SETTLE_DEFAULT;
}
