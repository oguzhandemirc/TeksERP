// =============================================================================
// GELEN BELGE — aynı müşteri partisinin başka belgeleri (salt okuma bilgisi; tasarım notu 2026-11-02 §2 md.5)
// =============================================================================
// Sahip OCR'dan dolmadığı için kontrol okuma anında değil, detayda (sahip seçilince detay yeniden okunur) yapılır.
// Parti kimliği YALNIZ `customerBatchKeyOf`/`customerBatchKeySql` (ship-readiness boğaz-ikizi); iptal belge ve
// belgenin kendisi sayılmaz. Engel değildir: onay ve taslak yazımı bundan etkilenmez.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { customerBatchKeyOf, customerBatchKeySql, customerBatchMemberSql } from "./helpers/ship-readiness.helper";

/** Yanıtta listelenen en çok belge (sayı `total`da tam). */
export const SAME_BATCH_LIST_LIMIT = 10;

export interface SameBatchNotes {
  batchNo: string;
  /** İptal dışı, bu belge hariç aynı (sahip, parti no) belgelerinin sayısı. */
  total: number;
  /** En yeni önce, en çok `SAME_BATCH_LIST_LIMIT`. */
  notes: Array<{ id: string; noteNo: string; status: string; createdAt: Date }>;
}

/** Belgenin müşteri partisinde başka belge yoksa (ya da parti anahtarı yoksa) null. */
export async function sameBatchNotes(note: { id: string; ownerCustomerId: string | null; customerBatchNo: string | null }): Promise<SameBatchNotes | null> {
  const key = customerBatchKeyOf(note.ownerCustomerId, note.customerBatchNo);
  if (!key) return null;
  const where = Prisma.sql`${customerBatchMemberSql("n")} AND ${customerBatchKeySql("n")} = ${key} AND n.id <> ${note.id}::uuid AND n.status <> 'CANCELLED'`;
  const rows = await prisma.$queryRaw<Array<{ id: string; noteNo: string; status: string; createdAt: Date; total: bigint }>>`
    SELECT n.id, n."noteNo", n.status::text AS status, n."createdAt", COUNT(*) OVER () AS total
    FROM customer_delivery_notes n
    WHERE ${where}
    ORDER BY n."createdAt" DESC, n.id ASC
    LIMIT ${SAME_BATCH_LIST_LIMIT}`;
  if (!rows.length) return null;
  return {
    batchNo: note.customerBatchNo!.trim(),
    total: Number(rows[0]!.total),
    notes: rows.map((r) => ({ id: r.id, noteNo: r.noteNo, status: r.status, createdAt: r.createdAt })),
  };
}
