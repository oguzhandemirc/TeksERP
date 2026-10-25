// =============================================================================
// e-İrsaliye DURUM GEÇİŞİ — tek kapı (plan §3.2)
// =============================================================================
// Atomik claim: `updateMany WHERE {id, status IN from}` + `count===0 → 409
// EIRSALIYE_STATE_CONFLICT`; olay AYNI tx'te `writeEIrsaliyeEventTx`le. Çağıran tx'in
// İLK ifadesi sevkiyat kilididir (`lockShipmentScopeTx`); bu helper kilit almaz.
// `findUnique → if → update` YASAK: yarışta ikinci deneme eski durumu görüp ezerdi.
// =============================================================================
import type { EIrsaliyeEventType, EIrsaliyeStatus, Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { writeEIrsaliyeEventTx } from "./e-irsaliye-event.helper";

export interface EIrsaliyeTransition {
  id: string;
  from: readonly EIrsaliyeStatus[];
  to: EIrsaliyeStatus;
  event: EIrsaliyeEventType;
  patch?: Omit<Prisma.EIrsaliyeUncheckedUpdateManyInput, "status">;
  /** Ek claim koşulu (ör. gönderilen XML hâlâ güncel sürüm mü). */
  whereExtra?: Prisma.EIrsaliyeWhereInput;
  actorId: string | null;
  note?: string | null;
  xmlId?: string | null;
  /** 409 cümlesi — verilmezse genel cümle. */
  conflictMessage?: string;
}

export const EIRSALIYE_STATE_CONFLICT = "EIRSALIYE_STATE_CONFLICT";

export async function transitionEIrsaliyeTx(tx: Prisma.TransactionClient, t: EIrsaliyeTransition): Promise<void> {
  // Çok kaynaklı geçişte olayın `fromStatus`u: kilit altında okunur (bütün yazarlar aynı kilitte).
  const fromStatus =
    t.from.length === 1
      ? t.from[0]!
      : (await tx.eIrsaliye.findUnique({ where: { id: t.id }, select: { status: true } }))?.status ?? null;
  const claim = await tx.eIrsaliye.updateMany({
    where: { ...t.whereExtra, id: t.id, status: { in: [...t.from] } },
    data: { ...t.patch, status: t.to, updatedById: t.actorId },
  });
  if (claim.count === 0 || fromStatus === null) {
    throw AppError.conflict(
      t.conflictMessage ?? "e-İrsaliye kaydının durumu bu sırada değişti; sayfayı yenileyip yeniden deneyin.",
      { code: EIRSALIYE_STATE_CONFLICT, id: t.id, beklenen: [...t.from] },
    );
  }
  await writeEIrsaliyeEventTx(tx, {
    eIrsaliyeId: t.id,
    type: t.event,
    fromStatus,
    toStatus: t.to,
    xmlId: t.xmlId ?? null,
    note: t.note ?? null,
    actorId: t.actorId,
  });
}
