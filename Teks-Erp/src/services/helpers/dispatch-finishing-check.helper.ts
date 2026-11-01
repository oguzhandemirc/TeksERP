// =============================================================================
// FASON SEVK KG KONTROLÜ — saf hesap (SY-E2, tasarım §6.5 "isteğe bağlı kontrol")
// =============================================================================
// Boyahane kilo başına faturalar; sevk kaleminde tartılmış kg (`dispatchedWeight`) zaten var.
// Bilgi satırı: beklenen tutar = Σ kg × SEVK TARİHİNDE geçerli KG tarifesi (kullanıcı kararı 2026-11-01,
// #377; tarih seçimi yalnız `pickFinishingRateAtDispatch`te). YALNIZ OKUMA — hiçbir şey yazmaz.
// Satır üretilemiyorsa `line: null` + sebep döner; ASLA 0 tutar uydurulmaz (tarife yok ≠ bedava).
// Fatura farkı yalnız fatura(lar) bu sevke ÖZGÜ, sevkin TÜM kumaş toplarını kapsıyor ve para birimi aynıysa hesaplanır.
// =============================================================================
import { Prisma, type Currency, type FinishingBasis } from "@prisma/client";
import { factoryDayEnd, factoryYmd } from "../../constants/time";
import { isCostPriceValidAt } from "./cost-price-validity.helper";

/** Satır üretilmeme sebebi — panel bunları göstermez (satır yok), API okuyucusu için açıklayıcı. */
export type FinishingCheckSkipReason =
  | "DISPATCH_CANCELLED" // sevk iptal edilmiş
  | "NO_FABRIC_ITEMS" // sevkte kumaş topu yok (levent/iplik fasonu)
  | "NO_RATE_CODE" // ürün/varyantta terbiye tarife kodu yok
  | "AMBIGUOUS_RATE_CODE" // iş emrinin satırları farklı tarife kodlarına çözülüyor
  | "RATE_NOT_FOUND" // kodun aktif tarifesi yok
  | "NOT_KG_BASIS" // tarife metre tabanlı
  | "OTHER_SUBCONTRACTOR" // tarife başka fason firmaya ait
  | "NO_WEIGHT"; // hiçbir topun sevk kg'ı yok

export interface FinishingCheckRate {
  code: string;
  name: string;
  basis: FinishingBasis;
  currency: Currency;
  pricePerM: Prisma.Decimal;
  subcontractorId: string | null;
}

/** Sevk tarihindeki tarife seçimi: hangi fabrika günü ve tarihli sürüm bulunamadığı için ilk sürüme mi düşüldü. */
export interface FinishingRateAsOf {
  /** Sevkin FABRİKA günü, `YYYY-MM-DD`. */
  day: string;
  /** Sevk gününde geçerli sürüm yok (tarife sevkten sonra girilmiş) → kodun ilk sürümü kullanıldı. */
  fallback: boolean;
}

interface RateVersion { id: string; createdAt: Date; revokedAt: Date | null }

/**
 * TEK KAYNAK — fason fatura karşılaştırmasının tarife sürümü: sevkin fabrika gününün SON anında geçerli sürüm
 * (fatura gün bazlıdır; aynı gün sonradan girilen tarife sayılır). O gün geçerli sürüm yoksa (tarife sevkten
 * sonra girilmiş, tarihli geçmiş yok) kodun sevkten sonraki İLK sürümü — tek aktif tarifede sonuç eskisiyle aynı.
 */
export function pickFinishingRateAtDispatch<T extends RateVersion>(versions: T[], dispatchedAt: Date): { rate: T; asOf: FinishingRateAsOf } | null {
  const at = factoryDayEnd(dispatchedAt);
  const day = factoryYmd(dispatchedAt);
  const byAge = [...versions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const valid = byAge.filter((v) => isCostPriceValidAt(v, at));
  if (valid.length) return { rate: valid[valid.length - 1], asOf: { day, fallback: false } };
  const later = byAge.find((v) => v.createdAt.getTime() > at.getTime());
  return later ? { rate: later, asOf: { day, fallback: true } } : null;
}

export interface FinishingCheckInvoice {
  docNo: string;
  status: "DRAFT" | "CONFIRMED";
  currency: Currency;
  /** KDV hariç net = subtotal − discountTotal. */
  net: Prisma.Decimal;
}

export interface FinishingCheckInput {
  subcontractorId: string;
  /** Sevk iptal edilmiş mi (`cancelledAt` dolu). */
  cancelled?: boolean;
  /** Sevkteki kumaş topu kalemlerinin kg'ı (null = tartılmamış). */
  fabricWeights: (Prisma.Decimal | null)[];
  /** Her bağlı sipariş satırı/ürün için çözülmüş tarife kodu (`resolveFinishingRateCode` çıktıları). */
  rateCodes: (string | null)[];
  rate: FinishingCheckRate | null;
  /** `pickFinishingRateAtDispatch` çıktısı; eski çağıran vermezse alanlar null/false döner. */
  rateAsOf?: FinishingRateAsOf | null;
  invoices: FinishingCheckInvoice[];
  /** Faturalanan fason kabul(ler)i başka sevklerin toplarını da içeriyor mu. */
  invoicesCoverOtherDispatches: boolean;
  /** Faturalanan kabul(ler) sevkin TÜM kumaş topu kalemlerini kapsıyor mu (kısmi kabulde fark uydurulmaz). */
  invoicesCoverWholeDispatch: boolean;
}

export interface FinishingCheckLine {
  rateCode: string;
  rateName: string;
  currency: Currency;
  pricePerKg: string;
  /** Tarifenin seçildiği sevk fabrika günü (`YYYY-MM-DD`). */
  rateAsOf: string | null;
  /** Sevk gününde geçerli tarife yoktu → kodun ilk sürümü kullanıldı. */
  rateFallback: boolean;
  totalKg: string;
  weighedCount: number;
  unweighedCount: number;
  expectedAmount: string;
  invoice: {
    docNos: string[];
    hasDraft: boolean;
    currency: Currency | null;
    netAmount: string | null;
    /** fatura − beklenen; yalnız fatura bu sevke özgü, sevkin tamamını kapsıyor ve para birimi aynıysa. */
    difference: string | null;
    coversOtherDispatches: boolean;
    /** Faturalı kabul sevkin yalnız bir kısmını kapsıyor (kısmi kabul) → fark null. */
    partial: boolean;
    /** Fatura dövizi tarifeninkinden farklı (ya da faturalar karışık dövizli) → KUR ÇEVRİLMEZ, fark null. */
    currencyMismatch: boolean;
  } | null;
}

export type FinishingCheckResult = { line: FinishingCheckLine; reason: null } | { line: null; reason: FinishingCheckSkipReason };

const skip = (reason: FinishingCheckSkipReason): FinishingCheckResult => ({ line: null, reason });
const money = (v: Prisma.Decimal): string => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);

/** Benzersiz tarife kodu: hiç kod yoksa null, birden fazla farklı kod varsa "AMBIGUOUS". */
export function pickDispatchRateCode(codes: (string | null)[]): string | null | "AMBIGUOUS" {
  const set = new Set(codes.filter((c): c is string => !!c));
  if (set.size > 1) return "AMBIGUOUS";
  if (codes.some((c) => !c) && set.size === 1) return "AMBIGUOUS"; // bir satır kodsuz, biri kodlu → tek tarife söylenemez
  return set.size === 1 ? [...set][0] : null;
}

export function computeDispatchFinishingCheck(inp: FinishingCheckInput): FinishingCheckResult {
  if (inp.cancelled) return skip("DISPATCH_CANCELLED");
  if (inp.fabricWeights.length === 0) return skip("NO_FABRIC_ITEMS");
  const code = pickDispatchRateCode(inp.rateCodes);
  if (code === "AMBIGUOUS") return skip("AMBIGUOUS_RATE_CODE");
  if (!code) return skip("NO_RATE_CODE");
  const rate = inp.rate;
  if (!rate || rate.code !== code) return skip("RATE_NOT_FOUND");
  if (rate.basis !== "KG") return skip("NOT_KG_BASIS");
  if (rate.subcontractorId && rate.subcontractorId !== inp.subcontractorId) return skip("OTHER_SUBCONTRACTOR");
  const weighed = inp.fabricWeights.filter((w): w is Prisma.Decimal => w !== null);
  if (weighed.length === 0) return skip("NO_WEIGHT");
  const totalKg = weighed.reduce((a, w) => a.plus(w), new Prisma.Decimal(0));
  const expected = totalKg.times(rate.pricePerM);
  return {
    reason: null,
    line: {
      rateCode: rate.code,
      rateName: rate.name,
      currency: rate.currency,
      pricePerKg: rate.pricePerM.toFixed(4),
      rateAsOf: inp.rateAsOf?.day ?? null,
      rateFallback: inp.rateAsOf?.fallback ?? false,
      totalKg: totalKg.toFixed(3),
      weighedCount: weighed.length,
      unweighedCount: inp.fabricWeights.length - weighed.length,
      expectedAmount: money(expected),
      invoice: invoiceSummary(inp, expected, rate.currency),
    },
  };
}

function invoiceSummary(inp: FinishingCheckInput, expected: Prisma.Decimal, rateCurrency: Currency): FinishingCheckLine["invoice"] {
  if (inp.invoices.length === 0) return null;
  const currencies = new Set(inp.invoices.map((i) => i.currency));
  const currency = currencies.size === 1 ? inp.invoices[0].currency : null;
  const net = currency ? inp.invoices.reduce((a, i) => a.plus(i.net), new Prisma.Decimal(0)) : null;
  const partial = !inp.invoicesCoverWholeDispatch;
  const currencyMismatch = currency !== rateCurrency;
  const comparable = net !== null && !currencyMismatch && !inp.invoicesCoverOtherDispatches && !partial;
  return {
    docNos: inp.invoices.map((i) => i.docNo),
    hasDraft: inp.invoices.some((i) => i.status === "DRAFT"),
    currency,
    netAmount: net ? money(net) : null,
    difference: comparable ? money(net.minus(expected.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP))) : null,
    coversOtherDispatches: inp.invoicesCoverOtherDispatches,
    partial,
    currencyMismatch,
  };
}
