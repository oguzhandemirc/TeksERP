// =============================================================================
// DEVERE F1 — DENYE SAPMA hesabı (saf, YALNIZ OKUR)
// =============================================================================
// Girdi: kabul edilmiş (K3 `ACCEPTED_WARPING_BEAM_WHERE`) ve tartılı (WOUND brüt + dara dolu) devere sarımları.
// Tek iplikli sarım iplik satırına, çok iplikli sarım "karma" satırına girer (tartı ipliklere bölünemez).
// Tartı denyesi = `denierFromKgExact(Σ net kg, Σ tel × metre)` — doğuş kopyaları farklı denyeli olsa da doğru kalır.
// Öneri: örnek ≥ `minBeams` ∧ |tartı denyesi − GÜNCEL kart denyesi| / kart > eşik% (uygulanmış öneri tekrar önerilmez).
// =============================================================================
import { Prisma } from "@prisma/client";
import { denierFromKgExact } from "../../constants/warp-beam";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

export type DenierDeviationStatus = "SUGGEST" | "WITHIN_THRESHOLD" | "INSUFFICIENT";

/** Bir tartılı sarımın hesaba giren gerçekleri (WOUND + kırılım). */
export interface DenierSampleBeam {
  lengthM: Prisma.Decimal;
  grossKg: Prisma.Decimal;
  tareKg: Prisma.Decimal;
  yarns: ReadonlyArray<{ yarnItemId: string; endsCount: number; denier: Prisma.Decimal; theoreticalKg: Prisma.Decimal }>;
}

export interface DenierYarnCard { id: string; code: string; name: string; linearDensityDen: Prisma.Decimal | null }

export interface DenierDeviationRow {
  yarnItemId: string;
  code: string;
  name: string;
  beamCount: number;
  lengthM: string;
  nominalKg: string;
  weighedNetKg: string;
  /** (net − nominal) ÷ nominal × 100, 2 hane; nominal 0 → null. */
  deviationPct: string | null;
  /** Sarımlara kopyalanan denye — hepsi aynıysa o, değilse null (kart arada değişmiş). */
  copiedDenier: string | null;
  /** Tartıdan bulunan denye (2 hane). */
  weighedDenier: string | null;
  /** İplik kartındaki GÜNCEL denye; [Uygula] bunu `expectedDenier` olarak geri yollar. */
  cardDenier: string | null;
  /** (tartı denyesi − kart) ÷ kart × 100, 2 hane; kart boşsa null. */
  cardDeviationPct: string | null;
  status: DenierDeviationStatus;
  /** Yalnız `SUGGEST`te dolu (= `weighedDenier`). */
  suggestedDenier: string | null;
}

export interface DenierDeviationMixed {
  beamCount: number;
  lengthM: string;
  nominalKg: string;
  weighedNetKg: string;
  deviationPct: string | null;
  yarnItemIds: string[];
}

export interface DenierDeviationResult { rows: DenierDeviationRow[]; mixed: DenierDeviationMixed | null }

const kg = (v: Prisma.Decimal) => v.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP).toFixed(3);
const pct = (num: Prisma.Decimal, den: Prisma.Decimal) =>
  den.isZero() ? null : num.minus(den).div(den).mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Saf hesap: sarımlar + iplik kartları + iki eşik → iplik satırları ve karma satırı. */
export function computeDenierDeviation(
  beams: ReadonlyArray<DenierSampleBeam>,
  cards: ReadonlyMap<string, DenierYarnCard>,
  opts: { minBeams: number; thresholdPct: number },
): DenierDeviationResult {
  type Acc = { beamCount: number; lengthM: Prisma.Decimal; nominal: Prisma.Decimal; net: Prisma.Decimal; endsM: Prisma.Decimal; deniers: Set<string> };
  const byYarn = new Map<string, Acc>();
  const mixed = { beamCount: 0, lengthM: ZERO, nominal: ZERO, net: ZERO, yarns: new Set<string>() };
  for (const b of beams) {
    if (b.yarns.length === 0) continue;
    const net = b.grossKg.minus(b.tareKg);
    const nominal = b.yarns.reduce((s, y) => s.plus(y.theoreticalKg), ZERO);
    if (b.yarns.length > 1) {
      mixed.beamCount += 1;
      mixed.lengthM = mixed.lengthM.plus(b.lengthM);
      mixed.nominal = mixed.nominal.plus(nominal);
      mixed.net = mixed.net.plus(net);
      for (const y of b.yarns) mixed.yarns.add(y.yarnItemId);
      continue;
    }
    const y = b.yarns[0]!;
    const a = byYarn.get(y.yarnItemId) ?? { beamCount: 0, lengthM: ZERO, nominal: ZERO, net: ZERO, endsM: ZERO, deniers: new Set<string>() };
    a.beamCount += 1;
    a.lengthM = a.lengthM.plus(b.lengthM);
    a.nominal = a.nominal.plus(nominal);
    a.net = a.net.plus(net);
    a.endsM = a.endsM.plus(b.lengthM.mul(y.endsCount));
    a.deniers.add(y.denier.toString());
    byYarn.set(y.yarnItemId, a);
  }

  const threshold = D(opts.thresholdPct);
  const rows: DenierDeviationRow[] = [];
  for (const [yarnItemId, a] of byYarn) {
    const card = cards.get(yarnItemId);
    const weighed = a.endsM.isZero() ? null : denierFromKgExact(a.net, a.endsM).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const cardDen = card?.linearDensityDen ?? null;
    const cardDev = weighed && cardDen && !cardDen.isZero() ? pct(weighed, cardDen) : null;
    let status: DenierDeviationStatus;
    if (a.beamCount < opts.minBeams || weighed === null) status = "INSUFFICIENT";
    else if (cardDev === null || cardDev.abs().gt(threshold)) status = "SUGGEST";
    else status = "WITHIN_THRESHOLD";
    rows.push({
      yarnItemId,
      code: card?.code ?? "",
      name: card?.name ?? "",
      beamCount: a.beamCount,
      lengthM: kg(a.lengthM),
      nominalKg: kg(a.nominal),
      weighedNetKg: kg(a.net),
      deviationPct: pct(a.net, a.nominal)?.toFixed(2) ?? null,
      copiedDenier: a.deniers.size === 1 ? [...a.deniers][0]! : null,
      weighedDenier: weighed?.toFixed(2) ?? null,
      cardDenier: cardDen?.toString() ?? null,
      cardDeviationPct: cardDev?.toFixed(2) ?? null,
      status,
      suggestedDenier: status === "SUGGEST" ? weighed!.toFixed(2) : null,
    });
  }
  rows.sort((x, y) => x.name.localeCompare(y.name, "tr") || x.code.localeCompare(y.code, "tr") || x.yarnItemId.localeCompare(y.yarnItemId));
  return {
    rows,
    mixed: mixed.beamCount === 0 ? null : {
      beamCount: mixed.beamCount,
      lengthM: kg(mixed.lengthM),
      nominalKg: kg(mixed.nominal),
      weighedNetKg: kg(mixed.net),
      deviationPct: pct(mixed.net, mixed.nominal)?.toFixed(2) ?? null,
      yarnItemIds: [...mixed.yarns].sort(),
    },
  };
}
