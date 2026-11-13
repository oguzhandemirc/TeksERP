/**
 * Bayat veri koruması (iyimser sürüm) — sipariş ve cari güncellemesi.
 *
 * İstemci okuduğu kaydın sürümünü İSTEĞE BAĞLI `expectedUpdatedAt` ile geri yollar; yazım
 * atomik claim'ine bu koşul eklenir, tutmazsa 409 `STALE_RECORD`. Alan yoksa hiçbir şey
 * değişmez (panel/tablet bugün göndermiyor). Alan DB kolonuna yazılmaz, gövdeden düşürülür.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";

export const STALE_RECORD_CODE = "STALE_RECORD";
export const STALE_RECORD_MESSAGE = "Kayıt siz bakarken değişti. Yenileyip tekrar deneyin.";
export const EXPECTED_UPDATED_AT_FIELD = "expectedUpdatedAt";

const ExpectedUpdatedAtSchema = z.iso.datetime({ offset: true });

export function staleRecordError(): AppError {
  return AppError.conflict(STALE_RECORD_MESSAGE, { code: STALE_RECORD_CODE });
}

/**
 * Gövdeden `expectedUpdatedAt`i ÇIKARIR (kolona sızmasın) ve çözer; yok/null → null, bozuk → 400.
 * `forbidDeactivate`: arşiv kapısı ayrı tx'te yazar (sürüm claim'iyle birleşmez) → `isActive:false` ile 400.
 */
export function takeExpectedUpdatedAt(body: Record<string, unknown>, opts?: { forbidDeactivate?: boolean }): Date | null {
  if (!Object.prototype.hasOwnProperty.call(body, EXPECTED_UPDATED_AT_FIELD)) return null;
  const raw = body[EXPECTED_UPDATED_AT_FIELD];
  delete body[EXPECTED_UPDATED_AT_FIELD];
  if (raw === undefined || raw === null) return null;
  const parsed = ExpectedUpdatedAtSchema.safeParse(raw);
  if (!parsed.success) {
    throw AppError.badRequest("expectedUpdatedAt ISO tarih olmalı (ör. 2026-11-13T10:00:00.000Z).", { code: "VALIDATION_ERROR" });
  }
  if (opts?.forbidDeactivate && body.isActive === false) {
    throw AppError.badRequest("Pasife alma expectedUpdatedAt ile birlikte gönderilemez; pasife almak için DELETE ucunu kullanın.", { code: "VALIDATION_ERROR" });
  }
  return new Date(parsed.data);
}

const nextMs = (d: Date): Date => new Date(d.getTime() + 1);

/** JSON sürümü milisaniyeye keser, DB mikro saniye tutabilir: eşitlik [v, v+1ms) penceresidir. */
export function updatedAtIs(expected: Date): Prisma.DateTimeFilter {
  return { gte: expected, lt: nextMs(expected) };
}

/**
 * Siparişin İÇERİK sürümü = başlık ve kalemlerin en büyük `updatedAt`i. Kalem rengi ve müşteri
 * adı düzeltmesi yalnız kalemi yazar, başlığa dokunmaz — sürüm o yüzden ikisinin maksimumudur.
 */
export function orderContentUpdatedAt(order: { updatedAt: Date; lines?: ReadonlyArray<{ updatedAt: Date }> | null }): Date {
  let max = order.updatedAt.getTime();
  for (const l of order.lines ?? []) max = Math.max(max, l.updatedAt.getTime());
  return new Date(max);
}

/** `orderContentUpdatedAt` ∈ [v, v+1ms) yükleminin Prisma ikizi (tek UPDATE'in WHERE'ine girer). */
export function orderContentVersionWhere(expected: Date): Prisma.OrderWhereInput {
  return {
    updatedAt: { lt: nextMs(expected) },
    lines: { none: { updatedAt: { gte: nextMs(expected) } } },
    OR: [{ updatedAt: { gte: expected } }, { lines: { some: { updatedAt: { gte: expected } } } }],
  };
}

/**
 * Sipariş sürüm claim'i — kalem/başlık yazımından ÖNCE, tx içinde. Başlık satırını kilitler
 * (eşzamanlı ikinci yazım bekler, sonra tazelenen `updatedAt`e takılır) ve sürümü ilerletir.
 */
export async function claimOrderVersionTx(
  tx: Prisma.TransactionClient,
  id: string,
  status: Prisma.OrderWhereInput["status"],
  expected: Date,
): Promise<void> {
  // Kilit sırası sevk yoluyla aynı (kalemler id sırasıyla → başlık); `updatedAt`e dokunmadan kilitler.
  // aktif-kalem-muaf: satır KİLİDİ (FOR UPDATE), talep sorgusu değil — sürüm iptal edilmiş kalemi de kapsar.
  await tx.$queryRaw`SELECT id FROM order_lines WHERE "orderId" = ${id}::uuid ORDER BY id FOR UPDATE`;
  const claimed = await tx.order.updateMany({
    where: { id, status, ...orderContentVersionWhere(expected) },
    data: { updatedAt: new Date() },
  });
  if (claimed.count === 0) throw staleRecordError();
}

/** Sipariş detay/güncelleme yanıtına `contentUpdatedAt` (istemcinin geri yollayacağı sürüm) ekler. */
export function withOrderContentVersion<T extends { data?: unknown }>(res: T): T {
  const data = res.data as { updatedAt?: unknown; lines?: unknown } | null | undefined;
  if (!data || !(data.updatedAt instanceof Date)) return res;
  const lines = Array.isArray(data.lines) && data.lines.every((l: { updatedAt?: unknown }) => l?.updatedAt instanceof Date)
    ? (data.lines as Array<{ updatedAt: Date }>)
    : null;
  if (!lines) return res;
  return { ...res, data: { ...data, contentUpdatedAt: orderContentUpdatedAt({ updatedAt: data.updatedAt, lines }) } };
}
