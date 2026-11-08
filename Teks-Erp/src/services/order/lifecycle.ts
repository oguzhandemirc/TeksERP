// =============================================================================
// Order Service / lifecycle
// =============================================================================
// Aktif sevkiyat bağı kapısı ve sipariş silme (hardDelete → softDelete = CANCELLED geçişi).
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
  ShipmentStatus,
  WorkOrderStatus,
  WorkOrderType,
} from "@prisma/client";
import { touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { markTravelerCardDirtyTx } from "../helpers/traveler-card-dirty.helper";
import { ACTIVE_ORDER_LINK, activeOrderLinkCount, unlinkOrderLinesTx } from "../helpers/order-link.helper";
import { TERIM } from "../../constants/terim";
import type { OrderServiceThis } from "./shared";

export async function getActiveShipmentLinks(
    orderId: string
  ): Promise<Array<{ id: string; shipmentNo: string; status: ShipmentStatus }>> {
    // ÇUVAL HAVUZU: "aktif" = donmuş tahsisli sevkiyat (PLANNED). Rezerv YOK
    // (packedQty/rebalance kalktı) — açık miktar sevkte düşer; iptal serbest bırakır.
    const links = await prisma.shipmentOrder.findMany({
      where: {
        orderId,
        shipment: {
          status: ShipmentStatus.PLANNED,
        },
      },
      select: {
        shipment: { select: { id: true, shipmentNo: true, status: true } },
      },
    });
    return links.map((l) => l.shipment);
  }

export function assertNoActiveShipments(
    activeShipments: Array<{ shipmentNo: string; status: ShipmentStatus }>,
    eylem: string
  ): void {
    if (activeShipments.length === 0) return;
    const list = activeShipments.map((s) => `${s.shipmentNo} (${s.status})`).join(", ");
    throw AppError.conflict(
      `Sipariş aktif sevkiyat(lar)a bağlı: ${list}. ${eylem} için önce siparişi sevkiyattan çıkarın veya sevkiyatı tamamlayın/iptal edin.`
    );
  }

export async function hardDelete(this: OrderServiceThis, id: string, userId?: string): Promise<ApiResponse<unknown>> {
    return this.softDelete(id, userId);
  }

export async function softDelete(this: OrderServiceThis, 
    id: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    this.assertNoActiveShipments(await this.getActiveShipmentLinks(id), "İptal");
    const oldRecord = await prisma.order.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            workOrderLinks: {
              where: ACTIVE_ORDER_LINK,
              include: { workOrder: true },
            },
          },
        },
      },
    });

    if (!oldRecord) {
      return { success: false, data: null, message: "Sipariş bulunamadı" };
    }

    const allLinks = oldRecord.lines.flatMap((line) => line.workOrderLinks);
    const blockingStatuses = new Set(["IN_PROGRESS", "COMPLETED"]);
    const blockingWOs = allLinks
      .map((l) => l.workOrder)
      .filter((wo) => blockingStatuses.has(wo.status));

    if (blockingWOs.length > 0) {
      const workOrderNumbers = [...new Set(blockingWOs.map((w) => w.workOrderNumber))].join(", ");
      throw AppError.conflict(
        `Bu siparişe bağlı aktif/tamamlanmış ${TERIM.terbiyeIsEmri.cogulKucuk} var: ${workOrderNumbers}. Önce onları iptal edin.`
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      // F142: atomik claim ÖNCE — çift-paralel iptal ve araya giren COMPLETED
      // (manualComplete/recompute) koşulsuz CANCELLED ezmesini kapat.
      const cancelClaim = await tx.order.updateMany({
        where: { id, status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] } },
        // `cancelledAt` HER iptal yolunda damgalanır (bu generic yol dahil):
        // "dönemde kaç iptal" sorusu `orderDate`e sorulamaz ve damgasız satır
        // rapordan sessizce düşerdi. SEBEP yalnız operatörün seçtiği yolda
        // (`cancelWithActions`) dolar — burada uydurulmaz.
        data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
      });
      if (cancelClaim.count === 0) {
        const fresh = await tx.order.findUnique({ where: { id }, select: { status: true } });
        throw AppError.conflict(
          `Sipariş bu sırada ${
            fresh?.status === OrderStatus.COMPLETED ? "tamamlandı" : "iptal edildi"
          }, tekrar iptal edilemez. Sayfayı yenileyin.`,
        );
      }


      // BU siparişin satır bağlarını TAZE oku (orderLineId scope — shared WO'nun
      // başka sipariş bağları korunur). Linkli WO satırlarını sıralı kilitle
      // (workorder softDelete deseniyle simetrik) → eşzamanlı WO status geçişi serileşir.
      const myLinks = await tx.workOrderToOrderLine.findMany({
        where: { orderLine: { orderId: id }, ...ACTIVE_ORDER_LINK },
        select: { workOrderId: true, orderLineId: true },
      });
      const woIds = [...new Set(myLinks.map((l) => l.workOrderId))].sort();
      for (const wid of woIds) await touchWorkOrderTx(tx, wid); // döngü — Promise.all(tx.*) YASAK
      const woRows = await tx.workOrder.findMany({
        where: { id: { in: woIds } },
        select: { id: true, status: true, workOrderNumber: true },
      });
      const woById = new Map(woRows.map((w) => [w.id, w]));
      const blocking = woRows.filter((w) => blockingStatuses.has(w.status));
      if (blocking.length > 0) {
        const workOrderNumbers = [...new Set(blocking.map((w) => w.workOrderNumber))].join(", ");
        throw AppError.conflict(
          `Bu siparişe bağlı aktif/tamamlanmış ${TERIM.terbiyeIsEmri.cogulKucuk} var: ${workOrderNumbers}. Önce onları iptal edin.`,
        );
      }
      // BU siparişin bağlarını TERMİNAL OLMAYAN her iş emrinden kopar (2026-08-21).
      // Eskiden yalnız `status === "PLANNED"` çiftleri koparılıyordu; kardeş yol
      // `cancelWithActions` ise UNLINK/CONVERT/CANCEL üçünde de bağı siliyor. İki
      // yolun aynı cümleyi kurması gerekir: **iptal edilmiş siparişin bağı hiçbir
      // canlı/bitmiş iş emrinde kalmasın.** CANCELLED/SUPERSEDED iş emirleri kapsam
      // DIŞI — onlar tarihçedir, bağları da tarihsel izdir (silmek geçmişi bozar).
      // ⚠️ Bugün küme fiilen PLANNED'a eşittir: yukarıdaki `blocking` guard'ı
      // IN_PROGRESS/COMPLETED bağlı siparişi zaten 409 ile reddediyor. Kural yine de
      // kanonik yazıldı — guard gevşerse davranış sessizce eskiye dönmesin.
      const livePairs = myLinks.filter((l) => {
        const st = woById.get(l.workOrderId)?.status;
        return st !== undefined && st !== WorkOrderStatus.CANCELLED && st !== WorkOrderStatus.SUPERSEDED;
      });
      const typeChangedWorkOrderIds: string[] = [];
      if (livePairs.length > 0) {
        // Bağ SİLİNMEZ, damgalanır (③a, 2026-09-14): sipariş silinse de "bu iş emri o
        // sipariş için açılmıştı" izi durur (K5 şerhinin uygulama katmanı yarısı).
        await unlinkOrderLinesTx(tx, { pairs: livePairs, reason: "ORDER_DELETE", userId: userId ?? null });
        // Bağı kopan HER iş emri için (döngü — Promise.all(tx.*) YASAK):
        //   ① refakat kartı bayat — kartta sipariş bloğu + tip basılı,
        //   ② son bağı kalktıysa tip STOK'a döner (TİP = BAĞIN AYNASI;
        //      `cancelWithActions` UNLINK_ONLY dalı + `unlinkOrderLine` emsali).
        for (const wid of [...new Set(livePairs.map((l) => l.workOrderId))].sort()) {
          await markTravelerCardDirtyTx(tx, wid);
          const remaining = await activeOrderLinkCount(tx, wid);
          if (remaining > 0) continue;
          // Atomik: `updateMany WHERE type=ORDER_PRODUCTION` — zaten STOK'sa dokunmaz,
          // iptal/devredilmiş atlanır. `targetItemId: { not: null }` STOK'un değişmezi:
          // hedef kumaşı olmayan iş emri çevrilemez (sessizce ORDER kalır, count=0).
          const flipped = await setWorkOrderTypeTx(tx, wid, WorkOrderType.STOCK_PRODUCTION, {
            where: {
              status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
              targetItemId: { not: null },
            },
            ctx: { trigger: "ORDER_DELETE", userId, refType: "ORDER", refId: id },
          });
          if (flipped === "CHANGED") typeChangedWorkOrderIds.push(wid);
        }
      }
      const order = await tx.order.findUnique({ where: { id } });
      return { order: order!, unlinkedCount: livePairs.length, typeChangedWorkOrderIds };
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: oldRecord as unknown as Record<string, unknown>,
      newData: {
        status: "CANCELLED",
        unlinkedWorkOrderCount: updated.unlinkedCount,
        typeChangedWorkOrderIds: updated.typeChangedWorkOrderIds,
      },
    });

    return {
      success: true,
      data: updated.order,
      message:
        updated.unlinkedCount > 0
          ? `Sipariş iptal edildi. ${updated.unlinkedCount} ${TERIM.terbiyeIsEmri.tekilKucuk} bağlantısı koparıldı.` +
            (updated.typeChangedWorkOrderIds.length > 0
              ? ` ${updated.typeChangedWorkOrderIds.length} ${TERIM.terbiyeIsEmri.tekilKucuk} stok üretimine döndü.`
              : "")
          : "Sipariş iptal edildi",
    };
  }
