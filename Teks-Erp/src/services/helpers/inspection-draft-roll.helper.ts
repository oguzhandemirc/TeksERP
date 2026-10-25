// KK1 doğuşu önizlemesi (K4P-TABLET): top henüz yok — kumaş + form eninden "taslak top" kurulur ve
// muayeneyle AYNI `evaluateInspection`a verilir (ikinci formül yok). Uzunluk `inspectedLengthM`ten gelir.
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { toDec } from "./four-point-resolve.helper";

export interface DraftRollInput {
  itemId: string;
  widthCm?: Prisma.Decimal.Value | null;
}

export async function draftInspectionRoll(db: Prisma.TransactionClient, draft: DraftRollInput) {
  const item = await db.item.findUnique({ where: { id: draft.itemId }, select: { id: true } });
  if (!item) throw AppError.notFound("Kumaş bulunamadı.", { code: "ITEM_NOT_FOUND" });
  return {
    id: "", itemId: item.id, width: toDec(draft.widthCm ?? null), qualityGradeId: null, qualityGrade: null,
    currentQty: new Prisma.Decimal(0), status: "STOCK" as const, finalizedAt: null,
  };
}
