// =============================================================================
// "TOP ŞU AN NEREDE" — Prisma yüklemleri (TEK KAYNAK, 2026-11-04)
// =============================================================================
// Sipariş "Nerede?" (`order-where*.helper`) ile İş Emirleri listesinin "şu an hangi
// fasonda" süzgeci AYNI soruyu sorar; tanım burada: iş emrinin X'e giden AÇIK sevkinde
// OUTSTANDING kalemi var ve kalemin topu hâlâ AT_SUBCONTRACTOR. Planda/rota adımında
// X'in yazılı olması YETMEZ. "Hangi aşamada" sorusu `konumIstasyon`undur (workorder-location).
// =============================================================================
import { Prisma, RollStatus } from "@prisma/client";
import { OPEN_OUTSTANDING, OUTSTANDING_ITEM, outstandingItemOfOpenDispatch } from "./fason-open-dispatch.helper";

/** Kalem düzeyi: açık sevkin dönmemiş kalemi, topu hâlâ fasoncuda; `dispatch` sevke ek koşul. */
export function fasonItemNowWhere(
  dispatch?: Prisma.SubcontractorDispatchWhereInput,
): Prisma.SubcontractorDispatchItemWhereInput {
  return { ...outstandingItemOfOpenDispatch(dispatch), AND: [{ roll: { status: RollStatus.AT_SUBCONTRACTOR } }] };
}

/** İş emri düzeyi: `dispatch` koşuluna uyan açık sevkinde fasoncuda duran topu var. */
export function workOrderAtFasonWhere(dispatch: Prisma.SubcontractorDispatchWhereInput = {}): Prisma.WorkOrderWhereInput {
  return {
    dispatches: {
      some: {
        ...OPEN_OUTSTANDING,
        ...dispatch,
        AND: [{ items: { some: { ...OUTSTANDING_ITEM, AND: [{ roll: { status: RollStatus.AT_SUBCONTRACTOR } }] } } }],
      },
    },
  };
}
