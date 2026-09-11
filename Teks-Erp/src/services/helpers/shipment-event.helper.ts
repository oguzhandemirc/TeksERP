// =============================================================================
// SEVKİYAT OLAY DEFTERİ — tek yazma kapısı
// =============================================================================
// "Bu sevkiyata ne oldu" sorusunun cevabı. `Shipment.status` GÜNCEL gerçeği
// söyler; bu defter GEÇMİŞİ söyler ve satırı asla değişmez.
//
// ⚠️ NEDEN VAR: geri alma eskiden `dispatchedAt`/`dispatchedById`i NULL'lıyordu,
// yani "sevk edildi" gerçeği siliniyordu — SoD izni `shipping:undo-dispatch`ın
// kalıcı izi kalmıyordu. Tek seferlik bir `undispatchedAt` kolonu da yetmezdi:
// sevk → geri al → sevk turunda ikinci tur birincisini ezerdi.
//
// Şekil kardeşi `ChequeEvent` (`fromStatus`/`toStatus` + tipli storno). Ters yolu
// olan çiftler: DISPATCHED ↔ UNDISPATCHED · INVOICED ↔ INVOICE_CLEARED.
//
// BEST-EFFORT DEĞİL: çağıranın transaction'ı İÇİNDE koşar. Durum commit olup
// defter satırı düşerse "sevk geri alındı ama defterde yok" durumu doğardı.
// =============================================================================
import { ShipmentEventType, type ShipmentStatus, type Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export interface ShipmentEventEntry {
  shipmentId: string;
  type: ShipmentEventType;
  /** Doğuş olayında (PLANNED) null — öncesi yok. */
  fromStatus?: ShipmentStatus | null;
  toStatus: ShipmentStatus;
  reason?: string | null;
  reasonCode?: string | null;
  userId?: string | null;
  /**
   * Kullanıcı girdisi olabilen olay tarihi. Verilmezse şimdi.
   * ⚠️ KRONOLOJİ BUNDAN OKUNMAZ — "en son olay" daima `createdAt desc` ile
   * çözülür (olay defteri kuralı: `eventDate` geriye tarihlenebilir).
   */
  eventDate?: Date;
}

export async function writeShipmentEvent(tx: Tx, entry: ShipmentEventEntry): Promise<void> {
  await tx.shipmentEvent.create({
    data: {
      shipmentId: entry.shipmentId,
      type: entry.type,
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus,
      eventDate: entry.eventDate ?? new Date(),
      reason: entry.reason?.slice(0, 300) ?? null,
      reasonCode: entry.reasonCode?.slice(0, 64) ?? null,
      createdById: entry.userId ?? null,
    },
  });
}
