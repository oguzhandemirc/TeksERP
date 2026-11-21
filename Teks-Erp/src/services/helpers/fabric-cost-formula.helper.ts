// =============================================================================
// KUMAŞ MALİYET MOTORU — ek maliyet formülü satırları + fire yöntemi (SY-C1/C2)
// =============================================================================
// Motor (`fabric-cost.helper.ts`) dosya tavanı nedeniyle ayrı modül; hesap yine motordan çağrılır.
// Formül satırı yalnız PARA'dır: iplik tüketimi/ihtiyaç planı (`yarnUsagePerM`) bunu okumaz.
// Değişken değerleri motorun ara sonuçlarıdır; katalog `cost-formula-vars.helper.ts` (tek liste).
// =============================================================================
import { Prisma, type Currency } from "@prisma/client";
import { CostFormulaError, evaluateCostFormula, formulaVariables, parseCostFormula } from "./cost-formula-expr.helper";
import { COST_FORMULA_VARIABLE_NAMES } from "./cost-formula-vars.helper";
import type { CostFormulaInput, CostInput, CostLine, CostMissing, FxRates } from "./fabric-cost-types.helper";

type Dec = Prisma.Decimal;
const ONE = new Prisma.Decimal(1);
const HUNDRED = new Prisma.Decimal(100);

/** Fire uygulaması — TEK yer: BOLME net ÷ (1 − f) · CARPMA net × (1 + f); f yüzde. */
export function applyWastePct(net: Dec, pctValue: Dec, method: CostInput["wasteMethod"]): Dec {
  const f = pctValue.div(HUNDRED);
  return method === "CARPMA" ? net.mul(ONE.plus(f)) : net.div(ONE.minus(f));
}

/** Formülün kur isteyen dövizleri (kendi para birimi + `usd`/`eur` değişkeni) — önizleme/sürüm kuru için. */
export function formulaCurrencies(formulas: CostFormulaInput[] | undefined): Currency[] {
  const out = new Set<Currency>();
  for (const f of formulas ?? []) {
    if (f.currency !== "TRY") out.add(f.currency);
    try {
      const vars = formulaVariables(parseCostFormula(f.expression, COST_FORMULA_VARIABLE_NAMES));
      if (vars.includes("usd")) out.add("USD");
      if (vars.includes("eur")) out.add("EUR");
    } catch {
      // Donmuş metin ayrıştırılamıyorsa motor FORMULA_FAILED yazar; kur listesi etkilenmez.
    }
  }
  return [...out];
}

export interface FormulaContext {
  picksPerCm: Dec; lengthCm: Dec | null; endsCount: number | null;
  warpKg: Dec; weftKg: Dec; raw: Dec; mamul: Dec;
  /** ADET birimli atkı ipliklerinin metre başı adedi (fireli); adetle alınan atkı yoksa 0. */
  pulPieces: Dec;
}

/** Formül satırları (TL/m). Eksik kur → FX_RATE_MISSING; hesap hatası → FORMULA_FAILED; ikisinde satır yazılmaz. */
export function formulaLines(input: CostInput, ctx: FormulaContext, fx: FxRates, miss: (code: CostMissing) => void): CostLine[] {
  const formulas = input.formulas ?? [];
  if (!formulas.length) return [];
  const vars = new Map<string, Dec>([
    ["metre", ONE], ["atkiSikligi", ctx.picksPerCm],
    ["cozguKg", ctx.warpKg], ["atkiKg", ctx.weftKg], ["iplikKg", ctx.warpKg.plus(ctx.weftKg)],
    ["hamMaliyet", ctx.raw], ["mamulMaliyet", ctx.mamul], ["pulAdet", ctx.pulPieces],
  ]);
  if (ctx.lengthCm) vars.set("en", ctx.lengthCm);
  if (ctx.endsCount !== null) vars.set("cozguTel", new Prisma.Decimal(ctx.endsCount));
  if (fx.USD?.gt(0)) vars.set("usd", fx.USD);
  if (fx.EUR?.gt(0)) vars.set("eur", fx.EUR);
  const out: CostLine[] = [];
  for (const f of formulas) {
    let value: Dec;
    try {
      const node = parseCostFormula(f.expression, COST_FORMULA_VARIABLE_NAMES);
      const used = formulaVariables(node);
      if ((used.includes("usd") && !vars.has("usd")) || (used.includes("eur") && !vars.has("eur"))) {
        miss("FX_RATE_MISSING");
        continue;
      }
      value = evaluateCostFormula(node, vars);
    } catch (e) {
      if (e instanceof CostFormulaError) {
        miss("FORMULA_FAILED");
        continue;
      }
      throw e;
    }
    const rate = f.currency === "TRY" ? ONE : fx[f.currency];
    if (!rate || !rate.gt(0)) {
      miss("FX_RATE_MISSING");
      continue;
    }
    out.push({
      component: "FORMULA", label: `Ek — ${f.name}`, yarnItemId: null,
      qty: value, qtyUnit: `${f.currency}/m`, unitPriceTry: f.currency === "TRY" ? null : rate, amountPerMTry: value.mul(rate),
    });
  }
  return out;
}
