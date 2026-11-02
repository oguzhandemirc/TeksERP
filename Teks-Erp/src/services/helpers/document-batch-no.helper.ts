// =============================================================================
// Gelen belgeden doğan partinin NUMARASI (Gülkesim parti/metre §2.6) — tek çözücü
// =============================================================================
// Ayar `gelenBelge.batchNumberSource = DOCUMENT` VE notun `ourBatchNo`su doluysa o numara; değilse `null` (= seri,
// bugünkü davranış). Numara istemciden alınmaz, nottan okunur. İki okuyucu: parti doğuşu (`attachRolls` tx'i) ve plan
// önizlemesi (`batchNoPreview`) — ikisi aynı cevabı buradan alır.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { readBatchNumberSource } from "../system-setting.service";

type Db = Pick<Prisma.TransactionClient, "customerDeliveryNote" | "systemSetting">;

/** Not yoksa 404 (fail-closed: bilinmeyen kaynak sessizce seriye düşmez). */
export async function resolveDocumentBatchNo(db: Db, sourceNoteId: string | null | undefined): Promise<string | null> {
  if (!sourceNoteId) return null;
  const note = await db.customerDeliveryNote.findUnique({ where: { id: sourceNoteId }, select: { ourBatchNo: true } });
  if (!note) throw AppError.notFound("Gelen belge bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  if ((await readBatchNumberSource(db)) !== "DOCUMENT") return null;
  return note.ourBatchNo?.trim() || null;
}
