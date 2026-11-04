// =============================================================================
// "TOP ŞU AN NEREDE" — Prisma yüklemleri (TEK KAYNAK, 2026-11-04)
// =============================================================================
// Sipariş "Nerede?" türetmesi (`order-nerede*.helper`) ve İş Emirleri listesinin
// "şu an hangi fasonda / hangi aşamada" süzgeçleri AYNI soruyu sorar. Tanım:
//   • FASONDA – firma X: top AT_SUBCONTRACTOR ve X'e giden AÇIK bir sevkte
//     OUTSTANDING kalemi var (kabul/kapama/doğrudan sevkle dönmemiş). Planda/rota
//     adımında X'in yazılı olması YETMEZ.
//   • AŞAMADA – istasyon Y, topun şu an durduğu adımın istasyonu Y ve:
//       Y iç (INTERNAL) → top IN_PRODUCTION (`placesOf`taki STEP dalının Prisma ikizi);
//       Y fason (EXTERNAL) → top FASONDA (yukarıdaki tanım, firmasız).
// =============================================================================
import { Prisma, RollStatus, StationType } from "@prisma/client";
import { outstandingItemOfOpenDispatch } from "./fason-open-dispatch.helper";

/** Aşamada sayılan top durumu (sevke hazır ve fasondaki toplar aşama değildir). */
export const ROLL_AT_STAGE_STATUS = RollStatus.IN_PRODUCTION;

/** Şu an fasonda ve `dispatch` koşuluna uyan açık sevkte dönmemiş kalemi olan top. */
export function rollAtFasonWhere(dispatch?: Prisma.SubcontractorDispatchWhereInput): Prisma.RollWhereInput {
  return {
    status: RollStatus.AT_SUBCONTRACTOR,
    dispatchItems: { some: outstandingItemOfOpenDispatch(dispatch) },
  };
}

/**
 * Şu an bir aşamada (verilen istasyonlarda; verilmezse herhangi birinde) duran top.
 * İç istasyonda üretimde, fason istasyonunda fasonda olan top sayılır; fabrikada
 * IN_PRODUCTION olup adımı fason istasyonda olan top (dönmüş mal) aşamada değildir.
 */
export function rollAtStageWhere(stationIds?: string[]): Prisma.RollWhereInput {
  const at = (type: StationType): Prisma.WorkOrderStepWhereInput => ({
    ...(stationIds ? { stationId: { in: stationIds } } : {}),
    station: { type },
  });
  return {
    OR: [
      { status: ROLL_AT_STAGE_STATUS, currentStep: { is: at(StationType.INTERNAL) } },
      { AND: [rollAtFasonWhere(), { currentStep: { is: at(StationType.EXTERNAL) } }] },
    ],
  };
}
