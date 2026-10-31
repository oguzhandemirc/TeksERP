// =============================================================================
// TAMBUR FİNALİZE — ÇOCUK TOP EN KAYNAĞI (D4-E3, tasarım DALGA4 §6.5/§12.1)
// =============================================================================
// Bugün (WO_TARGET_FIRST): çocuk eni = iş emri eni, yoksa ana top eni.
// MEASURED_FIRST: ana topun eni bir en ölçen istasyonda ÖLÇÜLDÜYSE (D4-E2a izi:
// aktif adım bitiş satırında `widthAfter`) çocuklara o en geçer; ölçülmediyse
// bugünkü kaynak. Yalnız finalize yolunu etkiler (kesim yolları `parent.width`).
// =============================================================================
import { Prisma } from "@prisma/client";
import { readTamburChildWidthSource } from "../system-setting.service";
import { readWidthTrace, WIDTH_TRACE_OPERATION_TYPES } from "./measured-width.helper";
import { ACTIVE_OPERATION } from "./roll-operation.helper";

type Tx = Prisma.TransactionClient;

/** Ana topun eninin aktif bir ölçüm izi var mı (geri alınmış iz sayılmaz). */
async function parentWidthMeasuredTx(tx: Tx, rollId: string): Promise<boolean> {
  const ops = await tx.rollOperation.findMany({
    where: { rollId, ...ACTIVE_OPERATION, operationType: { in: WIDTH_TRACE_OPERATION_TYPES } },
    select: { metadata: true },
  });
  return ops.some((o) => readWidthTrace(o.metadata) != null);
}

/**
 * Finalize çocuklarının yazılacak eni. Ayar finalize tx'i içinde, segment
 * döngüsünden ÖNCE bir kez okunur; ana top eni tx içinden tazelenir.
 */
export async function pickFinalizeChildWidthTx(
  tx: Tx,
  args: { parentRollId: string; parentWidth: Prisma.Decimal | null; woWidth: Prisma.Decimal | null },
): Promise<Prisma.Decimal | null> {
  const source = await readTamburChildWidthSource(tx);
  if (source === "MEASURED_FIRST") {
    const fresh = await tx.roll.findUnique({ where: { id: args.parentRollId }, select: { width: true } });
    if (fresh?.width != null && (await parentWidthMeasuredTx(tx, args.parentRollId))) {
      return fresh.width;
    }
  }
  return args.woWidth ?? args.parentWidth;
}
