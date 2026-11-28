// =============================================================================
// FASON DEVERE SİPARİŞİ — plan hesabı (D4a; tek yer: önizleme, oluşturma, düzenleme aynı fonksiyon)
// =============================================================================
// Hedef = Σ(levent adedi × boy) satırları (K6) ya da adet belli değilse yalnız toplam metre (`resolvePlanTarget`). Ana kart + ek tel grupları (aynı levent — döner varsayılanı)
// satırları birleşir; aynı iplik iki karttan gelirse teller toplanır, kaynak ilk kart kalır. Aritmetik
// `warp-plan.helper`dan (formül kopyalanmaz); kart firesi her satırın KENDİ kaynak kartından gelir.
// =============================================================================
import { ItemType, Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { resolveDenier } from "../../constants/warp-beam";
import { computeWarpPlanForward, type WarpWasteSource } from "../helpers/warp-plan.helper";
import type { YarnWasteSource } from "../helpers/yarn-waste.helper";
import { WARP_SPEC_YARN_LINES_SELECT, warpSpecYarnLines } from "../helpers/warp-spec-yarn.helper";
import { isSharedBeamLayer, WARP_BEAM_MODE_LABEL, type WarpBeamModeCode } from "../helpers/warp-layer-beam.helper";
import { readLayerModesOnGround, readSharedBeamSpecsForGround } from "../helpers/effective-construction.helper";

type Db = Pick<Prisma.TransactionClient, "warpSpec" | "item" | "itemWarpLayer">;

export const WARPING_ORDER_MAX_BEAM_LINES = 20;
export const WARPING_ORDER_MAX_EXTRA_SPECS = 5;

export interface BeamLineInput {
  beamCount: number;
  beamLengthM: number | string;
}

/** Hedef girdisi: `beamLines` (adet × boy) YA DA `openTargetLengthM` (adet devereciye bırakıldı) — tam biri. */
export interface PlanTargetInput {
  beamLines?: BeamLineInput[];
  openTargetLengthM?: number | string;
}

export interface WarpingPlanInput extends PlanTargetInput {
  warpSpecId: string;
  extraWarpSpecIds: string[];
  fixedWasteM: Prisma.Decimal.Value;
}

export interface WarpingPlanYarn {
  yarnItemId: string;
  code: string;
  name: string;
  sourceWarpSpecId: string;
  endsCount: number;
  denier: Prisma.Decimal;
  wastePct: Prisma.Decimal;
  /** Uygulanan firenin kaynağı (`resolveYarnWastePct`): IPLIK = iplik kartı, KART = çözgü kartı firesi (yoksa 0). */
  wasteSource: YarnWasteSource;
  /** Kaynak çözgü kartının firesi (%) — iplik firesi geçtiğinde "uygulanmayan" değer olarak gösterilir. */
  specWastePct: Prisma.Decimal | null;
  /** Formül (firesiz) — müşterinin kâğıttaki formülü. */
  netKg: Prisma.Decimal;
  /** Fireli öneri; fire girdisi yoksa `netKg` ile aynı. */
  grossKg: Prisma.Decimal;
  sortOrder: number;
}

export interface WarpingPlan {
  /** `sequenceNote`: ana kartın dizilim notu (önizleme şeridi için; plana girmez). */
  spec: { id: string; code: string; name: string; sequenceNote: string | null };
  extras: Array<{ id: string; code: string; name: string }>;
  beamLines: Array<{ beamCount: number; beamLengthM: Prisma.Decimal; sortOrder: number }>;
  /** NULL = levent adedi belli değil (devereciye bırakıldı; satır yok, hedef yalnız toplam metre). */
  beamCount: number | null;
  targetLengthM: Prisma.Decimal;
  hasWaste: boolean;
  wasteSources: WarpWasteSource[];
  yarns: WarpingPlanYarn[];
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export function normalizeBeamLines(lines: BeamLineInput[]): WarpingPlan["beamLines"] {
  if (lines.length === 0 || lines.length > WARPING_ORDER_MAX_BEAM_LINES) {
    throw AppError.badRequest(`Levent satırı 1 ile ${WARPING_ORDER_MAX_BEAM_LINES} arasında olmalı.`, { code: "WARPING_BEAM_LINES_INVALID" });
  }
  return lines.map((l, i) => {
    const len = D(l.beamLengthM).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
    if (!Number.isInteger(l.beamCount) || l.beamCount <= 0) throw AppError.badRequest("Levent adedi sıfırdan büyük tam sayı olmalı.", { code: "WARPING_BEAM_LINES_INVALID" });
    if (!len.isFinite() || len.lte(0)) throw AppError.badRequest("Levent boyu sıfırdan büyük olmalı.", { code: "WARPING_BEAM_LINES_INVALID" });
    return { beamCount: l.beamCount, beamLengthM: len, sortOrder: i };
  });
}

export const WARPING_ORDER_MAX_TARGET_M = 10_000_000;

/** Levent adedi açık mı (sipariş/önizleme `beamCount` NULL) — DTO `beamCountOpen` ve panel metinleri bundan. */
export const isBeamCountOpen = (beamCount: number | null | undefined): boolean => beamCount == null;

/**
 * TEK KAYNAK hedef: satırlar → Σ(adet × boy), adet = Σ adet; açık adet → satırsız, adet NULL, hedef = toplam metre.
 * Önizleme, oluşturma, düzenleme ve idempotency imzası buradan geçer; okuyucular saklı `targetLengthM`i okur.
 */
export function resolvePlanTarget(input: PlanTargetInput): Pick<WarpingPlan, "beamLines" | "beamCount" | "targetLengthM"> {
  const hasLines = input.beamLines !== undefined;
  const hasOpen = input.openTargetLengthM !== undefined && input.openTargetLengthM !== null;
  if (hasLines === hasOpen) {
    throw AppError.badRequest("Levent satırları ya da (adet belli değilse) toplam metre — ikisinden biri girilmeli.", { code: "WARPING_BEAM_LINES_INVALID" });
  }
  if (hasOpen) {
    const total = D(input.openTargetLengthM!).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
    if (!total.isFinite() || total.lte(0)) throw AppError.badRequest("Toplam metre sıfırdan büyük olmalı.", { code: "WARPING_BEAM_LINES_INVALID" });
    if (total.gt(WARPING_ORDER_MAX_TARGET_M)) throw AppError.badRequest("Toplam metre çok büyük.", { code: "WARPING_BEAM_LINES_INVALID" });
    return { beamLines: [], beamCount: null, targetLengthM: total };
  }
  const beamLines = normalizeBeamLines(input.beamLines!);
  return {
    beamLines,
    beamCount: beamLines.reduce((s, l) => s + l.beamCount, 0),
    targetLengthM: beamLines.reduce((acc, l) => acc.plus(l.beamLengthM.mul(l.beamCount)), D(0)),
  };
}

/** İdempotency kimlik imzası — açık adet `open:<m>`, satırlı `2x1000.000,…`. */
export function planTargetSig(input: PlanTargetInput): string {
  const t = resolvePlanTarget(input);
  return t.beamCount === null ? `open:${t.targetLengthM.toFixed(3)}` : t.beamLines.map((l) => `${l.beamCount}x${l.beamLengthM.toFixed(3)}`).join(",");
}

/**
 * Ek tel grubu yüklemi — öneri ile kapının TEK süzgeci: kartın, ana kartı zemin kullanan HERHANGİ bir kumaşta
 * AYNI LEVENT dışı katmanı varsa ilk böyle katman döner (ret). Öneri bunu atlarsa kapının 400'üne çarpan kart önerilir.
 */
export function firstNonSharedLayer<T extends { beamMode: string }>(layers: readonly T[]): T | undefined {
  return layers.find((l) => !isSharedBeamLayer(l.beamMode));
}

/** Ana kartı zemin olarak kullanan kumaşlarda AYNI LEVENT katmanı olan VE kapıdan geçen kartlar — ek tel grubu önerisi. */
export async function suggestExtraSpecs(db: Db, warpSpecId: string): Promise<Array<{ id: string; code: string; name: string }>> {
  const specs = await readSharedBeamSpecsForGround(db, warpSpecId);
  const seen = new Map<string, { id: string; code: string; name: string }>();
  for (const s of specs) seen.set(s.id, s);
  const layers = await readLayerModesOnGround(db, warpSpecId, [...seen.keys()]);
  return [...seen.values()].filter((s) => !firstNonSharedLayer(layers.filter((l) => l.specId === s.id)));
}

/**
 * Ek tel grubu kapısı: ana kartı zemin kullanan bir kumaşta bu kart AYRI LEVENT ya da CAĞLIK katmanıysa 400 —
 * o teller bu levente sarılmaz (ayrı levent = ayrı sipariş; cağlık devereye gitmez). Katman bağı yoksa serbest.
 */
async function assertExtrasShareBeam(db: Db, warpSpecId: string, extraIds: string[]): Promise<void> {
  if (extraIds.length === 0) return;
  const layers = await readLayerModesOnGround(db, warpSpecId, extraIds);
  const bad = firstNonSharedLayer(layers);
  if (bad) {
    const label = WARP_BEAM_MODE_LABEL[bad.beamMode as WarpBeamModeCode] ?? bad.beamMode;
    const hint = bad.beamMode === "CREEL" ? "cağlıktan beslenir, devereye gitmez" : "ayrı levente sarılır — ayrı devere siparişi açın";
    throw AppError.badRequest(`${bad.specCode} kartı ${bad.itemCode} kumaşında "${label}" katmanı: ${hint}.`, { code: "WARPING_EXTRA_NOT_SHARED", beamMode: bad.beamMode });
  }
}

export async function computeWarpingPlan(db: Db, input: WarpingPlanInput): Promise<WarpingPlan> {
  const { beamLines, beamCount, targetLengthM } = resolvePlanTarget(input);
  const extraIds = [...new Set(input.extraWarpSpecIds)];
  if (extraIds.length !== input.extraWarpSpecIds.length) throw AppError.badRequest("Aynı ek tel grubu iki kez seçilemez.", { code: "WARPING_EXTRA_DUPLICATE" });
  if (extraIds.length > WARPING_ORDER_MAX_EXTRA_SPECS) throw AppError.badRequest(`En çok ${WARPING_ORDER_MAX_EXTRA_SPECS} ek tel grubu seçilebilir.`);
  if (extraIds.includes(input.warpSpecId)) throw AppError.badRequest("Ana çözgü kartı ek tel grubu olarak seçilemez.", { code: "WARPING_EXTRA_DUPLICATE" });
  const fixed = D(input.fixedWasteM);
  if (!fixed.isFinite() || fixed.isNegative()) throw AppError.badRequest("Sabit fire negatif olamaz.");

  const cardIds = [input.warpSpecId, ...extraIds];
  const cards = await db.warpSpec.findMany({
    where: { id: { in: cardIds } },
    select: { id: true, code: true, name: true, isActive: true, wastePct: true, sequenceNote: true, ...WARP_SPEC_YARN_LINES_SELECT },
  });
  const byId = new Map(cards.map((c) => [c.id, c]));
  for (const id of cardIds) {
    const c = byId.get(id);
    if (!c) throw AppError.badRequest(id === input.warpSpecId ? "Çözgü kartı bulunamadı." : "Ek tel grubu kartı bulunamadı.", { code: "WARP_SPEC_NOT_FOUND" });
    if (!c.isActive) throw AppError.badRequest(`${c.code} çözgü kartı pasif — sipariş açılamaz.`, { code: "WARP_SPEC_INACTIVE" });
  }
  await assertExtrasShareBeam(db, input.warpSpecId, extraIds);

  // Satır birleştirme — kart sırasıyla (ana kart önce), kart içinde `sortOrder`la; belirlenimli.
  const merged = new Map<string, { yarnItemId: string; endsCount: number; source: string }>();
  for (const id of cardIds) {
    for (const l of warpSpecYarnLines(byId.get(id)!)) {
      const cur = merged.get(l.yarnItemId);
      if (cur) cur.endsCount += l.endsCount;
      else merged.set(l.yarnItemId, { yarnItemId: l.yarnItemId, endsCount: l.endsCount, source: id });
    }
  }
  const yarnIds = [...merged.keys()];
  const items = await db.item.findMany({ where: { id: { in: yarnIds } }, select: { id: true, code: true, name: true, itemType: true, linearDensityDen: true, yarnWastePct: true } });
  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const id of yarnIds) {
    const it = itemById.get(id);
    if (!it || it.itemType !== ItemType.YARN) throw AppError.badRequest("Çözgü kartındaki iplik bir İPLİK stok kartı değil.", { code: "YARN_ITEM_TYPE" });
    if (resolveDenier(it) === null) throw AppError.badRequest(`"${it.name}" kaleminin denye değeri boş — devere hesabı denyesiz yapılamaz.`, { code: "YARN_DENIER_MISSING" });
  }

  const yarns: WarpingPlanYarn[] = [];
  let hasWaste = false;
  const wasteSources: WarpWasteSource[] = [];
  // Kaynak kart başına bir motor çağrısı: kart firesi o kartın `wastePct`i (ek grup kendi kartının firesini taşır).
  for (const id of cardIds) {
    const group = [...merged.values()].filter((m) => m.source === id);
    if (group.length === 0) continue;
    const res = computeWarpPlanForward({
      lines: group.map((g) => ({ yarnItemId: g.yarnItemId, endsCount: g.endsCount, denier: resolveDenier(itemById.get(g.yarnItemId)!)!, yarnWastePct: itemById.get(g.yarnItemId)!.yarnWastePct })),
      specWastePct: byId.get(id)!.wastePct,
      fixedWasteM: fixed,
      beamCount: 1,
      beamLengthM: targetLengthM,
    });
    hasWaste = hasWaste || res.hasWaste;
    for (const s of res.wasteSources) {
      if (!wasteSources.some((w) => JSON.stringify(w) === JSON.stringify(s))) wasteSources.push(s);
    }
    for (const l of res.lines) {
      const it = itemById.get(l.yarnItemId)!;
      yarns.push({
        yarnItemId: l.yarnItemId, code: it.code, name: it.name, sourceWarpSpecId: id, endsCount: l.endsCount,
        denier: resolveDenier(it)!, wastePct: D(l.wastePct), wasteSource: l.wasteSource, specWastePct: byId.get(id)!.wastePct,
        netKg: D(l.netKg), grossKg: D(l.grossKg), sortOrder: 0,
      });
    }
  }
  // Sıra = birleştirme sırası (talimattaki A, B, C…).
  const order = new Map(yarnIds.map((id, i) => [id, i]));
  yarns.sort((a, b) => order.get(a.yarnItemId)! - order.get(b.yarnItemId)!);
  yarns.forEach((y, i) => (y.sortOrder = i));
  const main = byId.get(input.warpSpecId)!;
  return {
    spec: { id: main.id, code: main.code, name: main.name, sequenceNote: main.sequenceNote },
    extras: extraIds.map((id) => ({ id, code: byId.get(id)!.code, name: byId.get(id)!.name })),
    beamLines, beamCount, targetLengthM, hasWaste, wasteSources, yarns,
  };
}

/** Plan satırlarını DB yükü biçiminde (createMany). */
export function planYarnRows(warpingOrderId: string, plan: WarpingPlan): Prisma.WarpingOrderYarnCreateManyInput[] {
  return plan.yarns.map((y) => ({
    warpingOrderId, yarnItemId: y.yarnItemId, sourceWarpSpecId: y.sourceWarpSpecId, endsCount: y.endsCount,
    denier: y.denier, wastePct: y.wastePct, netKg: y.netKg, grossKg: y.grossKg, sortOrder: y.sortOrder,
  }));
}
