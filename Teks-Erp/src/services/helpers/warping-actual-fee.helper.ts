// =============================================================================
// DEVERE GERÇEK MALİYETİ — TOP PAYI (devere maliyet dilim 1; plan PLAN-devere-maliyet-1126 §2.2)
// =============================================================================
// Yeni defter yok, saklanmaz: üç var olan kaynaktan OKUMA ANINDA türer — fatura bağı (pivot) · leventin WOUND'u ·
// topun iptal edilmemiş CONSUMED satırı. Kabul TL'si: onaylı fatura neti × belge kuru (fatura çok kabul kapsıyorsa
// beklenen tutar payıyla, karşılaştırılamazsa sarım metresiyle; son kabul kalanı alır), fatura yoksa siparişin donuk
// ücretinden beklenen × kabul günü kuru ("tahmini"). Beklenen ve "kabul edilen sarım" `loadWarpingOrderFeesTx`ten
// (ücret çarpımı burada YAZILMAZ). Yalnız `maliyet-bridge.helper` dinamik import eder; bilinmeyen değer 0 DEĞİL, null.
// =============================================================================
import { Prisma, WarpBeamOrigin, type Currency } from "@prisma/client";
import prisma from "../../lib/prisma";
import { loadWarpingOrderFeesTx, type WarpingReceiptFee } from "./warping-fee.helper";

type Dec = Prisma.Decimal;
type Db = Prisma.TransactionClient | typeof prisma;
const D0 = () => new Prisma.Decimal(0);

export type WarpingCostSource = "FATURA" | "TARIFE";
export type WarpingCostMissing = "DEVERE_UCRETI" | "DEVERE_FATURASI" | "LEVENT_KOKENI" | "FX_RATE_MISSING";

export interface WarpingReceiptInvoiceRead { invoiceId: string; netTry: Dec; receiptKeys: string[] }

export interface WarpingActualFeeCtx {
  /** Finans kapalıysa null — bütün kabuller tahmine döner. */
  readInvoices: ((db: Db, receiptKeys: string[]) => Promise<WarpingReceiptInvoiceRead[]>) | null;
  fxRate: (currency: Currency, at: Date) => Promise<Dec | null>;
  reworkBillable: boolean;
  /** `maliyet.karlilik.disFasonKaynagi = YALNIZ_FATURA`: faturasız kabul tahmin edilmez, eksik yazılır. */
  invoiceOnly: boolean;
}

export interface RollWarpingCost {
  /** Σ tüketim satırı payı (TL); bir satır bilinmiyorsa null (kısmi toplam 0 sayılmaz). */
  costTry: Dec | null;
  /** Payın tahmini (fatura yok/taslak/iptal) kısmı, TL. */
  estimatedTry: Dec;
  sources: WarpingCostSource[];
  missing: WarpingCostMissing[];
}

type ReceiptTry = { amountTry: Dec | null; source: WarpingCostSource | null; missing: WarpingCostMissing | null };

/** Fatura netini kapsadığı kabullere böler (K8): beklenen tutar payı, karşılaştırılamazsa sarım metresi; son kabul kalanı alır. */
export function splitInvoiceNet(netTry: Dec, receipts: Array<Pick<WarpingReceiptFee, "receiptKey" | "expectedAmount" | "lengthM"> & { currency: Currency | null }>): Map<string, Dec> {
  const out = new Map<string, Dec>();
  if (receipts.length === 0) return out;
  const currencies = new Set(receipts.map((r) => r.currency));
  const byExpected = receipts.every((r) => r.expectedAmount !== null) && currencies.size === 1;
  let weights = receipts.map((r) => (byExpected ? r.expectedAmount! : r.lengthM));
  let total = weights.reduce((a, w) => a.plus(w), D0());
  if (total.lte(0)) {
    weights = receipts.map((r) => r.lengthM);
    total = weights.reduce((a, w) => a.plus(w), D0());
  }
  let given = D0();
  receipts.forEach((r, i) => {
    const last = i === receipts.length - 1;
    const share = last ? netTry.minus(given) : total.gt(0) ? netTry.mul(weights[i]!).div(total).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : D0();
    given = given.plus(share);
    out.set(r.receiptKey, share);
  });
  return out;
}

/** Topların devere payı. Haritada YALNIZ iptal edilmemiş tüketim satırı (CONSUMED + rollId) olan top bulunur. */
export async function loadRollWarpingCostsTx(db: Db, rollIds: string[], ctx: WarpingActualFeeCtx): Promise<Map<string, RollWarpingCost>> {
  const out = new Map<string, RollWarpingCost>();
  if (rollIds.length === 0) return out;
  const consumed = await db.warpBeamEvent.findMany({
    where: { rollId: { in: rollIds }, kind: "CONSUMED", reversal: null },
    select: { id: true, rollId: true, lengthM: true, beamId: true, beam: { select: { originKind: true, ownerCustomerId: true, warpingOrderId: true, warpingReceiptKey: true } } },
    orderBy: { id: "asc" },
  });
  if (consumed.length === 0) return out;

  // ① Faturalar önce: faturanın öteki kabulleri de paylaştırmaya girer → beklenen o birleşim için okunur.
  const keys0 = [...new Set(consumed.flatMap((c) => (c.beam.warpingOrderId && c.beam.warpingReceiptKey ? [c.beam.warpingReceiptKey] : [])))].sort();
  const invoices = ctx.readInvoices && keys0.length > 0 ? await ctx.readInvoices(db, keys0) : [];
  const allKeys = [...new Set([...keys0, ...invoices.flatMap((i) => i.receiptKeys)])].sort();
  const fees = allKeys.length === 0 ? [] : await loadWarpingOrderFeesTx(db, { receiptKeys: allKeys }, { reworkBillable: ctx.reworkBillable });
  const receiptOf = new Map<string, WarpingReceiptFee & { currency: Currency | null }>();
  for (const o of fees) for (const r of o.receipts) receiptOf.set(r.receiptKey, { ...r, currency: o.feeCurrency });

  // ② Kabul TL'si.
  const invoiced = new Map<string, Dec>();
  for (const inv of invoices) {
    const rs = inv.receiptKeys.map((k) => receiptOf.get(k)).filter((r): r is NonNullable<typeof r> => !!r);
    for (const [k, v] of splitInvoiceNet(inv.netTry, rs)) invoiced.set(k, v);
  }
  const receiptTry = new Map<string, ReceiptTry>();
  for (const key of keys0) {
    const r = receiptOf.get(key);
    const inv = invoiced.get(key);
    if (inv !== undefined) receiptTry.set(key, { amountTry: inv, source: "FATURA", missing: null });
    else if (ctx.invoiceOnly) receiptTry.set(key, { amountTry: null, source: null, missing: "DEVERE_FATURASI" });
    else if (!r || r.expectedAmount === null || r.currency === null) receiptTry.set(key, { amountTry: null, source: null, missing: "DEVERE_UCRETI" });
    else {
      const rate = await ctx.fxRate(r.currency, r.receivedAt);
      receiptTry.set(key, rate ? { amountTry: r.expectedAmount.mul(rate), source: "TARIFE", missing: null } : { amountTry: null, source: null, missing: "FX_RATE_MISSING" });
    }
  }
  const beamOf = new Map<string, { receiptKey: string; lengthM: Dec; qty: Dec; receiptQty: Dec }>();
  for (const r of receiptOf.values()) for (const b of r.beams) beamOf.set(b.beamId, { receiptKey: r.receiptKey, lengthM: b.lengthM, qty: b.qty, receiptQty: r.qty });

  // ③ Satır payı = tüketilen çözgü m × kabul TL × (levent ölçüsü ÷ kabul ölçüsü) ÷ leventin sarım metresi.
  for (const c of consumed) {
    const acc = out.get(c.rollId!) ?? { costTry: D0(), estimatedTry: D0(), sources: [], missing: [] };
    let line: Dec | null = D0();
    const consumedM = new Prisma.Decimal(c.lengthM ?? 0);
    const b = c.beam;
    // Köken `originKind`ten: `ownerCustomerId` mülkiyet eksenidir, devere kabulü onu müşteri ipliği lotundan kalıtır —
    // o leventin devere faturası yine bize kesilir, "emanet levent" sayılmaz.
    if (b.originKind === WarpBeamOrigin.PURCHASED || b.originKind === WarpBeamOrigin.CONSIGNED) {
      line = null;
      acc.missing.push("LEVENT_KOKENI");
    } else if (b.originKind === WarpBeamOrigin.SUBCONTRACT) {
      const beam = beamOf.get(c.beamId);
      const rt = b.warpingReceiptKey ? receiptTry.get(b.warpingReceiptKey) : undefined;
      if (!b.warpingOrderId || !rt) {
        line = null;
        acc.missing.push("DEVERE_UCRETI");
      } else if (!beam || beam.qty.isZero() || beam.receiptQty.isZero()) {
        line = D0(); // reddedilmiş ya da bedelsiz yeniden sarım: ölçülmüş 0
      } else if (rt.amountTry === null || beam.lengthM.lte(0)) {
        line = null;
        acc.missing.push(rt.missing ?? "DEVERE_UCRETI");
      } else {
        line = consumedM.mul(rt.amountTry).mul(beam.qty).div(beam.receiptQty.mul(beam.lengthM));
        acc.sources.push(rt.source!);
        if (rt.source === "TARIFE") acc.estimatedTry = acc.estimatedTry.plus(line);
      }
    }
    // IN_HOUSE: dış devere hizmeti yok → ölçülmüş 0 (kendi makinemizin maliyeti bu hesabın dışında).
    acc.costTry = acc.costTry && line ? acc.costTry.plus(line) : null;
    acc.sources = [...new Set(acc.sources)];
    acc.missing = [...new Set(acc.missing)];
    out.set(c.rollId!, acc);
  }
  return out;
}
