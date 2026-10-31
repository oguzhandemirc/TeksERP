// =============================================================================
// KUMAŞ MALİYET MOTORU — saf, DB'siz, tam Decimal (MAL-2; plan MALIYET-TEKLIF-PLAN §2 BAĞLAYICI)
// =============================================================================
// Bütün maliyet sayıları BURADA doğar; istemci hesap yapmaz (`POST /api/cost/preview`), teklif
// (MAL-4) ve ihtiyaç planı (MAL-7) da bu dosyayı çağırır. Formül parçaları kopyalanmaz: çözgü kg
// `warpYarnKgExact`, tezgah hızı `theoreticalMPerHourDecimal` (tek ev). `number` YASAK — kayan
// nokta kuruşu kaydırır; yuvarlama yalnız sunumda (`presentCostOutcome`, TL/m 4 · kg/m 6 hane).
// Kur yoksa `FX_RATE_MISSING` ve sonuç null: kur ASLA 1 varsayılmaz (TRY tanım gereği 1'dir).
// =============================================================================
import { Prisma, type Currency } from "@prisma/client";
import { warpYarnKgExact } from "../../constants/warp-beam";
import { theoreticalMPerHourDecimal } from "./dokuma-levent-rapor.helper";
import { fastestGroupTakeUpPct } from "./warp-layer-beam.helper";

type Dec = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value): Dec => new Prisma.Decimal(v);
const ZERO = D(0);
const ONE = D(1);
const HUNDRED = D(100);
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

/** Değerin nereden geldiği (plan §2.1 öncelik tablosu); uyarılar buradan türer. */
export type CostSource = "KART" | "YAPI" | "PARAMETRE" | "OLCULMUS" | "ELLE";
export const COST_MISSING_CODES = [
  "WARP_SPEC_MISSING", "DENIER_MISSING", "TAKEUP_MISSING", "WEFT_SPEC_MISSING", "PICKS_MISSING",
  "WEFT_LENGTH_MISSING", "YARN_PRICE_MISSING", "FX_RATE_MISSING", "RPM_MISSING", "PARAMETER_SET_MISSING",
  // Plan §2.2 listesine ek (MAL-2): yapıdaki tarife kodu aktif tarifeye çözülmüyor — terbiye sessizce 0 olmasın.
  "FINISHING_RATE_MISSING",
] as const;
export type CostMissing = (typeof COST_MISSING_CODES)[number];
export const COST_WARNING_CODES = [
  "TAKEUP_DEFAULTED", "WARP_WASTE_DEFAULTED", "WARP_WASTE_MEASURED", "WEFT_LENGTH_FROM_WIDTH",
  "SHRINK_UNKNOWN", "RPM_DEFAULTED", "PRICE_STALE",
] as const;
export type CostWarning = (typeof COST_WARNING_CODES)[number];
export type CostComponent =
  | "WARP_YARN" | "WEFT_YARN" | "LOOM_MACHINE" | "LOOM_LABOR" | "ENERGY" | "BEAM_PREP"
  | "FINISHING" | "LENGTH_SHRINK" | "FABRIC_WASTE" | "OVERHEAD" | "EXTRA" | "PROCESS";

/** Kaynağıyla değer; `flag` derleyicinin türettiği uyarıdır (ör. atkı boyu enden türedi). */
export interface Sourced<T> { value: T | null; source: CostSource; flag?: CostWarning }
export interface CostPrice { amount: Dec; currency: Currency; source: CostSource; flag?: CostWarning }
export interface CostYarn { yarnItemId: string | null; name: string; denier: Sourced<Dec>; price: CostPrice | null }
export interface CostWeftYarn extends CostYarn { picksInRepeat: number }
export interface CostRate { code: string; name: string; basis: "RAW_M" | "FINISHED_M"; price: CostPrice | null }
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
}
/** 1 birim döviz kaç TL; TRY verilmese de 1'dir. Eksik döviz → FX_RATE_MISSING. */
export type FxRates = Partial<Record<Currency, Dec>>;

export interface CostLine {
  component: CostComponent; label: string; yarnItemId: string | null;
  qty: Dec | null; qtyUnit: string | null; unitPriceTry: Dec | null; amountPerMTry: Dec;
}
export interface CostResult {
  lines: CostLine[]; warpKgPerM: Dec; weftKgPerM: Dec; loomMPerHour: Dec;
  rawCostPerMTry: Dec; finishedCostPerMTry: Dec | null; soundCostPerMTry: Dec; overheadPerMTry: Dec; totalCostPerMTry: Dec;
}
export interface CostOutcome { result: CostResult | null; missing: CostMissing[]; warnings: CostWarning[] }

class Collector {
  readonly missing = new Set<CostMissing>();
  readonly warnings = new Set<CostWarning>();
  /** Değer yoksa eksik kodu yazar; `defaulted` kaynağı uyarıya çevrilir; `flag` her zaman taşınır. */
  take<T>(s: Sourced<T>, missingCode: CostMissing | null, onSource: Partial<Record<CostSource, CostWarning>> = {}): T | null {
    if (s.value === null) {
      if (missingCode) this.missing.add(missingCode);
      return null;
    }
    const w = onSource[s.source];
    if (w) this.warnings.add(w);
    if (s.flag) this.warnings.add(s.flag);
    return s.value;
  }
}

const pct = (v: Dec): Dec => v.div(HUNDRED);

/** TL karşılığı: TRY = 1; diğer döviz kuru yoksa null + FX_RATE_MISSING (ASLA 1). */
function toTry(p: CostPrice | null, fx: FxRates, c: Collector, missingCode: CostMissing = "YARN_PRICE_MISSING"): Dec | null {
  if (!p) {
    c.missing.add(missingCode);
    return null;
  }
  if (p.flag) c.warnings.add(p.flag);
  if (p.currency === "TRY") return p.amount;
  const rate = fx[p.currency];
  if (!rate || !rate.gt(0)) {
    c.missing.add("FX_RATE_MISSING");
    return null;
  }
  return p.amount.mul(rate);
}

/** Kᶜ = (N × dᶜ / 9 000 000) / (1 − t) / (1 − fᶜ) — kg/m. Zemin ve HER ek katman bunu çağırır (kopya yok). */
function warpKg(w: CostWarp | null, c: Collector): { kg: Dec; takeUp: Dec } | null {
  if (!w) {
    c.missing.add("WARP_SPEC_MISSING");
    return null;
  }
  const d = c.take(w.yarn.denier, "DENIER_MISSING");
  const t = c.take(w.takeUpPct, "TAKEUP_MISSING", { PARAMETRE: "TAKEUP_DEFAULTED" });
  const f = c.take(w.wastePct, "PARAMETER_SET_MISSING", { PARAMETRE: "WARP_WASTE_DEFAULTED", OLCULMUS: "WARP_WASTE_MEASURED" });
  if (d === null || t === null || f === null) return null;
  const takeUp = pct(t);
  return { kg: warpYarnKgExact(w.endsCount, d, 1).div(ONE.minus(takeUp)).div(ONE.minus(pct(f))), takeUp };
}

/** Zemin + ek katmanlar; herhangi biri eksikse null (yarım çözgü kg'ı gösterilmez). */
function warpKgs(input: CostInput, c: Collector): { kg: Dec; groundKg: Dec; takeUp: Dec; layers: Array<{ layer: CostWarpLayer; kg: Dec }> } | null {
  const ground = warpKg(input.warp, c);
  const layers = (input.warpLayers ?? []).map((layer) => ({ layer, r: warpKg(layer, c) }));
  if (!ground || layers.some((l) => l.r === null)) return null;
  const out = layers.map((l) => ({ layer: l.layer, kg: l.r!.kg }));
  return { kg: out.reduce((a, l) => a.plus(l.kg), ground.kg), groundKg: ground.kg, takeUp: ground.takeUp, layers: out };
}

/** Kⱼ = p × 100 × W × sⱼ × dⱼ / 9 000 000 / (1 − fᵃ), sⱼ = picksInRepeat / Σ — kg/m. */
function weftKgs(input: CostInput, c: Collector): { picksPerCm: Dec; perYarn: Array<{ yarn: CostWeftYarn; kg: Dec }> } | null {
  const w = input.weft;
  if (!w) {
    c.missing.add("WEFT_SPEC_MISSING");
    return null;
  }
  const p = c.take(w.picksPerCm, "PICKS_MISSING");
  if (p !== null && !p.gt(0)) c.missing.add("PICKS_MISSING");
  const lengthCm = c.take(w.lengthCm, "WEFT_LENGTH_MISSING");
  const f = c.take(w.wastePct, "PARAMETER_SET_MISSING");
  const total = w.yarns.reduce((a, y) => a + y.picksInRepeat, 0);
  if (total <= 0) c.missing.add("WEFT_SPEC_MISSING");
  const deniers = w.yarns.map((y) => c.take(y.denier, "DENIER_MISSING"));
  if (p === null || !p.gt(0) || lengthCm === null || f === null || total <= 0 || deniers.some((d) => d === null)) return null;
  const weftMPerM = p.mul(HUNDRED).mul(lengthCm.div(HUNDRED));
  const perYarn = w.yarns.map((yarn, i) => ({
    yarn,
    kg: weftMPerM.mul(D(yarn.picksInRepeat).div(total)).mul(deniers[i]!).div(9_000_000).div(ONE.minus(pct(f))),
  }));
  return { picksPerCm: p, perYarn };
}

/** Yalnız iplik tüketimi (kg/m) — ihtiyaç planı (MAL-7) fiyat/kur/parametre istemez. */
export function yarnUsagePerM(input: CostInput): {
  missing: CostMissing[];
  warp: { yarnItemId: string | null; kgPerM: Dec } | null;
  weft: Array<{ yarnItemId: string | null; kgPerM: Dec }>;
  /** SY-B1 ek çözgü katmanları (zemin `warp`a KATILMAZ — kip başına ayrı düşüm). */
  warpLayers: Array<{ yarnItemId: string | null; warpSpecId: string | null; beamMode: CostWarpLayer["beamMode"]; kgPerM: Dec }>;
} {
  const c = new Collector();
  const warp = warpKg(input.warp, c);
  const layers = (input.warpLayers ?? []).map((l) => ({ l, r: warpKg(l, c) }));
  const weft = weftKgs(input, c);
  return {
    missing: [...c.missing].sort(),
    warp: warp && input.warp ? { yarnItemId: input.warp.yarn.yarnItemId, kgPerM: warp.kg } : null,
    weft: (weft?.perYarn ?? []).map((x) => ({ yarnItemId: x.yarn.yarnItemId, kgPerM: x.kg })),
    warpLayers: layers.flatMap(({ l, r }) => (r ? [{ yarnItemId: l.yarn.yarnItemId, warpSpecId: l.warpSpecId, beamMode: l.beamMode, kgPerM: r.kg }] : [])),
  };
}

/**
 * Zemin leventinin etkin take-up'ı (SY-B1): SHARED_BEAM katmanı varsa en hızlı tükenen grup;
 * yoksa zemin değeri aynen. Levent hazırlığı ve hazır levent düşümü bunu okur.
 */
function groundBeamTakeUp(input: CostInput, groundTakeUp: Dec): Dec {
  const shared = (input.warpLayers ?? []).filter((l) => l.beamMode === "SHARED_BEAM");
  if (!shared.length) return groundTakeUp;
  const layerT = shared.map((l) => ({ beamMode: l.beamMode, takeUpPct: new Collector().take(l.takeUpPct, null) }));
  return pct(fastestGroupTakeUpPct(groundTakeUp.mul(HUNDRED), layerT)!);
}

/**
 * Çözgü metresinin kumaş karşılığı: L × (1 − t) — levent hazırlığı satırıyla aynı take-up çözümü.
 * İhtiyaç planı hazır levent düşümünde kullanır (formül kopyalanmaz); take-up yoksa null.
 */
export function fabricMetersFromWarpM(input: CostInput, warpM: Dec): Dec | null {
  if (!input.warp) return null;
  const t = new Collector().take(input.warp.takeUpPct, "TAKEUP_MISSING");
  return t === null ? null : warpM.mul(ONE.minus(groundBeamTakeUp(input, pct(t))));
}

const line = (component: CostComponent, label: string, amount: Dec, extra: Partial<CostLine> = {}): CostLine => ({
  component, label, yarnItemId: null, qty: null, qtyUnit: null, unitPriceTry: null, amountPerMTry: amount, ...extra,
});

/** V = n × 60 × η / (p × 100) = teorik m/sa × η; makine · işçilik · enerji satırları. */
function loomLines(input: CostInput, picksPerCm: Dec | null, c: Collector): { v: Dec; lines: CostLine[] } | null {
  const l = input.loom;
  const n = c.take(l.rpm, "RPM_MISSING", { PARAMETRE: "RPM_DEFAULTED" });
  const vals = [l.efficiencyPct, l.machineRateTry, l.laborRateTry, l.loomsPerOperator, l.energyKwhPerHour, l.energyPriceTry]
    .map((s) => c.take(s, "PARAMETER_SET_MISSING"));
  const theo = theoreticalMPerHourDecimal(n, picksPerCm);
  if (theo === null || vals.some((v) => v === null)) return null;
  const [eta, rm, rl, perOp, kwh, kwhPrice] = vals as Dec[];
  const v = theo.mul(pct(eta));
  if (!v.gt(0) || !perOp.gt(0)) {
    c.missing.add("RPM_MISSING");
    return null;
  }
  return {
    v,
    lines: [
      line("LOOM_MACHINE", "Tezgah", rm.div(v), { unitPriceTry: rm, qtyUnit: "sa" }),
      line("LOOM_LABOR", "İşçilik", rl.div(perOp).div(v), { unitPriceTry: rl, qtyUnit: "sa" }),
      line("ENERGY", "Enerji", kwh.mul(kwhPrice).div(v), { qty: kwh, qtyUnit: "kWh/sa", unitPriceTry: kwhPrice }),
    ],
  };
}

/** Ham metre maliyetinin iplik satırları (fiyat × kur). */
function yarnLines(input: CostInput, fx: FxRates, kg: { warp: ReturnType<typeof warpKgs>; weft: ReturnType<typeof weftKgs> }, c: Collector): CostLine[] | null {
  const { warp, weft } = kg;
  const out: CostLine[] = [];
  let ok = warp !== null && weft !== null;
  if (input.warp) {
    const p = toTry(input.warp.yarn.price, fx, c);
    const groundKg = warp?.groundKg;
    if (p === null) ok = false;
    else if (groundKg) out.push(line("WARP_YARN", `Çözgü — ${input.warp.yarn.name}`, groundKg.mul(p), { yarnItemId: input.warp.yarn.yarnItemId, qty: groundKg, qtyUnit: "kg", unitPriceTry: p }));
  }
  for (const [i, l] of (input.warpLayers ?? []).entries()) {
    const p = toTry(l.yarn.price, fx, c);
    const lk = warp?.layers[i]?.kg;
    if (p === null) ok = false;
    else if (lk) out.push(line("WARP_YARN", `Çözgü (${WARP_LAYER_ROLE_LABEL[l.role]}) — ${l.yarn.name}`, lk.mul(p), { yarnItemId: l.yarn.yarnItemId, qty: lk, qtyUnit: "kg", unitPriceTry: p }));
  }
  for (const [i, y] of (input.weft?.yarns ?? []).entries()) {
    const p = toTry(y.price, fx, c);
    const kg = weft?.perYarn[i]?.kg;
    if (p === null) ok = false;
    else if (kg) out.push(line("WEFT_YARN", `Atkı — ${y.name}`, kg.mul(p), { yarnItemId: y.yarnItemId, qty: kg, qtyUnit: "kg", unitPriceTry: p }));
  }
  return ok ? out : null;
}

/** Ham → mamul (terbiye + boy çekmesi): HAM_M (C+F)/(1−sᵦ) · MAMUL_M C/(1−sᵦ)+F; tarife yok → ham. */
function finishLines(input: CostInput, fx: FxRates, raw: Dec, c: Collector): { finished: Dec | null; keep: Dec; lines: CostLine[] } | null {
  const fin = input.finishing;
  if (!fin) return { finished: null, keep: ONE, lines: [] };
  const f = toTry(fin.price, fx, c, "FINISHING_RATE_MISSING");
  const sb = c.take(input.lengthShrinkPct, null) ?? (c.warnings.add("SHRINK_UNKNOWN"), ZERO);
  if (f === null) return null;
  const keep = ONE.minus(pct(sb));
  const finished = fin.basis === "RAW_M" ? raw.plus(f).div(keep) : raw.div(keep).plus(f);
  return {
    finished,
    keep,
    lines: [
      line("FINISHING", `Terbiye — ${fin.name}`, f, { unitPriceTry: f, qtyUnit: "m" }),
      line("LENGTH_SHRINK", "Boy çekmesi", finished.minus(raw).minus(f), { qty: sb, qtyUnit: "%" }),
    ],
  };
}

/** Ek işlem (§8): terbiyeden SONRA, kalite firesi + genel giderden ÖNCE; HAM_M tarifesi boy çekmesiyle mamul metreye taşınır. */
function processLines(input: CostInput, fx: FxRates, keep: Dec, c: Collector): CostLine[] {
  const out: CostLine[] = [];
  for (const p of input.processes ?? []) {
    const f = toTry(p.price, fx, c, "FINISHING_RATE_MISSING");
    if (f !== null) out.push(line("PROCESS", `İşlem — ${p.name}`, p.basis === "RAW_M" ? f.div(keep) : f, { unitPriceTry: f, qtyUnit: "m" }));
  }
  return out;
}

/** Plan §2.2 — `{result | null, missing[], warnings[]}`; eksik varsa sonuç YOK (yarım maliyet gösterilmez). */
export function computeFabricCost(input: CostInput, fx: FxRates): CostOutcome {
  const c = new Collector();
  if (!input.parameterSetId) c.missing.add("PARAMETER_SET_MISSING");
  const warp = warpKgs(input, c);
  const weft = weftKgs(input, c);
  const yarns = yarnLines(input, fx, { warp, weft }, c);
  const loom = loomLines(input, weft?.picksPerCm ?? null, c);
  const h = c.take(input.beam.prepCostTry, "PARAMETER_SET_MISSING");
  const lBeam = c.take(input.beam.lengthM, "PARAMETER_SET_MISSING");
  const fk = c.take(input.fabricWastePct, "PARAMETER_SET_MISSING");
  const g = c.take(input.overheadPct, "PARAMETER_SET_MISSING");
  if (!warp || !weft || !yarns || !loom || h === null || lBeam === null || fk === null || g === null) {
    for (const r of [input.finishing, ...(input.processes ?? [])]) if (r) toTry(r.price, fx, c, "FINISHING_RATE_MISSING"); // eksik listesi tam olsun
    return { result: null, missing: [...c.missing].sort(), warnings: [...c.warnings].sort() };
  }
  const prep = line("BEAM_PREP", "Levent hazırlığı", h.div(lBeam.mul(ONE.minus(groundBeamTakeUp(input, warp.takeUp)))), { unitPriceTry: h, qty: lBeam, qtyUnit: "m" });
  const rawLines = [...yarns, ...loom.lines, prep];
  const raw = rawLines.reduce((a, l) => a.plus(l.amountPerMTry), ZERO);
  const fin = finishLines(input, fx, raw, c);
  const procs = processLines(input, fx, fin?.keep ?? ONE, c);
  if (!fin || c.missing.size) return { result: null, missing: [...c.missing].sort(), warnings: [...c.warnings].sort() };
  const mamul = procs.reduce((a, l) => a.plus(l.amountPerMTry), fin.finished ?? raw);
  const sound = mamul.div(ONE.minus(pct(fk)));
  const overhead = sound.mul(pct(g));
  const extra = input.extra?.amountTry ?? ZERO;
  const lines = [
    ...rawLines,
    ...fin.lines,
    ...procs,
    line("FABRIC_WASTE", "Kalite firesi", sound.minus(mamul), { qty: fk, qtyUnit: "%" }),
    line("OVERHEAD", "Genel gider", overhead, { qty: g, qtyUnit: "%" }),
    ...(input.extra ? [line("EXTRA", input.extra.label ?? "Ek kalem", extra)] : []),
  ];
  const result: CostResult = {
    lines,
    warpKgPerM: warp.kg,
    weftKgPerM: weft.perYarn.reduce((a, x) => a.plus(x.kg), ZERO),
    loomMPerHour: loom.v,
    rawCostPerMTry: raw,
    finishedCostPerMTry: procs.length ? mamul : fin.finished, // ek işlem mamul aşamasıdır
    soundCostPerMTry: sound,
    overheadPerMTry: overhead,
    totalCostPerMTry: sound.plus(overhead).plus(extra),
  };
  return { result, missing: [], warnings: [...c.warnings].sort() };
}

// Sunum ve teklif önerisi ayrı modülde (dosya boyu); tüketiciler bu dosyadan almaya devam eder.
export { presentCostResult, roundCost4, roundKg6, suggestUnitPrice } from "./fabric-cost-present.helper";
