// =============================================================================
// KUMAŞ MALİYET MOTORU — sözleşme tipleri (girdi/sonuç/kod listeleri)
// =============================================================================
// Motor (`fabric-cost.helper.ts`) 300 satır tavanını aşınca tipler buraya ayrıldı; motor hepsini
// yeniden dışa verir, çağıranların import yolu değişmez. Burada hesap YOK — yalnız şekil.
// =============================================================================
import type { Prisma, Currency } from "@prisma/client";
import type { FinishingKgBasis } from "./fabric-cost-kg.helper";

type Dec = Prisma.Decimal;

/** Değerin nereden geldiği (plan §2.1 öncelik tablosu); uyarılar buradan türer. */
export type CostSource = "KART" | "YAPI" | "PARAMETRE" | "OLCULMUS" | "ELLE";
export const COST_MISSING_CODES = [
  "WARP_SPEC_MISSING", "DENIER_MISSING", "TAKEUP_MISSING", "WEFT_SPEC_MISSING", "PICKS_MISSING",
  "WEFT_LENGTH_MISSING", "YARN_PRICE_MISSING", "FX_RATE_MISSING", "RPM_MISSING", "PARAMETER_SET_MISSING",
  // Plan §2.2 listesine ek (MAL-2): yapıdaki tarife kodu aktif tarifeye çözülmüyor — terbiye sessizce 0 olmasın.
  "FINISHING_RATE_MISSING",
  // SY-D2: ATKI_UCRETI yönteminde ne yapıda ne parametre setinde atkı ücreti var — dokuma sessizce 0 olmasın.
  "PICK_RATE_MISSING",
] as const;
export type CostMissing = (typeof COST_MISSING_CODES)[number];
export const COST_WARNING_CODES = [
  "TAKEUP_DEFAULTED", "WARP_WASTE_DEFAULTED", "WARP_WASTE_MEASURED", "WEFT_LENGTH_FROM_WIDTH",
  "SHRINK_UNKNOWN", "RPM_DEFAULTED", "PRICE_STALE",
] as const;
export type CostWarning = (typeof COST_WARNING_CODES)[number];
export type CostComponent =
  | "WARP_YARN" | "WEFT_YARN" | "LOOM_MACHINE" | "LOOM_LABOR" | "ENERGY" | "BEAM_PREP"
  | "FINISHING" | "LENGTH_SHRINK" | "FABRIC_WASTE" | "OVERHEAD" | "EXTRA" | "PROCESS" | "WEAVING_PICK";

/** Kaynağıyla değer; `flag` derleyicinin türettiği uyarıdır (ör. atkı boyu enden türedi). */
export interface Sourced<T> { value: T | null; source: CostSource; flag?: CostWarning }
export interface CostPrice { amount: Dec; currency: Currency; source: CostSource; flag?: CostWarning }
/** `wastePct` (SY-3 I2) = iplik kartı firesi; yalnız doluyken yazılır — boşken girdi + hash bayt-aynı. */
export interface CostYarn { yarnItemId: string | null; name: string; denier: Sourced<Dec>; price: CostPrice | null; wastePct?: Dec }
export interface CostWeftYarn extends CostYarn { picksInRepeat: number }
/** `kgBase` yalnız KG tabanında yazılır — metre tabanlı tarifenin girdisi + hash'i bayt-aynı kalır. */
export interface CostRate { code: string; name: string; basis: "RAW_M" | "FINISHED_M" | "KG"; kgBase?: FinishingKgBasis; price: CostPrice | null }
export interface CostWarp { warpSpecId: string | null; endsCount: number; takeUpPct: Sourced<Dec>; wastePct: Sourced<Dec>; yarn: CostYarn }
/** SY-B1 ek çözgü katmanı (döner/ikinci çözgü): zeminle AYNI formül, kendi tel/iplik/take-up'ı. */
export interface CostWarpLayer extends CostWarp { role: "LENO" | "SECONDARY"; beamMode: "SEPARATE_BEAM" | "SHARED_BEAM" | "CREEL" }
export const WARP_LAYER_ROLE_LABEL: Record<CostWarpLayer["role"], string> = { LENO: "döner", SECONDARY: "ikinci" };
export interface CostInput {
  schemaVersion: 1;
  parameterSetId: string | null;
  warp: CostWarp | null;
  /** SY-B1 ek çözgü katmanları: yalnız doluyken yazılır — yoksa girdi + hash bayt-aynı. */
  warpLayers?: CostWarpLayer[];
  weft: { weftSpecId: string | null; picksPerCm: Sourced<Dec>; lengthCm: Sourced<Dec>; wastePct: Sourced<Dec>; yarns: CostWeftYarn[] } | null;
  loom: {
    rpm: Sourced<Dec>; efficiencyPct: Sourced<Dec>; machineRateTry: Sourced<Dec>; laborRateTry: Sourced<Dec>;
    loomsPerOperator: Sourced<Dec>; energyKwhPerHour: Sourced<Dec>; energyPriceTry: Sourced<Dec>;
  };
  beam: { prepCostTry: Sourced<Dec>; lengthM: Sourced<Dec> };
  /** null = ham satış (tarife yok): F = 0, sᵦ = 0, uyarı yok. */
  finishing: CostRate | null;
  /** SY-G1 ek işlemler (kurşun/devere…): yalnız doluyken yazılır — yoksa girdi + hash bayt-aynı. */
  processes?: CostRate[];
  lengthShrinkPct: Sourced<Dec>;
  fabricWastePct: Sourced<Dec>;
  overheadPct: Sourced<Dec>;
  extra: { amountTry: Dec; label: string | null } | null;
  /**
   * SY-D2: yalnız `maliyet.dokumaStandartYontemi = ATKI_UCRETI` iken YAZILIR (yokken anahtar hiç yok →
   * TEZGAH_SAATI girdisi/hash'i bayt-aynı). Ücret birimi: 1 atkı/cm sıklık için metre başına.
   */
  loomPick?: { rate: CostPrice | null };
}
/** 1 birim döviz kaç TL; TRY verilmese de 1'dir. Eksik döviz → FX_RATE_MISSING. */
export type FxRates = Partial<Record<Currency, Dec>>;

export interface CostLine {
  component: CostComponent; label: string; yarnItemId: string | null;
  qty: Dec | null; qtyUnit: string | null; unitPriceTry: Dec | null; amountPerMTry: Dec;
}
export interface CostResult {
  /** `loomMPerHour` null = atkı ücreti yönteminde devir/randıman bilinmiyor (bilgi satırı; hesaba girmez). */
  lines: CostLine[]; warpKgPerM: Dec; weftKgPerM: Dec; loomMPerHour: Dec | null;
  rawCostPerMTry: Dec; finishedCostPerMTry: Dec | null; soundCostPerMTry: Dec; overheadPerMTry: Dec; totalCostPerMTry: Dec;
}
export interface CostOutcome { result: CostResult | null; missing: CostMissing[]; warnings: CostWarning[] }
