// =============================================================================
// TeksERP - Fason Üretim Kabul (Service Production Intake) Service
// =============================================================================
// Müşterinin getirdiği (boyalı / yarı mamul) kumaşı bizim fabrikamızda
// kurşun / tambur / paketleme işlemlerine sokup iade ettiğimiz akış.
//
// Farkları:
//   - Roll.ownerCustomerId doludur → ilgili müşteriye kilitli.
//   - WorkOrder.type = SERVICE_PRODUCTION, siparişe bağlı değil.
//   - WorkOrder.servicePricePerMeter → metre başı hizmet bedeli.
//   - Rota adımları müşteri talebine göre opsiyonel (Kurşun/Tambur/Paketleme).
//   - Paketleme zorunlu (WO oluştururken OTO eklenecek — `workorder.service`
//     içindeki mevcut mantık bunu yapıyor).
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import {
  Prisma,
  RollStatus,
  RollEntrySource,
  WorkOrderStatus,
  WorkOrderType,
  StationKind,
} from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import {
  ensureWorkOrderInProgress,
  recomputeStepStatus,
} from "./helpers/roll-step.helper";

function generateBarcode(): string {
  const now = new Date();
  const datePart =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0");
  const randomPart = uuidv4().replace(/-/g, "").substring(0, 8).toUpperCase();
  return `TEKS-${datePart}-${randomPart}`;
}

async function generateBatchNumber(): Promise<string> {
  const now = new Date();
  const prefix =
    "SB-" + // SB = Service Batch
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    "-";

  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await prisma.workOrder.findFirst({
      where: { batchNumber: { startsWith: prefix } },
      orderBy: { batchNumber: "desc" },
      select: { batchNumber: true },
    });
    const seq = last
      ? parseInt(last.batchNumber.split("-").pop() ?? "0", 10) + 1
      : 1;
    const candidate = `${prefix}${String(seq).padStart(3, "0")}`;
    const exists = await prisma.workOrder.findUnique({ where: { batchNumber: candidate } });
    if (!exists) return candidate;
  }
  throw AppError.internal("Parti numarası üretilemedi, lütfen tekrar deneyin");
}

export interface ServiceIntakeRoll {
  initialQty: number;
  weightKg?: number | null;
  qualityGrade?: string | null;
  width?: number | null;
  customerDescription?: string | null;
}

export interface ServiceIntakeInput {
  customerId: string;
  itemId: string;
  variantId?: string | null;
  /** Metre başı hizmet bedeli (₺/m) */
  servicePricePerMeter: number;
  /** Müşteri talebine göre seçilen istasyon kind'ları. Paketleme her zaman zorunlu; server otomatik ekler. */
  routeStationKinds: StationKind[];
  /** Opsiyonel batch no override */
  batchNumber?: string | null;
  notes?: string | null;
  rolls: ServiceIntakeRoll[];
}

export class ServiceProductionService {
  /**
   * Fason üretim kabul — müşteri malı topları kaydet, SERVICE_PRODUCTION WO aç,
   * ilk rota adımına bağla. Her şey tek transaction içinde.
   */
  async createIntake(
    data: ServiceIntakeInput,
    userId?: string
  ): Promise<
    ApiResponse<{
      workOrderId: string;
      batchNumber: string;
      rollIds: string[];
      barcodes: string[];
    }>
  > {
    if (!data.rolls || data.rolls.length === 0) {
      throw AppError.badRequest("En az bir top bilgisi girilmelidir");
    }

    if (!(data.servicePricePerMeter > 0)) {
      throw AppError.badRequest("Metre başı hizmet bedeli pozitif olmalıdır");
    }

    // Müşteri
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      select: { id: true, isActive: true, type: true, name: true },
    });
    if (!customer || !customer.isActive) {
      throw AppError.notFound("Müşteri bulunamadı veya pasif");
    }

    // Item
    const item = await prisma.item.findUnique({
      where: { id: data.itemId },
      select: { id: true, isActive: true, code: true, name: true },
    });
    if (!item || !item.isActive) {
      throw AppError.notFound("Ürün bulunamadı veya pasif");
    }

    if (data.variantId) {
      const variant = await prisma.itemVariant.findUnique({
        where: { id: data.variantId },
        select: { id: true, itemId: true, isActive: true },
      });
      if (!variant || !variant.isActive) {
        throw AppError.notFound("Varyant bulunamadı veya pasif");
      }
      if (variant.itemId !== data.itemId) {
        throw AppError.badRequest("Varyant seçilen ürüne ait değil");
      }
    }

    // Rota adımlarını StationKind → gerçek Station'a çevir.
    // PACKAGING/SHIPPING rotaya KONULMAZ — paket/sevkiyat WO'dan bağımsız
    // fulfillment akışı. Bu yüzden müşteri istese bile filtreleriz.
    const desiredKinds = new Set<StationKind>(
      data.routeStationKinds.filter(
        (k) => k !== StationKind.PACKAGING && k !== StationKind.SHIPPING
      )
    );

    const candidateStations = await prisma.station.findMany({
      where: { kind: { in: Array.from(desiredKinds) }, isActive: true },
      orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
    });

    // Her kind için ilk aktif istasyon (deterministik)
    const stationByKind = new Map<StationKind, (typeof candidateStations)[number]>();
    for (const s of candidateStations) {
      if (!stationByKind.has(s.kind)) stationByKind.set(s.kind, s);
    }

    const missing: StationKind[] = [];
    for (const k of desiredKinds) {
      if (!stationByKind.has(k)) missing.push(k);
    }
    if (missing.length > 0) {
      throw AppError.badRequest(
        `Aktif istasyon bulunamadı: ${missing.join(", ")}. Yönetimden tanımlayın.`
      );
    }

    // Kanonik sıra: RAW_QC → PROCESS_QC → SUBCONTRACTOR → TAMBUR (üretim sonu)
    const orderedKinds: StationKind[] = [
      StationKind.RAW_QC,
      StationKind.PROCESS_QC,
      StationKind.SUBCONTRACTOR,
      StationKind.TAMBUR,
      StationKind.OTHER,
    ].filter((k) => desiredKinds.has(k));

    const finalSteps = orderedKinds.map((k) => ({
      stationId: stationByKind.get(k)!.id,
      notes: null as string | null,
    }));

    const batchNumber =
      data.batchNumber && data.batchNumber.trim().length > 0
        ? data.batchNumber.trim()
        : await generateBatchNumber();

    const created = await prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.create({
        data: {
          batchNumber,
          type: WorkOrderType.SERVICE_PRODUCTION,
          status: WorkOrderStatus.PLANNED,
          servicePricePerMeter: new Prisma.Decimal(data.servicePricePerMeter),
          parameters:
            data.notes && data.notes.trim().length > 0
              ? ({ notes: data.notes.trim() } as Prisma.InputJsonValue)
              : undefined,
          steps: {
            create: finalSteps.map((s, i) => ({
              stationId: s.stationId,
              stepSequence: i + 1,
              notes: s.notes,
            })),
          },
        },
        include: {
          steps: { orderBy: { stepSequence: "asc" } },
        },
      });

      const firstStepId = wo.steps[0].id;

      const rollIds: string[] = [];
      const barcodes: string[] = [];

      for (const r of data.rolls) {
        if (!(r.initialQty > 0)) {
          throw AppError.badRequest("Top metrajı pozitif olmalıdır");
        }
        const barcode = generateBarcode();
        const roll = await tx.roll.create({
          data: {
            barcode,
            itemId: data.itemId,
            variantId: data.variantId ?? null,
            ownerCustomerId: data.customerId,
            customerDescription:
              r.customerDescription && r.customerDescription.trim().length > 0
                ? r.customerDescription.trim()
                : null,
            initialQty: r.initialQty,
            currentQty: r.initialQty,
            weightKg: r.weightKg ?? null,
            width: r.width ?? null,
            qualityGrade: r.qualityGrade ?? "1.KALITE",
            status: RollStatus.IN_PRODUCTION,
            entrySource: RollEntrySource.CUSTOMER_SUPPLIED,
            producedInStepId: firstStepId,
            currentStepId: firstStepId,
          },
        });

        await tx.rollMovement.create({
          data: {
            rollId: roll.id,
            workOrderStepId: firstStepId,
            qtyIn: roll.currentQty,
            weightIn: roll.weightKg,
            operatorId: userId ?? null,
            notes: "SERVICE_INTAKE",
          },
        });

        rollIds.push(roll.id);
        barcodes.push(roll.barcode);
      }

      // İlk step'i ACTIVE olarak hesapla (açık movement'ler var) ve WO'yu IN_PROGRESS'e çek.
      // Fason kabulde top girişi = üretim başlangıcı.
      await recomputeStepStatus(tx, firstStepId);
      await ensureWorkOrderInProgress(tx, wo.id);

      return { wo, rollIds, barcodes };
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "WORK_ORDER",
      recordId: created.wo.id,
      newData: {
        batchNumber: created.wo.batchNumber,
        type: created.wo.type,
        customerId: data.customerId,
        itemId: data.itemId,
        variantId: data.variantId ?? null,
        servicePricePerMeter: data.servicePricePerMeter,
        rollCount: created.rollIds.length,
        routeKinds: orderedKinds,
      },
    });

    return {
      success: true,
      data: {
        workOrderId: created.wo.id,
        batchNumber: created.wo.batchNumber,
        rollIds: created.rollIds,
        barcodes: created.barcodes,
      },
      message: `Fason üretim kabul edildi: ${created.rollIds.length} top, parti ${created.wo.batchNumber}`,
    };
  }
}
