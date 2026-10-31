// =============================================================================
// CARİ KİLİDİ BİLDİRİMİ — `cari.kilitlendi` / `cari.kilit-acildi` (D4-I5; tasarım DALGA4 §12.2)
// =============================================================================
// Bu dosya yalnız konu + yükü kurar; `emitNotification` tür LİTERAL'iyle `cari-hold.service` koy/aç'ta, kilit
// satırını yazan/claim'leyen tx'in İÇİNDE çağrılır (rollback → bildirim yok; replay yeni satır yaratmaz → tek bildirim).
// Yük yalnız kimlik + görüntü dizesi: cari adı/kodu, kapsam, sebep ETİKETİ, kişi. TUTAR ve serbest metin
// (`reasonText`/`releaseReason`) GİRMEZ — gelen kutusu finans ekranı değildir.
// =============================================================================
import type { Prisma } from "@prisma/client";
import type { NotificationSubject } from "./notification-emit.helper";
import { holdScopeText, reasonLabel } from "./cari-hold.helper";

type Tx = Prisma.TransactionClient;

export interface HoldNotifyInput {
  id: string;
  cariId: string;
  blocksIntake: boolean;
  blocksShipment: boolean;
  blocksInvoice: boolean;
  reasonCode: string;
}

export async function cariHoldNotificationTx(
  tx: Tx,
  hold: HoldNotifyInput,
  actorUserId: string,
): Promise<{ subject: NotificationSubject; payload: Record<string, string> }> {
  const cari = await tx.cariAccount.findUnique({
    where: { id: hold.cariId },
    select: { customer: { select: { name: true, code: true } }, subcontractor: { select: { name: true, code: true } } },
  });
  const card = cari?.customer ?? cari?.subcontractor ?? null;
  const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { fullName: true, username: true } });
  return {
    subject: { type: "cari_hold", id: hold.id, key: hold.id },
    payload: {
      kilitId: hold.id,
      cariId: hold.cariId,
      cariAd: card?.name ?? "Cari",
      cariKodu: card?.code ?? "—",
      kapsam: holdScopeText(hold),
      sebep: reasonLabel(hold.reasonCode),
      kisi: actor ? actor.fullName || actor.username : "—",
    },
  };
}
