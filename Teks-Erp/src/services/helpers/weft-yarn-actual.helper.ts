// =============================================================================
// ATKI İPLİĞİ GERÇEK MALİYETİ — TOP PAYI (devere maliyet K7; plan PLAN-devere-maliyet-1126 §3 dilim 3)
// =============================================================================
// Atkının topa/lota tüketim defteri YOK (atkı tartılmaz): miktar standart sürümün atkı satırı normudur (kg/m × top
// metresi, "norm miktar"); yalnız FİYAT gerçeğe çekilir. Fiyat sırası topun doğduğu an: o ana kadar son giren lotun
// fiyatı (lot okuması `warp-yarn-lot-price.helper`, köprüden) → o tarihte geçerli `YarnCostPrice` (aynı birim;
// "tahmini") → eksik `ATKI_FIYATI`. Son giren lot müşteri malıysa bilgi `MUSTERI_IPLIGI` (0 katkı, eksik değil).
// Saklanmaz; bilinmeyen 0 DEĞİL null.
// =============================================================================
import { Prisma, YarnPurchaseUnit, type Currency } from "@prisma/client";
import prisma from "../../lib/prisma";
import { isCostPriceValidAt } from "./cost-price-validity.helper";
import type { LotPriceRead, YarnReceiptLot } from "./warp-yarn-lot-price.helper";

type Dec = Prisma.Decimal;
type Db = Prisma.TransactionClient | typeof prisma;
const D0 = () => new Prisma.Decimal(0);

export type WeftYarnCostSource = "LOT" | "MALIYET_FIYATI";
export type WeftYarnCostMissing = "ATKI_FIYATI" | "FX_RATE_MISSING" | "MUSTERI_IPLIGI";

/** Standart sürümün atkı satırı: metre başı norm miktar (`qtyUnit` kg · m · adet). */
export interface WeftNormLine { yarnItemId: string; qty: Dec; qtyUnit: string | null }

export interface WeftYarnActualCtx {
  /** İplik kapalıysa null — lot okunmaz, her satır maliyet kartı fiyatına düşer. */
  lots: {
    receipts: (db: Db, yarnItemIds: string[], until: Date) => Promise<YarnReceiptLot[]>;
    prices: (db: Db, lotIds: string[]) => Promise<Map<string, LotPriceRead>>;
  } | null;
  fxRate: (currency: Currency, at: Date) => Promise<Dec | null>;
}

export interface RollWeftYarnCost {
  costTry: Dec | null;
  /** Maliyet kartı fiyatından gelen kısım, TL. */
  estimatedTry: Dec;
  sources: WeftYarnCostSource[];
  missing: WeftYarnCostMissing[];
}

const UNIT_OF: Record<string, YarnPurchaseUnit> = { kg: YarnPurchaseUnit.KG, m: YarnPurchaseUnit.METRE, adet: YarnPurchaseUnit.ADET };
type CardPrice = { yarnItemId: string; unit: YarnPurchaseUnit; currency: Currency; pricePerKg: Dec; createdAt: Date; revokedAt: Date | null };

/** Satır fiyatı (TL/birim) ya da bilgi/eksik kodu; lot fiyatı yalnız kg satırında anlamlıdır. */
type PriceData = { receipts: YarnReceiptLot[]; lotPrices: Map<string, LotPriceRead>; cards: CardPrice[]; ctx: WeftYarnActualCtx };
async function linePrice(
  line: WeftNormLine, at: Date, { receipts, lotPrices, cards, ctx }: PriceData,
): Promise<{ perUnit: Dec; source: WeftYarnCostSource } | { code: WeftYarnCostMissing }> {
  const last = receipts.find((r) => r.yarnItemId === line.yarnItemId && r.at.getTime() <= at.getTime());
  if (last?.ownerCustomerId) return { code: "MUSTERI_IPLIGI" };
  const unit = UNIT_OF[line.qtyUnit ?? "kg"] ?? null;
  const lot = last && unit === YarnPurchaseUnit.KG ? lotPrices.get(last.lotId) : undefined;
  if (lot?.priceTry) return { perUnit: lot.priceTry, source: "LOT" };
  const card = cards
    .filter((c) => c.yarnItemId === line.yarnItemId && c.unit === unit && isCostPriceValidAt(c, at))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const rate = card ? await ctx.fxRate(card.currency, at) : null;
  if (card && rate) return { perUnit: card.pricePerKg.mul(rate), source: "MALIYET_FIYATI" };
  return { code: card || lot?.fxMissing ? "FX_RATE_MISSING" : "ATKI_FIYATI" };
}

/** Topların atkı ipliği payı (norm miktar × gerçek fiyat). Haritada yalnız norm satırı verilen top bulunur. */
export async function loadRollWeftYarnCostsTx(
  db: Db, rolls: Array<{ rollId: string; lines: WeftNormLine[] }>, ctx: WeftYarnActualCtx,
): Promise<Map<string, RollWeftYarnCost>> {
  const out = new Map<string, RollWeftYarnCost>();
  const priced = rolls.filter((r) => r.lines.length > 0);
  if (priced.length === 0) return out;
  const rows = await db.roll.findMany({ where: { id: { in: priced.map((r) => r.rollId) } }, select: { id: true, initialQty: true, createdAt: true } });
  const rollOf = new Map(rows.map((r) => [r.id, r]));
  const yarnIds = [...new Set(priced.flatMap((r) => r.lines.map((l) => l.yarnItemId)))].sort();
  const until = new Date(Math.max(...rows.map((r) => r.createdAt.getTime())));
  const receipts = ctx.lots && rows.length > 0 ? await ctx.lots.receipts(db, yarnIds, until) : [];
  const lotIds = [...new Set(receipts.filter((r) => !r.ownerCustomerId).map((r) => r.lotId))].sort();
  const lotPrices = ctx.lots && lotIds.length > 0 ? await ctx.lots.prices(db, lotIds) : new Map<string, LotPriceRead>();
  const cards = await db.yarnCostPrice.findMany({
    where: { yarnItemId: { in: yarnIds } },
    select: { yarnItemId: true, unit: true, currency: true, pricePerKg: true, createdAt: true, revokedAt: true },
  });
  const data: PriceData = { receipts, lotPrices, cards, ctx };
  for (const r of priced) {
    const roll = rollOf.get(r.rollId);
    if (!roll) continue;
    const acc: RollWeftYarnCost = { costTry: D0(), estimatedTry: D0(), sources: [], missing: [] };
    for (const line of r.lines) {
      const p = await linePrice(line, roll.createdAt, data);
      if ("code" in p) {
        // Müşteri malı iplik toplamı bozmaz (0 katkı); diğer kodlar bilinmeyendir.
        if (p.code !== "MUSTERI_IPLIGI") acc.costTry = null;
        if (!acc.missing.includes(p.code)) acc.missing.push(p.code);
        continue;
      }
      const amount = line.qty.mul(roll.initialQty).mul(p.perUnit);
      acc.costTry = acc.costTry ? acc.costTry.plus(amount) : null;
      if (p.source === "MALIYET_FIYATI") acc.estimatedTry = acc.estimatedTry.plus(amount);
      if (!acc.sources.includes(p.source)) acc.sources.push(p.source);
    }
    out.set(r.rollId, acc);
  }
  return out;
}
