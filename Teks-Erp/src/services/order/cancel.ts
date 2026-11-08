// =============================================================================
// Order Service / cancel
// =============================================================================
// Sipariş iptal önizlemesi (iş emri aksiyon matrisi). cancelWithActions cephede kalır — göreli dinamik import yolu.
// `order.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../order.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { ApiResponse } from "../../types/api.types";
import { AppError } from "../../utils/app-error";
import {
  OrderStatus,
  Prisma,
} from "@prisma/client";
import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import { computeAllowedActions, pickDefaultAction, type OrderServiceThis } from "./shared";

export async function getCancelPreview(this: OrderServiceThis, orderId: string): Promise<ApiResponse<unknown>> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        lines: {
          select: {
            id: true,
            workOrderLinks: {
              where: ACTIVE_ORDER_LINK,
              select: {
                workOrder: {
                  select: {
                    id: true,
                    workOrderNumber: true,
                    status: true,
                    type: true,
                    targetQuantity: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) throw AppError.notFound("Sipariş bulunamadı");

    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.COMPLETED
    ) {
      throw AppError.conflict(
        `Sipariş ${order.status === "CANCELLED" ? "zaten iptal" : "tamamlanmış"} — iptal edilemez`
      );
    }

    // WO bazında grupla — bir WO'ya birden fazla satırdan bağ olabilir.
    const woMap = new Map<
      string,
      {
        id: string;
        workOrderNumber: string;
        status: string;
        /** WO'nun hedef üretim metrajı (link-only model: per-sipariş tahsis yok). */
        targetQuantity: Prisma.Decimal | null;
      }
    >();
    for (const line of order.lines) {
      for (const link of line.workOrderLinks) {
        const wo = link.workOrder;
        if (woMap.has(wo.id)) continue;
        woMap.set(wo.id, {
          id: wo.id,
          workOrderNumber: wo.workOrderNumber,
          status: wo.status,
          targetQuantity:
            wo.targetQuantity != null ? new Prisma.Decimal(wo.targetQuantity) : null,
        });
      }
    }

    // PERF (N+1 giderildi): eskiden her WO için 2 ayrı sorgu (order.findMany +
    // roll.count) `Promise.all(map(async))` içinde dönüyordu → paylaşımlı siparişte
    // 2N round-trip + havuz baskısı. Artık WO sayısından bağımsız 3 sınırlı sorgu:
    //   (a) bu siparişin DIŞINDA bu WO'lara bağlı diğer siparişler,
    //   (b) bu WO'ların step'leri, (c) o step'lerde üretilmiş rulo sayısı (groupBy).
    // woId başına sonuçlar bellekte toplanır.
    const woIds = Array.from(woMap.keys());

    // (a) Diğer siparişler — hangi WO'ya bağlı olduklarını da çekip woId→Set kur.
    const otherOrderRows =
      woIds.length === 0
        ? []
        : await prisma.order.findMany({
            where: {
              id: { not: orderId },
              lines: {
                some: { workOrderLinks: { some: { ...ACTIVE_ORDER_LINK, workOrderId: { in: woIds } } } },
              },
            },
            select: {
              orderNumber: true,
              lines: {
                where: { workOrderLinks: { some: { ...ACTIVE_ORDER_LINK, workOrderId: { in: woIds } } } },
                select: { workOrderLinks: { where: ACTIVE_ORDER_LINK, select: { workOrderId: true } } },
              },
            },
          });
    const otherOrdersByWo = new Map<string, Set<string>>();
    for (const ord of otherOrderRows) {
      for (const line of ord.lines) {
        for (const link of line.workOrderLinks) {
          if (!woMap.has(link.workOrderId)) continue;
          let set = otherOrdersByWo.get(link.workOrderId);
          if (!set) {
            set = new Set<string>();
            otherOrdersByWo.set(link.workOrderId, set);
          }
          set.add(ord.orderNumber);
        }
      }
    }

    // (b+c) WO başına üretilmiş rulo sayısı: step'leri çek, roll.groupBy ile
    //       producedInStepId üzerinden say ([producedInStepId,status] index'li).
    const steps =
      woIds.length === 0
        ? []
        : await prisma.workOrderStep.findMany({
            where: { workOrderId: { in: woIds } },
            select: { id: true, workOrderId: true },
          });
    const stepToWo = new Map<string, string>();
    for (const s of steps) stepToWo.set(s.id, s.workOrderId);

    const rollGroups =
      steps.length === 0
        ? []
        : await prisma.roll.groupBy({
            by: ["producedInStepId"],
            where: { producedInStepId: { in: steps.map((s) => s.id) } },
            _count: { _all: true },
          });
    const rollCountByWo = new Map<string, number>();
    for (const g of rollGroups) {
      const wid = g.producedInStepId ? stepToWo.get(g.producedInStepId) : undefined;
      if (!wid) continue;
      rollCountByWo.set(wid, (rollCountByWo.get(wid) ?? 0) + g._count._all);
    }

    const affectedWorkOrders = Array.from(woMap.values()).map((wo) => {
      const otherOrderNumbers = Array.from(otherOrdersByWo.get(wo.id) ?? []);
      const isSoleOrder = otherOrderNumbers.length === 0;
      const allowedActions = computeAllowedActions(wo.status, isSoleOrder);
      const defaultAction = pickDefaultAction(wo.status, isSoleOrder);

      return {
        id: wo.id,
        workOrderNumber: wo.workOrderNumber,
        status: wo.status,
        targetQuantity: wo.targetQuantity,
        isSoleOrder,
        otherOrdersCount: otherOrderNumbers.length,
        otherOrderNumbers,
        producedRollCount: rollCountByWo.get(wo.id) ?? 0,
        allowedActions,
        defaultAction,
      };
    });

    // Aktif sevkiyat bağları — somut listele (uygulamada cancelWithActions/
    // softDelete bu bağ varken 409 ile bloklar; preview operatöre nedeni gösterir).
    const activeShipments = await this.getActiveShipmentLinks(orderId);

    return {
      success: true,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        affectedWorkOrders,
        activeShipments,
        canCancel: activeShipments.length === 0,
      },
    };
  }
