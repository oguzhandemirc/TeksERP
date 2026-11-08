// =============================================================================
// Order Service / aliases
// =============================================================================
// Müşteri ad takma adlarının (ürün/renk) siparişten terfisi ve kumaşa özel renk çiftleri.
// `order.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../order.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { hata } from "../../lib/logger";
import type { OrderServiceThis } from "./shared";

export async function promoteCustomerAliases(this: OrderServiceThis, 
    customerId: string | null | undefined,
    lines: Array<Record<string, unknown>> | null | undefined,
    userId?: string
  ): Promise<void> {
    if (!customerId || !Array.isArray(lines) || lines.length === 0) return;

    // Aynı sipariş içinde aynı ürün/renk birden fazla satırda geçerse tek terfi
    // yeter (ilk dolu ad master olur). PERF: satır-bazlı 2N findUnique yerine
    // benzersiz item/color için TEK varlık-okuması (2 findMany) + yalnız EKSİK
    // olanları upsert. Davranış birebir: yalnız HİÇ alias-satırı olmayan (assigned
    // dahil) item/color terfi edilir; mevcut satır korunur, ilk-dolu-ad kazanır.
    const itemNameById = new Map<string, string>();
    const colorNameById = new Map<string, string>();
    // Varlık okuması yalnız renk adı taşıyan satırlar için; okunamazsa yalnız RENK
    // terfisi atlanır (null), kumaş adı terfisi bundan etkilenmez.
    const renkAdayi = lines.filter((l) => typeof l.customerColorName === "string" && l.customerColorName.trim().length > 0);
    let kumasaOzel: Set<string> | null = new Set();
    if (renkAdayi.length > 0) {
      try {
        kumasaOzel = await this.kumasaOzelRenkCiftleri(customerId, renkAdayi);
      } catch (e) {
        hata("order", "kumaşa özel renk adı varlık-okuması başarısız, renk terfisi atlandı:", e);
        kumasaOzel = null;
      }
    }
    for (const line of lines) {
      const itemId = typeof line.itemId === "string" ? line.itemId : null;
      const colorId = typeof line.colorId === "string" ? line.colorId : null;
      const itemName =
        typeof line.customerItemName === "string" ? line.customerItemName.trim() : "";
      const colorName =
        typeof line.customerColorName === "string" ? line.customerColorName.trim() : "";
      if (itemId && itemName.length > 0 && !itemNameById.has(itemId)) {
        itemNameById.set(itemId, itemName);
      }
      const ozel = itemId && colorId && kumasaOzel?.has(`${itemId}|${colorId}`);
      if (kumasaOzel && colorId && colorName.length > 0 && !ozel && !colorNameById.has(colorId)) {
        colorNameById.set(colorId, colorName);
      }
    }
    if (itemNameById.size === 0 && colorNameById.size === 0) return;

    const itemIds = [...itemNameById.keys()];
    const colorIds = [...colorNameById.keys()];
    let existingItems = new Set<string>();
    let existingColors = new Set<string>();
    try {
      if (itemIds.length > 0) {
        existingItems = new Set(
          (
            await prisma.customerItemAlias.findMany({
              where: { customerId, itemId: { in: itemIds } },
              select: { itemId: true },
            })
          ).map((r) => r.itemId)
        );
      }
      if (colorIds.length > 0) {
        existingColors = new Set(
          (
            await prisma.customerColorAlias.findMany({
              where: { customerId, colorId: { in: colorIds } },
              select: { colorId: true },
            })
          ).map((r) => r.colorId)
        );
      }
    } catch (e) {
      // best-effort: varlık okunamazsa terfi atlanır, sipariş etkilenmez.
      hata("order", "müşteri alias varlık-okuması başarısız:", e);
      return;
    }

    for (const [itemId, itemName] of itemNameById) {
      if (existingItems.has(itemId)) continue;
      try {
        await this.aliasService.upsertItemAlias(customerId, itemId, itemName, userId);
      } catch (e) {
        hata("order", "müşteri-ürün alias terfisi başarısız:", e);
      }
    }
    for (const [colorId, colorName] of colorNameById) {
      if (existingColors.has(colorId)) continue;
      try {
        await this.aliasService.upsertColorAlias(customerId, colorId, colorName, userId);
      } catch (e) {
        hata("order", "müşteri-renk alias terfisi başarısız:", e);
      }
    }
  }

export async function kumasaOzelRenkCiftleri(
    customerId: string,
    lines: Array<Record<string, unknown>>,
  ): Promise<Set<string>> {
    const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
    const itemIds = [...new Set(lines.map((l) => str(l.itemId)).filter((x): x is string => !!x))];
    const colorIds = [...new Set(lines.map((l) => str(l.colorId)).filter((x): x is string => !!x))];
    if (itemIds.length === 0 || colorIds.length === 0) return new Set();
    const rows = await prisma.customerItemColorAlias.findMany({
      where: { customerId, itemId: { in: itemIds }, colorId: { in: colorIds } },
      select: { itemId: true, colorId: true },
    });
    return new Set(rows.map((r) => `${r.itemId}|${r.colorId}`));
  }
