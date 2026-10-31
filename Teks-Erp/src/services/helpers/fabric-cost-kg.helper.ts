// =============================================================================
// KG TABANLI TARİFE ÇEVİRİSİ (Seyitoğlu SY-E1, tasarım §6.5) — kumaş maliyet motorunun parçası
// =============================================================================
// Boyahane kilo başına faturalar; motor tarifeyi ham metre başı TL'ye çevirir: birim × kg/m. kg/m
// motorun KENDİ ara değerinden gelir (yeni formül yok): NET_HAM = take-up'lı, firesiz çözgü + atkı ·
// IPLIK_TUKETIMI = fireli `warpKgPerM + weftKgPerM` (Excel uyumu). Saf, DB'siz; `number` yok.
// =============================================================================
import type { Prisma } from "@prisma/client";
import type { CostLine, CostRate } from "./fabric-cost.helper";

type Dec = Prisma.Decimal;

/** `maliyet.terbiyeKgTabani` değer kümesi — ayar okuyucusu ve fotoğraf şeması buradan okur. */
export const FINISHING_KG_BASES = ["NET_HAM", "IPLIK_TUKETIMI"] as const;
export type FinishingKgBasis = (typeof FINISHING_KG_BASES)[number];

/** Motorun ham metre başı iplik kg'ı: `kg` fireli, `net` firesiz (ikisi de take-up'lı). */
export interface FabricKg { warp: { kg: Dec; net: Dec }; weft: { perYarn: Array<{ kg: Dec; net: Dec }> } }

function kgPerRawM(kg: FabricKg, base: FinishingKgBasis | undefined): Dec {
  const pick = (x: { kg: Dec; net: Dec }) => (base === "IPLIK_TUKETIMI" ? x.kg : x.net);
  return kg.weft.perYarn.reduce((a, x) => a.plus(pick(x)), pick(kg.warp));
}

/** Tarifenin metre başı TL'si + satır künyesi; metre tabanı aynen (bugünkü satır), KG ham metreye çevrilir. */
export function ratePerM(rate: CostRate, unitTry: Dec, kg: FabricKg): { amount: Dec; extra: Partial<CostLine> } {
  if (rate.basis !== "KG") return { amount: unitTry, extra: { unitPriceTry: unitTry, qtyUnit: "m" } };
  const q = kgPerRawM(kg, rate.kgBase);
  return { amount: unitTry.mul(q), extra: { qty: q, qtyUnit: "kg", unitPriceTry: unitTry } };
}
