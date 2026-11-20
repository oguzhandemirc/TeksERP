// Devere ücretinin fasoncu tarifesinden önerilmesi — saf katman. Tarifede "devere" türü yok: devereci zaten DEVERE
// kategorili firma, adaylar onun AKTİF tarifeleri. Birim eşlemesi RAW_M→METRE, KG→KG; FINISHED_M ve tel×metre eşleşmez.
import type { FinishingBasis, FinishingRate } from "@/pages/Cost/FinishingRates/service";
import { FINISHING_BASIS_LABEL } from "@/pages/Cost/FinishingRates/service";
import type { WarpingOrderFormState } from "./order-model";
import { trimNum } from "./order-model";
import { fmtDecFull } from "@/pages/Cost/shared/format";
import type { WarpingFeeUnit } from "./types";

export type FeeFields = Pick<WarpingOrderFormState, "feeUnit" | "feeUnitPrice" | "feeCurrency">;

const BASIS_TO_FEE_UNIT: Record<FinishingBasis, WarpingFeeUnit | null> = { RAW_M: "METRE", KG: "KG", FINISHED_M: null };

export function feeUnitOfBasis(b: FinishingBasis): WarpingFeeUnit | null {
  return BASIS_TO_FEE_UNIT[b] ?? null;
}

/** Birimi devere ücretine eşlenen aktif tarifeler. */
export function usableRates(rates: FinishingRate[]): FinishingRate[] {
  return rates.filter((r) => r.revokedAt === null && feeUnitOfBasis(r.basis) !== null);
}

/** Öneri: formdaki birimle eşleşen en yeni tarife, yoksa en yeni kullanılabilir tarife. */
export function pickRate(rates: FinishingRate[], unit: WarpingFeeUnit): FinishingRate | null {
  const usable = [...usableRates(rates)].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return usable.find((r) => feeUnitOfBasis(r.basis) === unit) ?? usable[0] ?? null;
}

/** Sunucu Decimal'ı metin ya da sayı gelebilir (JSON serileştirmesi) — String() ile kabul edilir. */
export function feeFromRate(r: FinishingRate): FeeFields {
  return { feeUnit: feeUnitOfBasis(r.basis) ?? "METRE", feeUnitPrice: trimNum(String(r.pricePerM)), feeCurrency: r.currency };
}

/** Form tarifenin verdiği değerlerden farklı mı (fiyat sayısal karşılaştırılır: "0.10" = "0.1"). */
export function feeDiffersFromRate(f: FeeFields, r: FinishingRate): boolean {
  const want = feeFromRate(r);
  const a = Number(f.feeUnitPrice.trim().replace(",", "."));
  const b = Number(want.feeUnitPrice);
  return f.feeUnit !== want.feeUnit || f.feeCurrency !== want.feeCurrency || f.feeUnitPrice.trim() === "" || a !== b;
}

export function rateLabel(r: FinishingRate): string {
  const unit = feeUnitOfBasis(r.basis) === "KG" ? "kg" : "m";
  return `${fmtDecFull(r.pricePerM)} ${r.currency}/${unit}`;
}

export function basisLabel(b: FinishingBasis): string {
  return FINISHING_BASIS_LABEL[b];
}
