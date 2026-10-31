// =============================================================================
// MALİYET HESABI — önizleme + kur çözümü + istek gövdesi okuma (MAL-2; plan §4.2)
// =============================================================================
// Önizleme YAZMAZ: derleyici → kur → motor → sunum. Kur sırası: istekte elle verilen (ELLE) →
// finans açıksa köprü önerisi (FINANS) → yoksa motor `FX_RATE_MISSING` yazar; ASLA 1 varsayılmaz.
// Gövde sayıları metin/sayı gelir, Decimal'e `parseDecimalField` çevirir (float Decimal kolona girmez).
// =============================================================================
import { Prisma, type Currency } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { EFFICIENCY_RULE, MARKUP_RULE, parseDecimalField, PCT_RULE } from "./helpers/cost-input.helper";
import {
  assembleCostInputTx,
  costCurrencies,
  type AdHocStructure,
  type AdHocYarn,
  type CostOverrides,
  type CostSourceRef,
} from "./helpers/cost-assembler.helper";
import { computeFabricCost, presentCostResult, suggestUnitPrice, type CostInput, type CostOutcome, type FxRates } from "./helpers/fabric-cost.helper";
import { serializeCostInput, type FxRatesSnapshot } from "./helpers/cost-snapshot.helper";
import { measuredWarpWaste, suggestFxRate, suggestYarnPrices } from "./helpers/maliyet-bridge.helper";
import { factoryYmd } from "../constants/time";
import { readCostPresentationCurrency } from "./system-setting.service";
import { costPresentation, withPresentation } from "./helpers/cost-presentation.helper";

type Dec = Prisma.Decimal;
const FX_RULE = { label: "Kur", min: 0, minExclusive: true, scale: 6 } as const;
const POS = (label: string, scale: number) => ({ label, min: 0, minExclusive: true, scale });
const req = <T>(v: T | null | undefined, label: string): T => {
  if (v === null || v === undefined) throw AppError.badRequest(`${label} zorunlu.`);
  return v;
};

export interface CostCalcBody {
  itemId?: string;
  recipeId?: string;
  adHoc?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
  fxRates?: Record<string, unknown>;
  /** Hesaplayıcının teklif fiyatı (MAL-4): yoksa `teklifFiyati` null. */
  pricing?: Record<string, unknown>;
}

/** Gövdedeki ezmeler → Decimal (aralıklar MAL-1 CHECK'lerinin aynası). */
export function parseOverrides(raw: Record<string, unknown> = {}): CostOverrides {
  const o: CostOverrides = {
    takeUpPct: parseDecimalField(raw.takeUpPct, PCT_RULE("Çözgü çekmesi")),
    warpWastePct: parseDecimalField(raw.warpWastePct, PCT_RULE("Çözgü firesi")),
    weftWastePct: parseDecimalField(raw.weftWastePct, PCT_RULE("Atkı firesi")),
    fabricWastePct: parseDecimalField(raw.fabricWastePct, PCT_RULE("Kalite firesi")),
    lengthShrinkPct: parseDecimalField(raw.lengthShrinkPct, PCT_RULE("Boy çekmesi")),
    efficiencyPct: parseDecimalField(raw.efficiencyPct, EFFICIENCY_RULE("Randıman")),
    weftLengthCm: parseDecimalField(raw.weftLengthCm, POS("Atkı boyu", 2)),
    beamLengthM: parseDecimalField(raw.beamLengthM, POS("Levent boyu", 2)),
    loomRpm: parseDecimalField(raw.loomRpm, { ...POS("Tezgah devri", 0), integer: true }),
    extraCostPerMTry: parseDecimalField(raw.extraCostPerMTry, { label: "Ek kalem", min: 0, scale: 4 }),
  };
  if (raw.warpWasteMeasured === true) o.warpWasteMeasured = true;
  if (raw.finishingRateCode !== undefined) o.finishingRateCode = typeof raw.finishingRateCode === "string" && raw.finishingRateCode.trim() ? raw.finishingRateCode.trim() : null;
  return o;
}

function parseYarn(raw: Record<string, unknown>, label: string): AdHocYarn {
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 100) : label;
  return {
    name,
    denier: parseDecimalField(raw.denier, POS(`${label} denye`, 4)) ?? null,
    pricePerKg: parseDecimalField(raw.pricePerKg, POS(`${label} fiyatı`, 4)) ?? null,
    currency: (raw.currency as Currency) ?? "TRY",
    ...(raw.picksInRepeat !== undefined ? { picksInRepeat: Number(parseDecimalField(raw.picksInRepeat, { ...POS(`${label} rapor adedi`, 0), integer: true })) } : {}),
  };
}

/** Elle yapı (kartı olmayan desen): çözgü + atkı iplikleri ad/denye/fiyat/para birimiyle. */
export function parseAdHoc(raw: Record<string, unknown>): AdHocStructure {
  const w = raw.warp as Record<string, unknown> | null | undefined;
  const f = raw.weft as Record<string, unknown> | null | undefined;
  return {
    warp: w
      ? {
          endsCount: Number(req(parseDecimalField(w.endsCount, { ...POS("Tel sayısı", 0), integer: true }), "Tel sayısı")),
          takeUpPct: parseDecimalField(w.takeUpPct, PCT_RULE("Çözgü çekmesi")),
          yarn: parseYarn((w.yarn ?? {}) as Record<string, unknown>, "Çözgü ipliği"),
        }
      : null,
    weft: f
      ? {
          picksPerCm: parseDecimalField(f.picksPerCm, POS("Atkı sıklığı", 2)) ?? null,
          rawWidthCm: parseDecimalField(f.rawWidthCm, POS("Ham en", 2)),
          yarns: ((f.yarns as unknown[]) ?? []).map((y, i) => parseYarn(y as Record<string, unknown>, `Atkı ipliği ${i + 1}`)),
        }
      : null,
    finishingRateCode: typeof raw.finishingRateCode === "string" && raw.finishingRateCode.trim() ? raw.finishingRateCode.trim() : null,
  };
}

export function parseFxRates(raw: Record<string, unknown> = {}): Partial<Record<Currency, Dec>> {
  const out: Partial<Record<Currency, Dec>> = {};
  for (const [k, v] of Object.entries(raw)) {
    const d = parseDecimalField(v, { ...FX_RULE, label: `${k} kuru` });
    if (d) out[k as Currency] = d;
  }
  return out;
}

/**
 * Girdinin istediği dövizler için kur: elle → finans önerisi → yok (motor FX_RATE_MISSING).
 * `presentation` (SY-J1): sunum dövizi TRY değilse onun kuru da çözülür ki sürümde DONSUN.
 */
export async function resolveFx(input: CostInput, given: Partial<Record<Currency, Dec>>, presentation?: Currency): Promise<{ rates: FxRates; snapshot: FxRatesSnapshot }> {
  const rates: FxRates = {};
  const kurlar: FxRatesSnapshot["kurlar"] = {};
  let finans = false;
  const today = factoryYmd();
  const currencies = costCurrencies(input);
  const inputCurrencies = new Set(currencies);
  if (presentation && presentation !== "TRY" && !currencies.includes(presentation)) currencies.push(presentation);
  for (const cur of currencies.sort()) {
    let r = given[cur] ?? null;
    if (!r) {
      r = await suggestFxRate(cur, new Date());
      // Kaynak etiketi girdinin dövizlerinden türer; yalnız sunum kuru FINANS'tan geldiyse etiket değişmez.
      if (r && inputCurrencies.has(cur)) finans = true;
    }
    if (r && cur !== "TRY") {
      rates[cur] = r;
      kurlar[cur as keyof FxRatesSnapshot["kurlar"]] = r.toString();
    }
  }
  const source = Object.keys(kurlar).length === 0 ? "YOK" : finans ? "FINANS" : "ELLE";
  return { rates, snapshot: { tarih: today, kaynak: source, kurlar } };
}

export function sourceRefOf(body: CostCalcBody): CostSourceRef {
  if (body.itemId && body.adHoc) throw AppError.badRequest("Ya ürün ya elle yapı gönderilmeli, ikisi birden değil.");
  if (body.recipeId && !body.itemId) throw AppError.badRequest("Varyant yalnız ürünle birlikte gönderilir.");
  if (body.itemId) return body.recipeId ? { itemId: body.itemId, recipeId: body.recipeId } : { itemId: body.itemId };
  if (body.adHoc) return { adHoc: parseAdHoc(body.adHoc) };
  throw AppError.badRequest("Ürün ya da elle yapı zorunlu.");
}

/** `POST /api/cost/preview` — hiçbir tabloya yazmaz. */
export async function previewCost(body: CostCalcBody) {
  const ref = sourceRefOf(body);
  const overrides = parseOverrides(body.overrides);
  const input = await prisma.$transaction((tx) => assembleCostInputTx(tx, ref, overrides));
  const setting = await readCostPresentationCurrency();
  const fx = await resolveFx(input, parseFxRates(body.fxRates), setting);
  const out = computeFabricCost(input, fx.rates);
  const pres = setting === "TRY" ? null : costPresentation(setting, fx.rates[setting], "ONIZLEME");
  const yarnIds = [input.warp?.yarn.yarnItemId, ...(input.weft?.yarns ?? []).map((y) => y.yarnItemId)].filter((x): x is string => !!x);
  const yarnPrices = [];
  for (const id of [...new Set(yarnIds)]) yarnPrices.push(await suggestYarnPrices(id));
  return {
    sonuc: out.result ? withPresentation(presentCostResult(out.result), pres) : null,
    eksikler: out.missing,
    uyarilar: out.warnings,
    girdi: serializeCostInput(input),
    kurlar: fx.snapshot,
    teklifFiyati: body.pricing ? await previewPricing(body.pricing, out) : null,
    oneriler: {
      fx: fx.snapshot.kurlar,
      yarnPrices,
      warpWaste: input.warp?.warpSpecId ? await measuredWarpWaste(input.warp.warpSpecId) : null,
    },
  };
}

/** Kâr: gövde ?? yürürlükteki parametre setinin varsayılanı; ikisi de yoksa 400 (sıfır varsayılmaz). Teklif, liste, önizleme TEK yol. */
export async function resolveMarkup(raw: unknown): Promise<Prisma.Decimal> {
  const given = parseDecimalField(raw, MARKUP_RULE("Kâr oranı"));
  if (given) return given;
  const set = await prisma.costParameterSet.findFirst({ where: { status: "ACTIVE" }, select: { defaultMarkupPct: true } });
  if (!set) throw AppError.badRequest("Yürürlükte maliyet parametre seti yok; kâr oranını elle girin.", { code: "COST_INPUT_MISSING", missing: ["PARAMETER_SET_MISSING"] });
  return set.defaultMarkupPct;
}

/** Önizlemede teklif fiyatı: maliyet × (1 + kâr) … / kur (`suggestUnitPrice`); kur yoksa öneri null + `eksik`. YAZMAZ. */
async function previewPricing(raw: Record<string, unknown>, out: CostOutcome) {
  const currency = raw.currency as Currency; // rota zod'u enum'a karşı doğrular
  const markupPct = await resolveMarkup(raw.markupPct);
  const fxRate = currency === "TRY" ? new Prisma.Decimal(1) : (parseDecimalField(raw.fxRate, FX_RULE) ?? (await suggestFxRate(currency, new Date())));
  const price = out.result
    ? suggestUnitPrice({
        costPerMTry: out.result.totalCostPerMTry, markupPct, fxRate,
        freightPerM: parseDecimalField(raw.freightPerM, { label: "Navlun", min: 0, scale: 4 }),
        financeChargePct: parseDecimalField(raw.financeChargePct, PCT_RULE("Vade farkı")),
        commissionPct: parseDecimalField(raw.commissionPct, PCT_RULE("Komisyon")),
      })
    : null;
  return { doviz: currency, karYuzde: markupPct.toFixed(2), kur: fxRate?.toString() ?? null, oneriBirimFiyat: price?.toFixed(4) ?? null, eksik: fxRate ? null : "FX_RATE_MISSING" };
}
