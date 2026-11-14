// =============================================================================
// Order Service / quick-order
// =============================================================================
// Toplardan hızlı sipariş (replay + tx).
// `order.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../order.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { ApiResponse } from "../../types/api.types";
import { AppError } from "../../utils/app-error";
import { assertOrderReplayAlive, tokenReplay, type TokenReplay } from "../helpers/token-replay.helper";
import {
  OrderStatus,
  Prisma,
  RollStatus,
} from "@prisma/client";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { isClientTokenP2002 } from "../../utils/p2002";
import { warehouseStampManyTx } from "../helpers/warehouse.helper";
import { runItemUsageChecksTx } from "../helpers/item-usage.helper";
import { TERIM } from "../../constants/terim";
import { emitOrderCreatedTx } from "../notification-sources/satis";
import { siparisSatirIzi, type OrderServiceThis, type SiparisSatiri } from "./shared";

export async function quickOrderFromRolls(this: OrderServiceThis, 
    data: { customerId: string; branchId?: string | null; rollIds: string[]; clientToken?: string | null },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const rollIds = [...new Set(data.rollIds)];
    if (rollIds.length === 0) throw AppError.badRequest("En az bir top okutulmalı");

    const rolls = await prisma.roll.findMany({
      where: { id: { in: rollIds } },
      select: {
        id: true,
        barcode: true,
        itemId: true,
        colorId: true,
        width: true,
        currentQty: true,
        status: true,
        shipmentId: true,
        sackId: true,
        currentStepId: true,
      },
    });
    if (rolls.length !== rollIds.length) throw AppError.notFound("Bazı toplar bulunamadı");

    // Spec (ürün+renk+en) bazında grupla → satır metrajı = grup currentQty toplamı.
    const groups = new Map<
      string,
      { itemId: string; colorId: string | null; width: number | null; quantity: Prisma.Decimal }
    >();
    for (const r of rolls) {
      const key = `${r.itemId}|${r.colorId ?? ""}|${r.width == null ? "" : Number(r.width)}`;
      const g =
        groups.get(key) ??
        { itemId: r.itemId, colorId: r.colorId, width: r.width != null ? Number(r.width) : null, quantity: new Prisma.Decimal(0) };
      g.quantity = g.quantity.plus(r.currentQty);
      groups.set(key, g);
    }
    const lines = [...groups.values()].map((g) => ({
      itemId: g.itemId,
      colorId: g.colorId,
      width: g.width,
      quantity: Number(g.quantity),
    }));

    // clientToken ZORUNLU (route): tümü-WAREHOUSE yolunda claim atlanır ve TEK koruma token'dır.
    // Sıralı tekrar (zaman aşımı sonrası) top kurallarından ÖNCE replay alır (hız yolu; kapı tx'teki K).
    const clientToken = data.clientToken || null;
    const replay = this.quickOrderReplay(data, lines, rolls.length);
    if (clientToken) {
      const once = await replay.replayIfAny(clientToken);
      if (once) return once;
    }

    const outcome = await this.quickOrderTx({ data, rolls, lines, clientToken, replay, userId });
    if ("replayed" in outcome) return outcome.replayed;
    const order = outcome.order as { id: string; orderNumber: string };
    const stockRollIds = outcome.stockRollIds;

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: this.config.tableName,
      recordId: order.id,
      newData: { customerId: data.customerId, branchId: data.branchId ?? null, lines, clientToken, orderNumber: order.orderNumber },
    });
    // Roll hareketini denetle (best-effort, tx DIŞI).
    if (stockRollIds.length > 0) {
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ROLL",
        // F153: tableName=ROLL ise recordId bir ROLL olmalı (order.id değil) — audit
        // tutarlılığı; sipariş bağı newData.orderNumber/rollIds ile korunur.
        recordId: stockRollIds[0],
        newData: { kind: "QUICK_ORDER_RAW_TO_WAREHOUSE", rollIds: stockRollIds, orderNumber: order.orderNumber },
      });
    }

    return {
      success: true,
      data: { order, lineCount: lines.length, rollCount: rolls.length, preparedToWarehouse: stockRollIds.length },
      message: `Hızlı sipariş açıldı: ${order.orderNumber} (${lines.length} satır, ${rolls.length} top)`,
    };
  }

export async function quickOrderTx(this: OrderServiceThis, { data, rolls, lines, clientToken, replay, userId }: {
    data: { customerId: string; branchId?: string | null };
    rolls: Array<{ id: string; barcode: string | null; status: RollStatus; shipmentId: string | null; sackId: string | null; currentStepId: string | null }>;
    lines: Array<{ itemId: string; colorId: string | null; width: number | null; quantity: number }>;
    clientToken: string | null;
    replay: TokenReplay<ApiResponse<unknown>>;
    userId: string | undefined;
  }): Promise<{ replayed: ApiResponse<unknown> } | { order: Record<string, unknown>; stockRollIds: string[] }> {
    // Her top serbest + satılabilir statüde olmalı (STOCK ham veya WAREHOUSE, çuvalsız).
    for (const r of rolls) {
      if (r.shipmentId) throw AppError.conflict(`Top bir sevkiyatta: ${r.barcode ?? r.id}`);
      if (r.sackId) throw AppError.conflict(`Top bir çuvalda: ${r.barcode ?? r.id}`);
      if (r.currentStepId) throw AppError.conflict(`Top bir ${TERIM.terbiyeIsEmri.tekilKucuk} adımında: ${r.barcode ?? r.id}`);
      if (r.status !== RollStatus.STOCK && r.status !== RollStatus.WAREHOUSE) {
        throw AppError.badRequest(`Top satışa uygun değil (${r.status}): ${r.barcode ?? r.id}`);
      }
    }
    // Sipariş kapıları (müşteri/şube + ürün/renk-atanabilirlik) `create` ile AYNI yerden.
    const prepared = await this.prepareOrderCreate(
      { customerId: data.customerId, branchId: data.branchId ?? null, lines, clientToken },
      clientToken,
      { userId },
      { fromScannedRolls: true },
    );
    const stockRollIds = rolls.filter((r) => r.status === RollStatus.STOCK).map((r) => r.id);
    return withBarcodeRetry(
      () =>
        prisma.$transaction(async (tx) => {
          if (clientToken) {
            const replayed = await replay.inTx(tx, clientToken);
            if (replayed) return { replayed };
          }
          await runItemUsageChecksTx(tx, prepared.lineCheck.checks);
          if (stockRollIds.length > 0) {
            const claimed = await tx.roll.updateMany({
              where: { id: { in: stockRollIds }, status: RollStatus.STOCK, shipmentId: null, currentStepId: null },
              data: { status: RollStatus.WAREHOUSE },
            });
            // Depoya GİRİŞ yazan her yolun ortak damgası (bkz. `warehouseStampManyTx`).
            await warehouseStampManyTx(tx, stockRollIds);
            if (claimed.count !== stockRollIds.length) {
              const escaped = await tx.roll.findMany({
                where: {
                  id: { in: stockRollIds },
                  NOT: { status: RollStatus.WAREHOUSE, shipmentId: null, currentStepId: null },
                },
                select: { id: true, barcode: true },
              });
              const list = escaped.map((r) => r.barcode ?? r.id).join(", ");
              throw AppError.conflict(
                `Şu toplar işlem sırasında başka bir akışta tüketildi; hızlı sipariş açılmadı, lütfen tekrar okutup deneyin: ${list}`,
              );
            }
          }
          const orderNumber = await this.nextOrderNumber(tx, prepared);
          const order = await this.insertOrderTx(tx, prepared, orderNumber);
          await emitOrderCreatedTx(tx, order.id as string, prepared.actorUserId);
          return { order, stockRollIds };
        }),
      undefined,
      (err) => !isClientTokenP2002(err),
    );
  }

export function quickOrderReplay(this: OrderServiceThis, 
    data: { customerId: string; branchId?: string | null },
    lines: Array<{ itemId: string; colorId: string | null; width: number | null; quantity: number }>,
    rollCount: number,
  ): TokenReplay<ApiResponse<unknown>> {
    return tokenReplay<Record<string, unknown>, ApiResponse<unknown>>({
      find: (db, clientToken) => this.findOrderByToken(db, clientToken),
      alive: (p) => assertOrderReplayAlive({ id: String(p.id), status: p.status as OrderStatus, orderNumber: (p.orderNumber as string | null) ?? null }),
      identity: (p) => [
        { ad: "customerId", mevcut: p.customerId, gelen: data.customerId },
        { ad: "branchId", mevcut: p.branchId, gelen: data.branchId },
        { ad: "lines", mevcut: siparisSatirIzi(Array.isArray(p.lines) ? (p.lines as SiparisSatiri[]) : []), gelen: siparisSatirIzi(lines) },
      ],
      collision: (p) => `Bu okutma daha önce ${p.orderNumber} siparişi olarak kaydedilmiş — yeni sipariş için ekranı kapatıp yeniden açın.`,
      collisionEk: (p) => ({ orderNumber: p.orderNumber }),
      respond: (p) => ({
        success: true,
        data: { order: p, lineCount: Array.isArray(p.lines) ? p.lines.length : 0, rollCount, preparedToWarehouse: 0 },
        message: `Hızlı sipariş zaten açılmış (yeniden gönderim): ${p.orderNumber}`,
      }),
    });
  }
