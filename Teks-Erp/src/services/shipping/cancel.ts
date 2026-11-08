// =============================================================================
// Shipping Service / cancel
// =============================================================================
// Planlı sevkiyat iptali: önizleme, cancelPlannedShipmentTx, cancelShipment.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================

import {
  Prisma,
  ShipmentStatus,
  ShipmentEventType,
  SwatchEventType,
  LoadUnitKind,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { writeShipmentEvent } from "../helpers/shipment-event.helper";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import {
  lockShipmentScopeTx,
} from "../helpers/shipment-locks.helper";
import {
  eIrsaliyePreviewRow,
  eIrsaliyeUndoBlock,
  logVoidedEIrsaliye,
  readLiveEIrsaliyeForShipmentTx,
  voidLocalEIrsaliyeTx,
  type VoidedEIrsaliye,
} from "../e-irsaliye/e-irsaliye-shipment.helper";
import {
  D0,
} from "../helpers/allocation.helper";
import { recomputeOrderStatusForOrdersTx, touchOrderLinesTx } from "../helpers/order-status.helper";
import {
  readPackingLotSettings,
} from "../helpers/packing-group.helper";
import {
  reopenLotsForSacksTx,
} from "../packing-lot.service";
import { ApiResponse } from "../../types/api.types";
import { ACTIVE_SACK_ALLOCATION, clearShipmentAllocationsTx } from "../helpers/sack-allocation.helper";
import { LIVE_LOAD_UNIT_WHERE } from "../helpers/load-unit.helper";
import { transitionSwatchesTx } from "../helpers/swatch-event.helper";
import type { ShippingServiceThis } from "./shared";

/**
 * Sevkiyat iptalinde SACK-dışı birimleri ÇÖZER: toplar rafa (sackId + shipmentId null),
 * birim sevkiyatında kalır ve damgalanır. Çağıran sevkiyatın çuval satırlarını
 * kilitlemiş olmalı. Dönüş: çözülen birim id'leri.
 */
export async function dissolveLoadUnitsTx(tx: Prisma.TransactionClient, shipmentId: string, userId: string | null): Promise<string[]> {
  const loose = await tx.sack.findMany({
    where: { shipmentId, unitKind: { not: LoadUnitKind.SACK }, dissolvedAt: null },
    select: { id: true },
  });
  const ids = loose.map((u) => u.id);
  if (ids.length === 0) return ids;
  await tx.roll.updateMany({ where: { sackId: { in: ids } }, data: { sackId: null, shipmentId: null } });
  await tx.sack.updateMany({ where: { id: { in: ids }, dissolvedAt: null }, data: { dissolvedAt: new Date(), dissolvedById: userId } });
  return ids;
}

export async function getCancelPreview(shipmentId: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true, shipmentNo: true, status: true,
        customer: { select: { name: true } },
        branch: { select: { name: true } },
        _count: { select: { sacks: { where: LIVE_LOAD_UNIT_WHERE }, rolls: true, swatches: true } },
        sacks: {
          // Çözülmüş (boşalmış) dökme/araba sayılmaz, listelenmez, belgeye girmez.
          where: LIVE_LOAD_UNIT_WHERE,
          orderBy: [{ seq: "asc" }, { id: "asc" }],
          select: {
            id: true, sackNo: true, unitKind: true, unitLabel: true, dissolvedAt: true,
            rolls: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, currentQty: true } },
            allocations: { where: ACTIVE_SACK_ALLOCATION, select: { qty: true, orderLine: { select: { order: { select: { orderNumber: true } } } } } },
          },
        },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    // İptal gövdesi yerel e-İrsaliyeyi IPTAL eder, gönderilmişte 409 verir — önizleme aynı helper'dan.
    const liveEIrs = await readLiveEIrsaliyeForShipmentTx(prisma, shipmentId);
    const eIrsBlock = eIrsaliyeUndoBlock(liveEIrs);
    const canCancel = shipment.status !== ShipmentStatus.DISPATCHED && shipment.status !== ShipmentStatus.CANCELLED && !eIrsBlock;
    const byOrder = new Map<string, Prisma.Decimal>();
    for (const sk of shipment.sacks) {
      for (const a of sk.allocations) {
        const ord = a.orderLine.order.orderNumber;
        byOrder.set(ord, (byOrder.get(ord) ?? D0()).plus(a.qty));
      }
    }
    return {
      success: true,
      data: {
        shipmentId: shipment.id,
        shipmentNo: shipment.shipmentNo,
        status: shipment.status,
        customerName: shipment.customer.name,
        branchName: shipment.branch?.name ?? null,
        canCancel,
        reason: canCancel ? null : (eIrsBlock ?? "Sevk edilmiş veya iptal edilmiş sevkiyat iptal edilemez."),
        eIrsaliye: eIrsaliyePreviewRow(liveEIrs),
        sackCount: shipment._count.sacks,
        rollCount: shipment._count.rolls,
        swatchCount: shipment._count.swatches,
        affectedOrders: [...byOrder.entries()].map(([orderNumber, qty]) => ({ orderNumber, qty: qty.toString() })),
        // Yıkıcı işlem önizlemesi HER kaydı listeler: birim + topları + nereye döneceği
        // (çuval havuza; dökme/araba çözülür, toplar rafa).
        units: shipment.sacks.filter((sk) => sk.dissolvedAt === null).map((sk) => ({
          id: sk.id, sackNo: sk.sackNo, unitKind: sk.unitKind, unitLabel: sk.unitLabel,
          returnsTo: sk.unitKind === LoadUnitKind.SACK ? "SACK_POOL" : "SHELF",
          rolls: sk.rolls.map((r) => ({ id: r.id, barcode: r.barcode, qty: Number(r.currentQty) })),
        })),
      },
    };
  }

export async function cancelPlannedShipmentTx(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    expectedStatus: ShipmentStatus,
    opts?: { userId?: string; reason?: string | null; reasonCode?: string | null },
  ): Promise<VoidedEIrsaliye | null> {
    const claim = await tx.shipment.updateMany({
      where: { id: shipmentId, status: expectedStatus },
      // İPTAL KÜNYESİ (2026-09-11): 37 modelin konvansiyonu; iptal edilebilen tek
      // belge olmasına rağmen burada YOKTU ve iptal yalnız `status`tan okunuyordu.
      data: {
        status: ShipmentStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledById: opts?.userId ?? null,
        cancelReason: opts?.reason?.slice(0, 300) ?? null,
        cancelReasonCode: opts?.reasonCode?.slice(0, 64) ?? null,
      },
    });
    if (claim.count === 0) throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
    // Yerel e-İrsaliye (GİB'e gitmemiş) sevkiyatla AYNI tx'te IPTAL; gönderilmişte 409 (ikinci sed).
    const voidedEIrsaliye = await voidLocalEIrsaliyeTx(tx, shipmentId, opts?.userId ?? null);
    await writeShipmentEvent(tx, {
      shipmentId,
      type: ShipmentEventType.CANCELLED,
      fromStatus: expectedStatus,
      toStatus: ShipmentStatus.CANCELLED,
      reason: opts?.reason ?? null,
      reasonCode: opts?.reasonCode ?? null,
      userId: opts?.userId ?? null,
    });
    // Tahsisleri DAMGALA (çuval.shipmentId null'lanmadan ÖNCE — yoksa ilişki yüklemi eşleşmez) + sipariş defteri.
    const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
    // Lost-update kilidi (performDispatchTx ile simetrik): defter mutasyonu
    // (deleteMany) + recompute, etkilenen siparişlerin TAM satır kümesi kilitliyken
    // koşar — eşzamanlı dispatch/iptal shippedQty'yi eksik yazamaz.
    const orderIds = [...new Set(orderRows.map((o) => o.orderId))];
    const lineRows = await tx.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    await touchOrderLinesTx(tx, lineRows.map((l) => l.id));
    await clearShipmentAllocationsTx(tx, shipmentId, opts?.userId ?? null);
    await tx.shipmentOrder.updateMany({ where: { shipmentId }, data: { isActive: false } });
    // Çuvallar depoya döner; içerik shipmentId null. Kilit sırası sevkiyat → çuval → içerik;
    // kartela çuvaldan ÖNCE yazılır (bileşik FK ON UPDATE CASCADE — removeSackFromShipment şerhi).
    await tx.$queryRaw`SELECT id FROM sacks WHERE "shipmentId" = ${shipmentId}::uuid ORDER BY id FOR UPDATE`;
    // Dökme/araba birimi havuza DÖNMEZ: topları rafa iner, birim sevkiyatında çözülmüş kalır.
    await dissolveLoadUnitsTx(tx, shipmentId, opts?.userId ?? null);
    await tx.roll.updateMany({ where: { shipmentId }, data: { shipmentId: null } });
    await transitionSwatchesTx(tx, SwatchEventType.SHIPMENT_REMOVED, {
      scope: { shipmentId },
      shipment: { id: shipmentId },
      ctx: { trigger: "SHIPMENT_CANCEL", userId: opts?.userId, reason: opts?.reason, reasonCode: opts?.reasonCode },
    });
    const returning = await tx.sack.findMany({ where: { shipmentId, unitKind: LoadUnitKind.SACK }, select: { id: true } });
    await tx.sack.updateMany({ where: { shipmentId, unitKind: LoadUnitKind.SACK }, data: { shipmentId: null, seq: null } });
    // Sevk partisi: geri gelen çuvalın kapalı partisi kendiliğinden açılır (operatör görsün).
    const lot = await readPackingLotSettings(tx);
    await reopenLotsForSacksTx(tx, returning.map((r) => r.id), lot.mode === "sevk-partisi");
    await recomputeOrderStatusForOrdersTx(tx, orderIds);
    return voidedEIrsaliye;
  }

export async function cancelShipment(this: ShippingServiceThis, shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true, _count: { select: { sacks: true } } } });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.CANCELLED) return { success: true, data: { shipmentId }, message: "Sevkiyat zaten iptal edilmiş" };
    if (shipment.status === ShipmentStatus.DISPATCHED) throw AppError.conflict("Sevk edilmiş sevkiyat iptal edilemez");

    const voidedEIrs = await prisma.$transaction(async (tx) => {
      // Sevkiyat kilidi İLK ifade: e-İrsaliye gönderim işaretiyle aynı kapsamda serileşir.
      await lockShipmentScopeTx(tx, shipmentId);
      return this.cancelPlannedShipmentTx(tx, shipmentId, shipment.status, { userId });
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "CANCEL", freedSacks: shipment._count.sacks } });
    await logVoidedEIrsaliye(userId, voidedEIrs);
    return { success: true, data: { shipmentId, freedSacks: shipment._count.sacks }, message: "Sevkiyat iptal edildi — çuvallar depoya döndü" };
  }
