// =============================================================================
// Order Service / line-color
// =============================================================================
// Sipariş kalemi renk değişimi.
// `order.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../order.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { ApiResponse } from "../../types/api.types";
import { AppError } from "../../utils/app-error";
import { assertColorsAssignableToCustomer } from "../helpers/color-assignment.helper";

// eslint-disable-next-line max-params -- özgün metot 5 parametreli ve uyarısı cephedeki imzada sayılır; ailenin max-params katkısı bölme öncesi gibi TEK
export async function changeLineColor(
    orderId: string,
    lineId: string,
    colorId: string | null,
    reason: string,
    userId?: string,
  ): Promise<ApiResponse<{ lineId: string; previousColorId: string | null; colorId: string | null }>> {
    const trimmed = (reason ?? "").trim();
    if (trimmed.length < 3) {
      throw AppError.badRequest("Renk değişikliği için sebep yazmalısınız.");
    }
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        customerId: true,
        lines: { where: { id: lineId }, select: { id: true, colorId: true, itemId: true } },
      },
    });
    if (!order) throw AppError.notFound("Sipariş bulunamadı");
    if (order.status === "CANCELLED" || order.status === "COMPLETED") {
      throw AppError.conflict(
        `${order.orderNumber} ${order.status === "CANCELLED" ? "iptal edilmiş" : "tamamlanmış"} — kalem rengi değiştirilemez.`,
      );
    }
    const line = order.lines[0];
    if (!line) throw AppError.notFound("Sipariş kalemi bulunamadı");
    if ((line.colorId ?? null) === colorId) {
      throw AppError.badRequest("Sipariş kalemi zaten bu renkte.");
    }

    let colorName: string | null = null;
    if (colorId) {
      const color = await prisma.color.findUnique({
        where: { id: colorId },
        select: { name: true, isActive: true },
      });
      if (!color || !color.isActive) throw AppError.badRequest("Renk bulunamadı veya pasif.");
      colorName = color.name;
      await assertColorsAssignableToCustomer([colorId], order.customerId);
      const item = await prisma.item.findUnique({
        where: { id: line.itemId },
        select: { allowedColors: { select: { colorId: true } } },
      });
      const allowed = new Set((item?.allowedColors ?? []).map((c) => c.colorId));
      if (allowed.size > 0 && !allowed.has(colorId)) {
        throw AppError.badRequest("Renk bu kumaşın izinli renk listesinde değil.");
      }
    }

    // Atomik: eşzamanlı başka bir düzeltme kalemi değiştirdiyse sessizce ezme.
    const claim = await prisma.orderLine.updateMany({
      where: { id: lineId, orderId, colorId: line.colorId },
      data: { colorId },
    });
    if (claim.count === 0) {
      throw AppError.conflict("Sipariş kalemi bu sırada değişti — yenileyip tekrar deneyin.");
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ORDER",
      recordId: orderId,
      oldData: { lineId, colorId: line.colorId },
      newData: { event: "ORDER_LINE_COLOR_CHANGED", lineId, colorId, colorName, reason: trimmed },
    });

    return {
      success: true,
      data: { lineId, previousColorId: line.colorId, colorId },
      message: `Sipariş kalemi rengi "${colorName ?? "renksiz"}" olarak güncellendi.`,
    };
  }
