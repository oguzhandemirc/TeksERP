// =============================================================================
// TeksERP — Batch (Parti) Service
// =============================================================================
// Parti = üretime aynı anda giren top grubu; bir iş emri (WorkOrder) N parti içerir.
// Attach dalgasında / sevk-anı auto-attach'te doğar (K3). Refakat kartı parti
// başınadır. "Dal" (eski Roll.batchSplitId = dispatch.id) kavramının yerini alır.
// Detay: PARTI-MODELI-TASARIM.md.
//
// Bu servis parti YAŞAM DÖNGÜSÜNÜN tx-içi çekirdeğini sağlar:
//   - createBatchTx            : P kodu üret + Batch + roll üyeliği + refakat kartı (tek tx)
//   - isBatchLockedTx          : parti kilitli mi (açık sevki var mı — türetilmiş kilit)
//   - assertBatchInWorkOrder   : parti gerçekten bu WO'ya mı ait
//   - deleteIfEmptyAndTraceless: boşalan + izsiz partiyi sil (soft-delete istisnası)
//
// Kod üretimi (P + GGAAYY + NNNN) tx İÇİNDE, sequence okuması closure içinde —
// çağıran `withBarcodeRetry(() => prisma.$transaction(...))` ile sarmalı (P2002 → retry).
// Kart audit'i F273 gereği tx DIŞINDA: createBatchTx `cardRes`'i döner, çağıran
// commit sonrası audit'ler (created ise).
// =============================================================================

import { Prisma, TravelerCard } from "@prisma/client";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { TravelerCardService } from "./traveler-card.service";
import { AppError } from "../utils/app-error";

const travelerCardService = new TravelerCardService();

export interface CreateBatchResult {
  batch: { id: string; batchNumber: string; workOrderId: string; splitFromId: string | null };
  cardRes: { card: TravelerCard; created: boolean };
}

/**
 * Parti no üretici (P + GGAAYY + NNNN) — tx İÇİNDE, sequence okuması closure içinde
 * (withBarcodeRetry kapsamında). `batches` tablosundan günün NUMERIC max'ı +1
 * (O-4 deseni: gte index seek + startsWith collation-bağımsız + Number.isFinite).
 */
export async function generateBatchNumberTx(
  tx: Prisma.TransactionClient,
  date: Date,
): Promise<string> {
  const prefix = dailyCodePrefix("P", date);
  const todays = await tx.batch.findMany({
    where: { batchNumber: { gte: prefix, startsWith: prefix } },
    select: { batchNumber: true },
  });
  const seq = nextDailySeq(
    todays.map((b) => b.batchNumber),
    prefix,
  );
  return buildDailyCode("P", seq, date);
}

/**
 * Yeni parti doğurur: P kodu + Batch satırı + (varsa) rollIds üyeliği + refakat kartı.
 * Çağıran tx'i `withBarcodeRetry(() => prisma.$transaction(...))` ile sarmalı.
 *
 * Roll üyeliği ATOMİK CLAIM DEĞİL — çağıran topları önceden sahiplenmiş olmalı
 * (attach status-guard'ı / dispatch claim'i); burada yalnız `batchId` damgalanır.
 * Kart audit'i tx DIŞINDA (F273): dönen `cardRes.created` ise çağıran commit
 * sonrası audit yazar.
 */
export async function createBatchTx(
  tx: Prisma.TransactionClient,
  params: {
    workOrderId: string;
    rollIds: string[];
    splitFromId?: string | null;
    userId?: string;
    date?: Date;
  },
): Promise<CreateBatchResult> {
  const now = params.date ?? new Date();
  const batchNumber = await generateBatchNumberTx(tx, now);

  const batch = await tx.batch.create({
    data: {
      batchNumber,
      workOrderId: params.workOrderId,
      splitFromId: params.splitFromId ?? null,
    },
    select: { id: true, batchNumber: true, workOrderId: true, splitFromId: true },
  });

  if (params.rollIds.length > 0) {
    await tx.roll.updateMany({
      where: { id: { in: params.rollIds } },
      data: { batchId: batch.id },
    });
  }

  const cardRes = await travelerCardService.createForBatch(tx, batch.id, params.userId);

  return { batch, cardRes };
}

/**
 * Parti KİLİTLİ mi? Kilit TÜRETİLMİŞTİR (status/lock kolonu YOK): partinin İPTAL
 * EDİLMEMİŞ en az bir fason sevki varsa kilitlidir — sevk edilmiş parti
 * düzenlenemez / birleştirilemez / topları taşınamaz (K8 guard'ı). İptalde sevk
 * `cancelledAt` alır → kilit kendiliğinden açılır.
 */
export async function isBatchLockedTx(
  tx: Prisma.TransactionClient,
  batchId: string,
): Promise<boolean> {
  const openDispatch = await tx.subcontractorDispatch.count({
    where: { batchId, cancelledAt: null },
  });
  return openDispatch > 0;
}

/**
 * Partinin gerçekten bu iş emrine ait olduğunu doğrular (cross-WO manipülasyon
 * koruması). Parti yoksa 404, başka WO'ya aitse 400.
 */
export async function assertBatchInWorkOrder(
  tx: Prisma.TransactionClient,
  batchId: string,
  workOrderId: string,
): Promise<void> {
  const batch = await tx.batch.findUnique({
    where: { id: batchId },
    select: { workOrderId: true },
  });
  if (!batch) throw AppError.notFound("Parti bulunamadı");
  if (batch.workOrderId !== workOrderId) {
    throw AppError.badRequest("Parti bu iş emrine ait değil");
  }
}

/**
 * Boşalan partiyi (hiç top kalmadıysa) YALNIZ hiçbir iz yoksa siler — soft-delete
 * istisnası ("boş çuval silme" emsali). İz = fason sevki VEYA kart taraması (scan)
 * VEYA kendisinden ayrılmış çocuk parti. İz varsa parti KALIR (izlenebilirlik).
 * İzsizse: (taranmamış) kart(lar) fiziksel silinir + parti silinir. Döner: silindiyse true.
 */
export async function deleteIfEmptyAndTraceless(
  tx: Prisma.TransactionClient,
  batchId: string,
): Promise<boolean> {
  const rollCount = await tx.roll.count({ where: { batchId } });
  if (rollCount > 0) return false;

  const dispatchCount = await tx.subcontractorDispatch.count({ where: { batchId } });
  if (dispatchCount > 0) return false;

  const childCount = await tx.batch.count({ where: { splitFromId: batchId } });
  if (childCount > 0) return false;

  const scanCount = await tx.travelerCardScan.count({
    where: { card: { batchId } },
  });
  if (scanCount > 0) return false;

  // İzsiz boş parti: kart(lar)ı sil (scan yok → FK RESTRICT güvenli) + partiyi sil.
  await tx.travelerCard.deleteMany({ where: { batchId } });
  await tx.batch.delete({ where: { id: batchId } });
  return true;
}
