// =============================================================================
// PARTİ DÜŞÜRME — "bu partiyi iş emrinden çıkar", iş emri devam eder
// =============================================================================
// Saha ihtiyacı: bir iş emrinin TEK partisi iptal olur (yanlış açıldı, müşteri o
// kalemden vazgeçti, mal başka işe kaydı) ama iş emri diğer partileriyle devam eder.
// Bugün bunun yolu yoktu: iş emri iptali hepsini birden alır, `splitBatch` partinin
// TÜM toplarını ayırmayı reddeder (`batch.service.ts:906`) ve Top Çıkar yalnız işlem
// görmemiş tek topu alır.
//
// ⚠️ Parti düşürme kendi tx'ini taşır: gerekçe/karar kavramı, refakat kartının bayat
// işaretlenmesi, boşalan partinin temizliği gerekir ve tek partinin düşürülmesi ya
// bütün olur ya hiç.
//
// ⚠️ İŞ EMRİ DURUMU DEĞİŞMEZ. Son parti de düşse `COMPLETED` yapılmaz — o "bunu
// ÜRETTİK" demektir ve olan bunun tam tersidir. Yanıttaki `noLiveRollsRemain`
// bayrağı ile arayüz "iş emrini de iptal et" teklif eder; karar kullanıcınındır.
// =============================================================================
import { ReasonPresetKind, RollStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { resolveReasonCode } from "./reason-preset.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { warehouseStampManyTx } from "./helpers/warehouse.helper";
import { WAREHOUSE_STOCK_STATUSES } from "./helpers/warehouse-stock.helper";
import {
  assertBatchInWorkOrderTx,
  deleteIfEmptyAndTracelessTx,
  K18_DEAD_STATUSES,
  NO_LIVE_MATERIAL_STATUSES,
} from "./batch.service";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { recomputeStepStatus } from "./helpers/roll-step.helper";
import {
  loadQualityTargetMaps,
  resolveFinalStatus,
  finalBarcodeType,
} from "./helpers/roll-finalize.helper";
import { reserveRollBarcodesTx } from "./helpers/roll-barcode.helper";
import { markTravelerCardDirtyTx } from "./helpers/traveler-card-dirty.helper";
import {
  applyRollDispositionsTx,
  DISPOSITION_MAX_ROLLS,
  SELLABLE_DISPOSITION_STATUSES,
  type AppliedRollDisposition,
} from "./helpers/roll-disposition.helper";
import type { CancelDisposition } from "./workorder.service";

export interface BatchDropInput {
  /** ZORUNLU (min 3) — audit'e ve hareket notuna yazılır. */
  reason: string;
  /**
   * Sebebin KATALOG KODU (ReasonPreset ROLL_CANCEL, 2026-08-21) — opsiyonel;
   * CANCELLED kararındaki topların `cancelReasonCode`'una yazılır. Verilmezse
   * sunucu `reason` metninden türetir (`resolveReasonCode`, tx DIŞINDA).
   */
  reasonCode?: string | null;
  /**
   * Partideki canlı topların ALT KÜMESİ. Gönderilmeyen her top varsayılan
   * `STOCK`'a döner (renge duyarlı — aşağıya bak).
   */
  dispositions?: Array<{ rollId: string; action: CancelDisposition }>;
}

/**
 * Düşürme engeli — yoksa `null`. SAF: önizleme ve mutasyon AYNI yüklemi çağırır,
 * yoksa ekran "düşürülebilir" derken uç 409 verir (`resolveUndoBlockReason` ve
 * `resolveRollRestoreBlockReason` ile aynı sözleşme).
 */
export function resolveBatchDropBlockReason(s: {
  workOrderStatus: WorkOrderStatus;
  mergedIntoBatchNumber: string | null;
  openDispatchNos: string[];
  atSubcontractorCount: number;
  returnedFromSubcontractorCount: number;
  liveRollCount: number;
}): string | null {
  if (
    s.workOrderStatus === WorkOrderStatus.COMPLETED ||
    s.workOrderStatus === WorkOrderStatus.CANCELLED ||
    s.workOrderStatus === WorkOrderStatus.SUPERSEDED
  ) {
    return `Tamamlanmış/iptal edilmiş iş emrinde parti düşürülemez (durum: ${s.workOrderStatus}).`;
  }
  if (s.mergedIntoBatchNumber) {
    return `Bu parti ${s.mergedIntoBatchNumber} altına birleştirilmiş — işlem survivor partide yapılmalı.`;
  }
  if (s.openDispatchNos.length > 0) {
    return (
      `Partinin açık fason sevki var (${s.openDispatchNos.join(", ")}) — ` +
      "önce sevkleri iptal edin, toplar içeri dönsün."
    );
  }
  if (s.atSubcontractorCount > 0) {
    return `${s.atSubcontractorCount} top fasonda (fiziksel olarak dışarıda) — parti düşürülemez.`;
  }
  if (s.returnedFromSubcontractorCount > 0) {
    return (
      `${s.returnedFromSubcontractorCount} top fason dönüşü bekliyor — ` +
      "parti düşürülemez, önce mal kabulü tamamlanmalı."
    );
  }
  if (s.liveRollCount === 0) {
    return "Bu partide canlı top yok — düşürülecek bir şey yok.";
  }
  return null;
}

/** Önizleme satırı — arayüz kararı bununla çizer. */
interface DropPreviewRoll {
  id: string;
  barcode: string | null;
  status: RollStatus;
  currentQty: number;
  colorName: string | null;
  colorHex: string | null;
  qualityGrade: string | null;
  stationName: string;
  /** Fason dönüşü mal ham stoğa dönemez. */
  canReturnToStock: boolean;
  /**
   * `STOCK` seçilirse topun GERÇEKTEN gideceği statü. Renkli top ham stoğa değil
   * kaliteden çözülen rafa döner (F1 kuralı) — etiket "Ham stok"
   * derken topun depoya gitmesi kullanıcıyı yanıltırdı.
   */
  revertStatus: RollStatus;
}

class WorkOrderBatchDropService {
  /** Partiyi düşürmenin etkisini ÖNİZLER. Hiçbir şeyi değiştirmez. */
  async getDropPreview(workOrderId: string, batchId: string): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, workOrderNumber: true, status: true, steps: { select: { id: true } } },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        batchNumber: true,
        workOrderId: true,
        mergedInto: { select: { batchNumber: true } },
      },
    });
    if (!batch) throw AppError.notFound("Parti bulunamadı");
    if (batch.workOrderId !== workOrderId) {
      throw AppError.badRequest("Parti bu iş emrine ait değil");
    }

    const rolls = await prisma.roll.findMany({
      where: { batchId, status: { notIn: K18_DEAD_STATUSES } },
      select: {
        id: true,
        barcode: true,
        status: true,
        currentQty: true,
        colorId: true,
        qualityGrade: true,
        entrySource: true,
        color: { select: { name: true, hex: true } },
        currentStep: { select: { station: { select: { name: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });

    const openDispatches = await prisma.subcontractorDispatch.findMany({
      where: { batchId, cancelledAt: null, directShippedAt: null },
      select: { id: true, dispatchNo: true },
    });

    const { statusByCode } = await loadQualityTargetMaps(
      prisma,
      rolls.map((r) => r.qualityGrade),
    );

    const mapped: DropPreviewRoll[] = rolls.map((r) => ({
      id: r.id,
      barcode: r.barcode,
      status: r.status,
      currentQty: Number(r.currentQty),
      colorName: r.color?.name ?? null,
      colorHex: r.color?.hex ?? null,
      qualityGrade: r.qualityGrade,
      stationName: r.currentStep?.station?.name ?? "—",
      canReturnToStock: r.entrySource !== "SUBCONTRACTOR_RETURN",
      revertStatus:
        r.colorId == null ? RollStatus.STOCK : resolveFinalStatus(r.qualityGrade, statusByCode),
    }));

    const blockReason = resolveBatchDropBlockReason({
      workOrderStatus: wo.status,
      mergedIntoBatchNumber: batch.mergedInto?.batchNumber ?? null,
      openDispatchNos: openDispatches.map((d) => d.dispatchNo),
      atSubcontractorCount: rolls.filter((r) => r.status === RollStatus.AT_SUBCONTRACTOR).length,
      returnedFromSubcontractorCount: rolls.filter(
        (r) => r.status === RollStatus.RETURNED_FROM_SUBCONTRACTOR,
      ).length,
      liveRollCount: rolls.length,
    });

    // Diğer partiler — "bu partiyi düşürürsem iş emrinde ne kalır" sorusu.
    const otherBatches = await prisma.batch.findMany({
      where: { workOrderId, id: { not: batchId }, mergedIntoId: null },
      select: { id: true, batchNumber: true, _count: { select: { rolls: true } } },
      orderBy: { createdAt: "asc" },
    });

    return {
      success: true,
      data: {
        workOrderId,
        workOrderNumber: wo.workOrderNumber,
        batchId,
        batchNumber: batch.batchNumber,
        canDrop: blockReason === null,
        blockReason,
        rolls: mapped,
        rollCount: mapped.length,
        totalMeters: mapped.reduce((s, r) => s + r.currentQty, 0),
        openDispatches: openDispatches.map((d) => ({
          dispatchId: d.id,
          dispatchNo: d.dispatchNo,
        })),
        otherBatches: otherBatches.map((b) => ({
          batchId: b.id,
          batchNumber: b.batchNumber,
          rollCount: b._count.rolls,
        })),
      },
    };
  }

  /**
   * Partiyi iş emrinden düşürür. Toplar karara göre çözülür, parti üyeliği kopar
   * (iptal edilenler HARİÇ — aşağıya bak) ve boşalan izsiz parti silinir.
   */
  async dropBatch(
    workOrderId: string,
    batchId: string,
    input: BatchDropInput,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const reason = (input.reason ?? "").trim();
    if (reason.length < 3) {
      throw AppError.badRequest("Düşürme nedeni (en az 3 karakter) zorunludur");
    }
    // Sebep KODU — tx DIŞINDA çözülür (açık kod doğrulanır, yoksa metinden türetilir;
    // serbest metin → NULL). Motor (`applyRollDispositionsTx`) tx içinde katalog okumaz.
    const { code: cancelReasonCode } = await resolveReasonCode(ReasonPresetKind.ROLL_CANCEL, {
      reasonCode: input.reasonCode,
      reasonText: reason,
    });

    // ⚠️ STOCK MOTORA VERİLMEZ — iptaldeki ile aynı gerekçe: varsayılan yolun
    // (renge duyarlı geri çekme) sonucu ile motorun yazacağı satır farklıdır ve
    // aynı karar, istemci satırı gönderdi mi göndermedi mi diye iki farklı
    // hareket üretirdi.
    const decided = (input.dispositions ?? []).filter((d) => d.action !== "STOCK");
    if (decided.length > DISPOSITION_MAX_ROLLS) {
      throw AppError.badRequest(
        `Tek işlemde en fazla ${DISPOSITION_MAX_ROLLS} top için karar verilebilir`,
      );
    }
    const seen = new Set<string>();
    for (const d of decided) {
      if (seen.has(d.rollId)) {
        throw AppError.badRequest("Aynı top için birden fazla karar gönderildi");
      }
      seen.add(d.rollId);
    }

    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        // ⚠️ İLK İFADE — KİLİT. Burada bir statü geçişi YOK, dolayısıyla iptalin
        // atomik claim'i gibi örtük bir kilit de yok. `dispatch`/`receive`/
        // `cancel`/`merge`/`split`/`moveRolls` hepsi bu satırı kilitler; kilidi
        // guard'lardan sonra almak ders kitabı TOCTOU'su olurdu (bu repo bedelini
        // KK1 mükerrer tuzağında ve parti numarası üretiminde iki kez ödedi).
        await touchWorkOrderTx(tx, workOrderId);

        // Kilit ALTINDA taze oku — tx dışı okuma tanım gereği bayattır.
        const wo = await tx.workOrder.findUnique({
          where: { id: workOrderId },
          select: { workOrderNumber: true, status: true, steps: { select: { id: true } } },
        });
        if (!wo) throw AppError.notFound("İş emri bulunamadı");
        const stepIds = wo.steps.map((s) => s.id);

        await assertBatchInWorkOrderTx(tx, batchId, workOrderId);
        const batch = await tx.batch.findUnique({
          where: { id: batchId },
          select: { batchNumber: true, mergedInto: { select: { batchNumber: true } } },
        });
        if (!batch) throw AppError.notFound("Parti bulunamadı");

        const openDispatches = await tx.subcontractorDispatch.findMany({
          where: { batchId, cancelledAt: null, directShippedAt: null },
          select: { dispatchNo: true },
        });

        const live = await tx.roll.findMany({
          where: { batchId, status: { notIn: K18_DEAD_STATUSES } },
          select: {
            id: true,
            barcode: true,
            status: true,
            currentQty: true,
            weightKg: true,
            colorId: true,
            qualityGrade: true,
            entrySource: true,
            currentStepId: true,
          },
        });

        const blockReason = resolveBatchDropBlockReason({
          workOrderStatus: wo.status,
          mergedIntoBatchNumber: batch.mergedInto?.batchNumber ?? null,
          openDispatchNos: openDispatches.map((d) => d.dispatchNo),
          atSubcontractorCount: live.filter((r) => r.status === RollStatus.AT_SUBCONTRACTOR).length,
          returnedFromSubcontractorCount: live.filter(
            (r) => r.status === RollStatus.RETURNED_FROM_SUBCONTRACTOR,
          ).length,
          liveRollCount: live.length,
        });
        if (blockReason) throw AppError.conflict(blockReason);

        const liveById = new Map(live.map((r) => [r.id, r]));
        const missing = decided.filter((d) => !liveById.has(d.rollId));
        if (missing.length > 0) {
          throw AppError.badRequest(
            `${missing.length} top artık bu partide değil — liste bu sırada değişti. Sayfayı yenileyin.`,
          );
        }
        // Fason dönüşü mal ham stoğa DÖNEMEZ (softDelete invariant'ı). Guard yukarıda
        // partiyi zaten bloklamış olur; kural yine de burada durur — sonuç değil
        // KURAL olduğu için.
        for (const d of decided) {
          const roll = liveById.get(d.rollId)!;
          if (d.action === "STOCK" && roll.entrySource === "SUBCONTRACTOR_RETURN") {
            throw AppError.badRequest(
              `${roll.barcode ?? "Açık kumaş"}: fason dönüşü top ham stoğa çekilemez.`,
            );
          }
        }

        const affectedStepIds = new Set(
          live.map((r) => r.currentStepId).filter((s): s is string => !!s),
        );

        // 1) KARARLI TOPLAR (fire / hatalı kayıt).
        //    ⚠️ `batchId` KURALI: `STOCK`/`SCRAP` partiden KOPAR, `CANCELLED` KALIR.
        //    Sebep `getBranches`: lane yalnız K18 ölülerini gizler ve **`SCRAP` K18'de
        //    DEĞİLDİR** — fire top partide kalsaydı lane'de sonsuza dek "üretimde"
        //    görünürdü. `CANCELLED` ise K18'dedir, gizlenir ve partide kalarak
        //    "hangi partiye yanlış top yazılmıştı" izini korur (`inventory.softDelete`).
        const applied: AppliedRollDisposition[] = decided.length
          ? await applyRollDispositionsTx(tx, {
              origin: "BATCH_DROP",
              reason,
              reasonCode: cancelReasonCode,
              userId,
              rolls: live,
              dispositions: decided,
              stepIds,
              clearBatchId: (action) => action !== "CANCELLED",
              generateBarcodes: false, // üç aksiyonun hiçbiri satılabilir değil
            })
          : [];

        // 2) KALAN TOPLAR → varsayılan geri çekme, RENGE DUYARLI (F1).
        //    Renksiz (ham) → STOCK; renkli (işlenmiş) → kaliteden çözülen final raf.
        //    Körlemesine STOCK yazmak, boyanmış bir topu ham stoğa düşürürdü.
        const decidedIds = new Set(decided.map((d) => d.rollId));
        const residual = live.filter(
          (r) => !decidedIds.has(r.id) && r.status === RollStatus.IN_PRODUCTION,
        );
        const { statusByCode } = await loadQualityTargetMaps(
          tx,
          residual.map((r) => r.qualityGrade),
        );
        const idsByTarget = new Map<RollStatus, string[]>();
        for (const r of residual) {
          const target =
            r.colorId == null ? RollStatus.STOCK : resolveFinalStatus(r.qualityGrade, statusByCode);
          const arr = idsByTarget.get(target);
          if (arr) arr.push(r.id);
          else idsByTarget.set(target, [r.id]);
        }
        let claimed = 0;
        for (const [target, ids] of idsByTarget) {
          // Hedef STOK KÜMESİNDEYSE depo damgası terfinin parçası (flip'ten ÖNCE).
          if (WAREHOUSE_STOCK_STATUSES.includes(target)) {
            await warehouseStampManyTx(tx, ids);
          }
          const res = await tx.roll.updateMany({
            where: { id: { in: ids }, status: RollStatus.IN_PRODUCTION, sackId: null, shipmentId: null },
            data: { status: target, currentStepId: null, batchId: null },
          });
          claimed += res.count;
        }
        if (claimed !== residual.length) {
          throw AppError.conflict(
            "Toplardan biri bu sırada başka bir işlemle değişti. Listeyi yenileyip tekrar deneyin.",
          );
        }

        // 2b) Satılabilir rafa düşen barkodsuz topa barkod ("her kumaşa etiket").
        //     Tek per-top adım; bu yüzden tx `withBarcodeRetry` ile sarılı.
        //     (2026-08-10, F-CORE-VER-001) Hedef grubu başına TEK rezervasyon —
        //     eskiden her top ayrı bir sayaç turu atıyordu ve sayaç satırının
        //     kilidi ilk turdan itibaren zaten tutulduğu için araya giren her
        //     tur kilidi o kadar uzatıyordu. ⚠️ Tx'in İÇİNDE kaldı: barkodsuz
        //     küme claim'den SONRA okunan `residual`den çözülüyor, tx öncesi
        //     okuma bayat olurdu.
        const residualById = new Map(residual.map((r) => [r.id, r]));
        for (const [target, ids] of idsByTarget) {
          if (!SELLABLE_DISPOSITION_STATUSES.includes(target)) continue;
          const unbarcoded = ids.filter((rid) => residualById.get(rid)?.barcode == null);
          const reserved = await reserveRollBarcodesTx(tx, finalBarcodeType(target), unbarcoded.length);
          for (const [i, rid] of unbarcoded.entries()) {
            await tx.roll.update({ where: { id: rid }, data: { barcode: reserved[i]! } });
          }
        }

        // 2c) `producedInStepId` yalnız BU iş emrinin adımını gösteriyorsa temizlenir
        //     İptal edilen toplarda üretim izi KORUNUR —
        //     `inventory.softDelete` de dokunmaz.
        const residualIds = residual.map((r) => r.id);
        if (residualIds.length > 0 && stepIds.length > 0) {
          await tx.roll.updateMany({
            where: { id: { in: residualIds }, producedInStepId: { in: stepIds } },
            data: { producedInStepId: null },
          });
        }

        // 3) Kalan topların açık hareketleri — "mal bu istasyondan geçti" semantiği
        //    gerekçe notta.
        if (residualIds.length > 0 && stepIds.length > 0) {
          const note = `BATCH_DROP_STOCK: ${reason}`.slice(0, 400);
          await tx.$executeRaw`
            UPDATE roll_movements m
            SET "exitedAt" = now(), -- tz-ok: kolon timestamptz, oturum UTC
                "qtyOut" = COALESCE(m."qtyOut", NULLIF(m."qtyIn", 0), r."currentQty"),
                "weightOut" = COALESCE(m."weightOut", m."weightIn", r."weightKg"),
                notes = CASE WHEN m.notes IS NULL OR m.notes = '' THEN ${note}
                             ELSE ${note} || ' (' || m.notes || ')' END
            FROM rolls r
            WHERE m."rollId" = r.id
              AND m."rollId" = ANY(${residualIds}::uuid[])
              AND m."workOrderStepId" = ANY(${stepIds}::uuid[])
              AND m."exitedAt" IS NULL
              AND m."revokedAt" IS NULL
          `;
        }

        // 4) Refakat kartı BAYAT — kartın parti bloğu (`resolveLiveBatches`) parti
        //    başına top adedi + metraj basar; parti düşünce basılı kâğıt yanlışlanır.
        //    Yön kuralı: fazla işaretlemek güvenli, eksik işaretlemek hata.
        await markTravelerCardDirtyTx(tx, workOrderId);

        // 5) Adım durumları (SIRALI — tx client'ında Promise.all YASAK).
        for (const sid of affectedStepIds) {
          await recomputeStepStatus(tx, sid);
        }

        // 6) Boşalan izsiz parti silinir. ⚠️ `CANCELLED` top partide KALDIĞI için
        //    silme `false` döner — bu BEKLENEN sonuçtur, çalışılacak bir hata değil:
        //    parti, iptal edilmiş topların kabı olarak durur.
        const batchDeleted = await deleteIfEmptyAndTracelessTx(tx, batchId);

        // 7) İş emrinde canlı malzeme kaldı mı — BAYRAK, aksiyon değil.
        //    ⚠️ Küme K18 DEĞİL: K18 "lane'de gösterme" sorusunu yanıtlar, buradaki
        //    soru "iş emrinde iş kaldı mı". SHIPPED ve SCRAP burada ÖLÜDÜR.
        const liveRemaining = await tx.roll.count({
          where: {
            OR: [
              ...(stepIds.length > 0 ? [{ currentStepId: { in: stepIds } }] : []),
              { batch: { workOrderId } },
            ],
            status: { notIn: NO_LIVE_MATERIAL_STATUSES },
          },
        });

        const remainingBatches = await tx.batch.findMany({
          where: { workOrderId, mergedIntoId: null },
          select: { id: true, batchNumber: true },
          orderBy: { createdAt: "asc" },
        });
        const liveByBatch = await tx.roll.groupBy({
          by: ["batchId"],
          where: { batch: { workOrderId }, status: { notIn: K18_DEAD_STATUSES } },
          _count: { _all: true },
          _sum: { currentQty: true },
        });
        const liveMap = new Map(liveByBatch.map((g) => [g.batchId ?? "", g]));

        const woAfter = await tx.workOrder.findUnique({
          where: { id: workOrderId },
          select: { status: true },
        });

        return {
          workOrderNumber: wo.workOrderNumber,
          batchNumber: batch.batchNumber,
          workOrderStatus: woAfter?.status ?? wo.status,
          applied,
          residualCount: residual.length,
          droppedCount: applied.length + residual.length,
          batchDeleted,
          noLiveRollsRemain: liveRemaining === 0,
          affectedStepIds: [...affectedStepIds],
          remainingBatches: remainingBatches
            .filter((b) => b.id !== batchId || !batchDeleted)
            .map((b) => ({
              batchId: b.id,
              batchNumber: b.batchNumber,
              liveRollCount: liveMap.get(b.id)?._count._all ?? 0,
              meters: Number(liveMap.get(b.id)?._sum.currentQty ?? 0),
            })),
        };
      }),
    );

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "BATCH",
      recordId: batchId,
      newData: {
        event: "BATCH_DROP",
        batchNumber: result.batchNumber,
        workOrderNumber: result.workOrderNumber,
        reason,
        droppedCount: result.droppedCount,
        scrapCount: result.applied.filter((a) => a.action === "SCRAP").length,
        cancelledCount: result.applied.filter((a) => a.action === "CANCELLED").length,
        batchDeleted: result.batchDeleted,
        noLiveRollsRemain: result.noLiveRollsRemain,
      },
    });

    await AuditService.logMany(
      result.applied.map((a) => ({
        userId,
        action: "UPDATE" as const,
        tableName: "ROLL",
        recordId: a.rollId,
        oldData: { status: a.from },
        newData: {
          status: a.to,
          event: "BATCH_DROP_DISPOSITION",
          action: a.action,
          reason,
          batchNumber: result.batchNumber,
        },
      })),
    );

    return {
      success: true,
      data: result,
      message: `${result.batchNumber} partisi iş emrinden düşürüldü (${result.droppedCount} top)`,
    };
  }
}

export const workOrderBatchDropService = new WorkOrderBatchDropService();
