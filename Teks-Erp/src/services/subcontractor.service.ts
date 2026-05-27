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
  StationKind,
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
import { resolveQualityGradeId } from "./helpers/quality-grade.helper";

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
// Cascade cancel — receipt'ten doğan açık kumaş roll'larının iptal güvenlik kontrolü
// -----------------------------------------------------------------------------

/** Frontend'in iptal preview ekranında listelediği her bornRoll için döner. */
export interface BornRollPreviewItem {
  id: string;
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
  operations: { id: string }[];
  movements: { exitedAt: Date | null }[];
  children: { id: string }[];
  dispatchItems: { id: string }[];
};

/**
 * Bir bornRoll cascade iptal edilebilir mi? Downstream'i olan (operasyon
 * görmüş, sonraki istasyona geçmiş, Tambur'da bölünmüş, başka fasona
 * gönderilmiş) Roll'lar iptal edilemez — önce manuel temizlik gerekir.
 *
 * SAFE statüler: STOCK, IN_PRODUCTION. Diğerleri (TAMBUR_CONSUMED,
 * WAREHOUSE, SCRAP, A1_STOCK, AT_SUBCONTRACTOR vb.) cascade'i tetiklerse
 * iz tutarsızlığı yaratır.
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
  const safeStatuses: RollStatus[] = [RollStatus.STOCK, RollStatus.IN_PRODUCTION];
  if (!safeStatuses.includes(roll.status)) {
    reasons.push(`Durum: ${roll.status}`);
  }
  return reasons;
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

    // Aynı adımda paralel açık sevk yasak — operatör yanlışlıkla aynı kartı
    // tekrar okutup üstüne ekleme yapmasın. "Açık sevk" = iptal edilmemiş VE
    // henüz fason kabulü tam yapılmamış (en az bir item geri gelmemiş).
    // Meşru bir ikinci parti için operatör önce eski sevki iptal eder veya
    // mal kabul yapar; o zaman bu kontrol geçer.
    const openDispatch = await prisma.subcontractorDispatch.findFirst({
      where: {
        stepId: data.stepId,
        cancelledAt: null,
        items: { some: { receiptItems: { none: {} } } },
      },
      select: { dispatchNo: true },
    });
    if (openDispatch) {
      throw AppError.conflict(
        `Bu adım için açık fason sevki var (${openDispatch.dispatchNo}). ` +
          `Yeni sevk açmak için önce o sevki iptal edin veya mal kabul yapın.`
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
      // 2) Zaten bu adıma bağlı → geç
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

    // Decimal aritmetik — float drift olmasın; sevk kaydında string'e dökeriz.
    const totalQty = rolls.reduce(
      (s, r) => s.plus(r.currentQty),
      new Prisma.Decimal(0)
    );

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

      // Topların ürün/renk bilgilerini çek (snapshot için)
      const rollsWithMeta = await tx.roll.findMany({
        where: { id: { in: data.rollIds } },
        include: {
          item: { select: { code: true, name: true } },
          color: { select: { code: true, name: true } },
        },
      });

      const rollSnapshots = rollsWithMeta.map((r, idx) => ({
        sequence: idx + 1,
        id: r.id,
        barcode: r.barcode,
        itemCode: r.item?.code ?? "",
        itemName: r.item?.name ?? "",
        colorCode: r.color?.code ?? null,
        colorName: r.color?.name ?? null,
        dispatchedQty: r.currentQty,
        dispatchedWeight: r.weightKg ?? null,
        qualityGrade: r.qualityGrade,
        width: r.width ?? null,
      }));

      const totalWeight = rollSnapshots.reduce(
        (s, r) => s.plus(r.dispatchedWeight ?? 0),
        new Prisma.Decimal(0)
      );

      const printSnapshot = {
        dispatchNo,
        dispatchedAt: now.toISOString(),
        driverName: data.driverName ?? null,
        plateNumber: data.plateNumber ?? null,
        notes: data.notes ?? null,
        workOrder: {
          id: wo.id,
          batchNumber: wo.batchNumber,
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
  // YENİ MODEL (boyahane gibi açık kumaş döndüren fason):
  //   - Orijinal Roll'lar TERMINAL'e çekilir (status=SUBCONTRACTOR_CONSUMED).
  //     Fiziksel olarak top kaybolmuştur (boyahane top açıp birleştirmiş).
  //   - Yeni Roll BURADA AÇILMAZ. Yeni "açık kumaş" Roll'ları Kurşun/KK2 istasyonu
  //     operatörü tarafından (`POST /api/rolls/open-fabric`) açılır; receipt'ten
  //     colorId + propertyIds inherit edilir.
  //   - Receipt'e appliedColorId + appliedPropertyIds yazılır (renk veren
  //     kategoriden gelmişse WO.targetColor/Properties'tan otomatik kopyalanır;
  //     UI override gönderebilir).
  //   - Bu step'in tüm outstanding'i consumed olunca step COMPLETED.
  //   - Sonraki step PENDING kalır (Roll yok); operatör Kurşun/KK2'de ilk
  //     açık kumaş Roll'u oluşturduğunda step ACTIVE olur.
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
      /// Override — fason kategorisi appliesColor=true ise WO.targetColorId
      /// otomatik kullanılır; UI farklı renk seçtiyse buradan gönderilir.
      appliedColorId?: string | null;
      /// Override — fason kategorisi appliesProperty=true ise WO.targetProperties
      /// otomatik kullanılır; UI farklı liste verirse buradan gönderilir (replace).
      appliedPropertyIds?: string[];
      /// Fasondan gelen açık kumaş parçaları — verilirse Receipt anında yeni
      /// "open-fabric" Roll'lar otomatik doğar ve rotadaki bir sonraki adıma
      /// bağlanır. Verilmezse mevcut akış: Kurşun/KK2 operatörü
      /// `POST /api/rolls/open-fabric` ile manuel açar.
      newRolls?: Array<{
        qty: number;
        weightKg?: number | null;
        notes?: string | null;
      }>;
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
      select: {
        id: true,
        targetItemId: true,
        targetColorId: true,
        width: true,
        targetProperties: { select: { propertyId: true } },
      },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    // Roll.itemId fason dönüşünde DEĞİŞMEZ. Renk ise BU ADIM "renk veren" bir
    // kategoriye (SubcontractorCategory.appliesColor=true) bağlıysa
    // WO.targetColorId'den; özellikler ise "özellik veren" kategoride
    // (SubcontractorCategory.appliesProperty=true) WO.targetProperties'tan
    // otomatik kopyalanır. Aynı adım her ikisini de yapabilir (Boyahane).
    // Planlama tarafı rotada her bayrak için bir adım garanti eder.

    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: true,
        requiredCategory: {
          select: {
            id: true,
            name: true,
            appliesColor: true,
            appliesProperty: true,
          },
        },
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

    const appliesColor = !!step.requiredCategory?.appliesColor;
    const appliesProperty = !!step.requiredCategory?.appliesProperty;
    if (appliesColor && !wo.targetColorId && data.appliedColorId === undefined) {
      throw AppError.badRequest(
        "Bu adım renk uygulayan bir fason kategorisinde, ancak iş emrinde hedef renk tanımlı değil. Planlamayı düzeltin veya appliedColorId override gönderin.",
      );
    }

    // appliedColorId / appliedPropertyIds resolution:
    //   - Override gönderildiyse onu kullan (null override de meşru — renk yok)
    //   - Yoksa: appliesColor=true ise WO.targetColorId'den otomatik; değilse null
    //   - Property için ayrı bayrak: appliesProperty=true ise WO.targetProperties;
    //     boş targetProperties bilinçli olabilir → sessizce boş liste
    const resolvedAppliedColorId =
      data.appliedColorId !== undefined
        ? data.appliedColorId
        : appliesColor
          ? wo.targetColorId
          : null;
    const resolvedAppliedPropertyIds =
      data.appliedPropertyIds !== undefined
        ? data.appliedPropertyIds
        : appliesProperty
          ? wo.targetProperties.map((p) => p.propertyId)
          : [];

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
          appliedColorId: resolvedAppliedColorId,
        },
      });

      // Receipt'in property listesi — yeni doğacak açık kumaş Roll'ları bunu
      // inherit edecek (Kurşun/KK2'de operatör "yeni kumaş aç" çağrısında).
      if (resolvedAppliedPropertyIds.length > 0) {
        await tx.subcontractorReceiptProperty.createMany({
          data: resolvedAppliedPropertyIds.map((propertyId) => ({
            receiptId: receipt.id,
            propertyId,
          })),
          skipDuplicates: true,
        });
      }

      // ── Toplu hazırlık ─────────────────────────────────────────────────
      // YENİ MODEL: Roll'lar sonraki step'e taşınmaz. Terminal'e (CONSUMED)
      // çekilir — top fasona gittiyse (boyahane / zımpara / başkası) mutlaka
      // açılır, fiziksel "top" kavramı kaybolur. Yeni Roll'lar Kurşun/KK2'de
      // operatörün open-fabric çağrısıyla doğar.
      const returnRollIds = data.returns.map((r) => r.rollId);

      // 1) Açık movement'leri kapat (qtyOut/weightOut Roll'un sevk anındaki
      //    son ölçümlerinden). Audit izi için kritik — fasona ne gönderdiğimizi
      //    görmek istiyoruz.
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

      // 2) Orijinal Roll'lar TERMINAL'e: SUBCONTRACTOR_CONSUMED, currentStepId=null.
      //    Top fasona gittiyse mutlaka açıldı — boyahane/zımpara fark etmez,
      //    kimliği kaybeder. currentQty / colorId / RollProperty dokunulmaz —
      //    son hayatın izi audit/raporlamada kalsın.
      await tx.roll.updateMany({
        where: { id: { in: returnRollIds } },
        data: {
          status: RollStatus.SUBCONTRACTOR_CONSUMED,
          currentStepId: null,
        },
      });

      // 3) Receipt item kayıtları — orijinal Roll referansı (audit + UI'da
      //    "bu receipt hangi orijinal toplara karşılık" görünmek için).
      await tx.subcontractorReceiptItem.createMany({
        data: data.returns.map((ret) => ({
          receiptId: receipt.id,
          newRollId: ret.rollId,
          notes: ret.notes ?? null,
        })),
      });

      // 4) RollOperation log — orijinal Roll'a son işlem (SUBCONTRACTOR_RETURNED).
      //    Unique key (rollId, stepId, opType) — re-receive sessiz geçer.
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
            consumedAtSubcontractor: true,
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

      // 5) newRolls açık kumaş Roll'larını burada doğur. Controller seviyesinde
      //    min(1) zorunlu — fason kabul her zaman en az bir açık kumaş parçasıyla
      //    yapılır. Sonraki adım rotadaki bir sonraki adım: fason ise oraya
      //    bağlanır (kullanıcı sonra Dispatch çağırır), değilse Kurşun/KK2 gibi
      //    internal step'e. nextStep yoksa Roll'lar serbest stokta kalır.
      if (data.newRolls && data.newRolls.length > 0) {
        // Kaynak roll'lardan inherit: itemId + width. Kumaş eni boyahanede
        // değişmez — fiziksel gerçek source roll'da. WO.width (kullanıcı
        // formdan değiştirmiş olabilir) bu fiziksel değeri override etmemeli.
        // Width: source önce, WO sadece source'da yoksa fallback.
        // ItemId: WO.targetItemId önce (rota hedefi belli) — değilse source.
        const sourceRoll = await tx.roll.findFirst({
          where: { id: { in: returnRollIds } },
          select: { itemId: true, width: true },
        });
        const bornItemId = wo.targetItemId ?? sourceRoll?.itemId ?? null;
        const bornWidth = sourceRoll?.width ?? wo.width ?? null;
        if (!bornItemId) {
          throw AppError.badRequest(
            "Yeni Roll için item belirlenemedi (WO.targetItemId ve kaynak Roll itemId yok)"
          );
        }

        // Açık kumaş Roll'ları için varsayılan kalite — Tambur kararı verilene kadar
        // "1.KALITE" başlangıç değeri (KK1 girişi pattern'i ile aynı).
        const defaultQualityGradeCode = "1.KALITE";
        const defaultQualityGradeId = await resolveQualityGradeId(
          defaultQualityGradeCode,
          tx,
        );

        for (const nr of data.newRolls) {
          if (!Number.isFinite(nr.qty) || nr.qty <= 0) {
            throw AppError.badRequest("Yeni Roll metrajı pozitif olmalı");
          }
          const created = await tx.roll.create({
            data: {
              itemId: bornItemId,
              colorId: resolvedAppliedColorId,
              initialQty: nr.qty,
              currentQty: nr.qty,
              weightKg: nr.weightKg ?? null,
              width: bornWidth,
              status: RollStatus.STOCK,
              qualityGrade: defaultQualityGradeCode,
              qualityGradeId: defaultQualityGradeId,
              entrySource: "SUBCONTRACTOR_RETURN",
              parentReceiptId: receipt.id,
              currentStepId: nextStep ? nextStep.id : null,
              createdById: userId ?? null,
              // barcode null — açık kumaş, fiziksel etiket yok
              ...(resolvedAppliedPropertyIds.length > 0
                ? {
                    properties: {
                      create: resolvedAppliedPropertyIds.map((propertyId) => ({
                        property: { connect: { id: propertyId } },
                      })),
                    },
                  }
                : {}),
            },
          });
          // Sonraki step varsa açılış RollMovement'i (qty/weight in)
          if (nextStep) {
            await tx.rollMovement.create({
              data: {
                rollId: created.id,
                workOrderStepId: nextStep.id,
                qtyIn: nr.qty,
                weightIn: nr.weightKg ?? null,
                operatorId: userId ?? null,
                notes: `RECEIPT_OPEN_FABRIC:${receiptNo}`,
              },
            });
          }
        }
        // Sonraki step var ise status'unu güncelle (PENDING → ACTIVE / vb.)
        if (nextStep) {
          await recomputeStepStatus(tx, nextStep.id);
        }
      }
      // newRolls boş senaryosu artık geçersiz (controller min(1) ile reddediyor).

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
        consumedRollCount: data.returns.length,
        appliedColorId: resolvedAppliedColorId,
        appliedPropertyIds: resolvedAppliedPropertyIds,
      },
    });

    return {
      success: true,
      data: result,
      message: `Fason kabul tamamlandı: ${result!.receiptNo} (${data.returns.length} orijinal top consumed). Yeni Roll'lar Kurşun/KK2'de açılacak.`,
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
    //
    // workOrderId verildiyse boş döndüğünde net 400/404 mesajı atılır
    // (operatör yanlış kart/yanlış zaman). workOrderId verilmediyse (admin
    // tüm-WO listesi) sessiz boş array döner — eski davranış.
    if (params?.workOrderId) {
      const woId = params.workOrderId;

      // WO'da hiç SUBCONTRACTOR step var mı?
      const subStepCount = await prisma.workOrderStep.count({
        where: { workOrderId: woId, station: { kind: "SUBCONTRACTOR" } },
      });
      if (subStepCount === 0) {
        throw AppError.notFound(
          "Bu iş emrinde fason adımı tanımlı değil",
        );
      }

      // SUBCONTRACTOR step'lerden birinde AT_SUBCONTRACTOR rulu var mı?
      const pendingCount = await prisma.roll.count({
        where: {
          status: RollStatus.AT_SUBCONTRACTOR,
          currentStep: {
            workOrderId: woId,
            station: { kind: "SUBCONTRACTOR" },
          },
        },
      });

      if (pendingCount === 0) {
        // Bu WO'nun rulları gerçekte hangi adımlarda?
        const stepsWithRolls = await prisma.workOrderStep.findMany({
          where: { workOrderId: woId, currentRolls: { some: {} } },
          select: {
            station: { select: { name: true } },
            _count: { select: { currentRolls: true } },
          },
          orderBy: { stepSequence: "asc" },
        });

        if (stepsWithRolls.length === 0) {
          throw AppError.badRequest(
            "Bu iş emrinin fason adımında bekleyen rulo yok ve şu an aktif başka adım da yok. (Üretim henüz başlamamış veya tamamlanmış.)",
          );
        }

        const stepNames = stepsWithRolls
          .map((s) => `${s.station.name} (${s._count.currentRolls} rulo)`)
          .join(", ");
        throw AppError.badRequest(
          `Bu iş emrinin fason adımında bekleyen rulo yok. Mevcut konum: ${stepNames}. Tabletinizi yanlış istasyonda okutmuş olabilirsiniz.`,
        );
      }
    }

    const rollWhere: Prisma.RollWhereInput = {
      status: RollStatus.AT_SUBCONTRACTOR,
      ...(params?.workOrderId
        ? { currentStep: { workOrderId: params.workOrderId } }
        : {}),
    };
    // HAFİF projection — mobil/web sadece şunları tüketir:
    //   barcode, qty/weight/width, qualityGrade, item.{code,name}, color.{code,name}
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
        color: { select: { id: true, code: true, name: true } },
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
          select: { id: true, batchNumber: true, status: true },
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
      const totalQty = stepRolls.reduce(
        (s, r) => s.plus(r.currentQty),
        new Prisma.Decimal(0),
      );

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
    // Müşteri/orderLinks gibi N+ join'ler list response'unu şişiriyordu;
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
          notes: true,
          stepId: true,
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
            targetItem: true,
            targetColor: true,
            targetProperties: { include: { property: true } },
            orderLinks: {
              include: {
                orderLine: {
                  include: {
                    item: true,
                    color: true,
                    order: { include: { customer: true } },
                  },
                },
              },
            },
          },
        },
        step: { include: { station: true } },
        items: {
          include: {
            roll: {
              include: {
                item: true,
                color: true,
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
      // Decimal aritmetik — float drift olmasın; serializer number'a çevirir.
      totalQty: items.reduce(
        (sum, it) => sum.plus(it.sourceDispatchItem?.dispatchedQty ?? 0),
        new Prisma.Decimal(0)
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
            newRoll: { include: { item: true, color: true } },
            sourceDispatchItem: { include: { roll: true } },
          },
        },
        // Fasondan dönen yeni açık kumaş parçaları (split senaryosu için kritik).
        // UI bunları ayrı section'da listeler; orijinal items ile karıştırılmaz.
        bornRolls: {
          select: {
            id: true,
            initialQty: true,
            currentQty: true,
            weightKg: true,
            width: true,
            status: true,
            qualityGrade: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
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
        workOrder: {
          select: {
            id: true,
            batchNumber: true,
            parameters: true,
            type: true,
            // Sevk fişinde "fasoncudan ne istiyoruz" → WO'nun hedef rengi.
            // Snapshot içinde dondurulmuyor; her zaman canlı join'liyoruz.
            // Fason istasyondan sonraki üretimde renk değişebilir; sevk fişi
            // boyahanenin hangi renge boyaması gerektiğini söyler.
            targetColor: { select: { id: true, code: true, name: true, hex: true } },
          },
        },
        step: { include: { station: { select: { name: true, code: true } } } },
        items: {
          include: {
            roll: {
              include: {
                item: { select: { code: true, name: true } },
                color: { select: { code: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");

    const requestedColor = dispatch.workOrder.targetColor
      ? {
          id: dispatch.workOrder.targetColor.id,
          code: dispatch.workOrder.targetColor.code,
          name: dispatch.workOrder.targetColor.name,
          hex: dispatch.workOrder.targetColor.hex,
        }
      : null;

    // Snapshot varsa döndür, yoksa live hesapla (geriye dönük uyumluluk).
    // requestedColor her iki dalda da canlı join — eski snapshot'larda bile yer alır.
    if (dispatch.printSnapshot) {
      return {
        success: true,
        data: { ...(dispatch.printSnapshot as object), requestedColor },
      };
    }

    const rolls = dispatch.items.map((item, idx) => ({
      sequence: idx + 1,
      id: item.roll.id,
      barcode: item.roll.barcode,
      itemCode: item.roll.item?.code ?? "",
      itemName: item.roll.item?.name ?? "",
      colorCode: item.roll.color?.code ?? null,
      colorName: item.roll.color?.name ?? null,
      dispatchedQty: item.dispatchedQty,
      dispatchedWeight: item.dispatchedWeight ?? null,
      qualityGrade: item.roll.qualityGrade,
      width: item.roll.width ?? null,
    }));

    const totalWeight = rolls.reduce(
      (s, r) => s.plus(r.dispatchedWeight ?? 0),
      new Prisma.Decimal(0)
    );

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
        requestedColor,
      },
    };
  }

  // ===========================================================================
  // CANCEL RECEIPT — Fason kabulün iptali (operatör hatası geri alma)
  // ===========================================================================
  //
  // Kural:
  //   - Receipt soft-cancel edilir (cancelledAt/By/Reason).
  //   - Receipt'teki rulalar AT_SUBCONTRACTOR'a geri çekilir, currentStepId
  //     bu fason adımına döner.
  //   - Receipt seviyesindeki appliedColor / appliedProperty kayıtları silinir
  //     ("renk veren" ya da "özellik veren" kategori bu adımdaydı diye).
  //   - Sonraki adımda her rulo için: kapalı movement, RollOperation veya
  //     yeni dispatch varsa REDDET ("önce o işlemi geri al"). Aksi halde
  //     sonraki adımdaki açık movement silinir.
  //   - Bu adımdaki SUBCONTRACTOR_RETURNED operation log'ları silinir.
  //   - Step status recompute (genelde COMPLETED → ACTIVE'e döner).
  //   - WO COMPLETED iken iptal yasak.
  //
  /**
   * Receipt iptal preview — bornRoll'ları ve her birinin downstream durumunu
   * döner. Frontend bunu kullanarak operatöre "şu açık kumaş roll'ları da
   * iptal edilecek" onayı sunar. allSafe=false ise iptal disabled olmalı.
   */
  async getCancelPreview(receiptId: string): Promise<
    ApiResponse<{
      receiptNo: string;
      receivedAt: Date;
      bornRolls: BornRollPreviewItem[];
      allSafe: boolean;
      totalBornRolls: number;
    }>
  > {
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id: receiptId },
      select: {
        id: true,
        receiptNo: true,
        receivedAt: true,
        cancelledAt: true,
        workOrder: { select: { status: true } },
        bornRolls: {
          select: {
            id: true,
            currentQty: true,
            status: true,
            item: { select: { code: true, name: true } },
            color: { select: { name: true } },
            // Downstream check: bu roll üzerinde herhangi bir RollOperation var mı
            operations: { select: { id: true }, take: 1 },
            // Sonraki istasyona çıkmış mı (exitedAt set olmuş RollMovement)
            movements: { select: { exitedAt: true } },
            // Tambur'da bölünmüş mü (çocuk roll türemiş)
            children: { select: { id: true }, take: 1 },
            // Başka fason sevkinde mi
            dispatchItems: { select: { id: true }, take: 1 },
          },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul belgesi bulunamadı");
    if (receipt.cancelledAt) {
      throw AppError.conflict("Bu mal kabul zaten iptal edilmiş");
    }
    if (receipt.workOrder.status === "COMPLETED") {
      throw AppError.conflict("Tamamlanmış iş emrinin mal kabulü iptal edilemez");
    }

    const bornRolls: BornRollPreviewItem[] = receipt.bornRolls.map((roll) => {
      const blockingReasons = computeBornRollBlockingReasons(roll);
      return {
        id: roll.id,
        itemCode: roll.item.code,
        itemName: roll.item.name,
        colorName: roll.color?.name ?? null,
        currentQty: Number(roll.currentQty),
        status: roll.status,
        blockingReasons,
        safeToCancel: blockingReasons.length === 0,
      };
    });

    return {
      success: true,
      data: {
        receiptNo: receipt.receiptNo,
        receivedAt: receipt.receivedAt,
        bornRolls,
        allSafe: bornRolls.every((b) => b.safeToCancel),
        totalBornRolls: bornRolls.length,
      },
    };
  }

  async cancelReceipt(
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
        items: { select: { newRollId: true } },
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
            currentStepId: true,
            status: true,
            operations: { select: { id: true }, take: 1 },
            movements: { select: { exitedAt: true } },
            children: { select: { id: true }, take: 1 },
            dispatchItems: { select: { id: true }, take: 1 },
          },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul belgesi bulunamadı");
    if (receipt.cancelledAt) {
      throw AppError.conflict("Bu mal kabul zaten iptal edilmiş");
    }
    if (receipt.step.workOrder.status === "COMPLETED") {
      throw AppError.conflict("Tamamlanmış iş emrinin mal kabulü iptal edilemez");
    }

    const rollIds = receipt.items.map((it) => it.newRollId);
    if (rollIds.length === 0) {
      throw AppError.badRequest("Bu kabul belgesinde rulo yok");
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
            `Top işlenmiş, iptal güvenli değil (Roll ${roll.id.slice(0, 8)}…): ${reasons.join(", ")}`,
          );
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      // 0) Cascade: bornRoll'ları iptal et (varsa)
      if (bornRollIds.length > 0) {
        // RollMovement: bu roll'lara ait, receipt'in açtığı open-fabric movement
        await tx.rollMovement.deleteMany({
          where: {
            rollId: { in: bornRollIds },
            notes: `RECEIPT_OPEN_FABRIC:${receipt.receiptNo}`,
          },
        });
        // RollProperty: receipt'ten inherit edilmişti, sil
        await tx.rollProperty.deleteMany({
          where: { rollId: { in: bornRollIds } },
        });
        // Roll status → CANCELLED, currentStepId temizle
        await tx.roll.updateMany({
          where: { id: { in: bornRollIds } },
          data: {
            status: RollStatus.CANCELLED,
            currentStepId: null,
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

      // 1) Receipt'i soft-cancel
      await tx.subcontractorReceipt.update({
        where: { id: receiptId },
        data: {
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: trimmedReason,
        },
      });

      // 2) Bu adım için kapatılmış RollMovement'ları geri aç (RETURNED_VIA_RECEIPT
      //    notuyla kapatılmıştı)
      await tx.rollMovement.updateMany({
        where: {
          workOrderStepId: receipt.stepId,
          rollId: { in: rollIds },
          notes: `RETURNED_VIA_RECEIPT:${receipt.receiptNo}`,
        },
        data: {
          qtyOut: null,
          weightOut: null,
          exitedAt: null,
          notes: `REOPENED_FROM_RECEIPT:${receipt.receiptNo}`,
        },
      });

      // 3) Orijinal Roll'ları SUBCONTRACTOR_CONSUMED'dan AT_SUBCONTRACTOR'a geri çek
      await tx.roll.updateMany({
        where: { id: { in: rollIds } },
        data: {
          status: RollStatus.AT_SUBCONTRACTOR,
          currentStepId: receipt.stepId,
        },
      });

      // 4) SUBCONTRACTOR_RETURNED operation log'larını sil
      await tx.rollOperation.deleteMany({
        where: {
          rollId: { in: rollIds },
          workOrderStepId: receipt.stepId,
          operationType: RollOperationType.SUBCONTRACTOR_RETURNED,
        },
      });

      // 5) Receipt'in property listesini sil (cancel ⇒ uygulanan kimlik geri alınır)
      await tx.subcontractorReceiptProperty.deleteMany({
        where: { receiptId },
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

  // ===========================================================================
  // RECEIPT PRINT SNAPSHOT
  // ===========================================================================
  async getReceiptPrintSnapshot(id: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        workOrder: { select: { id: true, batchNumber: true, type: true } },
        step: { include: { station: { select: { name: true, code: true } } } },
        receivedBy: { select: { fullName: true } },
        items: {
          include: {
            newRoll: {
              include: {
                item: { select: { code: true, name: true } },
                color: { select: { code: true, name: true } },
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
      colorCode: item.newRoll.color?.code ?? null,
      colorName: item.newRoll.color?.name ?? null,
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
