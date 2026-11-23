// =============================================================================
// Roll shade service — topa ton grubu harfi ata (panel "Ton ata", 2026-11-23)
// =============================================================================
// Envanter servis ailesinin DIŞINDA durur: ailenin içinde olsaydı inventory.routes aileye bir sekme
// erken girer ve ticaret zinciri rejim kapısı tarama derinliğine düşerdi (test_finance_regime_gate).
// `Roll.shadeCode` durum alanıdır (defter değil: satır silinince raporlanan sayı değişmez); eski değer
// audit'te kalır. Kilit kümesi etiket düzeltmesiyle aynı (`LABEL_TEXT_LOCKED_STATUSES`): sevk edilmiş /
// dışarıdaki / ölü topun tonu değişmez. Uç: POST /api/rolls/shade.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { LABEL_TEXT_LOCKED_STATUSES, labelTextFixBlock } from "./helpers/label-text-lock.helper";
import { normalizeShadeCode } from "./helpers/shade-group.helper";

export const ROLL_SHADE_MAX_BATCH = 500;

export interface RollShadeSetInput {
  rollIds: string[];
  /** null/"" → tonu kaldır. */
  shadeCode: string | null;
  reason?: string | null;
}

export interface RollShadeSetResult {
  shadeCode: string | null;
  updated: number;
  unchanged: number;
}

export async function setRollShade(input: RollShadeSetInput, userId?: string): Promise<ApiResponse<RollShadeSetResult>> {
  const ids = [...new Set(input.rollIds)];
  if (ids.length === 0) throw AppError.badRequest("En az bir top seçilmeli.");
  if (ids.length > ROLL_SHADE_MAX_BATCH) throw AppError.badRequest(`Tek seferde en fazla ${ROLL_SHADE_MAX_BATCH} topa ton atanabilir.`);
  const shadeCode = normalizeShadeCode(input.shadeCode);
  const reason = input.reason?.trim() || null;

  const rolls = await prisma.roll.findMany({
    where: { id: { in: ids } },
    select: { id: true, barcode: true, status: true, shadeCode: true },
  });
  if (rolls.length !== ids.length) throw AppError.notFound("Seçilen toplardan bazıları bulunamadı — listeyi yenileyin.");
  // Etkilenen HER engelli top barkoduyla listelenir (soyut sayı yetmez).
  const blocked = rolls.map((r) => ({ r, b: labelTextFixBlock(r.status) })).filter((x) => x.b !== null);
  if (blocked.length > 0) {
    throw AppError.conflict(
      `Tonu değiştirilemeyen top var (sevk edilmiş / dışarıda / tüketilmiş): ${blocked.map((x) => x.r.barcode ?? "(barkodsuz)").join(", ")}`,
      { code: blocked[0]!.b!.code, rolls: blocked.map((x) => ({ id: x.r.id, barcode: x.r.barcode, status: x.r.status })) },
    );
  }
  const changing = rolls.filter((r) => r.shadeCode !== shadeCode);
  if (changing.length === 0) {
    return { success: true, data: { shadeCode, updated: 0, unchanged: rolls.length }, message: "Ton zaten aynı" };
  }

  // ATOMİK CLAIM: kilitli statüye arada geçen top sayılmaz → sayım tutmazsa tx geri sarılır, 409.
  const changingIds = changing.map((r) => r.id);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.roll.updateMany({
      where: { id: { in: changingIds }, status: { notIn: [...LABEL_TEXT_LOCKED_STATUSES] } },
      data: { shadeCode, labelDirty: true },
    });
    if (count !== changingIds.length) {
      throw AppError.conflict("Seçilen toplardan biri bu arada değişti (sevk/tüketim) — yenileyip tekrar deneyin.", { code: "ROLL_CHANGED" });
    }
  });

  await AuditService.logMany(
    changing.map((r) => ({
      userId,
      action: "UPDATE" as const,
      tableName: "ROLL",
      recordId: r.id,
      oldData: { shadeCode: r.shadeCode, barcode: r.barcode },
      newData: { shadeCode, event: "SHADE_SET", ...(reason ? { reason } : {}) },
    })),
  );

  return {
    success: true,
    data: { shadeCode, updated: changing.length, unchanged: rolls.length - changing.length },
    message: shadeCode ? `${changing.length} topa ton ${shadeCode} atandı` : `${changing.length} topun tonu kaldırıldı`,
  };
}
