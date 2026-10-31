// =============================================================================
// KUMAŞ MALİYETİ — SUNUM + TEKLİF FİYAT ÖNERİSİ (MAL-2; motordan ayrıldı SY-B1, dosya boyu)
// =============================================================================
// Tek yuvarlama noktası burasıdır; motor (`fabric-cost.helper`) yuvarlamaz ve bu dosyayı yeniden
// dışa aktarır — tüketici importları değişmez.
// =============================================================================
import { Prisma } from "@prisma/client";
import type { CostResult } from "./fabric-cost.helper";

type Dec = Prisma.Decimal;
const ONE = new Prisma.Decimal(1);
const HUNDRED = new Prisma.Decimal(100);
const ZERO = new Prisma.Decimal(0);
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
const pct = (v: Dec): Dec => v.div(HUNDRED);

/**
 * Teklif fiyatı önerisi (plan §2.2): P_TL = C × (1 + m) × (1 + vade) / (1 − komisyon); öneri = P_TL / r + navlun.
 * Kur yoksa ya da ≤ 0 → null (1 VARSAYILMAZ). 4 hane; kullanıcı 2 haneye kesinleştirir.
 */
export function suggestUnitPrice(p: {
  costPerMTry: Dec; markupPct: Dec; fxRate: Dec | null; freightPerM?: Dec | null; financeChargePct?: Dec | null; commissionPct?: Dec | null;
}): Dec | null {
  if (!p.fxRate || !p.fxRate.gt(0)) return null;
  let tl = p.costPerMTry.mul(ONE.plus(pct(p.markupPct)));
  if (p.financeChargePct) tl = tl.mul(ONE.plus(pct(p.financeChargePct)));
  if (p.commissionPct) tl = tl.div(ONE.minus(pct(p.commissionPct)));
  return tl.div(p.fxRate).plus(p.freightPerM ?? ZERO).toDecimalPlaces(4, HALF_UP);
}

/** SUNUM — tek yuvarlama noktası: TL/m 4, kg/m 6, m/sa 4 hane; tel anahtarları Türkçe. */
const r4 = (v: Dec): string => v.toDecimalPlaces(4, HALF_UP).toFixed(4);
const r6 = (v: Dec): string => v.toDecimalPlaces(6, HALF_UP).toFixed(6);
export function presentCostResult(r: CostResult) {
  return {
    satirlar: r.lines.map((l, i) => ({
      sira: i + 1,
      bilesen: l.component,
      etiket: l.label,
      iplikId: l.yarnItemId,
      miktar: l.qty === null ? null : l.qtyUnit === "kg" ? r6(l.qty) : l.qty.toString(),
      birim: l.qtyUnit,
      birimFiyatTl: l.unitPriceTry === null ? null : r4(l.unitPriceTry),
      tutarTlM: r4(l.amountPerMTry),
    })),
    cozguKgM: r6(r.warpKgPerM),
    atkiKgM: r6(r.weftKgPerM),
    tezgahMSaat: r4(r.loomMPerHour),
    hamTlM: r4(r.rawCostPerMTry),
    mamulTlM: r.finishedCostPerMTry === null ? null : r4(r.finishedCostPerMTry),
    saglamTlM: r4(r.soundCostPerMTry),
    genelGiderTlM: r4(r.overheadPerMTry),
    standartTlM: r4(r.totalCostPerMTry),
  };
}
export const roundCost4 = (v: Dec): Dec => v.toDecimalPlaces(4, HALF_UP);
export const roundKg6 = (v: Dec): Dec => v.toDecimalPlaces(6, HALF_UP);
