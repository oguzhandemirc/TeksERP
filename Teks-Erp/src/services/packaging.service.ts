// =============================================================================
// TeksERP - Packaging (Paket/Tartı/Etiket) Service
// =============================================================================
// Paketleme WO'dan bağımsız fulfillment akışıdır. Tambur sonrası rulo
// WAREHOUSE'a düşer ve WO'nun görevi biter. Planlamacı PackagingQueue
// üzerinden rulayı bir siparişe (veya stoğa) atar. Operatör kuyruktan sıradakini
// alır, tartar, finalize eder → rulo READY_FOR_SHIP'e geçer.
//
// finalize:
//   - WorkOrderStep'e bağlanmaz (rota artık üretim istasyonları için).
//   - RollMovement yazmaz (RollMovement production transition audit'i).
//   - allocation yazılır (sipariş atamasıyla), roll status güncellenir,
//     PackagingQueue satırı DONE'a çekilir.
//   - Audit: AuditService.log + PackagingQueue tarihçesi.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { Roll, RollStatus } from "@prisma/client";
import { CustomerVariantAliasService } from "./customer-variant-alias.service";
import { PackagingQueueService } from "./packaging-queue.service";

const packagingQueueService = new PackagingQueueService();

const aliasService = new CustomerVariantAliasService();

export interface PackagingFinalizeInput {
  rollId: string;
  weightKg: number;
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
   * Kartela tartı simülasyonu (Faz 1). length × width üzerinden
   * yaklaşık ağırlık üretir; operatör manuel override yapabilir.
   */
  async simulateWeighSwatch(
    swatchId: string
  ): Promise<ApiResponse<{ weightKg: number }>> {
    const sw = await prisma.swatch.findUnique({
      where: { id: swatchId },
      select: { length: true, width: true },
    });
    if (!sw) throw AppError.notFound("Kartela bulunamadı");

    // length+width cm cinsinden; m²→kg: ortalama 0.25 kg/m² (Faz 1 mock)
    const widthM = (sw.width ?? 150) / 100; // varsayılan 150cm
    const lengthM = sw.length / 100;
    const areaM2 = widthM * lengthM;
    const weightKg = Math.max(0.005, Number((areaM2 * 0.25).toFixed(3)));

    return { success: true, data: { weightKg } };
  }

  /**
   * "Bitti" — depodaki rulonun paketleme RollMovement'ini atomic olarak
   * açıp kapatır, kilo uygulanır, top READY_FOR_SHIP olur. Bölüştürme yok;
   * bütün top tek hedefe gider. Paketleme adımı iş emrinin önceden
   * tanımlanmış adımıdır; rulonun en son hareketi (Tambur çıkışı) üzerinden
   * iş emri çözümlenir.
   */
  async finalize(
    input: PackagingFinalizeInput,
    userId?: string
  ): Promise<ApiResponse<PackagingFinalizeResult>> {
    if (input.weightKg <= 0) {
      throw AppError.badRequest("Kilo 0'dan büyük olmalı");
    }

    // Paketleme WO'dan bağımsız fulfillment akışı — sadece rulonun kendisi +
    // planlama kuyruğundaki atama (plannedOrder) üzerinden çalışır.
    const roll = await prisma.roll.findUnique({
      where: { id: input.rollId },
      include: {
        item: true,
        variant: true,
        ownerCustomer: { select: { id: true, name: true } },
        allocations: true,
        packagingQueueEntries: {
          where: { status: { in: ["WAITING", "TAKEN"] } },
          include: {
            plannedOrder: {
              include: {
                customer: true,
                lines: { select: { id: true, itemId: true } },
              },
            },
          },
          take: 1,
        },
      },
    });

    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.status !== RollStatus.WAREHOUSE) {
      throw AppError.badRequest(
        `Top depoda değil (durum: ${roll.status}) — önce Tambur'dan çıkması gerekir`
      );
    }

    const isServiceOwned = !!roll.ownerCustomerId;
    const queueEntry = roll.packagingQueueEntries[0] ?? null;
    const plannedOrder = queueEntry?.plannedOrder ?? null;

    // Hedef sipariş satırı operatör tarafından AÇIKÇA seçilmelidir — otomatik
    // eşleştirme kaldırıldı (sessiz hayalet rulo üretiyordu). Fason rulolar
    // sahibine gider, allocation oluşturulmaz.
    const targetOrderLineId: string | null = input.orderLineId ?? null;
    if (isServiceOwned && targetOrderLineId) {
      throw AppError.badRequest(
        "Müşteri malı (fason) top bir siparişe bağlanamaz — doğrudan sahibine sevk edilir"
      );
    }
    if (targetOrderLineId && plannedOrder) {
      const belongs = plannedOrder.lines.some((l) => l.id === targetOrderLineId);
      if (!belongs) {
        throw AppError.badRequest(
          "Seçilen sipariş satırı planlanan siparişe ait değil"
        );
      }
    }

    const netLength = roll.currentQty;
    const customerName = isServiceOwned
      ? roll.ownerCustomer?.name ?? null
      : plannedOrder?.customer.name ?? null;
    const orderNumber = isServiceOwned ? null : plannedOrder?.orderNumber ?? null;

    const updated = await prisma.$transaction(async (tx) => {
      // Mevcut tahsisleri temizle, yenisini (varsa) ekle — "bütün top tek hedef"
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

      const updatedRoll = await tx.roll.update({
        where: { id: input.rollId },
        data: {
          status: RollStatus.READY_FOR_SHIP,
          currentStepId: null,
          weightKg: input.weightKg,
          grossWeightKg: input.weightKg,
          packagingDate: new Date(),
        },
      });

      // Kuyruk satırı varsa kapat — paketleme bitti.
      await packagingQueueService.markDoneByRollId(input.rollId, userId, tx);

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
      customerName,
      orderNumber,
      batchNumber: "",
      printedAt: new Date().toISOString(),
      customerVariantLabel: resolution.customerLabel,
      customerVariantCode: resolution.customerCode,
    };

    return {
      success: true,
      data: { roll: updated, label },
      message: "Paketleme tamamlandı — sevkiyata hazır",
    };
  }

}
