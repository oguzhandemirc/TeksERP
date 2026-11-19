// =============================================================================
// SATIŞ · PLANLAMA ÖZETLERİ — `siparis.gunluk-ozet` (gün sonu) · `planlama.vardiya-ozet` (vardiya sonu), S1
// =============================================================================
// Sayılar deftere/kolona dayanır (SystemLog'dan türetilmez): sipariş doğuş/terminal damgaları (`createdAt`,
// `completedAt`, `cancelledAt`) ve iş emri defteri (`work_order_events`, CREATED / STATUS_CHANGED). Yük tutar taşımaz.
// Hepsi sıfırsa pencere bildirimsiz geçer (damga yine ilerler).
// =============================================================================
import { WorkOrderEventType, type Prisma } from "@prisma/client";
import { registerDigestSource, type DigestWindow } from "../../jobs/notification-digest.job";

/** Pencerede açılan/tamamlanan/iptal sipariş sayımı — günlük sipariş özeti ve birleşik gün sonu özetinin TEK kaynağı. */
export async function orderWindowCounts(tx: Prisma.TransactionClient, w: Pick<DigestWindow, "from" | "to">) {
  const range = { gte: w.from, lt: w.to };
  const yeni = await tx.order.count({ where: { createdAt: range } });
  const kalem = await tx.orderLine.count({ where: { order: { createdAt: range } } });
  const tamamlanan = await tx.order.count({ where: { completedAt: range, status: "COMPLETED" } });
  const iptal = await tx.order.count({ where: { cancelledAt: range, status: "CANCELLED" } });
  return { yeni, kalem, tamamlanan, iptal };
}

export function registerSalesDigestSources(): void {
  registerDigestSource({
    kind: "siparis.gunluk-ozet",
    compute: async (tx, w) => {
      const c = await orderWindowCounts(tx, w);
      if (c.yeni + c.tamamlanan + c.iptal === 0) return null;
      return { gun: w.label, ...c };
    },
  });
  registerDigestSource({
    kind: "planlama.vardiya-ozet",
    compute: async (tx, w) => {
      const createdAt = { gte: w.from, lt: w.to };
      const acilan = await tx.workOrderEvent.count({ where: { type: WorkOrderEventType.CREATED, createdAt } });
      const baslayan = await tx.workOrderEvent.count({
        where: { type: WorkOrderEventType.STATUS_CHANGED, fromValue: "PLANNED", toValue: "IN_PROGRESS", createdAt },
      });
      const biten = await tx.workOrderEvent.count({ where: { type: WorkOrderEventType.STATUS_CHANGED, toValue: "COMPLETED", createdAt } });
      if (acilan + baslayan + biten === 0) return null;
      return { vardiyaId: w.key, vardiyaAd: w.label, acilan, baslayan, biten };
    },
  });
}
