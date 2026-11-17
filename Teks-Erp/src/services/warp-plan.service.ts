// =============================================================================
// ÇÖZGÜ HESABI servisi (fason devere D1, plan §5–§6.1) — salt okuma, hiçbir şey yazmaz.
// =============================================================================
// Girdi kayıtlı kart (`warpSpecId`) YA DA gövdedeki satırlar (kart formu önizlemesi). Satırlar `warpSpecYarnLines`ten,
// denye `resolveDenier`den, aritmetik `warp-plan.helper`dan. Stok iplik modülünden köprüyle okunur: iplik kapalıysa
// `null` ("bilinmiyor", 0 değil). Deverecide duran iplik yalnız fason devere başlıklarından sayılır (§4.6); o başlık
// D4'te doğar, bu yüzden devereci seçiliyken bugün 0 döner (hesap doğru, kol hazır).
// =============================================================================
import { ItemType, Prisma, WarpingOrderStatus } from "@prisma/client";
import { carryOverByYarn, loadWarpingYarnHoldings } from "./helpers/warping-yarn-open.helper";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { resolveDenier } from "../constants/warp-beam";
import { readDevereWarpFixedWasteM } from "./system-setting.service";
import { readYarnStock } from "./helpers/maliyet-bridge.helper";
import { WARP_SPEC_YARN_LINES_SELECT, warpSpecYarnLines, type WarpSpecYarnLine } from "./helpers/warp-spec-yarn.helper";
import {
  computeWarpPlanForward,
  computeWarpPlanReverse,
  endsFromKgPer1000m,
  endsFromReed,
  type WarpPlanForwardResult,
  type WarpPlanReverseResult,
  type WarpPlanStock,
} from "./helpers/warp-plan.helper";

export const WARP_PLAN_MAX_LINES = 20;

export interface WarpPlanCalcInput {
  mode: "FROM_BEAMS" | "FROM_STOCK";
  warpSpecId?: string;
  lines?: Array<{ yarnItemId: string; endsCount: number }>;
  /** Yalnız gövde satırlarıyla: kart firesi (%) önizlemesi. */
  specWastePct?: number | null;
  beamCount?: number;
  beamLengthM?: number;
  /** Verilmezse `devere.warpFixedWasteM` ayarı. */
  fixedWasteM?: number;
  subcontractorId?: string;
}

export interface WarpPlanYarnInfo {
  yarnItemId: string;
  code: string;
  name: string;
  denier: number;
  sortOrder: number;
  emanetKg: number | null;
}

export interface WarpPlanCalcResult {
  mode: WarpPlanCalcInput["mode"];
  warpSpec: { id: string; code: string; name: string } | null;
  fixedWasteM: number;
  stock: { known: boolean; emanetAcik: boolean; subcontractorId: string | null };
  yarns: WarpPlanYarnInfo[];
  forward: WarpPlanForwardResult | null;
  reverse: WarpPlanReverseResult | null;
}

async function loadSpec(input: WarpPlanCalcInput): Promise<{
  spec: { id: string; code: string; name: string } | null;
  lines: WarpSpecYarnLine[];
  specWastePct: Prisma.Decimal | null;
}> {
  if ((input.warpSpecId ? 1 : 0) + (input.lines ? 1 : 0) !== 1) {
    throw AppError.badRequest("Ya çözgü kartı ya da iplik satırları verilmeli (ikisi birden değil).");
  }
  if (input.warpSpecId) {
    const spec = await prisma.warpSpec.findUnique({
      where: { id: input.warpSpecId },
      select: { id: true, code: true, name: true, wastePct: true, ...WARP_SPEC_YARN_LINES_SELECT },
    });
    if (!spec) throw AppError.notFound("Çözgü kartı bulunamadı.");
    return { spec: { id: spec.id, code: spec.code, name: spec.name }, lines: warpSpecYarnLines(spec), specWastePct: spec.wastePct };
  }
  const raw = input.lines!;
  if (raw.length === 0 || raw.length > WARP_PLAN_MAX_LINES) throw AppError.badRequest(`İplik satırı 1 ile ${WARP_PLAN_MAX_LINES} arasında olmalı.`);
  if (new Set(raw.map((l) => l.yarnItemId)).size !== raw.length) throw AppError.badRequest("Aynı iplik kartta iki satır olamaz — telleri tek satırda toplayın.");
  const pct = input.specWastePct;
  return {
    spec: null,
    lines: raw.map((l, i) => ({ yarnItemId: l.yarnItemId, endsCount: l.endsCount, sortOrder: i })),
    specWastePct: pct == null ? null : new Prisma.Decimal(pct),
  };
}

export async function calculateWarpPlan(input: WarpPlanCalcInput): Promise<ApiResponse<WarpPlanCalcResult>> {
  if (input.mode === "FROM_BEAMS" && (input.beamCount == null || input.beamLengthM == null)) {
    throw AppError.badRequest("Leventten hesap için levent adedi ve levent boyu zorunlu.");
  }
  const { spec, lines, specWastePct } = await loadSpec(input);
  const ids = lines.map((l) => l.yarnItemId);
  const items = await prisma.item.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, name: true, itemType: true, linearDensityDen: true, yarnWastePct: true },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const id of ids) {
    const it = byId.get(id);
    if (!it) throw AppError.badRequest("Çözgü ipliği bulunamadı.");
    if (it.itemType !== ItemType.YARN) throw AppError.badRequest(`"${it.name}" bir İPLİK kalemi değil.`);
    if (resolveDenier(it) === null) {
      throw AppError.badRequest(`"${it.name}" kaleminin denye değeri boş — hesap (tel × denye × metre ÷ 9.000.000) denyesiz yapılamaz.`);
    }
  }
  if (input.subcontractorId) {
    const sub = await prisma.subcontractor.findUnique({ where: { id: input.subcontractorId }, select: { id: true } });
    if (!sub) throw AppError.badRequest("Devereci (fason firma) bulunamadı.");
  }
  const fixedWasteM = input.fixedWasteM ?? (await readDevereWarpFixedWasteM());
  const stockRead = await readYarnStock(ids, { excludeHeld: true });
  // D4b-2: "deverecide" = seçili deverecideki KAPANMIŞ siparişlerden kalan fabrika malı iplik (devreden bakiye; emanet hariç).
  const carry = input.subcontractorId
    ? carryOverByYarn(await loadWarpingYarnHoldings(prisma, { subcontractorIds: [input.subcontractorId], yarnItemIds: ids, statuses: [WarpingOrderStatus.COMPLETED] }), null)
    : new Map<string, Prisma.Decimal>();
  const stock = new Map<string, WarpPlanStock>();
  for (const id of ids) {
    stock.set(id, {
      depoKg: stockRead ? (stockRead.byItem.get(id)?.serbestKg ?? new Prisma.Decimal(0)) : null,
      fasondaKg: input.subcontractorId ? (carry.get(id) ?? new Prisma.Decimal(0)) : null,
    });
  }
  const common = {
    lines: lines.map((l) => ({ yarnItemId: l.yarnItemId, endsCount: l.endsCount, denier: resolveDenier(byId.get(l.yarnItemId)!)!, yarnWastePct: byId.get(l.yarnItemId)!.yarnWastePct })),
    specWastePct,
    fixedWasteM,
    stock,
  };
  const warnings: string[] = [];
  let forward: WarpPlanForwardResult | null = null;
  let reverse: WarpPlanReverseResult | null = null;
  if (input.mode === "FROM_BEAMS") {
    forward = computeWarpPlanForward({ ...common, beamCount: input.beamCount!, beamLengthM: input.beamLengthM! });
  } else {
    reverse = computeWarpPlanReverse({ ...common, beamLengthM: input.beamLengthM ?? null });
    if (reverse.unknownStock) warnings.push("İplik stoğu bilinmiyor (iplik modülü kapalı) — en çok metre hesaplanamadı.");
    else if (reverse.insufficient) warnings.push("Eldeki iplik bir metre çözgüye bile yetmiyor.");
  }
  return {
    success: true,
    data: {
      mode: input.mode,
      warpSpec: spec,
      fixedWasteM,
      stock: { known: stockRead !== null, emanetAcik: stockRead?.emanetAcik ?? false, subcontractorId: input.subcontractorId ?? null },
      yarns: lines.map((l) => {
        const it = byId.get(l.yarnItemId)!;
        const em = stockRead?.byItem.get(l.yarnItemId)?.emanetKg ?? null;
        return { yarnItemId: it.id, code: it.code, name: it.name, denier: Number(resolveDenier(it)), sortOrder: l.sortOrder, emanetKg: em == null ? null : Number(em.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP)) };
      }),
      forward,
      reverse,
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

// ── KART FORMU YARDIMCILARI (plan §5.5, D3) — yalnız ÖNERİR; hiçbir şey yazmaz ──
export type WarpEndsSuggestInput =
  | { kind: "KG_PER_1000M"; yarnItemId: string; kgPer1000m: number }
  | { kind: "REED"; reedPerCm: number; widthCm: number; endsPerDent?: number };

export interface WarpEndsSuggestResult {
  endsCount: number;
  /** Yalnız KG_PER_1000M: istenen kg − önerilen telin verdiği kg (yuvarlama farkı). */
  diffKg: number | null;
  /** Yalnız KG_PER_1000M: hesapta kullanılan iplik kartı denyesi. */
  denier: number | null;
}

export async function suggestWarpEnds(input: WarpEndsSuggestInput): Promise<ApiResponse<WarpEndsSuggestResult>> {
  if (input.kind === "REED") {
    const endsCount = endsFromReed(input.reedPerCm, input.widthCm, input.endsPerDent ?? 1);
    if (endsCount <= 0) throw AppError.badRequest("Tarak × en × dişe tel sıfır tel veriyor — değerleri kontrol edin.");
    return { success: true, data: { endsCount, diffKg: null, denier: null } };
  }
  const it = await prisma.item.findUnique({ where: { id: input.yarnItemId }, select: { name: true, itemType: true, linearDensityDen: true, yarnWastePct: true } });
  if (!it) throw AppError.badRequest("Çözgü ipliği bulunamadı.");
  if (it.itemType !== ItemType.YARN) throw AppError.badRequest(`"${it.name}" bir İPLİK kalemi değil.`);
  const denier = resolveDenier(it);
  if (denier === null) throw AppError.badRequest(`"${it.name}" kaleminin denye değeri boş — tel önerisi denyesiz hesaplanamaz.`);
  const r = endsFromKgPer1000m(input.kgPer1000m, denier);
  return { success: true, data: { endsCount: r.endsCount, diffKg: r.diffKg, denier: Number(denier) } };
}
