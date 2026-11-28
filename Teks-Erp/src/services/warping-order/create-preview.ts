// =============================================================================
// FASON DEVERE SİPARİŞİ — önizleme (yazmaz)
// =============================================================================
// create.ts'ten ayrıldı (dosya boyutu); oluşturma ile aynı plan fonksiyonu ve sabit fire çözümü.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { readDevereWarpFixedWasteM } from "../system-setting.service";
import { readYarnStock } from "../helpers/maliyet-bridge.helper";
import { computeWarpingPlan, isBeamCountOpen, suggestExtraSpecs, type BeamLineInput, type WarpingPlan } from "./plan";
import { expandWarpSequence, type WarpEndsSequence } from "../helpers/warp-sequence.helper";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export async function resolveFixedWaste(v: number | undefined): Promise<Prisma.Decimal> {
  return D(v ?? (await readDevereWarpFixedWasteM())).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export interface WarpingOrderPreviewInput {
  warpSpecId: string;
  beamLines?: BeamLineInput[];
  openTargetLengthM?: number;
  extraWarpSpecIds?: string[];
  fixedWasteM?: number;
}

export interface WarpingOrderPreview {
  warpSpec: WarpingPlan["spec"];
  /** Dizilim notunun tel tel açılımı (talimatla aynı fonksiyon); not yok/okunamaz → null. */
  endsSequence: WarpEndsSequence | null;
  extras: WarpingPlan["extras"];
  suggestedExtraSpecs: Array<{ id: string; code: string; name: string }>;
  beamLines: Array<{ beamCount: number; beamLengthM: string }>;
  beamCount: number | null;
  beamCountOpen: boolean;
  targetLengthM: string;
  fixedWasteM: string;
  hasWaste: boolean;
  wasteSources: WarpingPlan["wasteSources"];
  stock: { known: boolean; emanetAcik: boolean };
  yarns: Array<{ yarnItemId: string; code: string; name: string; sourceWarpSpecId: string; endsCount: number; denier: string; wastePct: string; wasteSource: WarpingPlan["yarns"][number]["wasteSource"]; specWastePct: string | null; netKg: string; grossKg: string; depoKg: string | null; emanetKg: string | null }>;
  totals: { netKg: string; grossKg: string };
}

/** Önizleme: yazmaz; aynı plan fonksiyonu + depo stoğu (iplik kapalıysa `null` = bilinmiyor) + SHARED_BEAM ek grup önerisi. */
export async function previewWarpingOrder(input: WarpingOrderPreviewInput): Promise<WarpingOrderPreview> {
  const fixed = await resolveFixedWaste(input.fixedWasteM);
  const plan = await computeWarpingPlan(prisma, { warpSpecId: input.warpSpecId, extraWarpSpecIds: input.extraWarpSpecIds ?? [], beamLines: input.beamLines, openTargetLengthM: input.openTargetLengthM, fixedWasteM: fixed });
  const suggested = (await suggestExtraSpecs(prisma, input.warpSpecId)).filter((s) => !plan.extras.some((e) => e.id === s.id));
  const stock = await readYarnStock(plan.yarns.map((y) => y.yarnItemId), { excludeHeld: true });
  let net = D(0);
  let gross = D(0);
  return {
    warpSpec: plan.spec,
    endsSequence: expandWarpSequence(plan.spec.sequenceNote, plan.yarns.map((y) => y.endsCount)),
    extras: plan.extras,
    suggestedExtraSpecs: suggested,
    beamLines: plan.beamLines.map((l) => ({ beamCount: l.beamCount, beamLengthM: l.beamLengthM.toFixed(3) })),
    beamCount: plan.beamCount,
    beamCountOpen: isBeamCountOpen(plan.beamCount),
    targetLengthM: plan.targetLengthM.toFixed(3),
    fixedWasteM: fixed.toFixed(2),
    hasWaste: plan.hasWaste,
    wasteSources: plan.wasteSources,
    stock: { known: stock !== null, emanetAcik: stock?.emanetAcik ?? false },
    yarns: plan.yarns.map((y) => {
      net = net.plus(y.netKg);
      gross = gross.plus(y.grossKg);
      const s = stock?.byItem.get(y.yarnItemId);
      return {
        yarnItemId: y.yarnItemId, code: y.code, name: y.name, sourceWarpSpecId: y.sourceWarpSpecId, endsCount: y.endsCount,
        denier: y.denier.toString(), wastePct: y.wastePct.toFixed(2), wasteSource: y.wasteSource, specWastePct: y.specWastePct?.toFixed(2) ?? null, netKg: y.netKg.toFixed(3), grossKg: y.grossKg.toFixed(3),
        depoKg: stock ? (s?.serbestKg ?? D(0)).toFixed(3) : null,
        emanetKg: s?.emanetKg == null ? null : s.emanetKg.toFixed(3),
      };
    }),
    totals: { netKg: net.toFixed(3), grossKg: gross.toFixed(3) },
  };
}
