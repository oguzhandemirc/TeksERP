// =============================================================================
// TeksERP - Subcontractor (Fason) Service / receipt-cancel
// =============================================================================
// Kabul iptali: önizleme, doğan topun engel yüklemi (boğaz ikizi), parti uyuşmazlığı ve iptal.
// `subcontractor.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../subcontractor.service`) okunur.
// =============================================================================

/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (dispatch.ts sayılır) */
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { ACTIVE_OPERATION, revokeRollOperations } from "../helpers/roll-operation.helper";
import { revokeRollProperties } from "../helpers/property-revoke.helper";
import { ACTIVE_MOVEMENT, reopenClosedMovementsTx, revokeRollMovements } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { reverseLatestScopedStockMove } from "../helpers/warehouse-ledger-reverse.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { ApiResponse } from "../../types/api.types";
import { Prisma, RollOperationType, RollStatus, ScanType } from "@prisma/client";
import { recomputeStepStatus } from "../helpers/roll-step.helper";
import { touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { revokePlanDeviationsTx, findPlanDeviationConfirmationsTx } from "../helpers/tambur-plan-gate.helper";
import {
  FASON_RECEIPT_CANCEL_CODE,
  FASON_RECEIPT_CANCEL_TEXT,
} from "../../constants/reason-presets";
import { VARIANCE_SOURCES } from "../../constants/variance-reasons";
import { assertWorkOrderBound } from "../helpers/dispatch-header.helper";
import { isRollItem } from "../helpers/dispatch-item-kind.helper";
import { assertRollsRevivable } from "../helpers/item-usage.helper";
import { ekranYolu } from "../../constants/panel-ekran-yolu";
import { TERIM } from "../../constants/terim";
import { UNBARCODED_ROLL_LABEL } from "./shared";
import { logTravelerScan } from "./receive";
import type { SubcontractorServiceThis } from "./shared";

// -----------------------------------------------------------------------------
// Cascade cancel — receipt'ten doğan açık kumaş roll'larının iptal güvenlik kontrolü
// -----------------------------------------------------------------------------

/** Frontend'in iptal preview ekranında listelediği her bornRoll için döner. */
export interface BornRollPreviewItem {
  id: string;
  /** Operatörün gerçekten okuyabildiği kimlik. UUID basmak teşhis değil gürültü. */
  barcode: string | null;
  itemCode: string;
  itemName: string;
  colorName: string | null;
  currentQty: number;
  status: RollStatus;
  /** Boş ise cascade iptal güvenli. Dolu ise her satır operatöre gösterilir. */
  blockingReasons: string[];
  safeToCancel: boolean;
}

type BornRollDownstreamShape = {
  status: RollStatus;
  sackId: string | null;
  operations: { id: string }[];
  movements: { exitedAt: Date | null }[];
  children: { id: string }[];
  dispatchItems: { id: string }[];
  /** Kabul girişi DIŞINDA geri alınmamış stok defteri satırı (transfer/sevk vb.). */
  warehouseMovements: { id: string }[];
};

/**
 * Doğan topun kabul girişi DIŞINDAKİ canlı stok defteri satırları — depoya girdikten
 * sonra transfer/çuval/sevk görmüşse iptal yalnız giriş satırını tersleyemez.
 * `computeBornRollBlockingReasons` (select) ve `blockingCondition` (where) BOĞAZ İKİZ.
 */
export const BORN_ROLL_FOREIGN_STOCK_MOVE: Prisma.WarehouseMovementWhereInput = {
  reasonCode: { not: STOCK_MOVE_REASON.FASON_RECEIPT },
  reversesMovementId: null,
  reversedBy: { none: {} },
};

/** Doğan topun cascade iptalinde güvenli statüler — tek kaynak, iki ikizde de okunur. */
export const BORN_ROLL_SAFE_STATUSES: readonly RollStatus[] = [
  RollStatus.STOCK,
  RollStatus.IN_PRODUCTION,
  // SON adım kabulünde doğan top depoya girer; iptal artık giriş satırını
  // `FASON_RECEIPT_CANCEL` ile tersliyor (2026-09-13) — çuvalsız ve başka
  // defter satırı yoksa iz tutarlı kalır.
  RollStatus.WAREHOUSE,
];

/**
 * Bir bornRoll cascade iptal edilebilir mi? Downstream'i olan (operasyon
 * görmüş, sonraki istasyona geçmiş, Tambur'da bölünmüş, başka fasona
 * gönderilmiş, çuvala girmiş, depoda başka hareket görmüş) Roll'lar iptal
 * edilemez — önce manuel temizlik gerekir.
 */
function computeBornRollBlockingReasons(roll: BornRollDownstreamShape): string[] {
  const reasons: string[] = [];
  if (roll.operations.length > 0) {
    reasons.push("Üzerinde işlem yapılmış");
  }
  if (roll.movements.some((m) => m.exitedAt !== null)) {
    reasons.push("Sonraki istasyona geçmiş");
  }
  if (roll.children.length > 0) {
    reasons.push("Tambur'da bölünmüş");
  }
  if (roll.dispatchItems.length > 0) {
    reasons.push("Başka fason sevkinde");
  }
  if (roll.sackId) {
    reasons.push("Çuvala girmiş");
  }
  if (roll.warehouseMovements.length > 0) {
    reasons.push("Depoda başka hareket görmüş");
  }
  if (!BORN_ROLL_SAFE_STATUSES.includes(roll.status)) {
    reasons.push(`Durum: ${roll.status}`);
  }
  return reasons;
}

// -----------------------------------------------------------------------------
// K14 parti-tutarlılık — TEK KAYNAK (iptal önizlemesi + tx içi guard)
// -----------------------------------------------------------------------------

/** Kabul iptalini engelleyen tek bir parti uyuşmazlığı satırı. */
export interface ReceiptBatchMismatchItem {
  rollId: string;
  /** Barkod; barkodsuz açık kumaşta `(barkodsuz açık kumaş)`. */
  barcode: string;
  dispatchNo: string;
  /** Topun ŞU ANKİ partisi (merge/move sonrası). */
  rollBatchNumber: string | null;
  /** Sevk kaydının bağlı olduğu parti. */
  dispatchBatchNumber: string | null;
}

/**
 * K14 parti-tutarlılık kontrolü. Kabul iptali orijinalleri yeniden
 * AT_SUBCONTRACTOR yapar ve kaynak sevk(ler) yeniden OUTSTANDING olur; K14
 * dönmüş partiyi K8 araçlarına (merge/move) açtığından top bu arada BAŞKA
 * partiye taşınmış olabilir. O halde "AT_SUB topun batchId'si = açık sevkin
 * batchId'si" değişmezi (firma çözümü, mobil kabul gruplaması, undoTransfer
 * bunu okur) kırılır.
 *
 * ⚠️ Bu fonksiyon HEM `getCancelPreview` HEM `cancelReceipt`'in tx-içi guard'ı
 * tarafından çağrılır — sorgu ikiye kopyalanırsa drift olur ve operatör
 * `allSafe: true` görüp 409 yer. Tek kaynak burasıdır.
 *
 * ⚠️ SIRALI await — `tx.*` üzerinde `Promise.all` YASAK (pg adapter tek
 * connection'ı seri çalıştırır).
 */
async function computeReceiptBatchMismatches(
  client: Prisma.TransactionClient | typeof prisma,
  rollIds: string[],
  stepId: string,
): Promise<ReceiptBatchMismatchItem[]> {
  if (rollIds.length === 0) return [];
  const rollBatchRows = await client.roll.findMany({
    where: { id: { in: rollIds } },
    select: {
      id: true,
      barcode: true,
      batchId: true,
      batch: { select: { batchNumber: true } },
    },
  });
  const srcDispatchItems = await client.subcontractorDispatchItem.findMany({
    where: {
      rollId: { in: rollIds },
      dispatch: { stepId, cancelledAt: null, directShippedAt: null },
    },
    select: {
      rollId: true,
      dispatch: {
        select: { batchId: true, dispatchNo: true, batch: { select: { batchNumber: true } } },
      },
    },
  });
  const rollBatchById = new Map(rollBatchRows.map((r) => [r.id, r] as const));
  const mismatches: ReceiptBatchMismatchItem[] = [];
  for (const it of srcDispatchItems.filter(isRollItem)) {
    const roll = rollBatchById.get(it.rollId);
    if (roll && roll.batchId !== it.dispatch.batchId) {
      mismatches.push({
        rollId: roll.id,
        barcode: roll.barcode ?? UNBARCODED_ROLL_LABEL,
        dispatchNo: it.dispatch.dispatchNo,
        rollBatchNumber: roll.batch?.batchNumber ?? null,
        dispatchBatchNumber: it.dispatch.batch?.batchNumber ?? null,
      });
    }
  }
  return mismatches;
}

/**
 * K14 uyuşmazlık mesajı — önizleme ve guard AYNI metni kullanır.
 * Parti NUMARALARI şart: operatör hangi iki partiyi birleştireceğini bilmeden
 * "birleştirin" demek yönlendirme değil, bilmece olur.
 */
function buildBatchMismatchMessage(items: ReceiptBatchMismatchItem[]): string {
  const detail = items
    .map(
      (m) =>
        `${m.barcode} topu artık ${m.rollBatchNumber ?? "partisiz"} partisinde ` +
        `ama sevk ${m.dispatchNo} → ${m.dispatchBatchNumber ?? "partisiz"} partisine bağlı`,
    )
    .join("; ");
  const pairs = [
    ...new Set(
      items.map((m) => `${m.dispatchBatchNumber ?? "partisiz"} + ${m.rollBatchNumber ?? "partisiz"}`),
    ),
  ].join(", ");
  return (
    `Kabul iptal edilemez — topların parti üyeliği kabulden sonra değişmiş ` +
    `(birleştirme/taşıma): ${detail}. ` +
    `Panelden ${ekranYolu("terbiyeIsEmirleri")} → detay → Partiler → Birleştir ile şu partileri birleştirin: ${pairs}. ` +
    `Sonra iptali tekrar deneyin.`
  );
}

export async function findClosedRemainderItems(
    db: Prisma.TransactionClient | typeof prisma,
    receiptId: string,
  ): Promise<Array<{ barcode: string | null; status: RollStatus }>> {
    const kismiler = await db.subcontractorReceiptItem.findMany({
      where: { receiptId, isPartial: true },
      select: { newRollId: true },
    });
    if (kismiler.length === 0) return [];
    const toplar = await db.roll.findMany({
      where: { id: { in: kismiler.map((k) => k.newRollId) } },
      select: { barcode: true, status: true },
    });
    return toplar.filter((t) => t.status !== RollStatus.AT_SUBCONTRACTOR);
  }

export async function getCancelPreview(this: SubcontractorServiceThis, receiptId: string): Promise<
    ApiResponse<{
      receiptNo: string;
      receivedAt: Date;
      bornRolls: BornRollPreviewItem[];
      /**
       * K14 parti-tutarlılık engeli — `cancelReceipt`'in tx-içi guard'ıyla AYNI
       * yardımcıdan gelir. Eskiden önizleme bunu hiç sormuyordu: operatör
       * `allSafe: true` görüp butona basıyor, sonra 409 yiyordu.
       */
      batchMismatch: {
        blocked: boolean;
        items: ReceiptBatchMismatchItem[];
        /** Guard'ın basacağı metnin birebir aynısı (null = engel yok). */
        message: string | null;
      };
      /** LIFO engeli (kısmi teslimat): aynı topa dokunan daha yeni aktif makbuzlar. */
      laterReceipts: string[];
      /**
       * ÜÇÜNCÜ ENGEL (BULGU-T3-017): kısmi kabulün kaynak topunun kalanı
       * "gelmeyecek" olarak kapatılmışsa top artık fasonda DEĞİLDİR ve iptalin
       * geri ekleyeceği bir şey kalmaz — uç 409 verir. Önizleme bunu önceden
       * söylemeli; `cancelReceipt`in guard'ıyla AYNI yardımcıdan gelir.
       */
      remainderClosed: {
        blocked: boolean;
        rolls: string[];
        message: string | null;
      };
      allSafe: boolean;
      totalBornRolls: number;
    }>
  > {
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id: receiptId },
      select: {
        id: true,
        workOrderId: true,
        receiptNo: true,
        receivedAt: true,
        cancelledAt: true,
        createdAt: true,
        stepId: true,
        items: { select: { newRollId: true } },
        workOrder: { select: { status: true } },
        bornRolls: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            status: true,
            item: { select: { code: true, name: true } },
            color: { select: { name: true } },
            // Downstream check: bu roll üzerinde geri alınmamış RollOperation var mı
            operations: { where: ACTIVE_OPERATION, select: { id: true }, take: 1 },
            // Sonraki istasyona çıkmış mı (exitedAt set olmuş RollMovement)
            movements: { where: ACTIVE_MOVEMENT, select: { exitedAt: true } },
            // Tambur'da bölünmüş mü (çocuk roll türemiş)
            children: { select: { id: true }, take: 1 },
            // Başka fason sevkinde mi
            dispatchItems: { select: { id: true }, take: 1 },
            // Çuvala girmiş mi / depoda kabul girişi dışında hareket görmüş mü
            sackId: true,
            warehouseMovements: { where: BORN_ROLL_FOREIGN_STOCK_MOVE, select: { id: true }, take: 1 },
          },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul belgesi bulunamadı");
    assertWorkOrderBound(receipt, "Mal kabul belgesi");
    if (receipt.cancelledAt) {
      throw AppError.conflict("Bu mal kabul zaten iptal edilmiş");
    }
    if (receipt.workOrder.status === "COMPLETED") {
      throw AppError.conflict(`Tamamlanmış ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} mal kabulü iptal edilemez`);
    }

    const bornRolls: BornRollPreviewItem[] = receipt.bornRolls.map((roll) => {
      const blockingReasons = computeBornRollBlockingReasons(roll);
      return {
        id: roll.id,
        barcode: roll.barcode,
        itemCode: roll.item.code,
        itemName: roll.item.name,
        colorName: roll.color?.name ?? null,
        currentQty: Number(roll.currentQty),
        status: roll.status,
        blockingReasons,
        safeToCancel: blockingReasons.length === 0,
      };
    });

    // K14'ü ÖNE AL — guard ile aynı yardımcı, aynı metin (drift yok).
    const mismatchItems = await computeReceiptBatchMismatches(
      prisma,
      receipt.items.map((it) => it.newRollId),
      receipt.stepId,
    );

    // LIFO engeli — cancelReceipt guard'ıyla aynı sorgu (kısmi teslimat).
    const laterReceipts = await prisma.subcontractorReceipt.findMany({
      where: {
        stepId: receipt.stepId,
        cancelledAt: null,
        id: { not: receiptId },
        createdAt: { gt: receipt.createdAt },
        items: { some: { newRollId: { in: receipt.items.map((it) => it.newRollId) } } },
      },
      select: { receiptNo: true },
      orderBy: { createdAt: "desc" },
    });

    const kapananKalanlar = await this.findClosedRemainderItems(prisma, receiptId);

    return {
      success: true,
      data: {
        receiptNo: receipt.receiptNo,
        receivedAt: receipt.receivedAt,
        bornRolls,
        batchMismatch: {
          blocked: mismatchItems.length > 0,
          items: mismatchItems,
          message: mismatchItems.length > 0 ? buildBatchMismatchMessage(mismatchItems) : null,
        },
        laterReceipts: laterReceipts.map((r) => r.receiptNo),
        // ÜÇÜNCÜ ENGEL (BULGU-T3-017): kısmi kabulün kaynak topu artık fasonda
        // değilse ("kalan gelmeyecek" kapaması) iptal 409 verir — önizleme bunu
        // ÖNCEDEN söylemeli.
        remainderClosed: {
          blocked: kapananKalanlar.length > 0,
          rolls: kapananKalanlar.map((t) => t.barcode ?? "(barkodsuz)"),
          message:
            kapananKalanlar.length > 0
              ? `Bu kabulün kısmi topunun kalanı "gelmeyecek" olarak kapatılmış ` +
                `(${kapananKalanlar.map((t) => t.barcode ?? "(barkodsuz)").join(", ")}). ` +
                "Kabul iptal edilemez — önce kalan kapamasını geri alın."
              : null,
        },
        // Önizleme bayat olabilir ama "güvenli" demeden önce bilinen TÜM
        // engelleri saymak zorunda.
        allSafe:
          bornRolls.every((b) => b.safeToCancel) &&
          mismatchItems.length === 0 &&
          laterReceipts.length === 0 &&
          kapananKalanlar.length === 0,
        totalBornRolls: bornRolls.length,
      },
    };
  }

export async function cancelReceipt(
    receiptId: string,
    reason: string,
    userId?: string,
    cascadeRollIds: string[] = [],
  ): Promise<ApiResponse<{ receiptNo: string; revertedRollCount: number; cascadedRollCount: number }>> {
    const trimmedReason = reason?.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
    }

    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id: receiptId },
      include: {
        items: { select: { newRollId: true, receivedQty: true, isPartial: true } },
        step: {
          include: {
            workOrder: {
              select: {
                id: true,
                status: true,
                steps: { orderBy: { stepSequence: "asc" }, select: { id: true, stepSequence: true } },
              },
            },
          },
        },
        bornRolls: {
          select: {
            id: true,
            barcode: true,
            currentStepId: true,
            status: true,
            operations: { where: ACTIVE_OPERATION, select: { id: true }, take: 1 },
            movements: { where: ACTIVE_MOVEMENT, select: { exitedAt: true } },
            children: { select: { id: true }, take: 1 },
            dispatchItems: { select: { id: true }, take: 1 },
            sackId: true,
            warehouseMovements: { where: BORN_ROLL_FOREIGN_STOCK_MOVE, select: { id: true }, take: 1 },
          },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul belgesi bulunamadı");
    assertWorkOrderBound(receipt, "Mal kabul belgesi"); // makbuz iptali iş emri yolunda (dokuma makbuzu G2 servisinde)
    if (receipt.cancelledAt) {
      throw AppError.conflict("Bu mal kabul zaten iptal edilmiş");
    }
    if (receipt.step.workOrder.status === "COMPLETED") {
      throw AppError.conflict(`Tamamlanmış ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} mal kabulü iptal edilemez`);
    }

    const rollIds = receipt.items.map((it) => it.newRollId);
    if (rollIds.length === 0) {
      throw AppError.badRequest("Bu kabul belgesinde rulo yok");
    }

    // LIFO GUARD (kısmi teslimat, 2026-08-19): aynı topa dokunan DAHA SONRAKİ
    // aktif makbuz varken bu makbuz iptal edilemez — defter satırları iç içe
    // geçer (kısmi-1 iptal edilirken final-2 tüketilmiş topa metraj geri koyardı).
    // Doğru sıra: önce en son makbuz iptal edilir (SAP storno LIFO pratiği).
    const laterReceipts = await prisma.subcontractorReceipt.findMany({
      where: {
        stepId: receipt.stepId,
        cancelledAt: null,
        id: { not: receiptId },
        createdAt: { gt: receipt.createdAt },
        items: { some: { newRollId: { in: rollIds } } },
      },
      select: { receiptNo: true },
      orderBy: { createdAt: "desc" },
    });
    if (laterReceipts.length > 0) {
      throw AppError.conflict(
        `Bu makbuzun toplarına dokunan daha yeni makbuz(lar) var: ${laterReceipts
          .map((r) => r.receiptNo)
          .join(", ")}. Önce en son makbuzu iptal edin (iptal sırası: yeniden eskiye).`,
        { code: "RECEIPT_NOT_LATEST" },
      );
    }

    // Cascade kontrolü: bornRoll varsa cascadeRollIds tüm bornRoll'ları kapsamalı
    // ve hepsi safety check'ten geçmeli. Aksi halde frontend preview göstermemiş
    // veya bayat veri ile çağırmış demektir → conflict.
    const bornRollIds = receipt.bornRolls.map((b) => b.id);
    if (bornRollIds.length > 0) {
      const cascadeSet = new Set(cascadeRollIds);
      const missing = bornRollIds.filter((id) => !cascadeSet.has(id));
      if (missing.length > 0) {
        throw AppError.conflict(
          `Bu receipt'ten ${bornRollIds.length} açık kumaş Roll'u türemiş. İptal için tümünün onaylanması gerek (${missing.length} eksik). Önce iptal önizlemesini yenileyin.`,
        );
      }
      const extra = cascadeRollIds.filter((id) => !bornRollIds.includes(id));
      if (extra.length > 0) {
        throw AppError.badRequest("Receipt'e ait olmayan Roll id'si gönderildi");
      }
      // Race koruması: preview'den sonra başka oturumda işlem yapılmış olabilir
      for (const roll of receipt.bornRolls) {
        const reasons = computeBornRollBlockingReasons(roll);
        if (reasons.length > 0) {
          throw AppError.conflict(
            `Top işlenmiş, iptal güvenli değil — ${roll.barcode ?? UNBARCODED_ROLL_LABEL}: ${reasons.join(", ")}`,
          );
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      // Fason completion yarışı (subcon #4): WO satırını kilitle — adım recompute'u
      // (COMPLETED→ACTIVE re-open) eşzamanlı dispatch/receive ile serileşsin.
      await touchWorkOrderTx(tx, receipt.workOrderId);
      // 0) Cascade: bornRoll'ları iptal et (varsa)
      if (bornRollIds.length > 0) {
        // Race koruması (tx İÇİ): yukarıdaki computeBornRollBlockingReasons
        // kontrolü tx DIŞINDA — preview ile tx arasında Kurşun operatörü born
        // roll'a işlem açmış olabilir. Aynı kontrolü taze veriyle tekrarla.
        const freshBornRolls = await sequentialTx(tx).roll.findMany({
          where: { id: { in: bornRollIds } },
          select: {
            id: true,
            barcode: true,
            currentStepId: true,
            status: true,
            operations: { where: ACTIVE_OPERATION, select: { id: true }, take: 1 },
            movements: { where: ACTIVE_MOVEMENT, select: { exitedAt: true } },
            children: { select: { id: true }, take: 1 },
            dispatchItems: { select: { id: true }, take: 1 },
            sackId: true,
            warehouseMovements: { where: BORN_ROLL_FOREIGN_STOCK_MOVE, select: { id: true }, take: 1 },
          },
        });
        for (const roll of freshBornRolls) {
          const reasons = computeBornRollBlockingReasons(roll);
          if (reasons.length > 0) {
            throw AppError.conflict(
              `Top bu sırada işlenmiş, iptal güvenli değil — ${roll.barcode ?? UNBARCODED_ROLL_LABEL}: ${reasons.join(", ")}`,
            );
          }
        }
        // RollMovement: receipt'in açtığı open-fabric hareketi GERİ AL (silme değil —
        // defter doktrini; geri alınmış satır adım durumuna girmez).
        await revokeRollMovements(tx, {
          rollIds: bornRollIds,
          notes: `RECEIPT_OPEN_FABRIC:${receipt.receiptNo}`,
          reason: "FASON_KABUL_IPTAL",
          userId,
        });
        // PLAN-SAPMA İMZASI (2026-09-13): kabulde "plandan farklı renk" onaylandıysa
        // deftere satır yazılmıştı ve Tambur kapısı o satırı görüp soruyu BİR DAHA
        // SORMUYOR. Kabul iptal edilince o onay geçersizdir — damgalanmazsa, doğan
        // top diriltildiğinde satır topa geri yapışır ve kapı susmaya devam eder.
        // ⚠️ Tanecik `confirmationId`: burada imza top başına tektir ama yüklem yine
        // imza kümesinden geçer (yarım damgalanmış imza tutarlı görünür).
        const receiptConfirmations = await findPlanDeviationConfirmationsTx(tx, {
          rollId: { in: bornRollIds },
        });
        await revokePlanDeviationsTx(tx, {
          confirmationIds: receiptConfirmations,
          reason: "FASON_KABUL_IPTAL",
          userId,
        });
        // STOK DEFTERİ: son adım kabulünde doğan top depoya `FASON_RECEIPT` ile
        // girmişti — o satırın TERSİ yazılır (ileri satır silinmez, değişmez).
        // Ara adımda doğan top satırsızdır → `bulunamayan`, hata değil (ufuk).
        await reverseLatestScopedStockMove(
          tx,
          bornRollIds,
          { reasonCode: STOCK_MOVE_REASON.FASON_RECEIPT, workOrderStepId: null },
          {
            reasonCode: STOCK_MOVE_REASON.FASON_RECEIPT_CANCEL,
            userId: userId ?? null,
            notes: `Fason kabul iptali (${receipt.receiptNo})`,
          },
        );
        // RollProperty SİLİNMEZ, DAMGALANIR (③a, Faz 2e): kardeş `revokeRollMovements`
        // ile aynı sebep kodu — top CANCELLED'a giderken özelliği de "geri alındı"
        // damgası taşır, satır ölü topta durur. Yeniden kabul YENİ top yaratır.
        await revokeRollProperties(tx, {
          rollIds: bornRollIds,
          reason: STOCK_MOVE_REASON.FASON_RECEIPT_CANCEL,
          userId: userId ?? null,
        });
        // Roll status → CANCELLED, currentStepId temizle
        // ⚠️ SEBEP KODU 2026-09-13'te EKLENDİ: bu yol topu SEBEPSİZ iptal ediyordu
        //    (data yalnız status + currentStepId), oysa iptal sebebi kataloglu. İki
        //    işi var — izi satırın KENDİSİNDE bırakmak (audit 6 ayda arşivlenir) ve
        //    restore guard'ının yedinci dalını beslemek.
        //    ⚠️ Engeli getiren şey bu KOD değil guard'ın DALI; kod tek başına hiçbir
        //    engel getirmez. İkisini karıştırmak kusuru "kapatılmış sanmaya" yol açar.
        await tx.roll.updateMany({
          where: { id: { in: bornRollIds } },
          data: {
            status: RollStatus.CANCELLED,
            currentStepId: null,
            cancelReasonCode: FASON_RECEIPT_CANCEL_CODE,
            cancelReason: FASON_RECEIPT_CANCEL_TEXT,
            cancelledAt: new Date(),
            cancelledById: userId ?? null,
          },
        });
        // Nextstep recompute (cascade roll'lar oradan çıktı, status değişebilir)
        const nextStepIds = [
          ...new Set(
            receipt.bornRolls
              .map((b) => b.currentStepId)
              .filter((id): id is string => !!id),
          ),
        ];
        for (const stepId of nextStepIds) {
          await recomputeStepStatus(tx, stepId);
        }
      }

      // 1) Receipt'i soft-cancel — ATOMİK CLAIM: cancelledAt kontrolü tx
      //    DIŞINDA; eşzamanlı çift iptal kaybedeni burada 409 alır.
      const receiptClaim = await tx.subcontractorReceipt.updateMany({
        where: { id: receiptId, cancelledAt: null },
        data: {
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: trimmedReason,
        },
      });
      if (receiptClaim.count === 0) {
        throw AppError.conflict("Bu mal kabul az önce başka bir kullanıcı tarafından iptal edilmiş.");
      }

      // 2) Bu adım için kapatılmış RollMovement'ları geri aç (RETURNED_VIA_RECEIPT
      //    notuyla kapatılmıştı)
      await reopenClosedMovementsTx(tx, {
        where: {
          workOrderStepId: receipt.stepId,
          rollId: { in: rollIds },
          notes: `RETURNED_VIA_RECEIPT:${receipt.receiptNo}`,
        },
        reason: "FASON_KABUL_IPTAL",
        notes: `REOPENED_FROM_RECEIPT:${receipt.receiptNo}`,
        userId: userId ?? null,
      });

      // 2.5) K14 parti-tutarlılık guard'ı: kabul iptali orijinalleri yeniden
      //    AT_SUBCONTRACTOR yapar ve kaynak sevk(ler) yeniden OUTSTANDING olur.
      //    K14 dönmüş partiyi K8 araçlarına (merge/move) açtığından, top bu arada
      //    BAŞKA partiye taşınmış olabilir — o halde canlanacak "AT_SUB topun
      //    batchId'si = açık sevkin batchId'si" değişmezi (firma çözümü, mobil
      //    kabul gruplaması, undoTransfer bunu okur) kırılırdı. Uyuşmazlıkta 409:
      //    iptal, üyelik eski partiye dönmeden / K15 belge-taşıma gelmeden yapılamaz.
      //    ⚠️ SIRALI await — `tx.*` üzerinde `Promise.all` YASAK (pg adapter tek
      //    connection'ı seri çalıştırır; pg@9'da hard-error). Paralellik zaten
      //    illüzyondu, davranış değişmiyor.
      //    ⚠️ Guard KALIR (son savunma hattı; önizleme bayat olabilir) ama sorgu
      //    artık `getCancelPreview` ile ORTAK yardımcıdan gelir — iki kopya
      //    kaçınılmaz olarak ayrışır ve operatör "güvenli" görüp 409 yerdi.
      const mismatches = await computeReceiptBatchMismatches(tx, rollIds, receipt.stepId);
      if (mismatches.length > 0) {
        throw AppError.conflict(buildBatchMismatchMessage(mismatches), {
          code: "BATCH_MISMATCH",
          items: mismatches,
        });
      }

      // 3) Orijinal Roll'ları geri çek — İKİ DAL (kısmi teslimat, 2026-08-19):
      //    • TAM kabul edilmiş top (isPartial=false): SUBCONTRACTOR_CONSUMED →
      //      AT_SUBCONTRACTOR (eski davranış; metraja DOKUNULMAZ — tam kabul
      //      metrajı düşürmemişti).
      //    • KISMİ kabul edilmiş top (isPartial=true): top ZATEN AT_SUBCONTRACTOR
      //      (tüketilmemişti) — statüye dokunulmaz, düşülen metraj (receivedQty)
      //      atomik increment ile GERİ KONUR. Kalan-kapama araya girdiyse top
      //      CONSUMED olur ve claim düşer → 409 (LIFO guard makbuzları korur,
      //      bu claim kalan-kapamayı).
      //    Her iki dal da ATOMİK CLAIM: beklenen statüde olmayan top → 409 + rollback.
      const fullItems = receipt.items.filter((it) => !it.isPartial);
      const partialItems = receipt.items.filter((it) => it.isPartial);
      if (fullItems.length > 0) {
        // Dirilme: kart Pasif olamaz (S5) — DB seddinin uygulama ikizi, çıkış yolunu söyler.
        await assertRollsRevivable(tx, fullItems.map((it) => it.newRollId));
        const revertedRolls = await tx.roll.updateMany({
          where: {
            id: { in: fullItems.map((it) => it.newRollId) },
            status: RollStatus.SUBCONTRACTOR_CONSUMED,
          },
          data: {
            status: RollStatus.AT_SUBCONTRACTOR,
            currentStepId: receipt.stepId,
          },
        });
        if (revertedRolls.count !== fullItems.length) {
          throw AppError.conflict(
            "Toplardan biri bu sırada başka bir işlemle değişmiş — kabul iptali yapılamadı. Listeyi yenileyip tekrar deneyin."
          );
        }
      }
      for (const it of partialItems) {
        if (it.receivedQty == null) continue; // savunma — kısmi satır defter metrajsız yazılmaz
        const restored = await tx.roll.updateMany({
          where: {
            id: it.newRollId,
            status: RollStatus.AT_SUBCONTRACTOR,
            currentStepId: receipt.stepId,
          },
          data: { currentQty: { increment: it.receivedQty } },
        });
        if (restored.count !== 1) {
          throw AppError.conflict(
            "Kısmen kabul edilmiş top bu sırada başka bir işlemle değişmiş (kalan kapatılmış olabilir) — kabul iptali yapılamadı."
          );
        }
      }

      // 4) SUBCONTRACTOR_RETURNED izini GERİ AL (silme değil).
      await revokeRollOperations(tx, {
        rollIds,
        workOrderStepIds: [receipt.stepId],
        operationTypes: [RollOperationType.SUBCONTRACTOR_RETURNED],
        reason: "FASON_KABUL_IPTAL",
        userId,
      });

      // 5) Receipt'in property listesini sil (cancel ⇒ uygulanan kimlik geri alınır)
      await tx.subcontractorReceiptProperty.deleteMany({
        where: { receiptId },
      });

      // 5b) ÇEKME SAPMASINI TERSLE (2026-08-21) — satır SİLİNMEZ, işaretlenir
      //     (append-only defter kuralı). İptal edilen kabulün firesi raporda
      //     kalsaydı defterde HAYALET fire olurdu; bu, defterin engellemek için
      //     var olduğu şeyin ta kendisi.
      //
      // ⚠️ Adres `sourceRefId`'dir, `rollId` DEĞİL: kısmi teslimatta aynı top
      // aynı adımda birden çok makbuzda sapma üretir ve iptal LIFO yalnız
      // SONUNCUSUNU kaldırır — rollId ile silmek önceki teslimatın meşru
      // sapmasını da süpürürdü.
      await tx.rollVariance.updateMany({
        where: {
          source: VARIANCE_SOURCES.SUBCONTRACTOR_RETURN,
          sourceRefId: receiptId,
          reversedAt: null,
        },
        data: { reversedAt: new Date(), reversedById: userId ?? null },
      });

      // 6) Step status recompute (genelde COMPLETED → ACTIVE'e döner)
      await recomputeStepStatus(tx, receipt.stepId);

      // 7) Refakat kartı INFO scan
      await logTravelerScan(
        tx,
        receipt.workOrderId,
        receipt.step.stationId,
        receipt.stepId,
        ScanType.INFO,
        userId,
        `Fason kabul iptal: ${receipt.receiptNo} — ${trimmedReason}`,
      );
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SUBCONTRACTOR_RECEIPT",
      recordId: receiptId,
      newData: {
        cancelled: true,
        cancelReason: trimmedReason,
        revertedRollCount: rollIds.length,
        cascadedRollCount: bornRollIds.length,
      },
    });

    const cascadeMsg = bornRollIds.length > 0
      ? ` · ${bornRollIds.length} açık kumaş iptal edildi`
      : "";
    return {
      success: true,
      data: {
        receiptNo: receipt.receiptNo,
        revertedRollCount: rollIds.length,
        cascadedRollCount: bornRollIds.length,
      },
      message: `Fason kabul iptal edildi: ${receipt.receiptNo} (${rollIds.length} rulo geri çekildi${cascadeMsg})`,
    };
  }
