// =============================================================================
// TeksERP - System Setting / desen ve tarak ayarları (Seyitoğlu K9 + K10, 2026-11-25)
// =============================================================================
// K10: firmanın kullandığı ağızlık mekanizmaları (üç boolean, varsayılan TRUE = bugünkü davranış).
// K9: tarak numarası birimi (enum üçlü kalıbı; DB'de saklanan değer hep diş/10 cm, çeviri panelde).
// Ayrı dosya: dokuma/devere ek dilimleri `modules.ts`/`defaults.ts`e çarpışmasın (emsal `devere-receive.ts`).
// =============================================================================
import prisma from "../../lib/prisma";
import { SETTING_KEYS } from "./keys";
import type { WeaveShedMechanismValue } from "../../constants/weave-classification";
import { DRAWING_IN_FRAMES_DEFAULT_MAX, DRAWING_IN_FRAMES_HARD_MAX } from "../../constants/drawing-in-plan";

type SettingDb = Pick<typeof prisma, "systemSetting">;

/** Kayıt yok ya da çöp değer → TRUE (bugün üç mekanizma da seçilebilir). */
function asBooleanDefaultTrue(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v !== "false";
  return true;
}

async function readBoolTrue(key: string, tx?: SettingDb): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key }, select: { value: true } });
  return asBooleanDefaultTrue(setting?.value);
}

// `export async function` biçimi bilinçli: `test_feature_flag_contract` okuyucuyu bu imzadan bulur.
export async function readDokumaMechanismCamEnabled(tx?: SettingDb): Promise<boolean> {
  return readBoolTrue(SETTING_KEYS.DOKUMA_MECHANISM_CAM_ENABLED, tx);
}
export async function readDokumaMechanismDobbyEnabled(tx?: SettingDb): Promise<boolean> {
  return readBoolTrue(SETTING_KEYS.DOKUMA_MECHANISM_DOBBY_ENABLED, tx);
}
export async function readDokumaMechanismJacquardEnabled(tx?: SettingDb): Promise<boolean> {
  return readBoolTrue(SETTING_KEYS.DOKUMA_MECHANISM_JACQUARD_ENABLED, tx);
}

/** Mekanizma → ayar anahtarı + API adı (yazma doğrulaması ve servis kapısı aynı tabloyu okur). */
export const MECHANISM_SETTING: Readonly<Record<WeaveShedMechanismValue, { key: string; flag: "dokumaMechanismCamEnabled" | "dokumaMechanismDobbyEnabled" | "dokumaMechanismJacquardEnabled" }>> = {
  CAM: { key: SETTING_KEYS.DOKUMA_MECHANISM_CAM_ENABLED, flag: "dokumaMechanismCamEnabled" },
  DOBBY: { key: SETTING_KEYS.DOKUMA_MECHANISM_DOBBY_ENABLED, flag: "dokumaMechanismDobbyEnabled" },
  JACQUARD: { key: SETTING_KEYS.DOKUMA_MECHANISM_JACQUARD_ENABLED, flag: "dokumaMechanismJacquardEnabled" },
};

/** Firmanın açık mekanizmaları — servis kapısının TEK okuyucusu. */
export async function readEnabledShedMechanisms(tx?: SettingDb): Promise<Set<WeaveShedMechanismValue>> {
  const out = new Set<WeaveShedMechanismValue>();
  if (await readDokumaMechanismCamEnabled(tx)) out.add("CAM");
  if (await readDokumaMechanismDobbyEnabled(tx)) out.add("DOBBY");
  if (await readDokumaMechanismJacquardEnabled(tx)) out.add("JACQUARD");
  return out;
}

/** Tarak numarası birimi: `DENTS_PER_10CM` diş/10 cm (varsayılan = bugünkü saklama) · `DENTS_PER_CM` diş/cm. */
export type DevereReedNumberUnit = "DENTS_PER_10CM" | "DENTS_PER_CM";
export const DEVERE_REED_NUMBER_UNITS: DevereReedNumberUnit[] = ["DENTS_PER_10CM", "DENTS_PER_CM"];
export const DEFAULT_DEVERE_REED_NUMBER_UNIT: DevereReedNumberUnit = "DENTS_PER_10CM";

export async function readDevereReedNumberUnit(tx?: SettingDb): Promise<DevereReedNumberUnit> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_REED_NUMBER_UNIT }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && DEVERE_REED_NUMBER_UNITS.includes(v as DevereReedNumberUnit) ? (v as DevereReedNumberUnit) : DEFAULT_DEVERE_REED_NUMBER_UNIT;
}

/** T1 tahar planı çerçeve üst sınırı: kayıt yok ya da aralık dışı → 12 (fabrika: "en yüksek 12"); en çok 16 (DB CHECK). */
export async function readDokumaDrawingInMaxFrames(tx?: SettingDb): Promise<number> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.DOKUMA_DRAWING_IN_MAX_FRAMES }, select: { value: true } });
  const n = typeof setting?.value === "number" ? setting.value : Number(setting?.value);
  return Number.isInteger(n) && n >= 1 && n <= DRAWING_IN_FRAMES_HARD_MAX ? n : DRAWING_IN_FRAMES_DEFAULT_MAX;
}
