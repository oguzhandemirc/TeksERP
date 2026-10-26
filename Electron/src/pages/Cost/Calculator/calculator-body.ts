// Hızlı hesaplayıcı formu → `POST /api/cost/preview` gövdesi. HESAP YOK: alanlar yalnız Decimal metnine çevrilir,
// boş alan gövdeye girmez (sunucu varsayılanı/eksikliği söyler). Ürün ya da elle yapı — ikisi birden asla.
import type { Currency } from "@/pages/Finance/service";
import type { PreviewBody } from "../Items/service";
import { STRUCTURE_KEYS, type StructureKey } from "../Items/service";
import { fxBody } from "../shared/FxRateInputs";
import { toDecimalText } from "../shared/format";

export const MAX_WEFT_YARNS = 8;

export interface YarnForm { name: string; denier: string; pricePerKg: string; currency: Currency; picksInRepeat: string }
export interface AdHocForm { endsCount: string; takeUpPct: string; warpYarn: YarnForm; picksPerCm: string; rawWidthCm: string; weftYarns: YarnForm[] }
export type OverrideForm = Record<StructureKey, string>;
export interface CalculatorState {
  mode: "item" | "adHoc";
  itemId: string | null;
  adHoc: AdHocForm;
  overrides: OverrideForm;
  finishingRateCode: string;
  fx: Partial<Record<Currency, string>>;
}

export const emptyYarn = (): YarnForm => ({ name: "", denier: "", pricePerKg: "", currency: "TRY", picksInRepeat: "" });
export const emptyCalculator = (): CalculatorState => ({
  mode: "item",
  itemId: null,
  adHoc: { endsCount: "", takeUpPct: "", warpYarn: emptyYarn(), picksPerCm: "", rawWidthCm: "", weftYarns: [emptyYarn()] },
  overrides: Object.fromEntries(STRUCTURE_KEYS.map((k) => [k, ""])) as OverrideForm,
  finishingRateCode: "",
  fx: {},
});

/** Dolu alanlar; boş olan gövdeye hiç girmez. */
function filled(o: Record<string, string | null>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).filter((e): e is [string, string] => e[1] !== null && e[1] !== ""));
}

function yarnBody(y: YarnForm, withPicks: boolean): Record<string, string> {
  const price = toDecimalText(y.pricePerKg);
  return filled({
    name: y.name.trim() || null,
    denier: toDecimalText(y.denier),
    pricePerKg: price,
    currency: price ? y.currency : null,
    picksInRepeat: withPicks ? toDecimalText(y.picksInRepeat) : null,
  });
}

export function adHocBody(a: AdHocForm, finishingRateCode: string): Record<string, unknown> | null {
  const ends = toDecimalText(a.endsCount);
  const picks = toDecimalText(a.picksPerCm);
  if (!ends && !picks) return null;
  return {
    warp: ends ? { endsCount: ends, ...filled({ takeUpPct: toDecimalText(a.takeUpPct) }), yarn: yarnBody(a.warpYarn, false) } : null,
    weft: picks ? { picksPerCm: picks, ...filled({ rawWidthCm: toDecimalText(a.rawWidthCm) }), yarns: a.weftYarns.map((y) => yarnBody(y, true)) } : null,
    finishingRateCode: finishingRateCode || null,
  };
}

/** Gönderilecek bir şey yoksa null (istek atılmaz). */
export function buildCalculatorBody(s: CalculatorState): PreviewBody | null {
  const overrides: Record<string, unknown> = filled(Object.fromEntries(STRUCTURE_KEYS.map((k) => [k, toDecimalText(s.overrides[k])])));
  const fxRates = fxBody(s.fx);
  if (s.mode === "item") {
    if (!s.itemId) return null;
    // Ürün kipinde tarife seçilmezse yapıdaki tarife geçerli kalır (alan gönderilmez).
    if (s.finishingRateCode) overrides.finishingRateCode = s.finishingRateCode;
    return { itemId: s.itemId, overrides, fxRates };
  }
  const adHoc = adHocBody(s.adHoc, s.finishingRateCode);
  return adHoc ? { adHoc, overrides, fxRates } : null;
}
