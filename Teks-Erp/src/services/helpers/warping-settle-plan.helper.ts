// =============================================================================
// FASON DEVERE D5b — KAPANIŞ PLANI (saf; önizleme ve kapanış aynı fonksiyon)
// =============================================================================
// Kalan iplik kalem kalem (sevk kalemi × lot) üçe bölünür: İADE (depoya döner) · FİRE (defter satırı) · DEVERECİDE
// KALIR (kayıt yok; tutma açık kalır, sonraki siparişe devreder). Gövdede satır yoksa VARSAYILAN A1-a: iplik başına
// fire = min(kalan, plan brüt − plan net), sevk sırasıyla (FIFO) kalemlere; fazlası kalır, iade 0.
// fire % = Σ fire / (Σ sarılan nominal + Σ fire); tolerans (siparişte donmuş, NULL/0 = denetim yok) yalnız UYARIR.
// =============================================================================
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import type { WarpingYarnItem } from "./warping-yarn-open.helper";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kg = (v: Prisma.Decimal) => v.toFixed(3);
const ZERO = D(0);

export interface WarpingSettleLineInput {
  dispatchItemId: string;
  returnKg?: number;
  wasteKg?: number;
  /** İade sebebi (`YARN_SUBCONTRACT_RETURN`); yoksa gövdenin `returnReasonCode`u. */
  returnReasonCode?: string | null;
  /** İadenin girdiği depo; yoksa çıkışın deposu. */
  warehouseId?: string | null;
}
export interface WarpingSettleBody {
  reason?: string | null;
  returnReasonCode?: string | null;
  /** Verilmezse varsayılan A1-a; verilirse listede olmayan kalem tümüyle "deverecide kalır". */
  lines?: WarpingSettleLineInput[];
}

export interface SettlePlanLine {
  dispatchItemId: string; dispatchId: string; dispatchNo: string; yarnItemId: string; lotId: string | null; lotNo: string | null;
  own: boolean; holdingKg: Prisma.Decimal; returnKg: Prisma.Decimal; wasteKg: Prisma.Decimal; keepKg: Prisma.Decimal;
  returnReasonCode: string | null; warehouseId: string | null;
}
export interface SettlePlanYarn {
  yarnItemId: string; code: string; plannedWasteKg: Prisma.Decimal; woundKg: Prisma.Decimal;
  holdingKg: Prisma.Decimal; returnKg: Prisma.Decimal; wasteKg: Prisma.Decimal; keepKg: Prisma.Decimal;
  wastePct: Prisma.Decimal | null; overTolerance: boolean;
}
export interface SettlePlan {
  isDefault: boolean;
  lines: SettlePlanLine[];
  yarns: SettlePlanYarn[];
  wastePct: Prisma.Decimal | null;
  tolerancePct: Prisma.Decimal | null;
  overTolerance: boolean;
  warnings: string[];
}
export interface SettlePlanYarnInput { yarnItemId: string; code: string; netKg: string; grossKg: string; woundKg: string; unallocatedKg: string }

const dec3 = (v: number, ad: string) => {
  const d = D(v).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  if (!d.isFinite() || d.lt(0)) throw AppError.badRequest(`${ad} negatif olamaz.`, { code: "VALIDATION_ERROR" });
  return d;
};
const pct = (part: Prisma.Decimal, whole: Prisma.Decimal) => (whole.isZero() ? null : part.div(whole).mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP));

function defaultSplit(held: WarpingYarnItem[], yarns: SettlePlanYarnInput[]): Map<string, Prisma.Decimal> {
  const waste = new Map<string, Prisma.Decimal>();
  for (const y of yarns) {
    const items = held.filter((i) => i.yarnItemId === y.yarnItemId);
    const left = items.reduce((s, i) => s.plus(i.openKg), ZERO);
    let rest = Prisma.Decimal.min(left, Prisma.Decimal.max(ZERO, D(y.grossKg).minus(y.netKg)));
    for (const it of items) {
      const take = Prisma.Decimal.min(rest, it.openKg);
      if (take.gt(0)) waste.set(it.dispatchItemId, take);
      rest = rest.minus(take);
    }
  }
  return waste;
}

function explicitLines(held: WarpingYarnItem[], body: WarpingSettleBody): Map<string, { ret: Prisma.Decimal; waste: Prisma.Decimal; reason: string | null; wh: string | null }> {
  const byId = new Map(held.map((i) => [i.dispatchItemId, i]));
  const out = new Map<string, { ret: Prisma.Decimal; waste: Prisma.Decimal; reason: string | null; wh: string | null }>();
  for (const l of body.lines ?? []) {
    const it = byId.get(l.dispatchItemId);
    if (!it) throw AppError.badRequest("Kapanış satırı bu siparişin deverecide tuttuğu bir kalem değil.", { code: "WARPING_SETTLE_LINE_UNKNOWN", dispatchItemId: l.dispatchItemId });
    if (out.has(l.dispatchItemId)) throw AppError.badRequest("Aynı kalem kapanışta iki kez yazılamaz.", { code: "WARPING_SETTLE_LINE_DUPLICATE", dispatchItemId: l.dispatchItemId });
    const ret = dec3(l.returnKg ?? 0, "İade kg");
    const waste = dec3(l.wasteKg ?? 0, "Fire kg");
    if (ret.plus(waste).gt(it.openKg)) {
      throw AppError.badRequest(`${it.dispatchNo} kaleminde iade + fire, deverecide tutulanı aşamaz (tutulan ${kg(it.openKg)} kg, iade ${kg(ret)} + fire ${kg(waste)}).`, {
        code: "WARPING_SETTLE_EXCEEDS", dispatchItemId: it.dispatchItemId, holdingKg: kg(it.openKg),
      });
    }
    const reason = l.returnReasonCode?.trim() || body.returnReasonCode?.trim() || null;
    if (ret.gt(0) && !reason) throw AppError.badRequest("İade satırında iade sebebi zorunlu.", { code: "WARPING_SETTLE_RETURN_REASON", dispatchItemId: it.dispatchItemId });
    out.set(l.dispatchItemId, { ret, waste, reason, wh: l.warehouseId ?? null });
  }
  return out;
}

/** Kapanış planı — `held` siparişin TAZE tutması (sevk sırası), `yarns` plan + sarılan nominal. */
export function buildSettlePlan(held0: WarpingYarnItem[], yarns: SettlePlanYarnInput[], body: WarpingSettleBody, tolerance: Prisma.Decimal | null): SettlePlan {
  const held = held0.filter((i) => i.openKg.gt(0));
  const isDefault = body.lines === undefined;
  const dflt = isDefault ? defaultSplit(held, yarns) : new Map<string, Prisma.Decimal>();
  const expl = isDefault ? new Map() : explicitLines(held, body);
  const lines: SettlePlanLine[] = held.map((it) => {
    const e = expl.get(it.dispatchItemId);
    const returnKg = e?.ret ?? ZERO;
    const wasteKg = isDefault ? (dflt.get(it.dispatchItemId) ?? ZERO) : (e?.waste ?? ZERO);
    return {
      dispatchItemId: it.dispatchItemId, dispatchId: it.dispatchId, dispatchNo: it.dispatchNo, yarnItemId: it.yarnItemId, lotId: it.lotId, lotNo: it.lotNo,
      own: it.own, holdingKg: it.openKg, returnKg, wasteKg, keepKg: it.openKg.minus(returnKg).minus(wasteKg),
      returnReasonCode: e?.reason ?? null, warehouseId: e?.wh ?? null,
    };
  });
  const tol = tolerance && tolerance.gt(0) ? tolerance : null;
  const warnings: string[] = [];
  let totWaste = ZERO;
  let totWound = ZERO;
  const yarnRows: SettlePlanYarn[] = yarns.map((y) => {
    const ls = lines.filter((l) => l.yarnItemId === y.yarnItemId);
    const sum = (f: (l: SettlePlanLine) => Prisma.Decimal) => ls.reduce((s, l) => s.plus(f(l)), ZERO);
    const wasteKg = sum((l) => l.wasteKg);
    const woundKg = D(y.woundKg);
    totWaste = totWaste.plus(wasteKg);
    totWound = totWound.plus(woundKg);
    const p = pct(wasteKg, woundKg.plus(wasteKg));
    const over = tol !== null && p !== null && p.gt(tol);
    if (over) warnings.push(`${y.code}: fire %${p!.toFixed(2)} toleransı (%${tol!.toFixed(2)}) aşıyor — kapanış engellenmez, gerekçe yazmanız önerilir.`);
    if (D(y.unallocatedKg).gt(0)) warnings.push(`${y.code}: nominal tüketim deverecideki iplikten ${kg(D(y.unallocatedKg))} kg fazla (bilgi).`);
    return {
      yarnItemId: y.yarnItemId, code: y.code, plannedWasteKg: Prisma.Decimal.max(ZERO, D(y.grossKg).minus(y.netKg)), woundKg,
      holdingKg: sum((l) => l.holdingKg), returnKg: sum((l) => l.returnKg), wasteKg, keepKg: sum((l) => l.keepKg), wastePct: p, overTolerance: over,
    };
  });
  const wastePct = pct(totWaste, totWound.plus(totWaste));
  const overAll = tol !== null && wastePct !== null && wastePct.gt(tol);
  if (overAll) warnings.unshift(`Sipariş geneli fire %${wastePct!.toFixed(2)} toleransı (%${tol!.toFixed(2)}) aşıyor — kapanış engellenmez.`);
  return { isDefault, lines, yarns: yarnRows, wastePct, tolerancePct: tol, overTolerance: overAll || yarnRows.some((y) => y.overTolerance), warnings };
}

/** Kapanış gövdesinin özeti — replay kimliği (aynı token farklı gövde 409). */
export function settleRequestHash(body: WarpingSettleBody): string {
  const lines = body.lines === undefined ? "A1-a" : [...body.lines]
    .sort((a, b) => a.dispatchItemId.localeCompare(b.dispatchItemId))
    .map((l) => [l.dispatchItemId, D(l.returnKg ?? 0).toFixed(3), D(l.wasteKg ?? 0).toFixed(3), l.returnReasonCode?.trim() || "", l.warehouseId ?? ""].join("|"));
  const norm = JSON.stringify({ reason: body.reason?.trim() || "", returnReasonCode: body.returnReasonCode?.trim() || "", lines });
  return createHash("sha256").update(norm).digest("hex");
}

/** DTO biçimi (kg/% metin). */
export function settlePlanDto(p: SettlePlan) {
  const k = (v: Prisma.Decimal) => kg(v);
  return {
    isDefault: p.isDefault,
    wastePct: p.wastePct?.toFixed(2) ?? null,
    tolerancePct: p.tolerancePct?.toFixed(2) ?? null,
    overTolerance: p.overTolerance,
    lines: p.lines.map((l) => ({
      dispatchItemId: l.dispatchItemId, dispatchId: l.dispatchId, dispatchNo: l.dispatchNo, yarnItemId: l.yarnItemId, lotId: l.lotId, lotNo: l.lotNo, own: l.own,
      holdingKg: k(l.holdingKg), returnKg: k(l.returnKg), wasteKg: k(l.wasteKg), keepKg: k(l.keepKg),
    })),
    yarns: p.yarns.map((y) => ({
      yarnItemId: y.yarnItemId, code: y.code, plannedWasteKg: k(y.plannedWasteKg), woundKg: k(y.woundKg), holdingKg: k(y.holdingKg),
      returnKg: k(y.returnKg), wasteKg: k(y.wasteKg), keepKg: k(y.keepKg), wastePct: y.wastePct?.toFixed(2) ?? null, overTolerance: y.overTolerance,
    })),
  };
}
