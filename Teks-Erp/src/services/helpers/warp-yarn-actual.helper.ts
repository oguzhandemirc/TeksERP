// =============================================================================
// ÇÖZGÜ İPLİĞİ GERÇEK MALİYETİ — TOP PAYI (devere maliyet dilim 3; plan PLAN-devere-maliyet-1126 §3)
// =============================================================================
// Yeni defter yok, saklanmaz. Leventin iplik TL'si = Σ WOUND kırılımı (`WarpBeamEventYarn.theoreticalKg`) × fiyat
// + sipariş firesinin (WarpingYarnWaste, geri alınmamış) metre payı. Fiyat sırası: lot fiyatı (fason: sevk kalemi lotu,
// kendi deveremiz: WARP_ISSUE lotu) → o tarihte geçerli `YarnCostPrice` (KG; "tahmini") → eksik `IPLIK_FIYATI`.
// Top payı = tüketilen çözgü m × leventin iplik TL'si ÷ sarım metresi (devere payıyla aynı tüketim satırı). Yalnız köprü
// dinamik import eder; iplik okuması (lot fiyatı, WARP_ISSUE) köprünün verdiği okuyucudan gelir, bilinmeyen 0 DEĞİL null.
// =============================================================================
import { Prisma, WarpBeamOrigin, YarnPurchaseUnit, type Currency } from "@prisma/client";
import prisma from "../../lib/prisma";
import { isCostPriceValidAt } from "./cost-price-validity.helper";
import type { BeamIssueLot, LotPriceRead } from "./warp-yarn-lot-price.helper";
import { ACCEPTED_WARPING_BEAM_WHERE, isBoughtOrConsignedBeam } from "./warping-fee.helper";

type Dec = Prisma.Decimal;
type Db = Prisma.TransactionClient | typeof prisma;
const D0 = () => new Prisma.Decimal(0);

export type WarpYarnCostSource = "LOT" | "MALIYET_FIYATI";
/** `MUSTERI_IPLIGI` eksik değil BİLGİDİR (müşteri malı iplik; dokuma tarafında `WEAVING_INFO_CODES`). */
export type WarpYarnCostMissing = "IPLIK_FIYATI" | "LEVENT_KOKENI" | "FX_RATE_MISSING" | "MUSTERI_IPLIGI";

export interface WarpYarnActualCtx {
  /** İplik kapalıysa null — lot fiyatı okunmaz, her kg maliyet kartı fiyatına düşer. */
  lots: {
    prices: (db: Db, lotIds: string[]) => Promise<Map<string, LotPriceRead>>;
    issues: (db: Db, beamIds: string[]) => Promise<BeamIssueLot[]>;
  } | null;
  fxRate: (currency: Currency, at: Date) => Promise<Dec | null>;
}

export interface RollWarpYarnCost {
  /** Σ tüketim satırı payı (TL); bir pay bilinmiyorsa null. */
  costTry: Dec | null;
  /** Maliyet kartı fiyatından (lot fiyatı yok) gelen kısım, TL. */
  estimatedTry: Dec;
  sources: WarpYarnCostSource[];
  missing: WarpYarnCostMissing[];
}

/** Bir kg kümesinin fiyatlanmış hali (null = bilinmiyor). */
type Priced = { amount: Dec | null; estimated: Dec; sources: Set<WarpYarnCostSource>; missing: Set<WarpYarnCostMissing> };
const emptyPriced = (): Priced => ({ amount: D0(), estimated: D0(), sources: new Set(), missing: new Set() });
function addPriced(a: Priced, b: Priced): void {
  a.amount = a.amount && b.amount ? a.amount.plus(b.amount) : null;
  a.estimated = a.estimated.plus(b.estimated);
  b.sources.forEach((s) => a.sources.add(s));
  b.missing.forEach((m) => a.missing.add(m));
}

type CardPrice = { yarnItemId: string; currency: Currency; pricePerKg: Dec; createdAt: Date; revokedAt: Date | null };

/** Fiyat okuyucusu: lot → maliyet kartı fiyatı (o tarihte geçerli) → eksik. */
function pricer(lotPrices: Map<string, LotPriceRead>, cards: CardPrice[], ctx: WarpYarnActualCtx) {
  return async (yarnItemId: string, lotId: string | null, kg: Dec, at: Date): Promise<Priced> => {
    const p = emptyPriced();
    const lot = lotId ? lotPrices.get(lotId) : undefined;
    if (lot?.priceTry) {
      p.amount = kg.mul(lot.priceTry);
      p.sources.add("LOT");
      return p;
    }
    const card = cards
      .filter((c) => c.yarnItemId === yarnItemId && isCostPriceValidAt(c, at))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const rate = card ? await ctx.fxRate(card.currency, at) : null;
    if (card && rate) {
      p.amount = kg.mul(card.pricePerKg).mul(rate);
      p.estimated = p.amount;
      p.sources.add("MALIYET_FIYATI");
    } else {
      p.amount = null;
      p.missing.add(card || lot?.fxMissing ? "FX_RATE_MISSING" : "IPLIK_FIYATI");
    }
    return p;
  };
}

/** Topların çözgü ipliği payı. Haritada YALNIZ iptal edilmemiş tüketim satırı (CONSUMED + rollId) olan top bulunur. */
export async function loadRollWarpYarnCostsTx(db: Db, rollIds: string[], ctx: WarpYarnActualCtx): Promise<Map<string, RollWarpYarnCost>> {
  const out = new Map<string, RollWarpYarnCost>();
  if (rollIds.length === 0) return out;
  const consumed = await db.warpBeamEvent.findMany({
    where: { rollId: { in: rollIds }, kind: "CONSUMED", reversal: null },
    select: { rollId: true, lengthM: true, beamId: true },
    orderBy: { id: "asc" },
  });
  if (consumed.length === 0) return out;
  const consumedBeamIds = [...new Set(consumed.map((c) => c.beamId))].sort();
  const beams = await db.warpBeam.findMany({
    where: { id: { in: consumedBeamIds } },
    select: { id: true, originKind: true, ownerCustomerId: true, warpingOrderId: true },
  });
  const orderIds = [...new Set(beams.flatMap((b) => (b.originKind === WarpBeamOrigin.SUBCONTRACT && b.warpingOrderId ? [b.warpingOrderId] : [])))].sort();
  // Fire paylaştırması siparişin BÜTÜN kabul edilen sarımlarına yapılır (yalnız tüketilenlere değil).
  const orderBeams = orderIds.length === 0 ? [] : await db.warpBeam.findMany({
    where: { ...ACCEPTED_WARPING_BEAM_WHERE, warpingOrderId: { in: orderIds } },
    select: { id: true, warpingOrderId: true },
  });
  const pricedBeamIds = [...new Set([...consumedBeamIds, ...orderBeams.map((b) => b.id)])].sort();
  const wounds = await db.warpBeamEvent.findMany({
    where: { beamId: { in: pricedBeamIds }, kind: "WOUND", reversal: null },
    select: {
      id: true, beamId: true, lengthM: true, createdAt: true,
      yarns: { select: { yarnItemId: true, theoreticalKg: true, allocations: { select: { kg: true, dispatchItem: { select: { lotId: true } } } } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const woundOf = new Map<string, (typeof wounds)[number]>();
  for (const w of wounds) if (!woundOf.has(w.beamId)) woundOf.set(w.beamId, w);
  const wastes = orderIds.length === 0 ? [] : await db.warpingYarnWaste.findMany({
    where: { warpingOrderId: { in: orderIds }, kind: "WASTE", reversal: null },
    select: { warpingOrderId: true, qtyKg: true, createdAt: true, dispatchItem: { select: { yarnItemId: true, lotId: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const issues = ctx.lots ? await ctx.lots.issues(db, consumedBeamIds) : [];
  const lotIds = [...new Set([
    ...wounds.flatMap((w) => w.yarns.flatMap((y) => y.allocations.map((a) => a.dispatchItem.lotId))),
    ...wastes.map((w) => w.dispatchItem.lotId), ...issues.map((i) => i.lotId),
  ].filter((x): x is string => !!x))].sort();
  const lotPrices = ctx.lots && lotIds.length > 0 ? await ctx.lots.prices(db, lotIds) : new Map<string, LotPriceRead>();
  const yarnIds = [...new Set([...wounds.flatMap((w) => w.yarns.map((y) => y.yarnItemId)), ...wastes.flatMap((w) => (w.dispatchItem.yarnItemId ? [w.dispatchItem.yarnItemId] : []))])];
  const cards = yarnIds.length === 0 ? [] : await db.yarnCostPrice.findMany({
    where: { yarnItemId: { in: yarnIds }, unit: YarnPurchaseUnit.KG },
    select: { yarnItemId: true, currency: true, pricePerKg: true, createdAt: true, revokedAt: true },
  });
  const price = pricer(lotPrices, cards, ctx);

  // ① Levent sarım kırılımı: kg, sevk kalemi lot payıyla (fason) ya da WARP_ISSUE lot ağırlığıyla (kendi deveremiz) fiyatlanır.
  const woundPriced = async (beamId: string, inHouse: boolean): Promise<Priced | null> => {
    const w = woundOf.get(beamId);
    if (!w || w.yarns.length === 0) return null;
    const acc = emptyPriced();
    for (const y of w.yarns) {
      const split: Array<{ lotId: string | null; kg: Dec }> = inHouse
        ? issues.filter((i) => i.beamId === beamId && i.yarnItemId === y.yarnItemId).map((i) => ({ lotId: i.lotId, kg: i.kg }))
        : y.allocations.map((a) => ({ lotId: a.dispatchItem.lotId, kg: a.kg }));
      const totalKg = split.reduce((a, s) => a.plus(s.kg), D0());
      if (totalKg.lte(0)) { addPriced(acc, await price(y.yarnItemId, null, y.theoreticalKg, w.createdAt)); continue; }
      for (const s of split) addPriced(acc, await price(y.yarnItemId, s.lotId, y.theoreticalKg.mul(s.kg).div(totalKg), w.createdAt));
    }
    return acc;
  };

  // ② Sipariş firesi TL/çözgü m (siparişin kabul edilen sarım metresine bölünür).
  const wastePerM = new Map<string, Priced & { perM: Dec | null }>();
  for (const orderId of orderIds) {
    const acc = emptyPriced();
    for (const w of wastes.filter((x) => x.warpingOrderId === orderId)) {
      if (!w.dispatchItem.yarnItemId) { acc.amount = null; acc.missing.add("IPLIK_FIYATI"); continue; }
      addPriced(acc, await price(w.dispatchItem.yarnItemId, w.dispatchItem.lotId, w.qtyKg, w.createdAt));
    }
    const lengthM = orderBeams.filter((b) => b.warpingOrderId === orderId).reduce((a, b) => a.plus(woundOf.get(b.id)?.lengthM ?? 0), D0());
    const perM = acc.amount && lengthM.gt(0) ? acc.amount.div(lengthM) : acc.amount && acc.amount.isZero() ? D0() : null;
    wastePerM.set(orderId, { ...acc, perM, estimated: lengthM.gt(0) ? acc.estimated.div(lengthM) : D0() });
  }

  const lengthOf = (beamId: string) => new Prisma.Decimal(woundOf.get(beamId)?.lengthM ?? 0);
  const beamPerM = await beamPerMOf(beams, lengthOf, woundPriced, wastePerM);
  return rollShares(consumed, beamPerM);
}

type BeamPerM = { perM: Dec | null; estPerM: Dec; sources: Set<WarpYarnCostSource>; missing: Set<WarpYarnCostMissing> };
type BeamRow = { id: string; originKind: WarpBeamOrigin; ownerCustomerId: string | null; warpingOrderId: string | null };

/** ③ Levent TL/çözgü m (sarım + fire payı), tahmini kısmı ayrı. */
async function beamPerMOf(
  beams: BeamRow[], lengthOf: (beamId: string) => Dec,
  woundPriced: (beamId: string, inHouse: boolean) => Promise<Priced | null>, wastePerM: Map<string, Priced & { perM: Dec | null }>,
): Promise<Map<string, BeamPerM>> {
  const beamPerM = new Map<string, BeamPerM>();
  for (const b of beams) {
    const r: BeamPerM = { perM: D0(), estPerM: D0(), sources: new Set(), missing: new Set() };
    if (isBoughtOrConsignedBeam(b.originKind)) {
      r.perM = null;
      r.missing.add("LEVENT_KOKENI");
    } else if (b.ownerCustomerId) {
      // Müşteri malı iplik bizim maliyetimiz değildir: pay toplamı bozmaz (0 katkı), bilgi koduyla ayrı söylenir.
      r.missing.add("MUSTERI_IPLIGI");
    } else {
      const p = await woundPriced(b.id, b.originKind !== WarpBeamOrigin.SUBCONTRACT);
      const lengthM = lengthOf(b.id);
      if (!p || lengthM.lte(0)) {
        r.perM = null;
        r.missing.add("IPLIK_FIYATI");
      } else {
        r.perM = p.amount ? p.amount.div(lengthM) : null;
        r.estPerM = p.estimated.div(lengthM);
        p.sources.forEach((s) => r.sources.add(s));
        p.missing.forEach((m) => r.missing.add(m));
      }
      const waste = b.warpingOrderId ? wastePerM.get(b.warpingOrderId) : undefined;
      if (waste) {
        r.perM = r.perM && waste.perM ? r.perM.plus(waste.perM) : null;
        r.estPerM = r.estPerM.plus(waste.estimated);
        waste.sources.forEach((s) => r.sources.add(s));
        waste.missing.forEach((m) => r.missing.add(m));
      }
    }
    beamPerM.set(b.id, r);
  }
  return beamPerM;
}

/** ④ Top payı: tüketim satırı metresi × leventin TL/m'si; bilinmeyen levent payı null (0 değil). */
function rollShares(consumed: Array<{ rollId: string | null; lengthM: Prisma.Decimal | number | null; beamId: string }>, beamPerM: Map<string, BeamPerM>): Map<string, RollWarpYarnCost> {
  const out = new Map<string, RollWarpYarnCost>();
  for (const c of consumed) {
    const acc = out.get(c.rollId!) ?? { costTry: D0(), estimatedTry: D0(), sources: [], missing: [] };
    const bp = beamPerM.get(c.beamId);
    const m = new Prisma.Decimal(c.lengthM ?? 0);
    const line = bp?.perM ? m.mul(bp.perM) : null;
    acc.costTry = acc.costTry && line ? acc.costTry.plus(line) : null;
    if (bp) acc.estimatedTry = acc.estimatedTry.plus(m.mul(bp.estPerM));
    acc.sources = [...new Set([...acc.sources, ...(bp?.sources ?? [])])];
    acc.missing = [...new Set([...acc.missing, ...(bp?.missing ?? (["IPLIK_FIYATI"] as WarpYarnCostMissing[]))])];
    out.set(c.rollId!, acc);
  }
  return out;
}
