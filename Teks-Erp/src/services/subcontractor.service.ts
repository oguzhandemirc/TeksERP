// =============================================================================
// TeksERP - Subcontractor (Fason) Service
// =============================================================================
// İş Kuralı:
//   - EXTERNAL station step'lerinde toplar operator tarafından START/FINISH
//     yapılamaz. Yerine şu iki uç nokta kullanılır:
//       * dispatch(): Seçilen toplar fasona sevk edilir. Step ACTIVE olur.
//                     Roll.status → AT_SUBCONTRACTOR. Refakat kartı DEPARTURE.
//       * receive() : Fasondan gelen fiziksel toplar irsaliye+göz kontrolü ile
//                     yeni barkodlarla sisteme alınır. Eski dispatch'e giren
//                     toplar RETURNED_FROM_SUBCONTRACTOR'a çekilir ve kapanır.
//                     Yeni toplar sonraki step'e taşınır, fire/çekme hesaplanır.
//                     Step COMPLETED olur. Refakat kartı ARRIVAL.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import {
  Prisma,
  RollOperationType,
  RollStatus,
  StationType,
  StepStatus,
  TravelerCardStatus,
  WorkOrderStatus,
  ScanType,
} from "@prisma/client";
import { buildPrefixedCardNumber } from "../utils/barcode";
import { recomputeStepStatus } from "./helpers/roll-step.helper";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function decodeSequenceFromBarcode(barcode: string): number | null {
  const parts = barcode.split("-");
  if (parts.length < 4) return null;
  const seqStr = parts[2];
  let n = 0;
  for (const ch of seqStr.toUpperCase()) {
    const v = CROCKFORD.indexOf(ch);
    if (v < 0) return null;
    n = n * 32 + v;
  }
  return n;
}

async function nextPrefixedSequence(
  tx: Prisma.TransactionClient,
  table: "subcontractorDispatch" | "subcontractorReceipt" | "swatch" | "roll",
  prefix: string,
  date: Date
): Promise<number> {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const barcodePrefix = `${prefix}-${yy}${mm}-`;

  let lastBarcode: string | null = null;
  if (table === "subcontractorDispatch") {
    const last = await tx.subcontractorDispatch.findFirst({
      where: { dispatchNo: { startsWith: barcodePrefix } },
      orderBy: { dispatchNo: "desc" },
      select: { dispatchNo: true },
    });
    lastBarcode = last?.dispatchNo ?? null;
  } else if (table === "subcontractorReceipt") {
    const last = await tx.subcontractorReceipt.findFirst({
      where: { receiptNo: { startsWith: barcodePrefix } },
      orderBy: { receiptNo: "desc" },
      select: { receiptNo: true },
    });
    lastBarcode = last?.receiptNo ?? null;
  } else if (table === "swatch") {
    const last = await tx.swatch.findFirst({
      where: { barcode: { startsWith: barcodePrefix } },
      orderBy: { barcode: "desc" },
      select: { barcode: true },
    });
    lastBarcode = last?.barcode ?? null;
  } else {
    const last = await tx.roll.findFirst({
      where: { barcode: { startsWith: barcodePrefix } },
      orderBy: { barcode: "desc" },
      select: { barcode: true },
    });
    lastBarcode = last?.barcode ?? null;
  }

  if (!lastBarcode) return 1;

  // Dispatch/Receipt numaraları 3 parçalı, sade ondalık: SD-YYMM-NNNNNN / SR-YYMM-NNNNNN
  // Swatch/Roll barkodları 4 parçalı, Crockford + checksum: PFX-YYMM-XXXXXX-C
  if (table === "subcontractorDispatch" || table === "subcontractorReceipt") {
    const parts = lastBarcode.split("-");
    const n = parseInt(parts[2] ?? "", 10);
    return (Number.isFinite(n) ? n : 0) + 1;
  }

  const n = decodeSequenceFromBarcode(lastBarcode);
  return (n ?? 0) + 1;
}

async function logTravelerScan(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  stationId: string,
  stepId: string,
  scanType: ScanType,
  userId: string | undefined,
  note: string
): Promise<void> {
  const activeCard = await tx.travelerCard.findFirst({
    where: { workOrderId, status: TravelerCardStatus.ACTIVE },
    select: { id: true },
  });
  if (!activeCard) return;

  await tx.travelerCardScan.create({
    data: {
      cardId: activeCard.id,
      stationId,
      workOrderStepId: stepId,
      scanType,
      scannedById: userId ?? null,
      notes: note,
    },
  });
}

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

export class SubcontractorService {
  // ===========================================================================
  // DISPATCH — Fasona sevk
  // ===========================================================================
  async dispatch(
    data: {
      workOrderId: string;
      stepId: string;
      companyId: string;
      rollIds: string[];
      plateNumber?: string;
      driverName?: string;
      notes?: string;
    },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    if (!data.rollIds || data.rollIds.length === 0) {
      throw AppError.badRequest("En az bir top seçmelisiniz");
    }

    const wo = await prisma.workOrder.findUnique({
      where: { id: data.workOrderId },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");
    if (
      wo.status !== WorkOrderStatus.PLANNED &&
      wo.status !== WorkOrderStatus.IN_PROGRESS
    ) {
      throw AppError.conflict(
        `Bu iş emrinde sevk yapılamaz: ${wo.status}. Sadece PLANNED/IN_PROGRESS.`
      );
    }

    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: { station: true, workOrder: true },
    });
    if (!step) throw AppError.notFound("İş emri adımı bulunamadı");
    if (step.workOrderId !== data.workOrderId) {
      throw AppError.badRequest("Adım bu iş emrine ait değil");
    }
    if (step.station.type !== StationType.EXTERNAL) {
      throw AppError.badRequest(
        `Sevk yalnızca EXTERNAL (fason/boyahane) istasyonlar için yapılabilir. Mevcut: ${step.station.type}`
      );
    }
    if (step.status === StepStatus.COMPLETED || step.status === StepStatus.SKIPPED) {
      throw AppError.conflict(
        `Adım zaten kapatılmış (${step.status}). Sevk yapılamaz.`
      );
    }

    const company = await prisma.customer.findUnique({
      where: { id: data.companyId },
    });
    if (!company) throw AppError.notFound("Fason firma bulunamadı");

    const rolls = await prisma.roll.findMany({
      where: { id: { in: data.rollIds } },
    });
    if (rolls.length !== data.rollIds.length) {
      const foundIds = new Set(rolls.map((r) => r.id));
      const missing = data.rollIds.filter((id) => !foundIds.has(id));
      throw AppError.notFound(`Top bulunamadı: ${missing.join(", ")}`);
    }

    for (const r of rolls) {
      if (r.currentStepId !== data.stepId) {
        throw AppError.badRequest(
          `Top ${r.barcode} bu adımda değil (mevcut step: ${r.currentStepId ?? "yok"})`
        );
      }
      if (r.status !== RollStatus.IN_PRODUCTION && r.status !== RollStatus.STOCK) {
        throw AppError.badRequest(
          `Top ${r.barcode} sevke uygun değil (status: ${r.status})`
        );
      }
    }

    const totalQty = rolls.reduce((s, r) => s + r.currentQty, 0);

    const result = await prisma.$transaction(async (tx) => {
      // Step ACTIVE'e çek
      if (step.status === StepStatus.PENDING) {
        await tx.workOrderStep.update({
          where: { id: step.id },
          data: { status: StepStatus.ACTIVE, startedAt: new Date() },
        });
      }

      // Dispatch numarası
      const now = new Date();
      const seq = await nextPrefixedSequence(tx, "subcontractorDispatch", "SD", now);
      const dispatchNo = buildPrefixedCardNumber("SD", now, seq);

      const dispatch = await tx.subcontractorDispatch.create({
        data: {
          dispatchNo,
          workOrderId: data.workOrderId,
          stepId: data.stepId,
          companyId: data.companyId,
          plateNumber: data.plateNumber ?? null,
          driverName: data.driverName ?? null,
          dispatchedById: userId ?? null,
          notes: data.notes ?? null,
          totalQty,
          items: {
            create: rolls.map((r) => ({
              rollId: r.id,
              dispatchedQty: r.currentQty,
              dispatchedWeight: r.weightKg,
            })),
          },
        },
        include: {
          items: true,
          company: true,
          step: { include: { station: true } },
        },
      });

      // Rolls: AT_SUBCONTRACTOR + SUBCONTRACTOR_SENT log
      for (const r of rolls) {
        await tx.roll.update({
          where: { id: r.id },
          data: { status: RollStatus.AT_SUBCONTRACTOR },
        });

        // Açık RollMovement kapanmasın — operatör START atmamış olabilir.
        // Fason süresi boyunca step üzerinde bekleyen açık movement varsa
        // notlandır, yoksa yeni movement aç.
        const open = await tx.rollMovement.findFirst({
          where: { rollId: r.id, workOrderStepId: data.stepId, exitedAt: null },
        });
        if (!open) {
          await tx.rollMovement.create({
            data: {
              rollId: r.id,
              workOrderStepId: data.stepId,
              qtyIn: r.currentQty,
              weightIn: r.weightKg,
              operatorId: userId ?? null,
              notes: `DISPATCH:${dispatchNo}`,
            },
          });
        }

        // Per-roll operation log (idempotent — re-dispatch sonrası ilk sevk kaydı korunur)
        await tx.rollOperation.upsert({
          where: {
            rollId_workOrderStepId_operationType: {
              rollId: r.id,
              workOrderStepId: data.stepId,
              operationType: RollOperationType.SUBCONTRACTOR_SENT,
            },
          },
          create: {
            rollId: r.id,
            workOrderStepId: data.stepId,
            operationType: RollOperationType.SUBCONTRACTOR_SENT,
            operatorId: userId ?? null,
            metadata: {
              dispatchNo,
              qty: r.currentQty,
              weight: r.weightKg,
            } as Prisma.InputJsonValue,
          },
          update: {},
        });
      }

      // Refakat kartı DEPARTURE
      await logTravelerScan(
        tx,
        data.workOrderId,
        step.stationId,
        step.id,
        ScanType.DEPARTURE,
        userId,
        `Fasona sevk: ${dispatchNo}`
      );

      return dispatch;
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SUBCONTRACTOR_DISPATCH",
      recordId: result.id,
      newData: {
        dispatchNo: result.dispatchNo,
        workOrderId: data.workOrderId,
        stepId: data.stepId,
        companyId: data.companyId,
        rollCount: rolls.length,
        totalQty,
      },
    });

    return {
      success: true,
      data: result,
      message: `Fason sevki oluşturuldu: ${result.dispatchNo} (${rolls.length} top, ${totalQty.toFixed(1)}m)`,
    };
  }

  // ===========================================================================
  // RECEIVE — Fason mal kabul (etiket basmaz, ölçüm yapmaz)
  // ===========================================================================
  //
  // Kural:
  //   - Yeni Roll kaydı AÇILMAZ. Fasona giden ORİJİNAL toplar dönüşte kabul edilir.
  //   - Ölçüm (metraj / ağırlık / fire) burada YAPILMAZ. Top miktarları sevk
  //     öncesindeki değerleriyle korunur; gerçek ölçüm sonraki istasyonun
  //     FINISH akışında yapılır ve fire orada kayıt edilir.
  //   - Top status → IN_PRODUCTION, sonraki adıma taşınır (son adımsa PRODUCED).
  //   - Step COMPLETED olur; son adım ise WO COMPLETED ve refakat kartı COMPLETED.
  //   - Sadece irsaliye no (manifestNo), kabul notu ve top-bazlı not saklanır.
  //
  async receive(
    data: {
      workOrderId: string;
      stepId: string;
      companyId: string;
      manifestNo: string;
      returns: Array<{
        rollId: string;         // Orijinal fasona gönderilmiş top
        notes?: string | null;  // Bu topa dair kabul notu (opsiyonel)
      }>;
      notes?: string;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!data.returns || data.returns.length === 0) {
      throw AppError.badRequest("En az bir dönüş kaydı girin");
    }
    if (!data.manifestNo || data.manifestNo.trim().length < 2) {
      throw AppError.badRequest("İrsaliye numarası zorunlu");
    }

    const wo = await prisma.workOrder.findUnique({
      where: { id: data.workOrderId },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: true,
        workOrder: {
          include: { steps: { orderBy: { stepSequence: "asc" } } },
        },
      },
    });
    if (!step) throw AppError.notFound("İş emri adımı bulunamadı");
    if (step.station.type !== StationType.EXTERNAL) {
      throw AppError.badRequest(
        "Mal kabul yalnızca EXTERNAL istasyon adımları için yapılabilir"
      );
    }
    if (step.status !== StepStatus.ACTIVE) {
      throw AppError.badRequest(
        `Adım ACTIVE değil. Önce sevk yapılmış olmalı (mevcut: ${step.status})`
      );
    }

    // Bu step'te halen AT_SUBCONTRACTOR olan roller
    const outstandingRolls = await prisma.roll.findMany({
      where: {
        currentStepId: data.stepId,
        status: RollStatus.AT_SUBCONTRACTOR,
      },
      select: {
        id: true,
        barcode: true,
        currentQty: true,
        weightKg: true,
      },
    });
    const outstandingIds = new Set(outstandingRolls.map((r) => r.id));

    // Giriş doğrulaması
    const returnIds = new Set<string>();
    for (const r of data.returns) {
      if (returnIds.has(r.rollId)) {
        throw AppError.badRequest(
          "Aynı top dönüş listesinde iki kez geçiyor"
        );
      }
      returnIds.add(r.rollId);
      if (!outstandingIds.has(r.rollId)) {
        throw AppError.badRequest(
          `Top ${r.rollId} bu adımda fasona gönderilmemiş veya zaten dönmüş`
        );
      }
    }

    const allSteps = step.workOrder.steps;
    const currentIndex = allSteps.findIndex((s) => s.id === step.id);
    const nextStep =
      currentIndex < allSteps.length - 1 ? allSteps[currentIndex + 1] : null;

    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const seq = await nextPrefixedSequence(tx, "subcontractorReceipt", "SR", now);
      const receiptNo = buildPrefixedCardNumber("SR", now, seq);

      const receipt = await tx.subcontractorReceipt.create({
        data: {
          receiptNo,
          manifestNo: data.manifestNo.trim(),
          workOrderId: data.workOrderId,
          stepId: data.stepId,
          companyId: data.companyId,
          receivedById: userId ?? null,
          notes: data.notes ?? null,
        },
      });

      // Her dönen top için: açık movement'i kapat + rolü sonraki adıma taşı
      // Ölçüm YAPILMAZ — sevk öncesindeki qty/weight korunur.
      for (const ret of data.returns) {
        const orig = outstandingRolls.find((r) => r.id === ret.rollId)!;

        // Fasondaki açık movement'i kapat — qtyOut/weightOut sevk öncesindeki
        // değerlerle (ölçüm yapılmadığı için) eşitlenir. Gerçek fire sonraki
        // istasyonun FINISH akışında kaydedilir.
        await tx.rollMovement.updateMany({
          where: {
            rollId: ret.rollId,
            workOrderStepId: data.stepId,
            exitedAt: null,
          },
          data: {
            exitedAt: new Date(),
            qtyOut: orig.currentQty,
            weightOut: orig.weightKg,
            notes: `RETURNED_VIA_RECEIPT:${receiptNo}`,
          },
        });

        // Orijinal rolün qty/weight değerlerine DOKUNULMAZ — sadece status ve
        // bir sonraki adım güncellenir.
        await tx.roll.update({
          where: { id: ret.rollId },
          data: {
            status: nextStep ? RollStatus.IN_PRODUCTION : RollStatus.PRODUCED,
            currentStepId: nextStep ? nextStep.id : null,
          },
        });

        // Receipt item kaydı — newRollId ORİJİNAL top'u işaret eder (etiket basılmaz)
        await tx.subcontractorReceiptItem.create({
          data: {
            receiptId: receipt.id,
            newRollId: ret.rollId,
            notes: ret.notes ?? null,
          },
        });

        // Sonraki adım için yeni RollMovement aç (varsa) — qtyIn sevk öncesi
        // değerle girer, ölçüm FINISH'te yapılacak.
        if (nextStep) {
          await tx.rollMovement.create({
            data: {
              rollId: ret.rollId,
              workOrderStepId: nextStep.id,
              qtyIn: orig.currentQty,
              weightIn: orig.weightKg,
              operatorId: userId ?? null,
              notes: `FROM_SUBCONTRACTOR_RECEIPT:${receiptNo}`,
            },
          });
        }

        // Per-roll operation log
        await tx.rollOperation.upsert({
          where: {
            rollId_workOrderStepId_operationType: {
              rollId: ret.rollId,
              workOrderStepId: data.stepId,
              operationType: RollOperationType.SUBCONTRACTOR_RETURNED,
            },
          },
          create: {
            rollId: ret.rollId,
            workOrderStepId: data.stepId,
            operationType: RollOperationType.SUBCONTRACTOR_RETURNED,
            operatorId: userId ?? null,
            metadata: {
              receiptNo,
              manifestNo: data.manifestNo.trim(),
              returnNote: ret.notes ?? null,
            } as Prisma.InputJsonValue,
          },
          update: {},
        });
      }

      // Step COMPLETED (tüm outstanding'ler dönmediyse hala ACTIVE kalmalı)
      const stillAtSubcontractor = await tx.roll.count({
        where: {
          currentStepId: data.stepId,
          status: RollStatus.AT_SUBCONTRACTOR,
        },
      });
      if (stillAtSubcontractor === 0) {
        await tx.workOrderStep.update({
          where: { id: step.id },
          data: { status: StepStatus.COMPLETED, completedAt: new Date() },
        });
      }

      // Son step + hepsi tamamlandıysa WO COMPLETED
      if (!nextStep && stillAtSubcontractor === 0) {
        const remaining = await tx.workOrderStep.count({
          where: {
            workOrderId: data.workOrderId,
            status: { notIn: [StepStatus.COMPLETED, StepStatus.SKIPPED] },
          },
        });
        if (remaining === 0) {
          await tx.workOrder.update({
            where: { id: data.workOrderId },
            data: { status: WorkOrderStatus.COMPLETED },
          });
          await tx.travelerCard.updateMany({
            where: { workOrderId: data.workOrderId, status: TravelerCardStatus.ACTIVE },
            data: { status: TravelerCardStatus.COMPLETED },
          });
        }
      }

      // Sonraki adım PENDING ise ACTIVE'e çek
      if (nextStep) {
        await recomputeStepStatus(tx, nextStep.id);
      }

      // Refakat kartı ARRIVAL
      await logTravelerScan(
        tx,
        data.workOrderId,
        step.stationId,
        step.id,
        ScanType.ARRIVAL,
        userId,
        `Fason kabul: ${receiptNo} (İrsaliye: ${data.manifestNo})`
      );

      return tx.subcontractorReceipt.findUnique({
        where: { id: receipt.id },
        include: {
          company: true,
          step: { include: { station: true } },
          items: { include: { newRoll: true } },
        },
      });
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SUBCONTRACTOR_RECEIPT",
      recordId: result!.id,
      newData: {
        receiptNo: result!.receiptNo,
        manifestNo: result!.manifestNo,
        workOrderId: data.workOrderId,
        stepId: data.stepId,
        returnCount: data.returns.length,
      },
    });

    return {
      success: true,
      data: result,
      message: `Fason kabul tamamlandı: ${result!.receiptNo} (${data.returns.length} top). Ölçüm sonraki istasyonda yapılacak.`,
    };
  }

  // ===========================================================================
  // LIST & QUERIES
  // ===========================================================================

  async listPendingReturns(): Promise<ApiResponse<unknown>> {
    // Fasondan beklenen tüm sevk-istasyon-firma üçlüsü
    const outstandingRolls = await prisma.roll.findMany({
      where: { status: RollStatus.AT_SUBCONTRACTOR },
      include: {
        item: true,
        variant: true,
      },
    });

    const stepIds = [...new Set(outstandingRolls.map((r) => r.currentStepId).filter(Boolean) as string[])];
    const steps = await prisma.workOrderStep.findMany({
      where: { id: { in: stepIds } },
      include: {
        station: true,
        workOrder: {
          include: { dyehouseCompany: true },
        },
      },
    });

    // Her step için son dispatch'i bul
    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { stepId: { in: stepIds } },
      include: { company: true, items: true },
      orderBy: { dispatchedAt: "desc" },
    });

    const byStep = new Map<string, typeof dispatches>();
    for (const d of dispatches) {
      const arr = byStep.get(d.stepId) ?? [];
      arr.push(d);
      byStep.set(d.stepId, arr);
    }

    const groups = steps.map((step) => {
      const stepRolls = outstandingRolls.filter((r) => r.currentStepId === step.id);
      const stepDispatches = byStep.get(step.id) ?? [];
      const lastDispatch = stepDispatches[0] ?? null;
      const totalQty = stepRolls.reduce((s, r) => s + r.currentQty, 0);

      return {
        step: {
          id: step.id,
          stepSequence: step.stepSequence,
          station: step.station,
          notes: step.notes,
        },
        workOrder: {
          id: step.workOrder.id,
          batchNumber: step.workOrder.batchNumber,
          recipeNo: step.workOrder.recipeNo,
          dyehouseCompany: step.workOrder.dyehouseCompany,
          status: step.workOrder.status,
        },
        lastDispatch,
        rolls: stepRolls,
        rollCount: stepRolls.length,
        totalQty,
      };
    });

    return { success: true, data: groups };
  }

  async listDispatches(params?: {
    workOrderId?: string;
    companyId?: string;
    limit?: number;
  }): Promise<ApiResponse<unknown>> {
    const where: Prisma.SubcontractorDispatchWhereInput = {};
    if (params?.workOrderId) where.workOrderId = params.workOrderId;
    if (params?.companyId) where.companyId = params.companyId;

    const dispatches = await prisma.subcontractorDispatch.findMany({
      where,
      include: {
        company: true,
        workOrder: true,
        step: { include: { station: true } },
        items: { include: { roll: true } },
        dispatchedBy: { select: { id: true, username: true, fullName: true } },
      },
      orderBy: { dispatchedAt: "desc" },
      take: params?.limit ?? 100,
    });

    return { success: true, data: dispatches };
  }

  async getDispatch(id: string): Promise<ApiResponse<unknown>> {
    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id },
      include: {
        company: true,
        workOrder: {
          include: {
            dyehouseCompany: true,
            orderLinks: { include: { orderLine: { include: { order: { include: { customer: true } } } } } },
          },
        },
        step: { include: { station: true } },
        items: { include: { roll: { include: { item: true, variant: true } } } },
        dispatchedBy: { select: { id: true, username: true, fullName: true } },
      },
    });

    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    return { success: true, data: dispatch };
  }

  async listReceipts(params?: {
    workOrderId?: string;
    companyId?: string;
    limit?: number;
  }): Promise<ApiResponse<unknown>> {
    const where: Prisma.SubcontractorReceiptWhereInput = {};
    if (params?.workOrderId) where.workOrderId = params.workOrderId;
    if (params?.companyId) where.companyId = params.companyId;

    const receipts = await prisma.subcontractorReceipt.findMany({
      where,
      include: {
        company: true,
        workOrder: true,
        step: { include: { station: true } },
        items: { include: { newRoll: true } },
        receivedBy: { select: { id: true, username: true, fullName: true } },
      },
      orderBy: { receivedAt: "desc" },
      take: params?.limit ?? 100,
    });

    return { success: true, data: receipts };
  }

  async getReceipt(id: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id },
      include: {
        company: true,
        workOrder: { include: { dyehouseCompany: true } },
        step: { include: { station: true } },
        items: {
          include: {
            newRoll: { include: { item: true, variant: true } },
            sourceDispatchItem: { include: { roll: true } },
          },
        },
        receivedBy: { select: { id: true, username: true, fullName: true } },
      },
    });

    if (!receipt) throw AppError.notFound("Mal kabul belgesi bulunamadı");
    return { success: true, data: receipt };
  }
}
