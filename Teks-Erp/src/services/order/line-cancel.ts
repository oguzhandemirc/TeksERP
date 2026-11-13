// =============================================================================
// Order Service / line-cancel
// =============================================================================
// Sipariş kalemi iptali: kalem yükleme, iptal önizlemesi, cancelOrderLine.
// `order.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../order.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { setWorkOrderTypeTx } from "../helpers/workorder-event.helper";
import { AuditService } from "../audit.service";
import { ApiResponse } from "../../types/api.types";
import { AppError } from "../../utils/app-error";
import {
  OrderStatus,
  Prisma,
  ReasonPresetKind,
  WorkOrderStatus,
  WorkOrderType,
} from "@prisma/client";
import { resolveReasonCode } from "../reason-preset.service";
import {
  recomputeOrderStatusTx,
  touchOrderLinesTx,
} from "../helpers/order-status.helper";
import { markTravelerCardDirtyTx } from "../helpers/traveler-card-dirty.helper";
import { ACTIVE_ORDER_LINK, activeOrderLinkCount, unlinkOrderLinesTx } from "../helpers/order-link.helper";
import { TERIM } from "../../constants/terim";
import type { OrderServiceThis } from "./shared";
import { guardLineCancelPreview, lineCancelTokenFor } from "./line-cancel-token";

export async function loadLineForCancel(orderId: string, lineId: string) {
    const line = await prisma.orderLine.findUnique({
      where: { id: lineId },
      select: {
        id: true,
        orderId: true,
        quantity: true,
        shippedQty: true,
        cancelledAt: true,
        width: true,
        item: { select: { name: true } },
        color: { select: { name: true } },
        order: { select: { id: true, orderNumber: true, status: true } },
        workOrderLinks: {
          where: ACTIVE_ORDER_LINK,
          select: {
            workOrder: {
              select: {
                id: true,
                workOrderNumber: true,
                status: true,
                type: true,
                targetItemId: true,
                _count: { select: { orderLinks: { where: ACTIVE_ORDER_LINK } } },
              },
            },
          },
        },
      },
    });
    if (!line || line.orderId !== orderId) {
      throw AppError.notFound("Sipariş kalemi bulunamadı.");
    }
    return line;
  }

export async function getLineCancelPreview(this: OrderServiceThis, orderId: string, lineId: string): Promise<ApiResponse<unknown>> {
    const line = await this.loadLineForCancel(orderId, lineId);
    const requested = new Prisma.Decimal(line.quantity);
    const shipped = new Prisma.Decimal(line.shippedQty);
    const remaining = Prisma.Decimal.max(0, requested.minus(shipped));

    const blockers: string[] = [];
    if (line.cancelledAt !== null) blockers.push("Bu kalem zaten iptal edilmiş.");
    if (line.order.status === OrderStatus.CANCELLED) {
      blockers.push("Siparişin tamamı zaten iptal edilmiş.");
    }
    if (remaining.lessThanOrEqualTo(0)) {
      blockers.push(
        "Kalemin tamamı sevk edilmiş — iptal edilecek bir şey kalmadı. " +
          "Mal geri geldiyse iade yolunu kullanın.",
      );
    }

    // Aktif WO bağları — CANCELLED/SUPERSEDED sayılmaz (zaten ölü).
    const affectedWorkOrders = line.workOrderLinks
      .map((l) => l.workOrder)
      .filter((w) => w.status !== WorkOrderStatus.CANCELLED && w.status !== "SUPERSEDED")
      .map((w) => {
        // Bu kalem WO'nun SON bağıysa iş emri stok üretimine döner
        // ("tip = bağın aynası" kuralı, 2026-08-21).
        const willBecomeStock = w.type === WorkOrderType.ORDER_PRODUCTION && w._count.orderLinks === 1;
        // TEK SERT ENGEL: hedef kumaşı olmayan WO stok üretimine DÖNEMEZ.
        // Sessizce bağlı bırakmak "tip = bağın aynası" invariantını bozardı.
        const blockedNoTargetItem = willBecomeStock && !w.targetItemId;
        if (blockedNoTargetItem) {
          blockers.push(
            `${w.workOrderNumber} bu kalemin son bağı ve hedef kumaşı tanımlı değil — ` +
              `stok üretimine dönemez. Önce ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} hedef kumaşı seçin.`,
          );
        }
        return {
          id: w.id,
          workOrderNumber: w.workOrderNumber,
          status: w.status,
          willBecomeStock,
          blockedNoTargetItem,
        };
      });

    // Bu kalem iptal edilince siparişte aktif kalem kalıyor mu?
    const otherActive = await prisma.orderLine.count({
      where: { orderId, cancelledAt: null, id: { not: lineId } },
    });
    const isLastActiveLine = otherActive === 0 && line.cancelledAt === null;
    const orderShipped = new Prisma.Decimal(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { shippedQty: true } }))
        .shippedQty,
    );

    return {
      success: true,
      data: {
        lineId: line.id,
        orderNumber: line.order.orderNumber,
        itemName: line.item.name,
        colorName: line.color?.name ?? null,
        width: line.width == null ? null : Number(line.width),
        requestedQty: Number(requested),
        shippedQty: Number(shipped),
        /** İptal edilecek metraj — sevk edilen DÜŞMEZ, "kalanı iptal". */
        remainingQty: Number(remaining),
        affectedWorkOrders,
        isLastActiveLine,
        /** Son kalemse siparişin düşeceği statü (kullanıcı kuralı). */
        resultingOrderStatus: isLastActiveLine
          ? orderShipped.greaterThan(0)
            ? OrderStatus.COMPLETED
            : OrderStatus.CANCELLED
          : null,
        blockers,
        canCancel: blockers.length === 0,
        // Uygulamaya `expectedPreviewToken` olarak geri yollanır; tutmazsa 409 CANCEL_PREVIEW_STALE.
        previewToken: await lineCancelTokenFor(orderId, lineId),
      },
    };
  }

// eslint-disable-next-line max-params -- `this` bağlam bildirimi parametre değil; özgün metot 4 parametreli
export async function cancelOrderLine(this: OrderServiceThis, 
    orderId: string,
    lineId: string,
    userId?: string,
    reason?: { reasonCode?: string | null; reasonText?: string | null; expectedPreviewToken?: string | null },
  ): Promise<ApiResponse<unknown>> {
    const previewGuard = await guardLineCancelPreview(orderId, lineId, reason?.expectedPreviewToken); // token yoksa no-op
    const preview = (await this.getLineCancelPreview(orderId, lineId)).data as {
      canCancel: boolean;
      blockers: string[];
      affectedWorkOrders: Array<{ id: string; willBecomeStock: boolean }>;
    };
    if (!preview.canCancel) {
      throw AppError.badRequest(preview.blockers.join(" "));
    }

    // Sebep çözümü TX DIŞINDA (top/sipariş iptalindeki kural): önbellek okuması
    // + olası tazeleme kilidi uzatmasın; geçersiz kod iptali hiç başlatmadan durdurur.
    const { code: cancelReasonCode, text: cancelReasonText } = reason
      ? await resolveReasonCode(ReasonPresetKind.ORDER_CANCEL, reason)
      : { code: null, text: null };

    const affectedWoIds = preview.affectedWorkOrders.map((w) => w.id);

    await prisma.$transaction(async (tx) => {
      await previewGuard(tx);
      // ATOMİK CLAIM: iki paralel iptal isteğinde ikincisi 409 almalı
      // (check-then-act YASAK — CLAUDE.md durum geçişi kuralı).
      const claim = await tx.orderLine.updateMany({
        where: { id: lineId, cancelledAt: null },
        data: {
          cancelledAt: new Date(),
          cancelReason: cancelReasonText,
          cancelReasonCode,
          cancelledById: userId ?? null,
        },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Bu kalem bu sırada iptal edildi. Sayfayı yenileyin.");
      }

      // Bağları kopar + gerekiyorsa WO'yu stok üretimine çevir.
      for (const woId of affectedWoIds) {
        // Bağ SİLİNMEZ, damgalanır (③a, 2026-09-14) — kalem iptali izi satırda durur.
        await unlinkOrderLinesTx(tx, { workOrderId: woId, orderLineId: lineId, reason: "ORDER_LINE_CANCEL", userId: userId ?? null });
        // Taze AÇIK sayım: yarışta araya yeni bağ girdiyse tip ORDER kalmalı
        // (`unlinkOrderLine` ile aynı atomik desen).
        const remaining = await activeOrderLinkCount(tx, woId);
        if (remaining === 0) {
          await setWorkOrderTypeTx(tx, woId, WorkOrderType.STOCK_PRODUCTION, {
            ctx: { trigger: "ORDER_LINE_CANCEL", userId, refType: "ORDER_LINE", refId: lineId },
          });
        }
        await markTravelerCardDirtyTx(tx, woId);
      }

      // Karşılanma + statü tek yazma noktasından (son-kalem kuralı orada).
      const lineIds = (
        await tx.orderLine.findMany({ where: { orderId }, select: { id: true } })
      ).map((l) => l.id);
      await touchOrderLinesTx(tx, lineIds);
      await recomputeOrderStatusTx(tx, orderId);
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ORDER_LINE",
      recordId: lineId,
      newData: {
        cancelled: true,
        orderId,
        cancelReasonCode,
        cancelReason: cancelReasonText,
        unlinkedWorkOrderIds: affectedWoIds,
      },
    }).catch(() => undefined);

    const fresh = await this.findById(orderId);
    return {
      success: true,
      data: fresh.data,
      message:
        affectedWoIds.length > 0
          ? `Kalem iptal edildi. ${affectedWoIds.length} ${TERIM.terbiyeIsEmri.tekilKucuk} bağı koparıldı.`
          : "Kalem iptal edildi.",
    };
  }
