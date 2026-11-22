// =============================================================================
// Devere S3 gövde ayarları — gövde no esnek eşleşme · tartılı bitişte dara gövdeden (ikisi de satır yoksa FALSE)
// =============================================================================
import prisma from "../../lib/prisma";
import { asBoolean } from "./core";
import { SETTING_KEYS } from "./keys";

/** Devere S3: gövde no esnek eşleşme — satır yoksa FALSE (bugün birebir). */
export async function readDevereBodyNoLooseMatch(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_BODY_NO_LOOSE_MATCH }, select: { value: true } });
  return setting ? asBoolean(setting.value) : false;
}

/** Devere S3: tartılı bitişte dara gövdeden — satır yoksa FALSE (bugün dara yoksa ESTIMATED 0). */
export async function readDevereResidualTareFromBody(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_RESIDUAL_TARE_FROM_BODY }, select: { value: true } });
  return setting ? asBoolean(setting.value) : false;
}
