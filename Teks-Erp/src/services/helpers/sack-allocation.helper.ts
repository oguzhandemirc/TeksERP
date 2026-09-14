// =============================================================================
// ÇUVAL TAHSİSİ (SackAllocation) — ETKİN SATIR YÜKLEMİ + DAMGA YAZICISI (K2, 2026-09-14)
// =============================================================================
// Tahsis sipariş karşılamasını belirleyen TİCARİ pivottur (`defter.md` ③a): yeniden
// hesap eski satırı SİLMEZ, `clearedAt` damgalar (`SackTagAssignment` deseni). Tablo
// hem etkin hem damgalı satır taşır ⇒ Σ okuyan HER yüzey (sipariş defteri `shippedQty`
// · sevkiyat detayı/önizleme · irsaliye/çeki listesi · müşteri adı · otomatik taslak
// · raporlar · ham SQL) bu yüklemden geçer. Yüklem kopyalanırsa bir yüzey damgalı
// satırı da toplar ve karşılama sessizce şişer (ayrışan yüzey sınıfı).
// =============================================================================
import { Prisma } from "@prisma/client";

/** "ETKİN TAHSİS" YÜKLEMİ — TEK KAYNAK. Damgalı (yeniden hesaplanmış) satır Σ'ya girmez. */
export const ACTIVE_SACK_ALLOCATION = { clearedAt: null } satisfies Prisma.SackAllocationWhereInput;

/** Ham SQL ikizi — alias'lı tablo başvurusu için `AND <alias>."clearedAt" IS NULL`. */
export const ACTIVE_SACK_ALLOCATION_SQL = `"clearedAt" IS NULL`;

/**
 * Bir sevkiyatın ETKİN tahsislerini damgalar — üç yazıcının (sipariş kümesi değişimi ·
 * tahsis yenileme · sevkiyat iptali) TEK boğazı. Satır silinmez; `clearedShipmentId`
 * damgayı basan sevkiyattır (çuval sonradan başka sevkiyata girse de iz kalır).
 * Çağıran çuvalların `shipmentId`sini null'lamadan ÖNCE çağırır (ilişki yüklemi).
 */
export async function clearShipmentAllocationsTx(
  tx: Prisma.TransactionClient,
  shipmentId: string,
  userId: string | null | undefined,
): Promise<number> {
  const r = await tx.sackAllocation.updateMany({
    where: { sack: { shipmentId }, ...ACTIVE_SACK_ALLOCATION },
    data: { clearedAt: new Date(), clearedShipmentId: shipmentId, clearedById: userId ?? null },
  });
  return r.count;
}
