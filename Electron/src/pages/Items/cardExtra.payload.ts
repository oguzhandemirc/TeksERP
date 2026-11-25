// Ürün kartı D4b gövde kuralları — sunucu `undefined` = dokunma: dolu → noktalı metin; boş alan yalnız kayıtta
// değer VARSA `null` (temizle) gider; boş + kayıtta yok → anahtar hiç gitmez (eski gövdeyle bayt-aynı).
import { ItemType } from "@/types/enums";
import { decimalToFormText } from "@/lib/decimal-form-text";
import type { ItemFormValues } from "./schema";
import type { Item, ItemCreatePayload } from "./types";

const FABRIC_KEYS = ["standardRollLengthM", "minOrderQty", "careInstructions"] as const;
const YARN_KEYS = ["yarnFilamentCount", "yarnPly", "yarnTwistTpm", "yarnTwistDirection", "yarnLuster"] as const;
type ExtraKey = (typeof FABRIC_KEYS)[number] | (typeof YARN_KEYS)[number] | "minStockQty";
type ExtraValues = Pick<ItemFormValues, "itemType" | ExtraKey>;

/** Asgari stok taşıyan tipler (sunucu `readMinStockField` ile aynı küme). */
export const carriesMinStock = (t: ItemType): boolean => t === ItemType.YARN || t === ItemType.CONSUMABLE;

const text = (v: string | number | null | undefined): string => decimalToFormText(v).replace(".", ",");

export function cardExtraFormValues(i: Item): Pick<ItemFormValues, ExtraKey> {
  return {
    standardRollLengthM: text(i.standardRollLengthM),
    minOrderQty: text(i.minOrderQty),
    careInstructions: i.careInstructions ?? "",
    yarnFilamentCount: text(i.yarnFilamentCount),
    yarnPly: text(i.yarnPly),
    yarnTwistTpm: text(i.yarnTwistTpm),
    yarnTwistDirection: i.yarnTwistDirection ?? "",
    yarnLuster: i.yarnLuster ?? "",
    minStockQty: text(i.minStockQty),
  };
}

export function cardExtraPayload(v: ExtraValues, initial: Item | null | undefined): Partial<ItemCreatePayload> {
  const keys: ExtraKey[] = [
    ...(v.itemType === ItemType.FABRIC ? FABRIC_KEYS : []),
    ...(v.itemType === ItemType.YARN ? YARN_KEYS : []),
    ...(carriesMinStock(v.itemType) ? (["minStockQty"] as const) : []),
  ];
  const out: Record<string, string | null> = {};
  for (const k of keys) {
    const raw = v[k].trim();
    const saved = initial?.[k];
    if (raw !== "") out[k] = k === "careInstructions" ? raw : raw.replace(",", ".");
    else if (saved != null && saved !== "") out[k] = null;
  }
  return out as Partial<ItemCreatePayload>;
}
