// =============================================================================
// TeksERP - Customer Name Cascade Helper
// =============================================================================
// Etiket / kartela basımında "müşterinin gördüğü ad" cascade'i.
// Tek yerde tutulur ki swatch, label endpoint'leri aynı mantıkla çalışsın.
//
// Sıra:
//   OrderLine.customerItemName  (1-shot override)  →  source: "OVERRIDE"
//     ↓ yoksa
//   CustomerItemAlias.alias     (master, live)     →  source: "MASTER"
//     ↓ yoksa
//   Item.name                   (default)          →  source: "DEFAULT"
//
// Aynı sıra color için.
// =============================================================================

import { Prisma } from "@prisma/client";

export type NameSource = "OVERRIDE" | "MASTER" | "DEFAULT";

export interface ResolvedName {
  name: string;
  source: NameSource;
}

/**
 * Tek değer için cascade — override > master > fallback.
 */
export function resolveName(
  override: string | null | undefined,
  master: string | null | undefined,
  fallback: string,
): ResolvedName {
  if (override && override.trim().length > 0) {
    return { name: override, source: "OVERRIDE" };
  }
  if (master && master.trim().length > 0) {
    return { name: master, source: "MASTER" };
  }
  return { name: fallback, source: "DEFAULT" };
}

/**
 * Boş string / sadece whitespace → null (override silindi sayılır).
 * OrderLine.customerItemName / customerColorName yazılırken normalize.
 */
export function normalizeOverride(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

// =============================================================================
// Toplu master alias çekme — N rulolu listelerde 2N query yerine 2 query.
// Snapshot inşa eden yerler için.
// =============================================================================

export interface BatchAliasResult {
  itemAliasByItemId: Map<string, string>;
  colorAliasByColorId: Map<string, string>;
}

/**
 * Bir müşteri için itemId/colorId set'lerine karşılık gelen master alias'ları
 * tek seferde çeker. Kullanım: snapshot builder'larda.
 *
 * tx içinde de güvenli: pg adapter Promise.all yasaklı, biz seri çekiyoruz.
 */
export async function batchLoadAliases(
  client: Prisma.TransactionClient | { customerItemAlias: Prisma.TransactionClient["customerItemAlias"]; customerColorAlias: Prisma.TransactionClient["customerColorAlias"] },
  customerId: string,
  itemIds: string[],
  colorIds: string[],
): Promise<BatchAliasResult> {
  const uniqItems = Array.from(new Set(itemIds));
  const uniqColors = Array.from(new Set(colorIds.filter((c) => !!c)));

  const itemAliasByItemId = new Map<string, string>();
  const colorAliasByColorId = new Map<string, string>();

  if (uniqItems.length > 0) {
    const itemRows = await client.customerItemAlias.findMany({
      where: { customerId, itemId: { in: uniqItems } },
      select: { itemId: true, alias: true },
    });
    for (const r of itemRows) itemAliasByItemId.set(r.itemId, r.alias);
  }

  if (uniqColors.length > 0) {
    const colorRows = await client.customerColorAlias.findMany({
      where: { customerId, colorId: { in: uniqColors } },
      select: { colorId: true, alias: true },
    });
    // alias null = sadece atama, özel ad yok → etikette standart renk adı kullanılır.
    for (const r of colorRows) if (r.alias) colorAliasByColorId.set(r.colorId, r.alias);
  }

  return { itemAliasByItemId, colorAliasByColorId };
}
