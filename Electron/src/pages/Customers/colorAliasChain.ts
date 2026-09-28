// Müşteri renk adı zinciri — ekranda gruplama ve silme onayı metni (saf; iki kart da buradan okur).
// Zincir backend'de çözülür (sipariş satırı adı → kumaşa özel → genel → bizdeki); burası yalnız anlatır.
import type { CustomerColorAlias, CustomerItemColorAlias } from "./aliasService";

export interface ColorAliasGroup {
  colorId: string;
  color: { id: string; code: string; name: string; hex: string | null; isActive?: boolean } | null;
  /** Genel (bütün kumaşlar) ad — yoksa null. */
  general: CustomerColorAlias | null;
  /** "Yalnız X kumaşında" adları, kumaş adına göre sıralı. */
  items: CustomerItemColorAlias[];
}

/** Genel satırın sırası korunur; yalnız kumaşa özel adı olan renk sona eklenir. Adsız atama satırı gösterilmez. */
export function groupColorAliases(
  general: readonly CustomerColorAlias[],
  itemRows: readonly CustomerItemColorAlias[],
): ColorAliasGroup[] {
  const groups = new Map<string, ColorAliasGroup>();
  for (const g of general) {
    if (!g.alias?.trim()) continue;
    groups.set(g.colorId, { colorId: g.colorId, color: g.color ?? null, general: g, items: [] });
  }
  for (const r of itemRows) {
    let grp = groups.get(r.colorId);
    if (!grp) {
      grp = { colorId: r.colorId, color: r.color ?? null, general: null, items: [] };
      groups.set(r.colorId, grp);
    }
    grp.items.push(r);
  }
  for (const grp of groups.values()) {
    grp.items.sort((a, b) => (a.item?.name ?? "").localeCompare(b.item?.name ?? "", "tr"));
  }
  return [...groups.values()];
}

const LINE_NAME_FIRST = "Sipariş satırına ayrıca ad yazılmışsa o yine önce gelir.";

/**
 * Kumaşa özel adı silince bu kumaşta ne basılır. `generalAlias`: müşterinin genel adı; `undefined` = henüz bilinmiyor.
 */
export function itemAliasDeleteText(
  row: { itemName: string; colorName: string; alias: string },
  generalAlias: string | null | undefined,
): string {
  const next =
    generalAlias === undefined
      ? `müşterinin genel renk adı (varsa) ya da bizdeki ad "${row.colorName}"`
      : generalAlias
        ? `müşterinin genel renk adı "${generalAlias}"`
        : `bizdeki ad "${row.colorName}"`;
  return `"${row.itemName}" kumaşındaki ${row.colorName} rengi için "${row.alias}" adı silinecek. Bundan sonra bu kumaşta ${next} basılır. ${LINE_NAME_FIRST}`;
}

/** Genel adı silince: kumaşa özel adlar kalır, diğer kumaşlar bizdeki ada döner. */
export function generalAliasDeleteText(colorName: string, alias: string, itemNames: readonly string[]): string {
  const remaining = itemNames.length
    ? ` Kumaşa özel ${itemNames.length} ad (${itemNames.join(", ")}) olduğu gibi kalır.`
    : "";
  return `${colorName} rengi için genel "${alias}" adı silinecek. Kumaşa özel adı olmayan kumaşlarda bizdeki ad "${colorName}" basılır.${remaining} ${LINE_NAME_FIRST}`;
}

/** Kumaş yeni ad kabul ediyor mu (backend `assertItemUsable` aynası): Tükenene kadar / Pasif kartta yazım kapalı. */
export const itemAcceptsAlias = (lifecycle: string | undefined): boolean => lifecycle === undefined || lifecycle === "ACTIVE";

export const ITEM_LOCKED_HINT = "Kumaş 'Tükenene kadar' ya da Pasif — ad değiştirilemez, yalnız silinebilir.";

/** Renk yeni/değişen ad kabul ediyor mu (backend `assertColor` aynası): pasif renkte yazım 400. */
export const colorAcceptsAlias = (color: { isActive?: boolean } | null | undefined): boolean => color?.isActive !== false;

export const COLOR_LOCKED_HINT = "Renk pasif — ad değiştirilemez, yalnız silinebilir.";
