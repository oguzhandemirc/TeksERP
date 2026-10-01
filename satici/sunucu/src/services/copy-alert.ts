// KOPYA UYARISI yazımı (kira zinciri · parmak izi · yabancı kira/HAK · kip): açık uyarı varsa görülmesi artar, yoksa açılır
// ve YENİ uyarının bildirimi aynı tx'te yazılır (sürmekte olan uyarının tekrar görülmesi bildirim doğurmaz).
import type { KopyaUyariTuru, KopyaUyarisi } from "@prisma/client";
import type { Fingerprint } from "../lisans-protokol";
import type { Tx } from "../lib/prisma";
import { enqueueNotificationTx } from "../notifications/outbox";
import type { VendorContext } from "./context";

export async function upsertCopyAlert(
  tx: Tx,
  installationDbId: string,
  type: KopyaUyariTuru,
  sides: { owner: Fingerprint | null; other: Fingerprint },
  nowMs: number,
): Promise<KopyaUyarisi> {
  const open = await tx.kopyaUyarisi.findFirst({ where: { kurulumId: installationDbId, tur: type, durum: "ACIK" } });
  if (open) {
    return tx.kopyaUyarisi.update({
      where: { id: open.id },
      data: { sonGorulme: new Date(nowMs), gorulmeSayisi: { increment: 1 }, digerParmakIzi: sides.other },
    });
  }
  const created = await tx.kopyaUyarisi.create({
    data: {
      kurulumId: installationDbId,
      tur: type,
      ilkGorulme: new Date(nowMs),
      sonGorulme: new Date(nowMs),
      ...(sides.owner ? { sahipParmakIzi: sides.owner } : {}),
      digerParmakIzi: sides.other,
    },
  });
  // Yeni uyarı bildirimi AYNI tx'te (sürmekte olan uyarının tekrar görülmesi bildirim DOĞURMAZ).
  await enqueueNotificationTx(tx, { event: "KOPYA_SUPHESI", keyParts: [created.id], installationDbId, relatedId: created.id, portalPath: "/kopya-uyarilari", referans: type });
  return created;
}

/** Uyarı ikinci penceresinde mi (ilk görülmeden `KOPYA_PENCERE_SN` geçti)? */
export function inSecondWindow(ctx: VendorContext, alert: KopyaUyarisi, nowMs: number): boolean {
  return nowMs - alert.ilkGorulme.getTime() >= ctx.config.KOPYA_PENCERE_SN * 1000;
}
