// =============================================================================
// TeksERP - System Setting / devere dönüş kabulü ayarları (E1)
// =============================================================================
// İrsaliye no tekrarı ve dönüşte tartı kipi. Enum üçlü kalıbı + okuyucu `includes` sigortasıyla; varsayılan = bugünkü
// davranış. Ayrı dosya: devere ek dilimleri aynı `defaults.ts`e çarpışmasın (emsal `devere-settle.ts`).
// =============================================================================
import prisma from "../../lib/prisma";
import { SETTING_KEYS } from "./keys";

/** Aynı deverecide daha önce kullanılmış irsaliye no: `ALLOW` sessiz · `WARN` uyarı (varsayılan, KARAR 5) · `BLOCK` 409. */
export type DevereDuplicateDeliveryNote = "ALLOW" | "WARN" | "BLOCK";
export const DEVERE_DUPLICATE_DELIVERY_NOTE_MODES: DevereDuplicateDeliveryNote[] = ["ALLOW", "WARN", "BLOCK"];
export const DEFAULT_DEVERE_DUPLICATE_DELIVERY_NOTE: DevereDuplicateDeliveryNote = "WARN";

/** Dönen leventte tartı: `OFF` brüt/dara alınmaz (gelirse 400) · `OPTIONAL` serbest (varsayılan = bugün) · `REQUIRED` brüt zorunlu. */
export type DevereReceiveWeighing = "OFF" | "OPTIONAL" | "REQUIRED";
export const DEVERE_RECEIVE_WEIGHING_MODES: DevereReceiveWeighing[] = ["OFF", "OPTIONAL", "REQUIRED"];
export const DEFAULT_DEVERE_RECEIVE_WEIGHING: DevereReceiveWeighing = "OPTIONAL";

type SettingDb = Pick<typeof prisma, "systemSetting">;

export async function readDevereDuplicateDeliveryNote(tx?: SettingDb): Promise<DevereDuplicateDeliveryNote> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_DUPLICATE_DELIVERY_NOTE }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && DEVERE_DUPLICATE_DELIVERY_NOTE_MODES.includes(v as DevereDuplicateDeliveryNote) ? (v as DevereDuplicateDeliveryNote) : DEFAULT_DEVERE_DUPLICATE_DELIVERY_NOTE;
}

export async function readDevereReceiveWeighing(tx?: SettingDb): Promise<DevereReceiveWeighing> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_RECEIVE_WEIGHING }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && DEVERE_RECEIVE_WEIGHING_MODES.includes(v as DevereReceiveWeighing) ? (v as DevereReceiveWeighing) : DEFAULT_DEVERE_RECEIVE_WEIGHING;
}
