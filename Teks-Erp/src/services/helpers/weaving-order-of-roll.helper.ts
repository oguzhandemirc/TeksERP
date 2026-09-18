// =============================================================================
// "BU TOP HANGİ DOKUMA İŞİNDEN?" — TEK OKUYUCU (G2, 2026-09-14)
// =============================================================================
// İki doğum yolu, tek soru: kendi tezgahında dokunan top İNDİRME üzerinden
// (`Roll.doffEventId → DoffEvent.machineRunId → MachineRun.weavingOrderId`),
// fasonda dokunan top MAKBUZ üzerinden (`Roll.parentReceiptId →
// SubcontractorReceipt.weavingOrderId`). `Roll.weavingOrderId` KOLONU YOKTUR —
// açılsaydı in-house yolda ikinci kaynak olurdu ("aynı soruyu cevaplayan iki yol").
// Bekçi (`test_subcontractor_weaving §5`) bu iki zinciri başka dosyada aramaz.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export type WeavingOrderOfRoll = {
  weavingOrderId: string;
  /** DOFF = kendi tezgahı (indirme) · RECEIPT = fason dokuma makbuzu. */
  via: "DOFF" | "RECEIPT";
};

/** Z1 (Y3 türetme, kolon yok): bu işten indirme yoluyla doğan (iptal edilmemiş) top sayısı — aynı zincir, aynı dosya. */
export async function countRollsOfWeavingOrder(db: Db, weavingOrderId: string): Promise<number> {
  return db.roll.count({ where: { doffEvent: { revokedAt: null, machineRun: { weavingOrderId } } } });
}

/** Top hiçbir dokuma işine bağlı değilse `null` (uydurulmaz). */
export async function weavingOrderOfRoll(db: Db, rollId: string): Promise<WeavingOrderOfRoll | null> {
  const roll = await db.roll.findUnique({
    where: { id: rollId },
    select: {
      doffEvent: { select: { revokedAt: true, machineRun: { select: { weavingOrderId: true } } } },
      parentReceipt: { select: { cancelledAt: true, weavingOrderId: true } },
    },
  });
  if (!roll) return null;
  const doffWo = roll.doffEvent?.revokedAt ? null : roll.doffEvent?.machineRun?.weavingOrderId ?? null;
  if (doffWo) return { weavingOrderId: doffWo, via: "DOFF" };
  const receiptWo = roll.parentReceipt?.cancelledAt ? null : roll.parentReceipt?.weavingOrderId ?? null;
  if (receiptWo) return { weavingOrderId: receiptWo, via: "RECEIPT" };
  return null;
}
