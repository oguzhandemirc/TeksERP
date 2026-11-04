// "Bir iş emri tek spec" çapası — saf kurallar. Seçilen kalemlerin TAM objesi
// hook'ta (`useQuickWorkOrder`) yaşar; picker'ın iç state'inde dursaydı sihirbaz
// adımı değişince (unmount) çapa kaybolur, farklı renkli kalem eklenebilirdi.
// Sunucu kapısı `WO_LINES_MIXED_COLOR/ITEM` ile aynı kural; bu yalnız erken uyarı.
import type { AvailableOrderLine } from '../../../services/order.service';

export type PickedOrderLines = Record<string, AvailableOrderLine>;

/** En karşılaştırması: null ≠ 0 ve "330" === "330.000" olsun. */
export const normWidth = (w: number | string | null | undefined): number | null =>
  w == null ? null : Number(w);

export function addPicked(map: PickedOrderLines, line: AvailableOrderLine): PickedOrderLines {
  return { ...map, [line.lineId]: line };
}

/** Seçimde kalmayan kalemleri at; değişiklik yoksa AYNI referans (gereksiz render yok). */
export function prunePicked(map: PickedOrderLines, ids: readonly string[]): PickedOrderLines {
  const next: PickedOrderLines = {};
  for (const id of ids) if (map[id]) next[id] = map[id];
  return Object.keys(next).length === Object.keys(map).length ? map : next;
}

/** Seçili kalemler, seçim sırasıyla; ilk eleman çapadır. */
export function selectedOf(ids: readonly string[], map: PickedOrderLines): AvailableOrderLine[] {
  return ids.map((id) => map[id]).filter(Boolean) as AvailableOrderLine[];
}

/** Bu kalem çapayla aynı iş emrinde üretilebilir mi — değilse sebebi. */
export function orderLineMismatch(
  anchor: AvailableOrderLine | null,
  line: AvailableOrderLine,
  itemId: string | null,
): string | null {
  if (anchor) {
    if (line.itemId !== anchor.itemId) return 'farklı kumaş';
    if ((line.colorId ?? null) !== (anchor.colorId ?? null)) return 'farklı renk';
    if (normWidth(line.width) !== normWidth(anchor.width)) return 'farklı en';
    return null;
  }
  // Henüz kalem seçilmedi: yalnız okutulan topların kumaşı kısıtlar.
  if (itemId && line.itemId !== itemId) return 'farklı kumaş';
  return null;
}
