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

import { Prisma, TravelerCard, TravelerCardStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { TravelerCardService } from "./traveler-card.service";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
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

// =============================================================================
// K8 düzeltme araçları — YALNIZ SEVKSİZ (kilitli olmayan) partide çalışır (sevk
// edilmiş parti düzenlenemez). Hepsi tek iş emri içinde. Electron K8 dialog'ları
// (Faz 6) bunları çağırır. Kilit türetilmiş (isBatchLockedTx).
// =============================================================================

/** Parti kilitliyse (açık sevki varsa) 409 fırlatır. */
async function assertUnlocked(
  tx: Prisma.TransactionClient,
  batchId: string,
  label: string,
): Promise<void> {
  if (await isBatchLockedTx(tx, batchId)) {
    throw AppError.conflict(`${label} sevk edilmiş — düzenlenemez (önce sevki iptal edin).`);
  }
}

/**
 * K8: Topları başka bir SEVKSİZ partiye taşı (aynı iş emri içinde). Boşalan izsiz
 * kaynak partiler silinir. Kaynak + hedef partiler kilitli olmamalı.
 */
export async function moveRolls(
  params: { rollIds: string[]; toBatchId: string; userId?: string },
): Promise<{ movedCount: number; toBatchNumber: string; deletedBatchIds: string[] }> {
  const { rollIds, toBatchId, userId } = params;
  if (rollIds.length === 0) throw AppError.badRequest("Taşınacak top seçilmedi");

  const result = await prisma.$transaction(async (tx) => {
    const target = await tx.batch.findUnique({
      where: { id: toBatchId },
      select: { id: true, workOrderId: true, batchNumber: true },
    });
    if (!target) throw AppError.notFound("Hedef parti bulunamadı");
    await assertUnlocked(tx, toBatchId, "Hedef parti");

    const rolls = await tx.roll.findMany({
      where: { id: { in: rollIds } },
      select: { id: true, batchId: true },
    });
    if (rolls.length !== rollIds.length) throw AppError.notFound("Bazı toplar bulunamadı");

    const sourceBatchIds = [
      ...new Set(rolls.map((r) => r.batchId).filter((x): x is string => !!x && x !== toBatchId)),
    ];
    for (const sb of sourceBatchIds) {
      const src = await tx.batch.findUnique({ where: { id: sb }, select: { workOrderId: true } });
      if (!src || src.workOrderId !== target.workOrderId) {
        throw AppError.badRequest("Toplar hedef partiyle aynı iş emrinde değil");
      }
      await assertUnlocked(tx, sb, "Kaynak parti");
    }

    await tx.roll.updateMany({ where: { id: { in: rollIds } }, data: { batchId: toBatchId } });

    const deletedBatchIds: string[] = [];
    for (const sb of sourceBatchIds) {
      if (await deleteIfEmptyAndTraceless(tx, sb)) deletedBatchIds.push(sb);
    }
    return { movedCount: rollIds.length, toBatchNumber: target.batchNumber, deletedBatchIds };
  });

  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "BATCH",
    recordId: toBatchId,
    newData: { event: "K8_MOVE_ROLLS", movedCount: result.movedCount, rollIds, deletedBatchIds: result.deletedBatchIds },
  });
  return result;
}

/**
 * K8: İki+ SEVKSİZ partiyi birleştir — EN ESKİ parti no YAŞAR (survivor). Kaynak
 * partilerin topları survivor'a taşınır, kaynak kartlar VOID, boşalan izsiz kaynaklar
 * silinir. Survivor kartını korur. Hepsi aynı iş emrinde + kilitsiz olmalı.
 */
export async function mergeBatches(
  params: { batchIds: string[]; userId?: string },
): Promise<{ survivorId: string; survivorNumber: string; mergedNumbers: string[] }> {
  const { batchIds, userId } = params;
  const uniq = [...new Set(batchIds)];
  if (uniq.length < 2) throw AppError.badRequest("Birleştirme için en az iki parti gerekli");

  const result = await prisma.$transaction(async (tx) => {
    const batches = await tx.batch.findMany({
      where: { id: { in: uniq } },
      select: { id: true, batchNumber: true, workOrderId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    if (batches.length !== uniq.length) throw AppError.notFound("Bazı partiler bulunamadı");
    const woId = batches[0].workOrderId;
    if (!batches.every((b) => b.workOrderId === woId)) {
      throw AppError.badRequest("Yalnız aynı iş emrinin partileri birleştirilebilir");
    }
    for (const b of batches) await assertUnlocked(tx, b.id, `Parti ${b.batchNumber}`);

    const survivor = batches[0]; // en eski no yaşar
    const sources = batches.slice(1);
    await tx.roll.updateMany({
      where: { batchId: { in: sources.map((s) => s.id) } },
      data: { batchId: survivor.id },
    });
    for (const s of sources) {
      await tx.travelerCard.updateMany({
        where: { batchId: s.id, status: TravelerCardStatus.ACTIVE },
        data: {
          status: TravelerCardStatus.VOIDED,
          voidedAt: new Date(),
          voidReason: `K8 BİRLEŞTİR → ${survivor.batchNumber}`,
        },
      });
      await deleteIfEmptyAndTraceless(tx, s.id);
    }
    return { survivorId: survivor.id, survivorNumber: survivor.batchNumber, mergedNumbers: sources.map((s) => s.batchNumber) };
  });

  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "BATCH",
    recordId: result.survivorId,
    newData: { event: "K8_MERGE_BATCHES", survivor: result.survivorNumber, merged: result.mergedNumbers },
  });
  return result;
}

/**
 * K8: Bir SEVKSİZ partiden seçilen topları YENİ bir partiye ayır (elle böl). Yeni
 * parti P kodu + kart alır (splitFrom = kaynak). Partinin TÜM topları seçilemez.
 */
export async function splitBatch(
  params: { batchId: string; rollIds: string[]; userId?: string },
): Promise<{ newBatchId: string; newBatchNumber: string }> {
  const { batchId, rollIds, userId } = params;
  if (rollIds.length === 0) throw AppError.badRequest("Ayrılacak top seçilmedi");

  const { newBatch, cardRes } = await withBarcodeRetry(() =>
    prisma.$transaction(async (tx) => {
      const src = await tx.batch.findUnique({
        where: { id: batchId },
        select: { id: true, workOrderId: true },
      });
      if (!src) throw AppError.notFound("Kaynak parti bulunamadı");
      await assertUnlocked(tx, batchId, "Kaynak parti");

      const rolls = await tx.roll.findMany({
        where: { id: { in: rollIds }, batchId },
        select: { id: true },
      });
      if (rolls.length !== rollIds.length) throw AppError.badRequest("Bazı toplar bu partide değil");
      const total = await tx.roll.count({ where: { batchId } });
      if (rolls.length >= total) {
        throw AppError.badRequest("Partinin TÜM topları seçilemez — bölmede bir kısım kaynakta kalmalı");
      }

      const created = await createBatchTx(tx, {
        workOrderId: src.workOrderId,
        rollIds: rolls.map((r) => r.id),
        splitFromId: batchId,
        userId,
      });
      return { newBatch: created.batch, cardRes: created.cardRes };
    }),
  );

  await AuditService.log({
    userId,
    action: "CREATE",
    tableName: "BATCH",
    recordId: newBatch.id,
    newData: { event: "K8_SPLIT_BATCH", batchNumber: newBatch.batchNumber, splitFromId: batchId, rollCount: rollIds.length },
  });
  if (cardRes.created) {
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "TRAVELER_CARD",
      recordId: cardRes.card.id,
      newData: {
        cardNumber: cardRes.card.cardNumber,
        barcode: cardRes.card.barcode,
        version: 1,
        batchId: newBatch.id,
        event: "AUTO_PRINT_ON_K8_SPLIT",
      },
    });
  }
  return { newBatchId: newBatch.id, newBatchNumber: newBatch.batchNumber };
}
