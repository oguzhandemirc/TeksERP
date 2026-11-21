// =============================================================================
// FASON DEVERE — tablette ret için LEVENT OKUTMA çözümü (devere ek-2 r)
// =============================================================================
// Okunan kod → devere siparişinden dönmüş sarım: levent etiketi (`beamNo`) > gövde QR/no (gövdenin üstündeki sarım)
// > gövde no serbest metni (`physicalBeamNo`, canlı sarım). Salt okuma; reddedilebilirlik kararı ret önizlemesinde
// (tek kaynak `previewWarpingBeamRejection`). Cevap OPT-IN allowlist: depocuya ücret/iplik dağıtımı inmez.
// =============================================================================
import { WarpBeamStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

export interface WarpingRejectLookupDto {
  beam: { id: string; beamNo: string; status: WarpBeamStatus; physicalBeamNo: string | null; bodyNo: string | null; lengthM: string | null };
  order: { id: string; orderNo: string; subcontractor: { id: string; name: string } };
}

const LIVE: WarpBeamStatus[] = [WarpBeamStatus.READY, WarpBeamStatus.MOUNTED, WarpBeamStatus.REJECTED];
const SELECT = {
  id: true, beamNo: true, status: true, physicalBeamNo: true,
  beamBody: { select: { bodyNo: true } },
  warpingOrder: { select: { id: true, orderNo: true, subcontractor: { select: { id: true, name: true } } } },
  events: { where: { kind: "WOUND" as const }, select: { lengthM: true }, take: 1 },
} as const;

export async function lookupWarpingRejectBeam(rawCode: string): Promise<WarpingRejectLookupDto> {
  const code = rawCode.trim();
  if (!code) throw AppError.badRequest("Levent etiketi ya da gövde no okutun.", { code: "VALIDATION_ERROR" });
  const ci = { equals: code, mode: "insensitive" as const };
  let beam = await prisma.warpBeam.findFirst({ where: { beamNo: ci }, select: SELECT });
  if (!beam) {
    const body = await prisma.beamBody.findFirst({ where: { bodyNo: ci }, select: { currentWarpBeamId: true } });
    if (body?.currentWarpBeamId) beam = await prisma.warpBeam.findUnique({ where: { id: body.currentWarpBeamId }, select: SELECT });
  }
  // Gövde no serbest metni: aynı gövde no'da birden çok geçmiş sarım olabilir — yalnız canlı olan, en yenisi.
  beam ??= await prisma.warpBeam.findFirst({ where: { physicalBeamNo: ci, status: { in: LIVE } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: SELECT });
  if (!beam) throw AppError.notFound(`${code} — bu koda bağlı levent bulunamadı.`, { code: "WARP_BEAM_NOT_FOUND" });
  if (!beam.warpingOrder) {
    throw AppError.conflict(`${beam.beamNo} fason devere siparişinden dönmüş bir levent değil — ret yalnız devereciden gelen levente yazılır.`, { code: "WARPING_REJECT_NOT_WARPING_BEAM" });
  }
  const o = beam.warpingOrder;
  const len = beam.events[0]?.lengthM;
  return {
    beam: { id: beam.id, beamNo: beam.beamNo, status: beam.status, physicalBeamNo: beam.physicalBeamNo, bodyNo: beam.beamBody?.bodyNo ?? null, lengthM: len == null ? null : len.toFixed(3) },
    order: { id: o.id, orderNo: o.orderNo, subcontractor: { id: o.subcontractor.id, name: o.subcontractor.name } },
  };
}
