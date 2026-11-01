// =============================================================================
// KÂRLILIK — DOĞRUDAN MALİYET: SARF + DIŞ FASON (D4-G2a; DALGA4 §8.3 formül, §8.6 ayarlar)
// =============================================================================
// İş (hizmet bağı) başına sarf = metre × norm (as-of hizmet anı) × sarf birim fiyatı (`sarfFiyatKaynagi`);
// dış fason = onaylı fason faturası × (iş metresi / makbuz metresi), yoksa ayara göre tarife tahmini ya da EKSİK.
// Bilinmeyen değer 0 DEĞİLDİR: `null` + eksik kodu. Tüm aritmetik `Prisma.Decimal`; yuvarlama sunumda.
// `fabric-cost.helper` (standart ürün maliyeti) ile karşılıklı import YASAK (`test_karlilik_cekirdek` §0).
// =============================================================================
import { Currency, Prisma, ServiceMeterBasis } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { ProfitConsumablePriceSource, ProfitSubcontractSource } from "../system-setting.service";
import { consumableNormHistory, isCostRateValidAt } from "./cost-rate-validity.helper";
import { finishingRateValidAt } from "./cost-price-validity.helper";
import { suggestConsumablePurchasePrices } from "./maliyet-bridge.helper";
import type { RevenueLinkRow } from "./profitability-finance.helper";

type FinanceReads = typeof import("./profitability-finance.helper");
const D0 = () => new Prisma.Decimal(0);

/** Eksik kodları — rapor rozeti; değer 0 yazılmaz. */
export type ProfitMissingCode =
  | "SARF_NORMU"
  | "SARF_FIYATI"
  | "FX_RATE_MISSING"
  | "DIS_FASON_FATURASI"
  | "DIS_FASON_TARIFESI"
  | "DIS_FASON_MAKBUZU"
  | "GELIR_SATIRI";

export interface WorkCost {
  consumableTry: Prisma.Decimal | null;
  subcontractTry: Prisma.Decimal | null;
  /** Dış fason faturası yok, tarife × metre tahmini (FATURA_ONCE). */
  subcontractEstimated: boolean;
  missing: ProfitMissingCode[];
}

export interface CostContext {
  consumablePriceSource: ProfitConsumablePriceSource;
  subcontractSource: ProfitSubcontractSource;
  finance: FinanceReads;
}

/** Kur önbelleği: (döviz, an) → TL; finansın tek çözücüsü. */
function fxCache(finance: FinanceReads) {
  const memo = new Map<string, Promise<Prisma.Decimal | null>>();
  return (currency: Currency, at: Date) => {
    if (currency === Currency.TRY) return Promise.resolve(new Prisma.Decimal(1));
    const k = `${currency}:${at.getTime()}`;
    if (!memo.has(k)) memo.set(k, finance.readFxRate(currency, at));
    return memo.get(k)!;
  };
}

/** Sarf birim TL çözücüsü — ayara göre kart alış fiyatı (as-of) ya da o güne kadarki son onaylı alış faturası. */
async function consumablePriceResolver(ctx: CostContext, consumableIds: string[], fx: ReturnType<typeof fxCache>) {
  const lines = ctx.consumablePriceSource === "SON_ALIS_FATURASI" ? await ctx.finance.readConsumablePurchaseLines(consumableIds) : [];
  const listMemo = new Map<number, Promise<Map<string, { price: Prisma.Decimal; currency: Currency }> | null>>();
  return async (itemId: string, at: Date): Promise<{ unitTry: Prisma.Decimal } | { missing: ProfitMissingCode }> => {
    if (ctx.consumablePriceSource === "SON_ALIS_FATURASI") {
      const last = lines.filter((l) => l.itemId === itemId && l.issueDate.getTime() <= at.getTime()).at(-1);
      return last ? { unitTry: last.unitTry } : { missing: "SARF_FIYATI" };
    }
    if (!listMemo.has(at.getTime())) listMemo.set(at.getTime(), suggestConsumablePurchasePrices(consumableIds, at));
    const hit = (await listMemo.get(at.getTime())!)?.get(itemId);
    if (!hit) return { missing: "SARF_FIYATI" };
    const rate = await fx(hit.currency, at);
    return rate ? { unitTry: hit.price.mul(rate) } : { missing: "FX_RATE_MISSING" };
  };
}

type ReceiptInfo = { id: string; stepId: string | null; subcontractorId: string; receivedAt: Date; meters: Prisma.Decimal };

/** RECEIVED işlerin makbuzu: doğan top (`parentReceiptId`) ya da makbuzdan kendisi dönen top; adım bağın adımıyla eşleşir. */
async function loadReceipts(links: RevenueLinkRow[]): Promise<Map<string, ReceiptInfo>> {
  const received = links.filter((l) => l.meterBasis === ServiceMeterBasis.RECEIVED);
  const out = new Map<string, ReceiptInfo>();
  if (received.length === 0) return out;
  const rollIds = [...new Set(received.map((l) => l.rollId))];
  const rolls = await prisma.roll.findMany({ where: { id: { in: rollIds } }, select: { id: true, parentReceiptId: true } });
  const items = await prisma.subcontractorReceiptItem.findMany({ where: { newRollId: { in: rollIds } }, select: { newRollId: true, receiptId: true } });
  const receiptIds = [...new Set([...rolls.map((r) => r.parentReceiptId), ...items.map((i) => i.receiptId)].filter((v): v is string => v !== null))];
  const receipts = await prisma.subcontractorReceipt.findMany({
    where: { id: { in: receiptIds }, cancelledAt: null },
    select: {
      id: true, stepId: true, subcontractorId: true, receivedAt: true,
      bornRolls: { select: { initialQty: true, currentQty: true } },
      items: { select: { newRollId: true, receivedQty: true, newRoll: { select: { initialQty: true, currentQty: true } } } },
    },
  });
  // Payda DONMUŞ metreden: kesim/sevkle oynayan currentQty geçmiş ayı değiştirmesin (yalnız eski initialQty=0 verisi).
  const frozen = (r: { initialQty: Prisma.Decimal; currentQty: Prisma.Decimal }) => (r.initialQty.gt(0) ? r.initialQty : r.currentQty);
  const info = new Map<string, ReceiptInfo>(receipts.map((r) => {
    // Makbuz metresi: doğan toplar (kabul metresi), yoksa kalemlerin alınan metresi; NULL kalem = topun kendisi,
    // aynı top BİR kez (K3b; service-flag-work.helper receivedOf ile aynı kural).
    let meters = D0();
    if (r.bornRolls.length > 0) meters = r.bornRolls.reduce((a, b) => a.plus(frozen(b)), D0());
    else {
      const nullCounted = new Set<string>();
      for (const i of r.items) {
        if (i.receivedQty !== null) meters = meters.plus(i.receivedQty);
        else if (!nullCounted.has(i.newRollId)) { nullCounted.add(i.newRollId); meters = meters.plus(frozen(i.newRoll)); }
      }
    }
    return [r.id, { id: r.id, stepId: r.stepId, subcontractorId: r.subcontractorId, receivedAt: r.receivedAt, meters }];
  }));
  for (const l of received) {
    const own = [rolls.find((r) => r.id === l.rollId)?.parentReceiptId, ...items.filter((i) => i.newRollId === l.rollId).map((i) => i.receiptId)];
    const hit = own.map((id) => (id ? info.get(id) : undefined)).find((r) => r && r.stepId === l.workOrderStepId);
    if (hit) out.set(l.id, hit);
  }
  return out;
}

/** Bağ başına sarf + dış fason maliyeti. Aynı bağ hem fatura hem iptal satırında AYNI değeri taşır (ters = eksi). */
export async function computeWorkCosts(ctx: CostContext, links: RevenueLinkRow[]): Promise<Map<string, WorkCost>> {
  const out = new Map<string, WorkCost>();
  const fx = fxCache(ctx.finance);
  const norms = await consumableNormHistory(prisma, [...new Set(links.map((l) => l.serviceItemId))]);
  const priceOf = await consumablePriceResolver(ctx, [...new Set(norms.map((n) => n.consumableItemId))], fx);
  const receipts = await loadReceipts(links);
  const invoiceTotals = await ctx.finance.readSubcontractInvoiceTotals([...new Set([...receipts.values()].map((r) => r.id))]);
  const rateMemo = new Map<string, Promise<Array<{ pricePerM: Prisma.Decimal; currency: Currency; basis: string }>>>();

  for (const l of links) {
    const missing: ProfitMissingCode[] = [];
    // ── Sarf: hizmet anında geçerli normlar (sarf kalemi başına tek sürüm) ──
    const valid = norms.filter((n) => n.serviceItemId === l.serviceItemId && isCostRateValidAt(n, l.serviceAt));
    let consumableTry: Prisma.Decimal | null = D0();
    if (valid.length === 0) { missing.push("SARF_NORMU"); consumableTry = null; }
    for (const n of valid) {
      const p = await priceOf(n.consumableItemId, l.serviceAt);
      if ("missing" in p) { if (!missing.includes(p.missing)) missing.push(p.missing); consumableTry = null; continue; }
      if (consumableTry) consumableTry = consumableTry.plus(l.billedMeters.mul(n.qtyPerM).mul(p.unitTry));
    }
    // ── Dış fason: yalnız fason kabulünden doğan iş (RECEIVED) ──
    let subcontractTry: Prisma.Decimal | null = D0();
    let subcontractEstimated = false;
    const rc = l.meterBasis === ServiceMeterBasis.RECEIVED ? receipts.get(l.id) : undefined;
    // RECEIVED iş ama makbuz çözülemedi (iptal / adım uyuşmaz) → maliyet sessizce 0 OLMAZ.
    if (l.meterBasis === ServiceMeterBasis.RECEIVED && !rc) { subcontractTry = null; missing.push("DIS_FASON_MAKBUZU"); }
    if (rc) {
      const billed = invoiceTotals.get(rc.id);
      if (billed && rc.meters.gt(0)) subcontractTry = billed.mul(l.billedMeters).div(rc.meters);
      else if (ctx.subcontractSource === "YALNIZ_FATURA") { subcontractTry = null; missing.push("DIS_FASON_FATURASI"); }
      else {
        const key = `${rc.subcontractorId}:${rc.receivedAt.getTime()}`;
        if (!rateMemo.has(key)) rateMemo.set(key, prisma.finishingRate.findMany({
          where: { AND: [{ subcontractorId: rc.subcontractorId }, finishingRateValidAt(rc.receivedAt)] },
          select: { pricePerM: true, currency: true, basis: true },
        }));
        const rates = await rateMemo.get(key)!;
        // Firmanın o gün tek geçerli tarifesi varsa tahmin; yoksa (hiç ya da hangisi belirsiz) eksik.
        const fxRate = rates.length === 1 ? await fx(rates[0]!.currency, rc.receivedAt) : null;
        // KG tarifesi metreyle çarpılamaz (sevk kilosu SY-E2'de) → tahmin yok, eksik (fail-closed).
        if (rates.length !== 1 || rates[0]!.basis === "KG") { subcontractTry = null; missing.push("DIS_FASON_TARIFESI"); }
        else if (!fxRate) { subcontractTry = null; if (!missing.includes("FX_RATE_MISSING")) missing.push("FX_RATE_MISSING"); }
        else { subcontractTry = rates[0]!.pricePerM.mul(l.billedMeters).mul(fxRate); subcontractEstimated = true; }
      }
    }
    out.set(l.id, { consumableTry, subcontractTry, subcontractEstimated, missing });
  }
  return out;
}
