// =============================================================================
// Inventory Service / rescue
// =============================================================================
// Takılı top kurtarma: önizleme + rescueStuckRoll.
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================

import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { postRescueEntryTx } from "../helpers/production-entry-ledger.helper";
import { AuditService } from "../audit.service";
import { warehouseStampTx } from "../helpers/warehouse.helper";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import {
  Prisma,
  Roll,
  RollStatus,
} from "@prisma/client";
import {
  recomputeStepStatus,
  completeWorkOrderIfStepsDone,
} from "../helpers/roll-step.helper";
import { touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { generateRollBarcodeTx } from "../helpers/roll-barcode.helper";
import { finalBarcodeType } from "../helpers/roll-finalize.helper";

/**
 * İstasyonda takılı (IN_PRODUCTION) top için kurtarma önizlemesi (salt-okunur).
 * eligible yalnız IN_PRODUCTION topta true; açık fason sevki blockReasons'a düşer.
 */
export interface RescuePreview {
  rollId: string;
  barcode: string | null;
  itemName: string;
  currentStatus: RollStatus;
  eligible: boolean;
  blockReasons: string[];
  stationName: string | null;
  openMovementCount: number;
  willGenerateBarcode: boolean;
}

export async function getRescuePreview(rollId: string): Promise<ApiResponse<RescuePreview>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: {
        id: true,
        barcode: true,
        status: true,
        currentStepId: true,
        shipmentId: true,
        sackId: true,
        item: { select: { name: true } },
        currentStep: { select: { station: { select: { name: true } } } },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    const blockReasons: string[] = [];
    let eligible = roll.status === RollStatus.IN_PRODUCTION;
    if (roll.status !== RollStatus.IN_PRODUCTION) {
      blockReasons.push(
        `Top üretimde değil (durum: ${roll.status}) — kurtarma yalnız makinede/istasyonda takılı toplar için`,
      );
    }
    // Açık (iptal edilmemiş) fason sevkine bağlı top kurtarılamaz — önce fason
    // kapatılmalı (iptal-önizleme/softDelete guard'larıyla aynı invariant deseni).
    const openDispatch = await prisma.subcontractorDispatchItem.findFirst({
      where: { rollId, dispatch: { cancelledAt: null } },
      select: { id: true },
    });
    if (openDispatch) {
      blockReasons.push("Top açık bir fason sevkine bağlı — önce fasonu kapatın");
    }
    const openMovementCount = await prisma.rollMovement.count({
      where: { ...ACTIVE_MOVEMENT, rollId, exitedAt: null },
    });
    eligible = eligible && blockReasons.length === 0;

    return {
      success: true,
      data: {
        rollId: roll.id,
        barcode: roll.barcode,
        itemName: roll.item.name,
        currentStatus: roll.status,
        eligible,
        blockReasons,
        stationName: roll.currentStep?.station.name ?? null,
        openMovementCount,
        willGenerateBarcode: roll.barcode == null,
      },
    };
  }

export async function rescueStuckRoll(
    rollId: string,
    data: { reason: string },
    userId?: string,
  ): Promise<ApiResponse<Roll>> {
    const reason = data.reason.trim();
    if (reason.length < 3) {
      throw AppError.badRequest("İşlem nedeni (en az 3 karakter) zorunludur");
    }

    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: {
        id: true,
        status: true,
        currentStepId: true,
        weightKg: true,
        currentQty: true,
        barcode: true,
        warehouseId: true,
        qualityGrade: true,
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.status !== RollStatus.IN_PRODUCTION) {
      throw AppError.conflict(
        "Bu top üretimde değil — kurtarma yalnız istasyonda takılı toplar için",
      );
    }

    const openDispatch = await prisma.subcontractorDispatchItem.findFirst({
      where: { rollId, dispatch: { cancelledAt: null } },
      select: { id: true },
    });
    if (openDispatch) {
      throw AppError.conflict("Top açık bir fason sevkine bağlı — önce fasonu kapatın");
    }

    // Barkod tx öncesi ayrı bağlantıda (sayaç kilidi kurtarma tx'i boyunca tutulmaz).
    const rescueBarcode =
      roll.barcode == null ? await generateRollBarcodeTx(prisma, finalBarcodeType(RollStatus.WAREHOUSE)) : null;
    const rescued = await prisma.$transaction(async (tx) => {
      // Açık hareketler + bağlı adımlar (+ currentStep) — recompute hedefleri.
      const openMoves = await tx.rollMovement.findMany({
        where: { ...ACTIVE_MOVEMENT, rollId, exitedAt: null },
        select: { id: true, workOrderStepId: true },
      });
      const affectedStepIds = Array.from(
        new Set(
          [...openMoves.map((m) => m.workOrderStepId), roll.currentStepId].filter(
            (s): s is string => !!s,
          ),
        ),
      );

      // WO id currentStep üzerinden çözülür; touchWorkOrderTx write-skew guard'ı
      // recompute/complete ÖNCESİ alınır (son-adım oto-tamamlama paritesi).
      const woId = roll.currentStepId
        ? (
            await tx.workOrderStep.findUnique({
              where: { id: roll.currentStepId },
              select: { workOrderId: true },
            })
          )?.workOrderId ?? null
        : null;
      if (woId) await touchWorkOrderTx(tx, woId);

      // Açık hareketleri FİZİKSEL çıkışla kapat. qtyOut = movement'ın KENDİ qtyIn'i
      // (tambur/kursun finishStep + WO kapanış dispozisyonu paritesi): top daha önce
      // kesilmişse (currentQty < qtyIn) `currentQty` ile kapatmak aradaki farkı
      // istasyon iş-hacmi raporunda HAYALET KAYIP gösterirdi. qtyIn 0/null ise kalan.
      const openForClose = await tx.rollMovement.findMany({
        where: { ...ACTIVE_MOVEMENT, rollId, exitedAt: null },
        select: { id: true, qtyIn: true, weightIn: true },
      });
      for (const m of openForClose) {
        await tx.rollMovement.update({
          where: { id: m.id, ...ACTIVE_MOVEMENT },
          data: {
            exitedAt: new Date(),
            qtyOut:
              m.qtyIn && new Prisma.Decimal(m.qtyIn).greaterThan(0)
                ? new Prisma.Decimal(m.qtyIn)
                : roll.currentQty,
            weightOut: m.weightIn ?? roll.weightKg,
            notes: "RESCUED_FROM_PRODUCTION",
          },
        });
      }

      // Atomik claim — IN_PRODUCTION + serbest (shipment/sack null) iken WAREHOUSE'a çek.
      const claim = await tx.roll.updateMany({
        where: {
          id: rollId,
          status: RollStatus.IN_PRODUCTION,
          shipmentId: null,
          sackId: null,
        },
        // Depo damgası ORTAK YÜKLEMDEN (terfi yolu `warehouseId`ye dokunmuyordu).
        data: {
          status: RollStatus.WAREHOUSE,
          currentStepId: null,
          ...(await warehouseStampTx(tx, roll.warehouseId)),
        },
      });
      if (claim.count === 0) {
        throw AppError.conflict(
          "Top bu sırada başka bir işleme girdi — yenileyip tekrar deneyin",
        );
      }

      // STOK DEFTERİ — üretimden depoya GİRİŞ (hüküm §11 giriş kalemi; 2026-09-13'e
      // kadar satırsızdı, K kümesinin üyesi).
      await postRescueEntryTx(tx, { rollId, stepId: roll.currentStepId, userId, reason });

      // "her kumaşa etiket" (F4) — barkodsuzsa final (WAREHOUSE) barkod üret.
      if (rescueBarcode) {
        await tx.roll.updateMany({ where: { id: rollId, barcode: null }, data: { barcode: rescueBarcode } });
      }

      // Kapanan movement "geçti" → adım/WO oto-COMPLETE olabilir.
      for (const sid of affectedStepIds) await recomputeStepStatus(tx, sid);
      if (woId) await completeWorkOrderIfStepsDone(tx, woId, { trigger: "RESCUE_STUCK_ROLL" });

      return tx.roll.findUniqueOrThrow({ where: { id: rollId } });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      newData: {
        event: "RESCUE_STUCK_ROLL",
        from: RollStatus.IN_PRODUCTION,
        to: RollStatus.WAREHOUSE,
        reason,
      },
    });

    return {
      success: true,
      data: rescued,
      message: "Top istasyondan kurtarıldı ve depoya alındı",
    };
  }
