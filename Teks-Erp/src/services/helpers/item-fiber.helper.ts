// =============================================================================
// İPLİK LİF BİLEŞİMİ — TEK YAZAR (K7, Seyitoğlu 2026-11-25)
// =============================================================================
// İplik kartının lif satırları (lif türü + %). Kurallar: yalnız YARN; lif türü tekrar etmez; pay 0 < p ≤ 100,
// en çok 2 ondalık; Σ pay TAM 100 (boş liste = bileşim bilinmiyor, temizler). Satırlar arası toplam DB'de
// yazılamaz → bu dosya kapıdır; satır CHECK `item_fibers_pct_ck` ikinci hat. Pasif lif türü yeni satıra
// giremez, kartta zaten olan satır korunur (pasife alma eski kartı bozmaz).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { parseDecimalField } from "./cost-input.helper";
import { pctText } from "./qty-text.helper";

type Db = Prisma.TransactionClient | typeof prisma;
export interface ItemFiberRow { fiberTypeId: string; pct: Prisma.Decimal }

const MAX_ROWS = 10;
const HUNDRED = new Prisma.Decimal(100);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gövdedeki `fibers` dizisini doğrular; anahtar yoksa `undefined` (dokunma). */
export async function parseItemFibers(
  db: Db,
  raw: unknown,
  ctx: { itemType: string | undefined; itemId?: string },
): Promise<ItemFiberRow[] | undefined> {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw AppError.badRequest("Lif bileşimi liste olmalı.", { code: "ITEM_FIBER_INVALID" });
  if (raw.length > MAX_ROWS) throw AppError.badRequest(`Lif bileşimi en çok ${MAX_ROWS} satır olabilir.`, { code: "ITEM_FIBER_INVALID" });
  if (raw.length > 0 && ctx.itemType !== "YARN") {
    throw AppError.badRequest("Lif bileşimi yalnız İPLİK kartına girilir.", { code: "ITEM_FIBER_YARN_ONLY" });
  }
  const rows: ItemFiberRow[] = [];
  for (const r of raw as unknown[]) {
    const o = (r ?? {}) as { fiberTypeId?: unknown; pct?: unknown };
    if (typeof o.fiberTypeId !== "string" || !UUID_RE.test(o.fiberTypeId)) {
      throw AppError.badRequest("Lif türü seçilmeli.", { code: "ITEM_FIBER_INVALID" });
    }
    if (rows.some((x) => x.fiberTypeId === o.fiberTypeId)) {
      throw AppError.badRequest("Aynı lif türü iki kez yazılamaz.", { code: "ITEM_FIBER_DUPLICATE" });
    }
    const pct = parseDecimalField(o.pct, { label: "Lif payı (%)", min: 0, minExclusive: true, max: 100, scale: 2 });
    if (!pct) throw AppError.badRequest("Lif payı (%) girilmeli.", { code: "ITEM_FIBER_INVALID" });
    rows.push({ fiberTypeId: o.fiberTypeId, pct });
  }
  if (rows.length === 0) return rows;
  const sum = rows.reduce((a, r) => a.plus(r.pct), new Prisma.Decimal(0));
  if (!sum.eq(HUNDRED)) {
    throw AppError.badRequest(`Lif payları toplamı %100 olmalı (şu an %${pctText(sum)}).`, { code: "ITEM_FIBER_SUM_NOT_100", sum: sum.toString() });
  }
  const ids = rows.map((r) => r.fiberTypeId);
  const types = await db.fiberType.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isActive: true } });
  if (types.length !== ids.length) throw AppError.badRequest("Lif türü bulunamadı.", { code: "ITEM_FIBER_TYPE_NOT_FOUND" });
  const kept = ctx.itemId
    ? new Set((await db.itemFiber.findMany({ where: { itemId: ctx.itemId }, select: { fiberTypeId: true } })).map((x) => x.fiberTypeId))
    : new Set<string>();
  const inactive = types.find((t) => !t.isActive && !kept.has(t.id));
  if (inactive) throw AppError.badRequest(`'${inactive.name}' lif türü pasif.`, { code: "ITEM_FIBER_TYPE_INACTIVE" });
  return rows;
}

/** Replace: kartın satırlarını silip yenilerini yazar (saf yapılandırma pivotu — izinli hard delete). */
export async function writeItemFibersTx(tx: Prisma.TransactionClient, itemId: string, rows: ItemFiberRow[]): Promise<void> {
  await tx.itemFiber.deleteMany({ where: { itemId } });
  if (rows.length > 0) await tx.itemFiber.createMany({ data: rows.map((r) => ({ itemId, fiberTypeId: r.fiberTypeId, pct: r.pct })) });
}

/** Audit yükü — Decimal metne (tek biçim). */
export const fibersAuditPayload = (rows: ItemFiberRow[]) => rows.map((r) => ({ fiberTypeId: r.fiberTypeId, pct: r.pct.toString() }));
