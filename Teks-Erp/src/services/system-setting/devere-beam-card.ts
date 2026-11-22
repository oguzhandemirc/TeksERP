// =============================================================================
// TeksERP - System Setting / levent kartı otomatik basımı (devere-levent S5)
// =============================================================================
// Panelde devere kabulü kaydedilince A6 levent kartları: `OFF` bugünkü davranış (hiçbir şey) · `ASK` "bas" önerisi ·
// `ALWAYS` doğrudan toplu basım penceresi. Enum üçlü kalıbı + `includes` sigortası (emsal `devere-settle.ts`).
// =============================================================================
import prisma from "../../lib/prisma";
import { SETTING_KEYS } from "./keys";

export type DevereBeamCardAutoPrint = "OFF" | "ASK" | "ALWAYS";
export const DEVERE_BEAM_CARD_AUTO_PRINTS: DevereBeamCardAutoPrint[] = ["OFF", "ASK", "ALWAYS"];
/** Varsayılan `OFF` — BUGÜNKÜ davranış (kabulden sonra kart önerilmez). */
export const DEFAULT_DEVERE_BEAM_CARD_AUTO_PRINT: DevereBeamCardAutoPrint = "OFF";

export async function readDevereBeamCardAutoPrint(tx?: Pick<typeof prisma, "systemSetting">): Promise<DevereBeamCardAutoPrint> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_BEAM_CARD_AUTO_PRINT }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && DEVERE_BEAM_CARD_AUTO_PRINTS.includes(v as DevereBeamCardAutoPrint) ? (v as DevereBeamCardAutoPrint) : DEFAULT_DEVERE_BEAM_CARD_AUTO_PRINT;
}
