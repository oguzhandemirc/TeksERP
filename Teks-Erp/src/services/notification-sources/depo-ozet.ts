// =============================================================================
// DEPO · SEVKİYAT · FASON ÖZETLERİ — gün sonu (S3, geniş katalog 2026-11-14)
// =============================================================================
// Sayılar deftere/belgeye dayanır (SystemLog'dan türetilmez): sevk metresi brüt TEK tanımdan (`reports/_shipped.ts`
// `collectShipped`, iade geri-eklemeli), geri alma `shipment_events` defterinden, depo hareketleri `warehouse_movements`
// defterinden, fason sevk/kabul iptalsiz belgelerden. Hepsi sıfırsa pencere bildirimsiz geçer. Yük tutar taşımaz.
// =============================================================================
import { ShipmentEventType, ShipmentStatus, WarehouseEventType } from "@prisma/client";
import { registerDigestSource } from "../../jobs/notification-digest.job";
import { collectShipped } from "../reports/_shipped";

const m2 = (v: unknown): number => Math.round(Number(String(v ?? 0)) * 100) / 100;

export function registerDepotDigestSources(): void {
  registerDigestSource({
    kind: "sevkiyat.gunluk-ozet",
    compute: async (tx, w) => {
      // `collectShipped` aralığı kapalı uçlu (`<= to`) → pencere sonu bir ms geri.
      const cells = await collectShipped({ from: w.from, to: new Date(w.to.getTime() - 1) });
      const top = cells.reduce((a, c) => a + c.rollCount, 0);
      const metre = m2(cells.reduce((a, c) => a + c.qty, 0));
      const sevkiyat = await tx.shipment.count({ where: { status: ShipmentStatus.DISPATCHED, dispatchedAt: { gte: w.from, lt: w.to } } });
      const geriAlinan = await tx.shipmentEvent.count({ where: { type: ShipmentEventType.UNDISPATCHED, createdAt: { gte: w.from, lt: w.to } } });
      if (top + sevkiyat + geriAlinan === 0) return null;
      return { gun: w.label, sevkiyat, top, metre, geriAlinan };
    },
  });
  registerDigestSource({
    kind: "stok.gunluk-ozet",
    compute: async (tx, w) => {
      const createdAt = { gte: w.from, lt: w.to };
      const entry = await tx.warehouseMovement.aggregate({ where: { eventType: WarehouseEventType.ENTRY, createdAt }, _count: { _all: true }, _sum: { qty: true } });
      const iade = await tx.warehouseMovement.count({ where: { eventType: WarehouseEventType.RETURN, createdAt } });
      const transfer = await tx.warehouseTransfer.count({ where: { createdAt } });
      const duzeltme = await tx.warehouseMovement.count({ where: { eventType: WarehouseEventType.ADJUST, createdAt } });
      if (entry._count._all + iade + transfer + duzeltme === 0) return null;
      return { gun: w.label, giris: entry._count._all, girisMetre: m2(entry._sum.qty), iade, transfer, duzeltme };
    },
  });
  registerDigestSource({
    kind: "fason.gunluk-ozet",
    compute: async (tx, w) => {
      const cikislar = await tx.subcontractorDispatch.aggregate({ where: { cancelledAt: null, dispatchedAt: { gte: w.from, lt: w.to } }, _count: { _all: true }, _sum: { totalQty: true } });
      const donus = await tx.subcontractorReceipt.count({ where: { cancelledAt: null, receivedAt: { gte: w.from, lt: w.to } } });
      if (cikislar._count._all + donus === 0) return null;
      return { gun: w.label, cikis: cikislar._count._all, cikisMetre: m2(cikislar._sum.totalQty), donus };
    },
  });
}
