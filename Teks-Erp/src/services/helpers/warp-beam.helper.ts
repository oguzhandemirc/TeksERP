// =============================================================================
// LEVENT YARDIMCILARI — DTO seçimi · levent numarası (8029 kod-kapsam kilidi) · köken XOR kapısı
// =============================================================================
import { Prisma, WarpBeamOrigin } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../../utils/code-format";
import { lockCodeScopeTx } from "./code-unique.helper";

export const WARP_BEAM_PREFIX = "LV";
const WARP_BEAM_CODE_SCOPE = "warpBeam";

export const WARP_BEAM_EVENT_SELECT = {
  id: true,
  kind: true,
  reversesEventId: true,
  fromStatus: true,
  toStatus: true,
  lengthM: true,
  machineId: true,
  endsCount: true,
  denier: true,
  theoreticalKg: true,
  kgSource: true,
  sectionCount: true,
  endsPerSection: true,
  breakCount: true,
  startedAt: true,
  reasonCode: true,
  reason: true,
  createdById: true,
  createdAt: true,
  machine: { select: { id: true, code: true, name: true } },
} satisfies Prisma.WarpBeamEventSelect;

export const WARP_BEAM_SELECT = {
  id: true,
  beamNo: true,
  warpSpecId: true,
  status: true,
  plannedLengthM: true,
  physicalBeamNo: true,
  notes: true,
  originKind: true,
  subcontractorId: true,
  supplierId: true,
  createdAt: true,
  updatedAt: true,
  warpSpec: { select: { id: true, code: true, name: true, endsCount: true, yarnItem: { select: { id: true, code: true, name: true, linearDensityDen: true } } } },
  subcontractor: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  // Listede "gerçek metre / kg" WOUND satırından okunur (bir levent bir kez doğar — partial unique).
  events: { where: { kind: "WOUND" }, select: WARP_BEAM_EVENT_SELECT, take: 1 },
} satisfies Prisma.WarpBeamSelect;

export type WarpBeamRow = Prisma.WarpBeamGetPayload<{ select: typeof WARP_BEAM_SELECT }>;
export type WarpBeamEventRow = Prisma.WarpBeamEventGetPayload<{ select: typeof WARP_BEAM_EVENT_SELECT }>;

/** Sıradaki levent numarası — 8029 kilidi bu fonksiyonun İLK ifadesidir (`nextDoffCodeTx` emsali). */
export async function nextBeamNoTx(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  const prefix = dailyCodePrefix(WARP_BEAM_PREFIX, date);
  await lockCodeScopeTx(tx, WARP_BEAM_CODE_SCOPE, prefix);
  const codes = await tx.warpBeam.findMany({ where: { beamNo: { gte: prefix, startsWith: prefix } }, select: { beamNo: true } });
  return buildDailyCode(WARP_BEAM_PREFIX, nextDailySeq(codes.map((c) => c.beamNo), prefix), date);
}

export interface OriginParty {
  originKind: WarpBeamOrigin;
  subcontractorId: string | null;
  supplierId: string | null;
}

/**
 * KÖKEN XOR'u — TEK KAPI (Türkçe mesaj burada; DB CHECK `warp_beams_origin_party_ck` ikinci hat):
 *   IN_HOUSE → taraf yok · SUBCONTRACT → yalnız fasoncu · PURCHASED → tedarikçi XOR fasoncu, TAM BİRİ.
 */
export function resolveOriginParty(p: OriginParty): OriginParty {
  const sub = p.subcontractorId || null;
  const sup = p.supplierId || null;
  switch (p.originKind) {
    case WarpBeamOrigin.IN_HOUSE:
      if (sub || sup) throw AppError.badRequest("İçeride sarılan levente karşı taraf yazılmaz (fasoncu/tedarikçi boş kalır).", { code: "WARP_BEAM_ORIGIN_PARTY" });
      return { originKind: p.originKind, subcontractorId: null, supplierId: null };
    case WarpBeamOrigin.SUBCONTRACT:
      if (!sub) throw AppError.badRequest("Fasona sardırılan levent için fasoncu zorunludur.", { code: "WARP_BEAM_ORIGIN_PARTY" });
      if (sup) throw AppError.badRequest("Fasona sardırılan levente tedarikçi yazılmaz — taraf fasoncudur.", { code: "WARP_BEAM_ORIGIN_PARTY" });
      return { originKind: p.originKind, subcontractorId: sub, supplierId: null };
    case WarpBeamOrigin.PURCHASED:
      if ((sub === null) === (sup === null)) {
        throw AppError.badRequest("Hazır alınan levent için TAM BİR taraf seçilir: tedarikçi (cari) YA DA fasoncu (kendi ipliğiyle saran devereci).", { code: "WARP_BEAM_ORIGIN_PARTY" });
      }
      return { originKind: p.originKind, subcontractorId: sub, supplierId: sup };
  }
}
