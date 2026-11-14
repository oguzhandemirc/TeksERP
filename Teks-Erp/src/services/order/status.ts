// =============================================================================
// Order Service / status
// =============================================================================
// Elle tamamlama ve yeniden açma.
// `order.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../order.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { ApiResponse } from "../../types/api.types";
import { AppError } from "../../utils/app-error";
import {
  OrderStatus,
} from "@prisma/client";
import {
  recomputeOrderStatusTx,
} from "../helpers/order-status.helper";
import type { OrderServiceThis } from "./shared";
import { emitOrderTerminalTx } from "../notification-sources/satis";

export async function manualComplete(this: OrderServiceThis, 
    id: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();
    if (!reason.trim()) throw AppError.badRequest("Tamamlama sebebi gerekli");

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, orderNumber: true, status: true, completedAt: true, customerId: true },
    });
    if (!order) throw AppError.notFound("Sipariş bulunamadı");
    this.assertNoActiveShipments(
      await this.getActiveShipmentLinks(id),
      "Manuel kapatma"
    );
    if (order.status === OrderStatus.COMPLETED) {
      throw AppError.badRequest("Sipariş zaten tamamlanmış");
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw AppError.badRequest("İptal edilmiş sipariş kapatılamaz");
    }
    if (order.status === OrderStatus.PENDING) {
      throw AppError.badRequest("Onaysız sipariş manuel tamamlanamaz");
    }

    // ATOMİK CLAIM (check-then-act DEĞİL — kardeş cancelWithActions ile parite):
    // terminal/PENDING reddini yazmanın WHERE'ine koy. Eşzamanlı cancelWithActions
    // ile yarışta manualComplete bayat non-terminal okuyup CANCELLED siparişi
    // sessizce COMPLETED'a ezemesin (yıkıcı iptalin geri alınması engellenir).
    await prisma.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({
        where: {
          id,
          status: {
            notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED, OrderStatus.PENDING],
          },
        },
        data: {
          status: OrderStatus.COMPLETED,
          completedAt: order.completedAt ?? new Date(),
          manualClosedById: userId,
          manualCloseReason: reason.trim(),
        },
      });
      if (claim.count === 0) {
        const fresh = await tx.order.findUnique({ where: { id }, select: { status: true } });
        throw AppError.conflict(
          `Sipariş bu sırada ${fresh?.status} durumuna geçti — manuel tamamlanamadı. Sayfayı yenileyin.`
        );
      }
      await emitOrderTerminalTx(tx, id, OrderStatus.COMPLETED, userId);
    });
    const updated = await prisma.order.findUnique({ where: { id } });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: { status: order.status },
      newData: {
        status: updated!.status,
        manualClosedById: userId,
        manualCloseReason: updated!.manualCloseReason,
      },
    });

    return {
      success: true,
      data: updated!,
      message: `Sipariş manuel tamamlandı: ${order.orderNumber}`,
    };
  }

export async function reopen(this: OrderServiceThis, 
    id: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        manualClosedById: true,
      },
    });
    if (!order) throw AppError.notFound("Sipariş bulunamadı");
    if (!order.manualClosedById) {
      throw AppError.badRequest(
        "Bu sipariş manuel kapatılmamış — yeniden açma uygulanamaz"
      );
    }

    // Manuel iz silinir; sonra recomputeOrderStatusTx sevk sayaçlarına göre
    // status (APPROVED/PARTIAL_SHIPPED) ve shippedQty'yi senkronize eder.
    const updated = await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM (check-then-act DEĞİL — manualComplete/cancelWithActions paritesi):
      // yalnız HÂLÂ manuel-kapalı sipariş yeniden açılır. tx-dışı manualClosedById
      // okuması UX; iki paralel reopen yarışında biri count===0 → 409 (çift audit/
      // koşulsuz APPROVED yazımı engellenir).
      const claim = await tx.order.updateMany({
        where: { id, manualClosedById: { not: null } },
        data: {
          manualClosedById: null,
          manualCloseReason: null,
          completedAt: null,
          status: OrderStatus.APPROVED,
        },
      });
      if (claim.count === 0) {
        throw AppError.conflict(
          "Sipariş bu sırada durum değiştirdi — yeniden açılamadı, sayfayı yenileyin"
        );
      }
      await recomputeOrderStatusTx(tx, id);
      return tx.order.findUniqueOrThrow({ where: { id } });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: { status: order.status, manualClosedById: order.manualClosedById },
      newData: {
        status: updated.status,
        manualClosedById: null,
        reopenReason: reason.trim() || null,
      },
    });

    return {
      success: true,
      data: updated,
      message: `Sipariş yeniden açıldı: ${order.orderNumber}`,
    };
  }
