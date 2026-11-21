// =============================================================================
// KUMAŞ MALİYET MOTORU — sözleşme tipleri (girdi/sonuç/kod listeleri)
// =============================================================================
// Motor (`fabric-cost.helper.ts`) 300 satır tavanını aşınca tipler buraya ayrıldı; motor hepsini
// yeniden dışa verir, çağıranların import yolu değişmez. Burada hesap YOK — yalnız şekil.
// =============================================================================
import type { Prisma, Currency } from "@prisma/client";
import type { FinishingKgBasis } from "./fabric-cost-kg.helper";
import type { NonKgYarnUnit } from "../../constants/yarn-unit";

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
  // SY-C1: ek maliyet formülü hesaplanamadı (sıfıra bölme, değeri olmayan değişken) — satır sessizce 0 olmasın.
  "FORMULA_FAILED",
  // SY-a: ADET birimli (pul) iplikte metredeki adet girilmemiş — maliyet sessizce 0 olmasın.
  "YARN_PIECES_MISSING",
] as const;
export type CostMissing = (typeof COST_MISSING_CODES)[number];
export const COST_WARNING_CODES = [
  "TAKEUP_DEFAULTED", "WARP_WASTE_DEFAULTED", "WARP_WASTE_MEASURED", "WEFT_LENGTH_FROM_WIDTH",
  "SHRINK_UNKNOWN", "RPM_DEFAULTED", "PRICE_STALE",
] as const;
export type CostWarning = (typeof COST_WARNING_CODES)[number];
export type CostComponent =
  | "WARP_YARN" | "WEFT_YARN" | "LOOM_MACHINE" | "LOOM_LABOR" | "ENERGY" | "BEAM_PREP"
  | "FINISHING" | "LENGTH_SHRINK" | "FABRIC_WASTE" | "OVERHEAD" | "EXTRA" | "PROCESS" | "WEAVING_PICK" | "FORMULA";

/** SY-C2 `maliyet.fireYontemi`: BOLME = net ÷ (1 − f) (bugünkü) · CARPMA = net × (1 + f) (Excel alışkanlığı). */
export const COST_WASTE_METHODS = ["BOLME", "CARPMA"] as const;
export type CostWasteMethod = (typeof COST_WASTE_METHODS)[number];
/** SY-C1: girdiye DONAN formül sürümü — standart maliyet sürümü yazıldığı formülle kalır. */
export interface CostFormulaInput { formulaId: string; code: string; name: string; versionNo: number; expression: string; currency: Currency }

/** Kaynağıyla değer; `flag` derleyicinin türettiği uyarıdır (ör. atkı boyu enden türedi). */
export interface Sourced<T> { value: T | null; source: CostSource; flag?: CostWarning }
export interface CostPrice { amount: Dec; currency: Currency; source: CostSource; flag?: CostWarning }
/** `wastePct` (SY-3 I2) = iplik kartı firesi; yalnız doluyken yazılır — boşken girdi + hash bayt-aynı. */
/**
 * `unit`/`piecesPerM` (SY-a) yalnız KG DIŞI birimli atkı ipliğinde yazılır (KG iplikte girdi + hash bayt-aynı): fiyat o birim
 * başınadır, iplik kg hesabına girmez; `piecesPerM` = iplik metresindeki adet (yalnız ADET).
 */
export interface CostYarn { yarnItemId: string | null; name: string; denier: Sourced<Dec>; price: CostPrice | null; wastePct?: Dec; unit?: NonKgYarnUnit; piecesPerM?: Dec }
export interface CostWeftYarn extends CostYarn { picksInRepeat: number }
/** `kgBase` yalnız KG tabanında yazılır — metre tabanlı tarifenin girdisi + hash'i bayt-aynı kalır. */
export interface CostRate { code: string; name: string; basis: "RAW_M" | "FINISHED_M" | "KG"; kgBase?: FinishingKgBasis; price: CostPrice | null }
/** Fason devere D2: çok iplikli çözgü kartının bir satırı (iplik + kendi teli). */
export interface CostWarpYarn extends CostYarn { endsCount: number }
/**
 * `yarns` yalnız ≥ 2 satırlı kartta yazılır (tek iplikte girdi + `inputHash` bayt-aynı); o zaman `yarn` = ana iplik,
 * `endsCount` = Σ tel ve motor kg'ı SATIR SATIR toplar.
 */
export interface CostWarp { warpSpecId: string | null; endsCount: number; takeUpPct: Sourced<Dec>; wastePct: Sourced<Dec>; yarn: CostYarn; yarns?: CostWarpYarn[] }
/** Çözgünün iplik satırları — tek iplikte `[yarn]` (toplam telle). Fiyat/kur/iplik listesi okuyucuları buradan geçer. */
export const costWarpYarns = (w: CostWarp): CostWarpYarn[] => w.yarns ?? [{ ...w.yarn, endsCount: w.endsCount }];
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
  /** SY-C2: yalnız CARPMA'da yazılır (BOLME = anahtar yok → girdi/hash bayt-aynı). Çekme bölmede kalır. */
  wasteMethod?: "CARPMA";
  /** SY-C1: yalnız aktif ek maliyet formülü varken yazılır (yoksa girdi + hash bayt-aynı). */
  formulas?: CostFormulaInput[];
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
