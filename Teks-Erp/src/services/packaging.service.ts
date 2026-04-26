// =============================================================================
// TeksERP - Packaging (Paket/Tartı/Etiket) Service
// =============================================================================
// Tambur sonrası her top buraya düşer. Operatör:
//   1. Refakat kartını veya top barkodunu okutur → iş emrindeki bekleyen
//      paketleme topları listelenir.
//   2. Topu tartıya koyar, kilo girilir (Faz 1: simülasyon butonu; ileride COM).
//   3. "Sevkiyata" veya "Depoya" seçimi yapar. İsterse varsayılan sipariş
//      atamasını başka bir satıra çevirir (bütün top, metraj bölüştürme yok).
//   4. "Bitti" → etiket payload'u döner, top PACKAGED olarak işaretlenir.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import {
  Prisma,
  Roll,
  RollStatus,
  RollOperationType,
  StationKind,
  StepStatus,
  WorkOrderStatus,
} from "@prisma/client";
import { recomputeStepStatus } from "./helpers/roll-step.helper";
import { CustomerVariantAliasService } from "./customer-variant-alias.service";

const aliasService = new CustomerVariantAliasService();

export type PackagingDestination = "SHIP" | "WAREHOUSE";

export interface PackagingOrderLinkOption {
  orderLineId: string;
  orderNumber: string;
  customerName: string;
  itemCode: string;
  itemName: string;
  requestedQty: number;
}

export interface PackagingRollSummary {
  rollId: string;
  barcode: string;
  itemCode: string;
  itemName: string;
  variantCode: string | null;
  variantName: string | null;
  currentQty: number;
  width: number | null;
  weightKg: number | null;
  qualityGrade: string;
  workOrderId: string;
  workOrderBatchNumber: string;
  stepId: string;
  defaultOrderLineId: string | null;
  defaultCustomerName: string | null;
  availableOrderLinks: PackagingOrderLinkOption[];
  // Fason Üretim Kabul: müşteri-malı top ise sahibi burada
  ownerCustomerId: string | null;
  ownerCustomerName: string | null;
  // Etiket önizlemesi: varsayılan hedef müşteriye göre çözülmüş karşılık
  previewCustomerName: string | null;
  previewCustomerLabel: string | null;
  previewCustomerCode: string | null;
}

export interface PackagingStepSummary {
  workOrderStepId: string;
  workOrderId: string;
  batchNumber: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  rolls: PackagingRollSummary[];
}

export interface PackagingFinalizeInput {
  rollId: string;
  weightKg: number;
  destination: PackagingDestination;
  orderLineId?: string | null;
}

export interface PackagingLabelPayload {
  barcode: string;
  itemCode: string;
  itemName: string;
  variantCode: string | null;
  variantName: string | null;
  widthCm: number | null;
  lengthMeters: number;
  weightKg: number;
  destination: PackagingDestination;
  customerName: string | null;
  orderNumber: string | null;
  batchNumber: string;
  printedAt: string;
  // Müşteri-özel desen adı (varsa etiketin ön yüzünde bu basılır)
  customerVariantLabel: string | null;
  customerVariantCode: string | null;
}

export interface PackagingFinalizeResult {
  roll: Roll;
  label: PackagingLabelPayload;
}

export class PackagingService {
  /**
   * Şu anda paketleme adımında açık olan (exitedAt=null) bütün topları listeler.
   * Tablet ekranı açıldığında arka plandaki "fallback" listedir.
   */
  async getPendingRolls(): Promise<ApiResponse<PackagingRollSummary[]>> {
    const rolls = await this.queryOpenRolls({
      stationKind: StationKind.PACKAGING,
    });
    return { success: true, data: rolls };
  }

  /**
   * Refakat kartı barkoduyla iş emrinin paketleme adımındaki açık topları
   * döner. Operatör kartı okuttuğunda bu çağrılır.
   */
  async getByCardBarcode(
    cardBarcode: string
  ): Promise<ApiResponse<PackagingStepSummary>> {
    const card = await prisma.travelerCard.findUnique({
      where: { barcode: cardBarcode },
      select: { status: true, workOrderId: true },
    });
    if (!card) {
      throw AppError.notFound(`Refakat kartı bulunamadı: ${cardBarcode}`);
    }
    if (card.status !== "ACTIVE") {
      throw AppError.badRequest(
        `Bu refakat kartı aktif değil (durum: ${card.status})`
      );
    }

    const step = await prisma.workOrderStep.findFirst({
      where: {
        workOrderId: card.workOrderId,
        station: { kind: StationKind.PACKAGING },
      },
      include: {
        station: true,
        workOrder: { select: { batchNumber: true } },
      },
      orderBy: { stepSequence: "asc" },
    });
    if (!step) {
      throw AppError.notFound("Bu iş emrinde Paketleme adımı tanımlı değil");
    }

    const rolls = await this.queryOpenRolls({ workOrderStepId: step.id });

    return {
      success: true,
      data: {
        workOrderStepId: step.id,
        workOrderId: step.workOrderId,
        batchNumber: step.workOrder.batchNumber,
        stationId: step.stationId,
        stationCode: step.station.code,
        stationName: step.station.name,
        rolls,
      },
    };
  }

  /**
   * Top barkodu ile arama — operatör refakat kartı yerine direkt topu okutursa.
   * Topun PACKAGING adımında açık bir movement'i olması gerekir.
   */
  async getByRollBarcode(
    barcode: string
  ): Promise<ApiResponse<PackagingRollSummary>> {
    const roll = await prisma.roll.findUnique({
      where: { barcode },
      select: { id: true },
    });
    if (!roll) {
      throw AppError.notFound(`Top bulunamadı: ${barcode}`);
    }

    const matches = await this.queryOpenRolls({ rollId: roll.id });
    if (matches.length === 0) {
      throw AppError.badRequest(
        "Bu top paketleme adımında açık değil (zaten paketlenmiş veya farklı bir istasyondadır)"
      );
    }

    return { success: true, data: matches[0] };
  }

  /**
   * Tartı simülasyonu — ileride COM port'tan anlık kilo okunacak.
   * Şu an mevcut metraj × 0.28 kg/m civarı gerçekçi bir sayı döner.
   */
  async simulateWeigh(
    rollId: string
  ): Promise<ApiResponse<{ weightKg: number }>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { currentQty: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    // Metre başına 0.22 - 0.35 kg arası rastgele
    const perMeter = 0.22 + Math.random() * 0.13;
    const weightKg = Math.max(0.1, Number((roll.currentQty * perMeter).toFixed(2)));

    return { success: true, data: { weightKg } };
  }

  /**
   * "Bitti" — topu paketleme adımından çıkarır, kilo + hedef uygulanır,
   * etiket payload'u döner. Bölüştürme (split) yok — bütün top tek hedefe gider.
   */
  async finalize(
    input: PackagingFinalizeInput,
    userId?: string
  ): Promise<ApiResponse<PackagingFinalizeResult>> {
    if (input.weightKg <= 0) {
      throw AppError.badRequest("Kilo 0'dan büyük olmalı");
    }
    if (input.destination !== "SHIP" && input.destination !== "WAREHOUSE") {
      throw AppError.badRequest("Hedef SHIP veya WAREHOUSE olmalı");
    }

    const roll = await prisma.roll.findUnique({
      where: { id: input.rollId },
      include: {
        item: true,
        variant: true,
        ownerCustomer: { select: { id: true, name: true } },
        currentStep: {
          include: {
            station: true,
            workOrder: {
              include: {
                orderLinks: {
                  include: {
                    orderLine: {
                      include: { order: { include: { customer: true } } },
                    },
                  },
                },
              },
            },
          },
        },
        allocations: true,
      },
    });

    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.currentStepId || !roll.currentStep) {
      throw AppError.badRequest("Top aktif bir iş emri adımında değil");
    }
    if (roll.currentStep.station.kind !== StationKind.PACKAGING) {
      throw AppError.badRequest(
        `Top paketleme adımında değil (mevcut: ${roll.currentStep.station.kind})`
      );
    }

    // Fason Üretim Kabul: iş emrinin siparişi yok, sahip müşteri Roll.ownerCustomer'dadır
    const isServiceOwned = !!roll.ownerCustomerId;

    // Hedef sipariş satırı: input verilmişse onu, yoksa iş emrinin tek bağı varsa onu kullan.
    // Müşteri-malı toplarda (fason) orderLinks boştur — sipariş aranmaz.
    // WAREHOUSE hedefinde de sipariş bağlantısı korunur (ara depolama, ileride sevk edilecek).
    let targetOrderLineId: string | null = input.orderLineId ?? null;
    if (!isServiceOwned) {
      if (!targetOrderLineId) {
        const links = roll.currentStep.workOrder.orderLinks;
        if (links.length === 1) {
          targetOrderLineId = links[0].orderLineId;
        } else if (links.length === 0) {
          if (input.destination === "SHIP") {
            throw AppError.badRequest(
              "Bu iş emri hiçbir siparişe bağlı değil. Depoya kaldırın veya siparişe bağlayın."
            );
          }
          // WAREHOUSE: siparişsiz stok olarak kabul edilir
        } else if (input.destination === "SHIP") {
          throw AppError.badRequest(
            "İş emrinde birden fazla sipariş var — lütfen hangisine gideceğini seçin"
          );
        }
        // WAREHOUSE + birden fazla sipariş: ilk bağlantıyı kullan (sevkiyatta netleşir)
        if (!targetOrderLineId && links.length > 1) {
          targetOrderLineId = links[0].orderLineId;
        }
      } else {
        const belongs = roll.currentStep.workOrder.orderLinks.some(
          (l) => l.orderLineId === targetOrderLineId
        );
        if (!belongs) {
          throw AppError.badRequest(
            "Seçilen sipariş satırı bu iş emrine bağlı değil"
          );
        }
      }
    } else if (input.destination === "SHIP" && isServiceOwned && targetOrderLineId) {
      // Operatör fason topu yanlışlıkla bir siparişe bağlamaya çalışırsa engelle
      throw AppError.badRequest(
        "Müşteri malı (fason) top bir siparişe bağlanamaz — doğrudan sahibine sevk edilir"
      );
    }

    const netLength = roll.currentQty;
    const customerName = isServiceOwned
      ? roll.ownerCustomer?.name ?? null
      : roll.currentStep.workOrder.orderLinks[0]?.orderLine.order.customer.name ?? null;
    const orderNumber = isServiceOwned
      ? null
      : (roll.currentStep.workOrder.orderLinks.find(
          (l) => l.orderLineId === targetOrderLineId
        )?.orderLine.order.orderNumber ??
        (roll.currentStep.workOrder.orderLinks.length === 1
          ? roll.currentStep.workOrder.orderLinks[0].orderLine.order.orderNumber
          : null));
    const batchNumber = roll.currentStep.workOrder.batchNumber;

    const stepId = roll.currentStepId;

    const updated = await prisma.$transaction(async (tx) => {
      const now = new Date();

      // Paketleme movement'ini kapat
      await tx.rollMovement.updateMany({
        where: { rollId: input.rollId, workOrderStepId: stepId, exitedAt: null },
        data: {
          exitedAt: now,
          qtyOut: netLength,
          weightOut: input.weightKg,
          notes:
            input.destination === "SHIP"
              ? "PACKAGED_TO_SHIP"
              : "PACKAGED_TO_WAREHOUSE",
        },
      });

      // Mevcut tahsisleri temizle, yenisini (varsa) ekle — "bütün top tek hedef"
      // WAREHOUSE hedefinde de tahsis korunur: top sipariş için üretildi, depoda bekliyor.
      await tx.orderAllocation.deleteMany({ where: { rollId: input.rollId } });
      if (targetOrderLineId) {
        await tx.orderAllocation.create({
          data: {
            rollId: input.rollId,
            orderLineId: targetOrderLineId,
            allocatedQty: netLength,
          },
        });
      }

      const nextStatus: RollStatus =
        input.destination === "SHIP"
          ? RollStatus.READY_FOR_SHIP
          : RollStatus.WAREHOUSE;

      const updatedRoll = await tx.roll.update({
        where: { id: input.rollId },
        data: {
          status: nextStatus,
          currentStepId: null,
          weightKg: input.weightKg,
          grossWeightKg: input.weightKg,
          packagingDate: new Date(),
        },
      });

      // Per-roll paketleme log'u
      await tx.rollOperation.upsert({
        where: {
          rollId_workOrderStepId_operationType: {
            rollId: input.rollId,
            workOrderStepId: stepId,
            operationType: RollOperationType.PACKAGED,
          },
        },
        create: {
          rollId: input.rollId,
          workOrderStepId: stepId,
          operationType: RollOperationType.PACKAGED,
          operatorId: userId ?? null,
          createdAt: now,
          metadata: {
            weightKg: input.weightKg,
            destination: input.destination,
            orderLineId: targetOrderLineId,
            netLength,
          } as Prisma.InputJsonValue,
        },
        update: {},
      });

      await recomputeStepStatus(tx, stepId);

      // Tüm adımlar COMPLETED/SKIPPED ise WO'yu kapat
      const workOrderId = roll.currentStep!.workOrderId;
      const remaining = await tx.workOrderStep.count({
        where: {
          workOrderId,
          status: { notIn: [StepStatus.COMPLETED, StepStatus.SKIPPED] },
        },
      });
      if (remaining === 0) {
        await tx.workOrder.update({
          where: { id: workOrderId },
          data: { status: WorkOrderStatus.COMPLETED },
        });
        await tx.travelerCard.updateMany({
          where: { workOrderId, status: "ACTIVE" },
          data: { status: "COMPLETED" },
        });
      }

      return updatedRoll;
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: input.rollId,
      oldData: {
        status: roll.status,
        weightKg: roll.weightKg,
      },
      newData: {
        status: updated.status,
        weightKg: updated.weightKg,
        destination: input.destination,
        orderLineId: targetOrderLineId,
      },
    });

    const resolution = await aliasService.resolveForRoll(input.rollId, {
      preferredOrderLineId: targetOrderLineId,
    });

    const label: PackagingLabelPayload = {
      barcode: updated.barcode,
      itemCode: roll.item.code,
      itemName: roll.item.name,
      variantCode: roll.variant?.code ?? null,
      variantName: roll.variant?.name ?? null,
      widthCm: updated.width,
      lengthMeters: netLength,
      weightKg: input.weightKg,
      destination: input.destination,
      customerName: input.destination === "SHIP" ? customerName : null,
      orderNumber: input.destination === "SHIP" ? orderNumber : null,
      batchNumber,
      printedAt: new Date().toISOString(),
      customerVariantLabel: resolution.customerLabel,
      customerVariantCode: resolution.customerCode,
    };

    return {
      success: true,
      data: { roll: updated, label },
      message:
        input.destination === "SHIP"
          ? "Paketleme tamamlandı — sevkiyata hazır"
          : "Paketleme tamamlandı — depoya kaldırıldı",
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async queryOpenRolls(opts: {
    stationKind?: StationKind;
    workOrderStepId?: string;
    rollId?: string;
  }): Promise<PackagingRollSummary[]> {
    const where: Prisma.RollMovementWhereInput = {
      exitedAt: null,
    };
    if (opts.workOrderStepId) {
      where.workOrderStepId = opts.workOrderStepId;
    } else if (opts.stationKind) {
      where.step = { station: { kind: opts.stationKind } };
    }
    if (opts.rollId) {
      where.rollId = opts.rollId;
    }

    const movements = await prisma.rollMovement.findMany({
      where,
      include: {
        roll: {
          include: {
            item: { select: { code: true, name: true } },
            variant: { select: { id: true, code: true, name: true } },
            ownerCustomer: { select: { id: true, name: true } },
            allocations: {
              include: {
                orderLine: {
                  include: { order: { include: { customer: true } } },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
        step: {
          include: {
            workOrder: {
              include: {
                orderLinks: {
                  include: {
                    orderLine: {
                      include: {
                        order: { include: { customer: true } },
                        item: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { enteredAt: "asc" },
    });

    // Varsayılan hedef müşteriyi çöz (resolver ile aynı öncelik sırası —
    // preferredOrderLineId hariç; operatör henüz seçim yapmadı).
    const previewTargets = movements.map((m) => {
      const roll = m.roll;
      let customerId: string | null = null;
      let customerName: string | null = null;
      if (roll.ownerCustomer) {
        customerId = roll.ownerCustomer.id;
        customerName = roll.ownerCustomer.name;
      } else if (roll.allocations.length > 0) {
        const c = roll.allocations[0].orderLine.order.customer;
        customerId = c.id;
        customerName = c.name;
      } else {
        const unique = new Set(
          m.step.workOrder.orderLinks.map(
            (l) => l.orderLine.order.customer.id,
          ),
        );
        if (unique.size === 1) {
          const c = m.step.workOrder.orderLinks[0].orderLine.order.customer;
          customerId = c.id;
          customerName = c.name;
        }
      }
      return { movementId: m.id, customerId, customerName };
    });

    // Alias lookup — tek sorguda topla
    const aliasKeys = previewTargets
      .map((t, i) => {
        const variantId = movements[i].roll.variantId;
        if (!t.customerId || !variantId) return null;
        return { customerId: t.customerId, variantId };
      })
      .filter((x): x is { customerId: string; variantId: string } => x !== null);

    const aliasMap = new Map<string, { label: string; code: string | null }>();
    if (aliasKeys.length > 0) {
      const rows = await prisma.customerVariantAlias.findMany({
        where: {
          isActive: true,
          OR: aliasKeys.map((k) => ({
            customerId: k.customerId,
            variantId: k.variantId,
          })),
        },
        select: {
          customerId: true,
          variantId: true,
          customerLabel: true,
          customerCode: true,
        },
      });
      for (const row of rows) {
        aliasMap.set(`${row.customerId}:${row.variantId}`, {
          label: row.customerLabel,
          code: row.customerCode,
        });
      }
    }

    return movements.map((m, i) => {
      const links = m.step.workOrder.orderLinks;
      const defaultLink = links.length === 1 ? links[0] : null;
      const target = previewTargets[i];
      const aliasKey =
        target.customerId && m.roll.variantId
          ? `${target.customerId}:${m.roll.variantId}`
          : null;
      const alias = aliasKey ? aliasMap.get(aliasKey) : undefined;
      return {
        rollId: m.roll.id,
        barcode: m.roll.barcode,
        itemCode: m.roll.item.code,
        itemName: m.roll.item.name,
        variantCode: m.roll.variant?.code ?? null,
        variantName: m.roll.variant?.name ?? null,
        currentQty: m.roll.currentQty,
        width: m.roll.width,
        weightKg: m.roll.weightKg,
        qualityGrade: m.roll.qualityGrade,
        workOrderId: m.step.workOrderId,
        workOrderBatchNumber: m.step.workOrder.batchNumber,
        stepId: m.workOrderStepId,
        defaultOrderLineId: defaultLink?.orderLineId ?? null,
        defaultCustomerName: defaultLink?.orderLine.order.customer.name ?? null,
        availableOrderLinks: links.map((l) => ({
          orderLineId: l.orderLineId,
          orderNumber: l.orderLine.order.orderNumber,
          customerName: l.orderLine.order.customer.name,
          itemCode: l.orderLine.item?.code ?? "",
          itemName: l.orderLine.item?.name ?? "",
          requestedQty: l.orderLine.quantity,
        })),
        ownerCustomerId: m.roll.ownerCustomer?.id ?? null,
        ownerCustomerName: m.roll.ownerCustomer?.name ?? null,
        previewCustomerName: target.customerName,
        previewCustomerLabel: alias?.label ?? null,
        previewCustomerCode: alias?.code ?? null,
      };
    });
  }
}
