import type { PickListRow } from "./types";

/** Müşteri adı basılmıyorken backend'in müşteri metnine göre böldüğü grupları ürün·renk·en'de birleştirir;
 *  yoksa hizmet ekseninde (tek varsayılan ürün) kâğıtta aynı görünen satırlar yinelenir. */
export function visibleContents(contents: PickListRow["contents"], withDeliveryNote: boolean): PickListRow["contents"] {
  if (withDeliveryNote) return contents;
  const merged = new Map<string, PickListRow["contents"][number]>();
  for (const c of contents) {
    const key = `${c.itemName}|${c.colorName ?? ""}|${c.width ?? ""}`;
    const prev = merged.get(key);
    if (prev) merged.set(key, { ...prev, qty: prev.qty + c.qty, rollCount: prev.rollCount + c.rollCount });
    else merged.set(key, { itemName: c.itemName, colorName: c.colorName, width: c.width, qty: c.qty, rollCount: c.rollCount });
  }
  return [...merged.values()];
}
