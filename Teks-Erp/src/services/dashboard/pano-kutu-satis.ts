// =============================================================================
// AÇILIŞ PANOSU — satış kutuları: ciro · tahsilat · en çok müşteri
// =============================================================================
// Ciro = dönemde SEVK edilen malın tutarı (sevk günü sipariş fiyatı × tahsis metresi) — semantik
// `sevk.tutar` ölçüsünün ve Yurtiçi/Yurtdışı Satış'ın kaynağı `_destination-mix-money`; fatura değil.
// Para birimleri TOPLANMAZ; fiyatsız satır 0 sayılmaz, sayısı söylenir. Tahsilat Kasa-Banka
// Defteri'nin hareket evreninden (`collectCashFlow`), carili tahsilat net (iptal ters kaydı düşer).
// =============================================================================
import { Prisma } from "@prisma/client";
import { aggregateMoney, collectMoneyRows } from "../reports/_destination-mix-money";
import { collectCashFlow, type CashFlowRow } from "../reports/cash-book.report";
import { changePct, bucketKeySql } from "./pano-donem";
import { PANO_TOP_N, type PanoSources } from "./pano-kaynak";
import { round1 } from "../reports/_breakdown";
import type { BoxInput } from "./pano-kutu-mevcut";

export interface PanoParaKpi { paraBirimi: string; deger: number; onceki: number; degisimYuzde: number | null }

const cents = (v: number): number => Math.round(v * 100) / 100;

/** Para birimi başına kıyas: iki dönemin birleşik para birimi kümesi, alfabetik. */
export function moneyKpis(cur: Map<string, number>, prev: Map<string, number>): PanoParaKpi[] {
  return [...new Set([...cur.keys(), ...prev.keys()])].sort().map((c) => {
    const d = cur.get(c) ?? 0;
    const p = prev.get(c) ?? 0;
    return { paraBirimi: c, deger: cents(d), onceki: cents(p), degisimYuzde: changePct(d, p) };
  });
}

export async function revenueBox({ src }: BoxInput) {
  const [cur, prev] = await Promise.all([
    src.once("moneyCur", () => collectMoneyRows(src.window.aralik)),
    src.once("moneyPrev", () => collectMoneyRows(src.window.oncekiAralik)),
  ]);
  const c = aggregateMoney(cur);
  const p = aggregateMoney(prev);
  return {
    tutarlar: moneyKpis(new Map(c.amounts.map((a) => [a.currency, a.amount])), new Map(p.amounts.map((a) => [a.currency, a.amount]))),
    fiyatsizSatir: c.lineCount - c.pricedLineCount,
  };
}

// ── kasa/banka hareketi (tahsilat + nakit akışı ortak kaynağı) ───────────────

export function cashFlowCur(src: PanoSources): Promise<CashFlowRow[]> {
  return src.once("cashCur", () => collectCashFlow(src.window.aralik, bucketKeySql(src.window.kova, "mv.dt")));
}

function cashFlowPrev(src: PanoSources): Promise<CashFlowRow[]> {
  return src.once("cashPrev", () => collectCashFlow(src.window.oncekiAralik, bucketKeySql(src.window.kova, "mv.dt")));
}

/** Carili tahsilat (net): tahsilat girişi − tahsilat iptalinin ters (çıkış) satırı; para birimi başına. */
function netCollections(rows: readonly CashFlowRow[]): Map<string, number> {
  const out = new Map<string, Prisma.Decimal>();
  for (const r of rows) {
    const sign = r.source === "PAYMENT" && r.direction === "IN" ? 1 : r.source === "PAYMENT_CANCEL" && r.direction === "OUT" ? -1 : 0;
    if (sign === 0) continue;
    out.set(r.currency, (out.get(r.currency) ?? new Prisma.Decimal(0)).add(new Prisma.Decimal(r.amount).mul(sign)));
  }
  return new Map([...out].map(([c, v]) => [c, v.toNumber()]));
}

export async function collectionBox({ src }: BoxInput) {
  const [cur, prev] = await Promise.all([cashFlowCur(src), cashFlowPrev(src)]);
  return { tutarlar: moneyKpis(netCollections(cur), netCollections(prev)) };
}

// ── en çok sipariş veren / sevk edilen müşteri ───────────────────────────────

export async function topCustomersBox({ src, can }: BoxInput) {
  const [intake, shipped] = await Promise.all([can.siparis ? src.intake() : null, can.sevk ? src.shippedCustomers() : null]);
  return {
    siparis: intake
      ? [...intake.byCustomer]
          .filter((r) => r.qty > 0 || r.count > 0)
          .sort((a, b) => b.qty - a.qty || a.label.localeCompare(b.label, "tr"))
          .slice(0, PANO_TOP_N)
          .map((r) => ({ musteriId: r.key, ad: r.label, siparisAdet: r.count, metre: round1(r.qty) }))
      : null,
    sevk: shipped ? shipped.map((r) => ({ musteriId: r.customerId, ad: r.name ?? "", metre: round1(Number(r.qty ?? 0)) })) : null,
  };
}
