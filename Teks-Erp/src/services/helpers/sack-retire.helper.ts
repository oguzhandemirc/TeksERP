// =============================================================================
// ÇUVAL "SİL" = DURUM GEÇİŞİ (emekli çuval) — 2026-11-19
// =============================================================================
// Deftere yazmış çuval (tartı · tahsis — defter.md ③a, RESTRICT FK · iz · depo hareketi · kartela olayı · iade)
// sert silinmez: silmek o satırları ya keser ya bağsız bırakır. "Sil" `retiredAt` damgasıdır (kök kural:
// hard delete yalnız ④ deftere hiç yazmamış taslak · ③b yapılandırma pivotu).
// Emekli çuval havuzdan görünmez: havuz okuyucuları `LIVE_SACK_WHERE` / `liveSackSql` süzer.
// =============================================================================
import { Prisma } from "@prisma/client";

/** "CANLI ÇUVAL" YÜKLEMİ — TEK KAYNAK. Emekli (silinmiş) çuval havuz/arama/bağlama yollarına girmez. */
export const LIVE_SACK_WHERE = { retiredAt: null } satisfies Prisma.SackWhereInput;

/** Ham SQL ikizi — `liveSackSql("s")` → `s."retiredAt" IS NULL`. */
export function liveSackSql(alias: string): Prisma.Sql {
  return Prisma.sql`${Prisma.raw(`${alias}."retiredAt"`)} IS NULL`;
}

/**
 * "Bu çuval deftere HİÇ yazdı mı" — TEK kaynak (çuval silme · el terminali boş çuval düşürme). Sıfırsa çuval
 * "deftere hiç yazmamış taslak"tır ve sert silinebilir; değilse silmek ölçüm/tahsis/hareket geçmişini
 * (cascade/SetNull/RESTRICT) koparırdı. FK'lı ve FK'sız (SwatchEvent · RollReturn) her başvuru sayılır.
 */
export async function sackLedgerCountTx(tx: Prisma.TransactionClient, sackId: string): Promise<number> {
  return (await tx.sackWeighing.count({ where: { sackId } }))
    // ⚠️ `clearedAt` SÜZÜLMEZ (bilinçli): temizlenmiş tahsis de geçmiştir.
    + (await tx.sackAllocation.count({ where: { sackId } }))
    + (await tx.sackTagAssignment.count({ where: { sackId } }))
    + (await tx.warehouseMovement.count({ where: { sackId } }))
    + (await tx.swatchEvent.count({ where: { sackId } }))
    + (await tx.rollReturn.count({ where: { prevSackId: sackId } }));
}
