// =============================================================================
// e-İrsaliye OLAY DEFTERİ — TEK YAZAR (`EIrsaliyeEvent`, `ShipmentEvent` emsali)
// =============================================================================
// Append-only (mühür `defter_block_tamper`); geri alma ileri olayı silmez, tipli karşı
// olay yazar (GONDERILDI ↔ GONDERIM_GERI_ALINDI · YANIT_KAYDEDILDI ↔ YANIT_GERI_ALINDI).
// Doğuş (HAZIRLANDI) dışında yalnız `transitionEIrsaliyeTx` çağırır — durum ve olay
// ayrı yerden yazılmaz. "En son olay" okuyucusu `createdAt, id` ile sıralar.
// =============================================================================
import type { EIrsaliyeEventType, EIrsaliyeStatus, Prisma } from "@prisma/client";

export interface EIrsaliyeEventEntry {
  eIrsaliyeId: string;
  type: EIrsaliyeEventType;
  /** Yalnız doğuşta (HAZIRLANDI) null — DB CHECK `e_irsaliye_olaylari_dogus_chk`. */
  fromStatus: EIrsaliyeStatus | null;
  toStatus: EIrsaliyeStatus;
  xmlId?: string | null;
  note?: string | null;
  actorId?: string | null;
}

export async function writeEIrsaliyeEventTx(tx: Prisma.TransactionClient, e: EIrsaliyeEventEntry): Promise<void> {
  await tx.eIrsaliyeEvent.create({
    data: {
      eIrsaliyeId: e.eIrsaliyeId,
      type: e.type,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      xmlId: e.xmlId ?? null,
      note: e.note ? e.note.slice(0, 1000) : null,
      actorId: e.actorId ?? null,
    },
  });
}
