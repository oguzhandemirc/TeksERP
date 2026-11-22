// =============================================================================
// TeksERP - System Setting / bekleme yaşı eşikleri (devere-levent S4 kalanı)
// =============================================================================
// Levent "N+ gündür dolu bekliyor" ve gövde "N+ gündür dışarıda" eşikleri. Varsayılanlar S4'ün sabitleri (14 / 30)
// = bugünkü davranış. Yalnız özet şeridi sayısı + panel hücre rengi; engel değil. Ayrı dosya: `devere-lead.ts` emsali.
// =============================================================================
import prisma from "../../lib/prisma";
import { asNumber } from "./core";
import { SETTING_KEYS } from "./keys";

export const DEFAULT_DEVERE_STALE_FULL_BEAM_DAYS = 14;
export const DEFAULT_DEVERE_STALE_OUT_BODY_DAYS = 30;
export const DEVERE_STALE_DAYS_MIN = 1;
export const DEVERE_STALE_DAYS_MAX = 365;

type SettingDb = Pick<typeof prisma, "systemSetting">;

async function readStaleDays(key: string, fallback: number, tx?: SettingDb): Promise<number> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key }, select: { value: true } });
  if (!setting) return fallback;
  const n = asNumber(setting.value);
  return n === null || !Number.isInteger(n) || n < DEVERE_STALE_DAYS_MIN || n > DEVERE_STALE_DAYS_MAX ? fallback : n;
}

/** Satır yok / çöp / aralık dışı → 14. */
export function readDevereStaleFullBeamDays(tx?: SettingDb): Promise<number> {
  return readStaleDays(SETTING_KEYS.DEVERE_STALE_FULL_BEAM_DAYS, DEFAULT_DEVERE_STALE_FULL_BEAM_DAYS, tx);
}

/** Satır yok / çöp / aralık dışı → 30. */
export function readDevereStaleOutBodyDays(tx?: SettingDb): Promise<number> {
  return readStaleDays(SETTING_KEYS.DEVERE_STALE_OUT_BODY_DAYS, DEFAULT_DEVERE_STALE_OUT_BODY_DAYS, tx);
}
