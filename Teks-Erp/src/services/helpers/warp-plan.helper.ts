// =============================================================================
// ÇÖZGÜ HESAP MOTORU — tek helper (fason devere D1, plan §5; saf, DB'siz)
// =============================================================================
// İki yön: (a) levent adedi × boy → iplik başına kg; (b) eldeki iplik → en çok metre + kısıtlayan iplik.
// Formül KOPYALANMAZ: kg `warpYarnKgExact`, ters yön `warpLengthFromKgExact` (`constants/warp-beam.ts`),
// iplik firesi `resolveYarnWastePct`. İç hesap yuvarlamasız Decimal; YALNIZ çıktı biçimi yuvarlanır
// (kg 3 hane, metre 1 hane, HALF_UP). Sevk önerisi yuvarlanmaz (karar 2026-11-17: adım/tam kg yok).
// Fire BÖLEREK uygulanır (maliyet motoruyla aynı): brüt = kg(L + sabit fire) ÷ (1 − f).
// =============================================================================
import { Prisma } from "@prisma/client";
import { warpLengthFromKgExact, warpYarnKgExact } from "../../constants/warp-beam";
import { resolveYarnWastePct, type YarnWasteSource } from "./yarn-waste.helper";

type Dec = Prisma.Decimal;
type DecIn = Prisma.Decimal.Value;

export interface WarpPlanLineInput {
  yarnItemId: string;
  endsCount: number;
  denier: DecIn;
  /** İplik kartı firesi (`Item.yarnWastePct`, %); boşsa kart firesi geçer. */
  yarnWastePct: DecIn | null;
}

/** Stok kesiti — `depoKg: null` = bilinmiyor (iplik modülü kapalı), 0 DEĞİL; `fasondaKg: null` = devereci seçilmedi. */
export interface WarpPlanStock {
  depoKg: DecIn | null;
  fasondaKg: DecIn | null;
}

export interface WarpPlanCommonInput {
  lines: ReadonlyArray<WarpPlanLineInput>;
  /** Çözgü kartı firesi (`WarpSpec.wastePct`, %). */
  specWastePct: DecIn | null;
  /** Sipariş başına sabit fire metresi (baş/son/düğüm). */
  fixedWasteM: DecIn;
  stock?: ReadonlyMap<string, WarpPlanStock>;
}

export type WarpWasteSource =
  | { kind: "SABIT_M"; value: number }
  | { kind: "KART_PCT"; value: number }
  | { kind: "IPLIK_PCT"; yarnItemId: string; value: number };

export interface WarpPlanForwardLine {
  yarnItemId: string;
  endsCount: number;
  wastePct: number;
  wasteSource: YarnWasteSource;
  /** Formül (firesiz) — müşterinin kâğıttaki formülünün sonucu. */
  netKg: number;
  /** Fireli öneri; fire girdisi yoksa `netKg` ile aynı. */
  grossKg: number;
  depoKg: number | null;
  fasondaKg: number | null;
  /** Gönderilecek = max(0, brüt − deverecide duran). */
  sendKg: number;
  /** Depo eksiği = max(0, gönderilecek − depo); depo bilinmiyorsa null. */
  depoShortKg: number | null;
}

export interface WarpPlanForwardResult {
  lengthM: number;
  grossLengthM: number;
  hasWaste: boolean;
  wasteSources: WarpWasteSource[];
  lines: WarpPlanForwardLine[];
  totals: { netKg: number; grossKg: number; sendKg: number };
}

export interface WarpPlanReverseLine {
  yarnItemId: string;
  availableKg: number | null;
  /** Bu iplik tek başına kaç metreye yeter (fireli, sabit fire düşülmeden). */
  maxLengthM: number | null;
  /** `maxLengthM` sarılınca artan kg. */
  leftoverKg: number | null;
}

export interface WarpPlanReverseResult {
  /** En çok sarılabilecek çözgü metresi (aşağı, 1 m'ye); stok bilinmiyorsa null. */
  maxLengthM: number | null;
  constraintYarnItemId: string | null;
  insufficient: boolean;
  unknownStock: boolean;
  fullBeams: number | null;
  remainderM: number | null;
  hasWaste: boolean;
  wasteSources: WarpWasteSource[];
  lines: WarpPlanReverseLine[];
}

const D = (v: DecIn): Dec => new Prisma.Decimal(v);
const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const kgOut = (v: Dec): number => Number(v.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP));
const mOut = (v: Dec): number => Number(v.toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP));
const maxD = (a: Dec, b: Dec): Dec => (a.greaterThan(b) ? a : b);

interface ResolvedLine {
  input: WarpPlanLineInput;
  f: Dec;
  source: YarnWasteSource;
}

function resolveLines(input: WarpPlanCommonInput): { lines: ResolvedLine[]; fixed: Dec; hasWaste: boolean; wasteSources: WarpWasteSource[] } {
  if (input.lines.length === 0) throw new Error("warp-plan: satırsız hesap");
  const fixed = D(input.fixedWasteM);
  if (fixed.isNegative()) throw new Error("warp-plan: sabit fire negatif olamaz");
  const specPct = input.specWastePct == null ? null : D(input.specWastePct);
  const lines = input.lines.map((l): ResolvedLine => {
    if (!Number.isInteger(l.endsCount) || l.endsCount <= 0) throw new Error("warp-plan: tel > 0 tam sayı olmalı");
    if (!D(l.denier).greaterThan(0)) throw new Error("warp-plan: denye > 0 olmalı");
    const r = resolveYarnWastePct(l.yarnWastePct == null ? null : D(l.yarnWastePct), { value: specPct, source: "KART" });
    const f = r.value ?? ZERO;
    if (f.isNegative() || f.greaterThanOrEqualTo(HUNDRED)) throw new Error("warp-plan: fire 0 ≤ f < 100 olmalı");
    return { input: l, f, source: r.source };
  });
  const wasteSources: WarpWasteSource[] = [];
  if (fixed.greaterThan(0)) wasteSources.push({ kind: "SABIT_M", value: Number(fixed) });
  if (specPct && specPct.greaterThan(0) && lines.some((l) => l.source === "KART")) wasteSources.push({ kind: "KART_PCT", value: Number(specPct) });
  for (const l of lines) {
    if (l.source === "IPLIK" && l.f.greaterThan(0)) wasteSources.push({ kind: "IPLIK_PCT", yarnItemId: l.input.yarnItemId, value: Number(l.f) });
  }
  const hasWaste = fixed.greaterThan(0) || lines.some((l) => l.f.greaterThan(0));
  return { lines, fixed, hasWaste, wasteSources };
}

/** Fireli brüt kg: kg(L + sabit fire) ÷ (1 − f/100). */
function grossKgExact(l: ResolvedLine, lengthM: Dec, fixed: Dec): Dec {
  return warpYarnKgExact(l.input.endsCount, l.input.denier, lengthM.plus(fixed)).div(new Prisma.Decimal(1).minus(l.f.div(HUNDRED)));
}

/** İleri yön (plan §5.2): levent adedi × boy → iplik başına net/brüt/gönderilecek kg. */
export function computeWarpPlanForward(input: WarpPlanCommonInput & { beamCount: number; beamLengthM: DecIn }): WarpPlanForwardResult {
  if (!Number.isInteger(input.beamCount) || input.beamCount <= 0) throw new Error("warp-plan: levent adedi > 0 tam sayı olmalı");
  const beamLength = D(input.beamLengthM);
  if (!beamLength.greaterThan(0)) throw new Error("warp-plan: levent boyu > 0 olmalı");
  const { lines, fixed, hasWaste, wasteSources } = resolveLines(input);
  const L = beamLength.mul(input.beamCount);
  let tNet = ZERO, tGross = ZERO, tSend = ZERO;
  const out = lines.map((l): WarpPlanForwardLine => {
    const net = warpYarnKgExact(l.input.endsCount, l.input.denier, L);
    const gross = hasWaste ? grossKgExact(l, L, fixed) : net;
    const st = input.stock?.get(l.input.yarnItemId);
    const fasonda = st?.fasondaKg == null ? null : D(st.fasondaKg);
    const depo = st?.depoKg == null ? null : D(st.depoKg);
    const send = maxD(ZERO, gross.minus(fasonda ?? ZERO));
    tNet = tNet.plus(net); tGross = tGross.plus(gross); tSend = tSend.plus(send);
    return {
      yarnItemId: l.input.yarnItemId,
      endsCount: l.input.endsCount,
      wastePct: Number(l.f),
      wasteSource: l.source,
      netKg: kgOut(net),
      grossKg: kgOut(gross),
      depoKg: depo == null ? null : kgOut(depo),
      fasondaKg: fasonda == null ? null : kgOut(fasonda),
      sendKg: kgOut(send),
      depoShortKg: depo == null ? null : kgOut(maxD(ZERO, send.minus(depo))),
    };
  });
  return {
    lengthM: mOut(L),
    grossLengthM: mOut(L.plus(fixed)),
    hasWaste,
    wasteSources,
    lines: out,
    totals: { netKg: kgOut(tNet), grossKg: kgOut(tGross), sendKg: kgOut(tSend) },
  };
}

/**
 * Ters yön (plan §5.3): kullanılabilir = depo + deverecide. L_j = kullanılabilir × (1 − f) × 9e6 / (tel × denye);
 * L_max = min_j L_j − sabit fire, aşağı 1 m'ye. Kısıt = en küçük L_j (eşitlikte sıradaki ilk satır).
 */
export function computeWarpPlanReverse(input: WarpPlanCommonInput & { beamLengthM?: DecIn | null }): WarpPlanReverseResult {
  const { lines, fixed, hasWaste, wasteSources } = resolveLines(input);
  const avail = lines.map((l) => {
    const st = input.stock?.get(l.input.yarnItemId);
    if (!st || st.depoKg == null) return null;
    return D(st.depoKg).plus(st.fasondaKg == null ? ZERO : D(st.fasondaKg));
  });
  const perLine = lines.map((l, i) => {
    const a = avail[i];
    if (a == null) return null;
    const usable = maxD(ZERO, a);
    return warpLengthFromKgExact(l.input.endsCount, l.input.denier, usable).mul(new Prisma.Decimal(1).minus(l.f.div(HUNDRED)));
  });
  const unknownStock = perLine.some((x) => x == null);
  let minIdx = -1;
  if (!unknownStock) {
    perLine.forEach((x, i) => {
      if (minIdx < 0 || x!.lessThan(perLine[minIdx]!)) minIdx = i;
    });
  }
  let maxL: Dec | null = null;
  if (!unknownStock) {
    const raw = perLine[minIdx]!.minus(fixed).toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR);
    maxL = raw.greaterThan(0) ? raw : ZERO;
  }
  const beamLength = input.beamLengthM == null ? null : D(input.beamLengthM);
  if (beamLength && !beamLength.greaterThan(0)) throw new Error("warp-plan: levent boyu > 0 olmalı");
  const fullBeams = maxL != null && beamLength ? Number(maxL.div(beamLength).toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR)) : null;
  const remainder = maxL != null && beamLength && fullBeams != null ? maxL.minus(beamLength.mul(fullBeams)) : null;
  return {
    maxLengthM: maxL == null ? null : mOut(maxL),
    constraintYarnItemId: unknownStock ? null : lines[minIdx]!.input.yarnItemId,
    insufficient: maxL != null && maxL.isZero(),
    unknownStock,
    fullBeams,
    remainderM: remainder == null ? null : mOut(remainder),
    hasWaste,
    wasteSources,
    lines: lines.map((l, i) => {
      const a = avail[i];
      const used = maxL == null ? null : maxL.isZero() ? ZERO : hasWaste ? grossKgExact(l, maxL, fixed) : warpYarnKgExact(l.input.endsCount, l.input.denier, maxL);
      return {
        yarnItemId: l.input.yarnItemId,
        availableKg: a == null ? null : kgOut(a),
        maxLengthM: perLine[i] == null ? null : mOut(perLine[i]!),
        leftoverKg: a == null || used == null ? null : kgOut(a.minus(used)),
      };
    }),
  };
}

/** Giriş yardımcısı (yalnız ÖNERİR): "1000 m'ye X kg, D denye" → tel = round(X ÷ kg/tel/1000 m); fark = X − karşılığı. */
export function endsFromKgPer1000m(kgPer1000m: DecIn, denier: DecIn): { endsCount: number; diffKg: number } {
  const kg = D(kgPer1000m);
  if (!kg.greaterThan(0) || !D(denier).greaterThan(0)) throw new Error("warp-plan: kg ve denye > 0 olmalı");
  const perEnd = warpYarnKgExact(1, denier, 1000);
  const ends = Math.max(1, Number(kg.div(perEnd).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)));
  return { endsCount: ends, diffKg: kgOut(kg.minus(warpYarnKgExact(ends, denier, 1000))) };
}

/** Giriş yardımcısı (yalnız ÖNERİR): tel = round(tarak (tel/cm) × en (cm) × dişe tel). Tarak birimi profildir. */
export function endsFromReed(reedPerCm: DecIn, widthCm: DecIn, endsPerDent: number = 1): number {
  if (!D(reedPerCm).greaterThan(0) || !D(widthCm).greaterThan(0) || !Number.isInteger(endsPerDent) || endsPerDent <= 0) {
    throw new Error("warp-plan: tarak, en ve dişe tel > 0 olmalı");
  }
  return Number(D(reedPerCm).mul(widthCm).mul(endsPerDent).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP));
}
