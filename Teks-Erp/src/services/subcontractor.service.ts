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
import { buildPagination } from "../utils/query-parser";
import {
  recomputeStepStatus,
  ensureWorkOrderInProgress,
} from "./helpers/roll-step.helper";

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
      subcontractorId: string;
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
      include: {
        station: { select: { name: true, code: true, type: true } },
        workOrder: true,
        requiredCategory: { select: { id: true, name: true } },
      },
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

    const subcontractor = await prisma.subcontractor.findUnique({
      where: { id: data.subcontractorId },
    });
    if (!subcontractor) throw AppError.notFound("Fason firma bulunamadı");

    // Adımın hizmet kategorisi tanımlıysa, seçilen fason firmanın bu kategoride
    // hizmet veriyor olması zorunlu (SubcontractorToCategory eşleşmesi).
    if (step.requiredCategoryId) {
      const link = await prisma.subcontractorToCategory.findUnique({
        where: {
          subcontractorId_categoryId: {
            subcontractorId: data.subcontractorId,
            categoryId: step.requiredCategoryId,
          },
        },
        select: { categoryId: true },
      });
      if (!link) {
        const categoryName =
          step.requiredCategory?.name ?? step.requiredCategoryId;
        throw AppError.badRequest(
          `Bu fason firma bu kategoride hizmet vermiyor (gerekli: ${categoryName}).`
        );
      }
    }

    const rolls = await prisma.roll.findMany({
      where: { id: { in: data.rollIds } },
    });
    if (rolls.length !== data.rollIds.length) {
      const foundIds = new Set(rolls.map((r) => r.id));
      const missing = data.rollIds.filter((id) => !foundIds.has(id));
      throw AppError.notFound(`Top bulunamadı: ${missing.join(", ")}`);
    }

    // Sevk anında otomatik attach edilecek toplar (mobil sahada tek-adım akış için).
    // Top serbest stoktaysa (henüz iş emrine bağlanmamış), aynı transaction içinde
    // bu adıma attach edilir; operatör ayrıca attach çağrısı yapmak zorunda kalmaz.
    const autoAttachIds = new Set<string>();

    for (const r of rolls) {
      // 1) Serbest stok → otomatik attach uygunluğu
      if (r.currentStepId === null && r.status === RollStatus.STOCK) {
        autoAttachIds.add(r.id);
        continue;
      }
      // 2) Zaten bu adıma bağlı → eski mantık (geç)
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
      // Otomatik attach: serbest stoktaki toplar bu adıma bağlanır.
      // (status STOCK kalır — alt blok aynı transaction içinde AT_SUBCONTRACTOR'a çekecek.)
      if (autoAttachIds.size > 0) {
        await tx.roll.updateMany({
          where: { id: { in: Array.from(autoAttachIds) } },
          data: { currentStepId: data.stepId },
        });
      }

      // Step ACTIVE'e çek
      if (step.status === StepStatus.PENDING) {
        await tx.workOrderStep.update({
          where: { id: step.id },
          data: { status: StepStatus.ACTIVE, startedAt: new Date() },
        });
      }
      // WO henüz PLANNED ise IN_PROGRESS'e çek (fason sevki = üretim başlangıcı)
      await ensureWorkOrderInProgress(tx, data.workOrderId);

      // Dispatch numarası
      const now = new Date();
      const seq = await nextPrefixedSequence(tx, "subcontractorDispatch", "SD", now);
      const dispatchNo = buildPrefixedCardNumber("SD", now, seq);

      // Topların ürün/varyant bilgilerini çek (snapshot için)
      const rollsWithMeta = await tx.roll.findMany({
        where: { id: { in: data.rollIds } },
        include: {
          item: { select: { code: true, name: true } },
          variant: { select: { code: true, name: true } },
        },
      });

      const rollSnapshots = rollsWithMeta.map((r, idx) => ({
        sequence: idx + 1,
        id: r.id,
        barcode: r.barcode,
        itemCode: r.item?.code ?? "",
        itemName: r.item?.name ?? "",
        variantCode: r.variant?.code ?? null,
        variantName: r.variant?.name ?? null,
        dispatchedQty: r.currentQty,
        dispatchedWeight: r.weightKg ?? null,
        qualityGrade: r.qualityGrade,
        width: r.width ?? null,
      }));

      const totalWeight = rollSnapshots.reduce((s, r) => s + (r.dispatchedWeight ?? 0), 0);

      const printSnapshot = {
        dispatchNo,
        dispatchedAt: now.toISOString(),
        driverName: data.driverName ?? null,
        plateNumber: data.plateNumber ?? null,
        notes: data.notes ?? null,
        workOrder: {
          id: wo.id,
          batchNumber: wo.batchNumber,
          recipeNo: wo.recipeNo,
          parameters: (wo.parameters as Record<string, unknown> | null) ?? null,
          type: wo.type,
        },
        subcontractor: {
          id: subcontractor.id,
          name: subcontractor.name,
          code: subcontractor.code ?? null,
        },
        step: {
          id: step.id,
          stepSequence: step.stepSequence,
          station: {
            name: step.station.name,
            code: step.station.code,
          },
        },
        rolls: rollSnapshots,
        totals: {
          rollCount: rollSnapshots.length,
          totalQty,
          totalWeight,
        },
      };

      const dispatch = await tx.subcontractorDispatch.create({
        data: {
          dispatchNo,
          workOrderId: data.workOrderId,
          stepId: data.stepId,
          subcontractorId: data.subcontractorId,
          // Plan snapshot — sevk anında step.plannedSubcontractorId ne ise dondurulur.
          // step.plannedSubcontractorId ileride değişse bile rapor için bu sabit kalır.
          plannedSubcontractorId: step.plannedSubcontractorId ?? null,
          plateNumber: data.plateNumber ?? null,
          driverName: data.driverName ?? null,
          dispatchedById: userId ?? null,
          notes: data.notes ?? null,
          totalQty,
          printSnapshot: printSnapshot as Prisma.InputJsonValue,
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
          subcontractor: true,
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
        subcontractorId: data.subcontractorId,
        plannedSubcontractorId: step.plannedSubcontractorId ?? null,
        rollCount: rolls.length,
        autoAttachedRollCount: autoAttachIds.size,
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
  // CANCEL — Sevk iptali (soft cancel)
  // ===========================================================================
  //
  // Kural:
  //   - Dispatch silinmez; cancelledAt/cancelledById/cancelReason set edilir.
  //   - Toplar STOCK'a geri döner ve currentStepId temizlenir (serbest stoğa iner).
  //   - Açık RollMovement varsa "CANCEL:dispatchNo" notuyla kapatılır.
  //   - SUBCONTRACTOR_SENT operation log'u silinir (idempotent).
  //   - Step'te başka aktif sevk/dispatch yoksa PENDING'e döner.
  //   - Mal kabul yapılmış sevk iptal EDİLEMEZ (önce kabul iptal endpoint'i
  //     gerekir — şu an o yok, dolayısıyla blok).
  //   - Refakat kartına CANCEL log'u düşülür.
  //
  async cancel(
    dispatchId: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const trimmedReason = reason?.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
    }

    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id: dispatchId },
      include: {
        items: true,
        step: { select: { id: true, status: true, stationId: true, workOrderId: true } },
      },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    if (dispatch.cancelledAt) {
      throw AppError.conflict("Bu sevk zaten iptal edilmiş");
    }

    // Mal kabul edilmiş sevk iptal edilemez (ReceiptItem.sourceDispatchItem üzerinden bağlı)
    const acceptedReceiptItem = await prisma.subcontractorReceiptItem.findFirst({
      where: { sourceDispatchItem: { is: { dispatchId } } },
      select: { receipt: { select: { receiptNo: true } } },
    });
    if (acceptedReceiptItem?.receipt) {
      throw AppError.conflict(
        `Mal kabul yapılmış sevk iptal edilemez (kabul: ${acceptedReceiptItem.receipt.receiptNo}). Önce kabul iptal edilmeli.`
      );
    }

    const rollIds = dispatch.items.map((i) => i.rollId);

    await prisma.$transaction(async (tx) => {
      // 1) Dispatch'i soft-cancel
      await tx.subcontractorDispatch.update({
        where: { id: dispatchId },
        data: {
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: trimmedReason,
        },
      });

      // 2) Toplar: STOCK + currentStepId temizle
      await tx.roll.updateMany({
        where: { id: { in: rollIds } },
        data: { status: RollStatus.STOCK, currentStepId: null },
      });

      // 3) Açık RollMovement'ları CANCEL notuyla kapat
      const openMovements = await tx.rollMovement.findMany({
        where: {
          rollId: { in: rollIds },
          workOrderStepId: dispatch.stepId,
          exitedAt: null,
        },
        select: { id: true, notes: true },
      });
      for (const mv of openMovements) {
        await tx.rollMovement.update({
          where: { id: mv.id },
          data: {
            exitedAt: new Date(),
            notes: mv.notes
              ? `${mv.notes} | CANCEL:${dispatch.dispatchNo}`
              : `CANCEL:${dispatch.dispatchNo}`,
          },
        });
      }

      // 4) SUBCONTRACTOR_SENT operation log'larını sil (idempotent — yoksa atla)
      await tx.rollOperation.deleteMany({
        where: {
          rollId: { in: rollIds },
          workOrderStepId: dispatch.stepId,
          operationType: RollOperationType.SUBCONTRACTOR_SENT,
        },
      });

      // 5) Step'te başka aktif (iptal edilmemiş) dispatch yoksa PENDING'e döndür
      const otherActive = await tx.subcontractorDispatch.count({
        where: {
          stepId: dispatch.stepId,
          cancelledAt: null,
          id: { not: dispatchId },
        },
      });
      if (otherActive === 0 && dispatch.step.status === StepStatus.ACTIVE) {
        await tx.workOrderStep.update({
          where: { id: dispatch.stepId },
          data: { status: StepStatus.PENDING, startedAt: null },
        });
      }

      // 6) Refakat kartı INFO scan (sevk iptal bildirimi)
      await logTravelerScan(
        tx,
        dispatch.workOrderId,
        dispatch.step.stationId,
        dispatch.stepId,
        ScanType.INFO,
        userId,
        `Fason sevk iptal: ${dispatch.dispatchNo} — ${trimmedReason}`
      );
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SUBCONTRACTOR_DISPATCH",
      recordId: dispatchId,
      newData: {
        cancelled: true,
        cancelReason: trimmedReason,
        rolledBackRollCount: rollIds.length,
      },
    });

    return {
      success: true,
      data: { id: dispatchId, dispatchNo: dispatch.dispatchNo },
      message: `Sevk iptal edildi: ${dispatch.dispatchNo}`,
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
      subcontractorId: string;
      manifestNo?: string | null; // Opsiyonel — fason her zaman irsaliye vermeyebilir
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

    const subcontractor = await prisma.subcontractor.findUnique({
      where: { id: data.subcontractorId },
      select: { id: true },
    });
    if (!subcontractor) throw AppError.notFound("Fason firma bulunamadı");

    // İrsaliye no opsiyonel — boş geldiyse null sakla.
    const manifestNoTrimmed =
      data.manifestNo && data.manifestNo.trim().length > 0
        ? data.manifestNo.trim()
        : null;

    const wo = await prisma.workOrder.findUnique({
      where: { id: data.workOrderId },
      select: { id: true },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    // Roll.itemId artık fason dönüşünde DEĞİŞMEZ. Final Item ataması Tambur'da
    // (PROCESS_QC → WAREHOUSE geçişinde) wo.targetItemId üzerinden yapılır.
    // Fason dönüşü sadece konum + status güncellemesi yapar.

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
          manifestNo: manifestNoTrimmed,
          workOrderId: data.workOrderId,
          stepId: data.stepId,
          subcontractorId: data.subcontractorId,
          receivedById: userId ?? null,
          notes: data.notes ?? null,
        },
      });

      // ── Toplu hazırlık ─────────────────────────────────────────────────
      // Roll.itemId fason dönüşünde DEĞİŞMEZ (final Item ataması Tambur'da).
      // Burada sadece movement kapatma + Roll status/currentStepId güncellemesi.
      const returnRollIds = data.returns.map((r) => r.rollId);

      // 1) Açık movement'leri tek raw SQL ile kapat (qtyOut/weightOut roll'dan).
      await tx.$executeRaw`
        UPDATE "roll_movements" rm
        SET "qtyOut"   = r."currentQty",
            "weightOut" = r."weightKg",
            "exitedAt"  = NOW(),
            "notes"     = ${`RETURNED_VIA_RECEIPT:${receiptNo}`}
        FROM "rolls" r
        WHERE rm."rollId" = r."id"
          AND rm."workOrderStepId" = ${data.stepId}
          AND rm."exitedAt" IS NULL
          AND rm."rollId" = ANY(${returnRollIds}::text[])
      `;

      // 2) Roll.update — toplu updateMany (itemId değişmediği için tek query).
      const nextRollStatus = nextStep ? RollStatus.IN_PRODUCTION : RollStatus.PRODUCED;
      const nextCurrentStepId = nextStep ? nextStep.id : null;
      await tx.roll.updateMany({
        where: { id: { in: returnRollIds } },
        data: { status: nextRollStatus, currentStepId: nextCurrentStepId },
      });

      // 4) Receipt item kayıtları — toplu insert.
      await tx.subcontractorReceiptItem.createMany({
        data: data.returns.map((ret) => ({
          receiptId: receipt.id,
          newRollId: ret.rollId,
          notes: ret.notes ?? null,
        })),
      });

      // 5) Sonraki step için RollMovement'ler — toplu insert (varsa).
      if (nextStep) {
        await tx.rollMovement.createMany({
          data: data.returns.map((ret) => {
            const orig = outstandingRolls.find((o) => o.id === ret.rollId)!;
            return {
              rollId: ret.rollId,
              workOrderStepId: nextStep.id,
              qtyIn: orig.currentQty,
              weightIn: orig.weightKg,
              operatorId: userId ?? null,
              notes: `FROM_SUBCONTRACTOR_RECEIPT:${receiptNo}`,
            };
          }),
        });
      }

      // 6) RollOperation log'ları — toplu insert. Unique key (rollId, stepId, opType)
      //    — `skipDuplicates` ile tekrar gönderim sessiz geçer (eski upsert'ün
      //    `update: {}` davranışıyla aynı semantik).
      await tx.rollOperation.createMany({
        data: data.returns.map((ret) => ({
          rollId: ret.rollId,
          workOrderStepId: data.stepId,
          operationType: RollOperationType.SUBCONTRACTOR_RETURNED,
          operatorId: userId ?? null,
          metadata: {
            receiptNo,
            manifestNo: manifestNoTrimmed,
            returnNote: ret.notes ?? null,
          } as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });

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
        manifestNoTrimmed
          ? `Fason kabul: ${receiptNo} (İrsaliye: ${manifestNoTrimmed})`
          : `Fason kabul: ${receiptNo}`
      );

      return tx.subcontractorReceipt.findUnique({
        where: { id: receipt.id },
        include: {
          subcontractor: true,
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

  async listPendingReturns(params?: {
    workOrderId?: string;
  }): Promise<ApiResponse<unknown>> {
    // Mobil mal kabul akışı: refakat kartı okutulduğunda sadece o iş emrinin
    // bekleyen grupları çekilir (gereksiz veri taşımamak için).
    const rollWhere: Prisma.RollWhereInput = {
      status: RollStatus.AT_SUBCONTRACTOR,
      ...(params?.workOrderId
        ? { currentStep: { workOrderId: params.workOrderId } }
        : {}),
    };
    // HAFİF projection — mobil/web sadece şunları tüketir:
    //   barcode, qty/weight/width, qualityGrade, item.{code,name}, variant.{code,name}
    // include:true her ilişkili tablonun TÜM kolonlarını çeker → 300+ rolllık
    // worst-case'de 300KB payload. select ile ~50KB'ye düşürür.
    const outstandingRolls = await prisma.roll.findMany({
      where: rollWhere,
      select: {
        id: true,
        barcode: true,
        currentQty: true,
        weightKg: true,
        width: true,
        qualityGrade: true,
        status: true,
        currentStepId: true,
        item: { select: { id: true, code: true, name: true } },
        variant: { select: { id: true, code: true, name: true } },
      },
    });

    const stepIds = [...new Set(outstandingRolls.map((r) => r.currentStepId).filter(Boolean) as string[])];
    const steps = await prisma.workOrderStep.findMany({
      where: { id: { in: stepIds } },
      select: {
        id: true,
        stepSequence: true,
        notes: true,
        station: { select: { id: true, code: true, name: true, type: true } },
        workOrder: {
          select: { id: true, batchNumber: true, recipeNo: true, status: true },
        },
        plannedSubcontractor: {
          select: { id: true, code: true, name: true },
        },
        requiredCategory: { select: { id: true, code: true, name: true } },
      },
    });

    // Her step için son dispatch'i bul. printSnapshot (büyük JSON) liste için gereksiz.
    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { stepId: { in: stepIds } },
      select: {
        id: true,
        dispatchNo: true,
        dispatchedAt: true,
        plateNumber: true,
        driverName: true,
        stepId: true,
        subcontractorId: true,
        subcontractor: { select: { id: true, code: true, name: true } },
      },
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
          requiredCategory: step.requiredCategory,
          plannedSubcontractor: step.plannedSubcontractor,
        },
        workOrder: {
          id: step.workOrder.id,
          batchNumber: step.workOrder.batchNumber,
          recipeNo: step.workOrder.recipeNo,
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
    subcontractorId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    success: true;
    data: unknown[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    const where: Prisma.SubcontractorDispatchWhereInput = {};
    if (params?.workOrderId) where.workOrderId = params.workOrderId;
    if (params?.subcontractorId) where.subcontractorId = params.subcontractorId;

    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 10));
    // buildPagination MAX_OFFSET=10K aşımında 400 fırlatır (curl saldırı yüzeyi).
    const { skip } = buildPagination(page, pageSize);

    // Liste için ÇOK HAFIF select — detay endpoint (`getDispatch`) tam veriyi döner.
    // Müşteri/orderLinks/ownerCustomer gibi N+ join'ler list response'unu şişiriyordu;
    // operatör detaya tıkladığında lazy fetch ile zenginleşir.
    const [dispatches, total] = await Promise.all([
      prisma.subcontractorDispatch.findMany({
        where,
        select: {
          id: true,
          dispatchNo: true,
          dispatchedAt: true,
          totalQty: true,
          plateNumber: true,
          driverName: true,
          cancelledAt: true,
          cancelReason: true,
          workOrder: { select: { id: true, batchNumber: true } },
          subcontractor: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { dispatchedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.subcontractorDispatch.count({ where }),
    ]);

    return {
      success: true,
      data: dispatches,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
    };
  }

  async getDispatch(id: string): Promise<ApiResponse<unknown>> {
    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        plannedSubcontractor: true,
        // WO + sipariş + müşteri zinciri (detay panelinde "kim için" göstermek için)
        workOrder: {
          include: {
            targetItem: {
              include: {
                color: true,
              },
            },
            targetProperties: { include: { property: true } },
            orderLinks: {
              include: {
                orderLine: {
                  include: {
                    item: true,
                    variant: true,
                    order: { include: { customer: true } },
                  },
                },
              },
            },
          },
        },
        step: { include: { station: true } },
        // Roll-level müşteri sahipliği (SERVICE_PRODUCTION müşteri-malı uyarısı)
        items: {
          include: {
            roll: {
              include: {
                item: true,
                variant: true,
                ownerCustomer: true,
              },
            },
          },
        },
        dispatchedBy: { select: { id: true, username: true, fullName: true } },
        cancelledBy: { select: { id: true, username: true, fullName: true } },
      },
    });

    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    return { success: true, data: dispatch };
  }

  async listReceipts(params?: {
    workOrderId?: string;
    subcontractorId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    success: true;
    data: unknown[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    const where: Prisma.SubcontractorReceiptWhereInput = {};
    if (params?.workOrderId) where.workOrderId = params.workOrderId;
    if (params?.subcontractorId) where.subcontractorId = params.subcontractorId;

    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 10));
    // buildPagination MAX_OFFSET=10K aşımında 400 fırlatır (curl saldırı yüzeyi).
    const { skip } = buildPagination(page, pageSize);

    // Hafif select — detay `getReceipt` ile lazy gelir (sevk listesindeki desen).
    // Mal kabulde metraj ölçülmez; toplam metraj sevk anındaki `dispatchedQty`
    // toplamından hesaplanır (fason hizmeti — qty değişmez).
    const [receipts, total] = await Promise.all([
      prisma.subcontractorReceipt.findMany({
        where,
        select: {
          id: true,
          receiptNo: true,
          manifestNo: true,
          receivedAt: true,
          notes: true,
          workOrder: { select: { id: true, batchNumber: true } },
          subcontractor: { select: { id: true, name: true, code: true } },
          step: {
            select: {
              id: true,
              stepSequence: true,
              station: { select: { name: true, code: true } },
            },
          },
          receivedBy: { select: { id: true, username: true, fullName: true } },
          _count: { select: { items: true } },
          items: {
            select: {
              sourceDispatchItem: { select: { dispatchedQty: true } },
            },
          },
        },
        orderBy: { receivedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.subcontractorReceipt.count({ where }),
    ]);

    const enriched = receipts.map(({ items, ...rest }) => ({
      ...rest,
      totalQty: items.reduce(
        (sum, it) => sum + (it.sourceDispatchItem?.dispatchedQty ?? 0),
        0
      ),
    }));

    return {
      success: true,
      data: enriched,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
    };
  }

  async getReceipt(id: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        workOrder: true,
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

  // ===========================================================================
  // DISPATCH PRINT SNAPSHOT
  // ===========================================================================
  async getDispatchPrintSnapshot(id: string): Promise<ApiResponse<unknown>> {
    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        workOrder: { select: { id: true, batchNumber: true, recipeNo: true, parameters: true, type: true } },
        step: { include: { station: { select: { name: true, code: true } } } },
        items: {
          include: {
            roll: {
              include: {
                item: { select: { code: true, name: true } },
                variant: { select: { code: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");

    // Snapshot varsa döndür, yoksa live hesapla (geriye dönük uyumluluk)
    if (dispatch.printSnapshot) {
      return { success: true, data: dispatch.printSnapshot };
    }

    const rolls = dispatch.items.map((item, idx) => ({
      sequence: idx + 1,
      id: item.roll.id,
      barcode: item.roll.barcode,
      itemCode: item.roll.item?.code ?? "",
      itemName: item.roll.item?.name ?? "",
      variantCode: item.roll.variant?.code ?? null,
      variantName: item.roll.variant?.name ?? null,
      dispatchedQty: item.dispatchedQty,
      dispatchedWeight: item.dispatchedWeight ?? null,
      qualityGrade: item.roll.qualityGrade,
      width: item.roll.width ?? null,
    }));

    const totalWeight = rolls.reduce((s, r) => s + (r.dispatchedWeight ?? 0), 0);

    return {
      success: true,
      data: {
        dispatchNo: dispatch.dispatchNo,
        dispatchedAt: dispatch.dispatchedAt.toISOString(),
        driverName: dispatch.driverName,
        plateNumber: dispatch.plateNumber,
        notes: dispatch.notes,
        workOrder: {
          id: dispatch.workOrder.id,
          batchNumber: dispatch.workOrder.batchNumber,
          recipeNo: dispatch.workOrder.recipeNo,
          parameters: dispatch.workOrder.parameters as Record<string, unknown> | null,
          type: dispatch.workOrder.type,
        },
        subcontractor: {
          id: dispatch.subcontractor.id,
          name: dispatch.subcontractor.name,
          code: dispatch.subcontractor.code ?? null,
        },
        step: {
          id: dispatch.step.id,
          stepSequence: dispatch.step.stepSequence,
          station: {
            name: dispatch.step.station.name,
            code: dispatch.step.station.code,
          },
        },
        rolls,
        totals: {
          rollCount: rolls.length,
          totalQty: dispatch.totalQty,
          totalWeight,
        },
      },
    };
  }

  // ===========================================================================
  // RECEIPT PRINT SNAPSHOT
  // ===========================================================================
  async getReceiptPrintSnapshot(id: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        workOrder: { select: { id: true, batchNumber: true, recipeNo: true, type: true } },
        step: { include: { station: { select: { name: true, code: true } } } },
        receivedBy: { select: { fullName: true } },
        items: {
          include: {
            newRoll: {
              include: {
                item: { select: { code: true, name: true } },
                variant: { select: { code: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!receipt) throw AppError.notFound("Kabul belgesi bulunamadı");

    const rolls = receipt.items.map((item, idx) => ({
      sequence: idx + 1,
      id: item.newRoll.id,
      barcode: item.newRoll.barcode,
      itemCode: item.newRoll.item?.code ?? "",
      itemName: item.newRoll.item?.name ?? "",
      variantCode: item.newRoll.variant?.code ?? null,
      variantName: item.newRoll.variant?.name ?? null,
      qualityGrade: item.newRoll.qualityGrade,
      notes: item.notes ?? null,
    }));

    return {
      success: true,
      data: {
        receiptNo: receipt.receiptNo,
        manifestNo: receipt.manifestNo,
        receivedAt: receipt.receivedAt.toISOString(),
        notes: receipt.notes,
        receivedBy: receipt.receivedBy?.fullName ?? null,
        workOrder: {
          id: receipt.workOrder.id,
          batchNumber: receipt.workOrder.batchNumber,
          recipeNo: receipt.workOrder.recipeNo,
          type: receipt.workOrder.type,
        },
        subcontractor: {
          id: receipt.subcontractor.id,
          name: receipt.subcontractor.name,
          code: receipt.subcontractor.code ?? null,
        },
        step: {
          id: receipt.step.id,
          stepSequence: receipt.step.stepSequence,
          station: {
            name: receipt.step.station.name,
            code: receipt.step.station.code,
          },
        },
        rolls,
        totals: { rollCount: rolls.length },
      },
    };
  }
}
