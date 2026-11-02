// =============================================================================
// İŞ EMRİ ETİKET BİLGİSİ — tek yazar (Gülkesim S5, fabrika cevabı 4)
// =============================================================================
// İE açan (panel) ya da tamburcu (tablet) eksik etiket alanını ekler, düzeltir ya da
// boş bastırır. Değer `WorkOrder.labelOverrides`a yazılır; `getRollLabel` her topta
// uygular. Yazım atomik claim (`updatedAt` eşitliği) — iki tablet aynı anda yazarsa
// ikincisi 409 alır, sessizce ezilmez. Audit before/after tx DIŞINDA (ayak izi).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import {
  LABEL_OVERRIDE_KEYS,
  LABEL_OVERRIDE_KEY_SET,
  LABEL_OVERRIDE_TEXT_MAX,
  readLabelOverrides,
  type LabelOverrideKeyDef,
  type LabelOverrides,
} from "../config/label-overrides";

export interface WorkOrderLabelOverridesView {
  workOrderId: string;
  workOrderNumber: string;
  overrides: LabelOverrides;
  keys: readonly LabelOverrideKeyDef[];
  /** İyimser eşzamanlılık belirteci — PUT'ta geri gönderilir. */
  updatedAt: string;
}

/**
 * Gövde → doğrulanmış harita. Değer `null` = anahtarı kaldır (kaynak değere dön);
 * "" = boş bas; metin = yerine yaz. Tanınmayan anahtar 400 (fail-closed).
 */
export function normalizeLabelOverrideInput(
  current: LabelOverrides,
  patch: Record<string, unknown>,
): LabelOverrides {
  const next: LabelOverrides = { ...current };
  for (const [key, raw] of Object.entries(patch)) {
    if (!LABEL_OVERRIDE_KEY_SET.has(key)) {
      throw AppError.badRequest(`Etikette bu alan değiştirilemez: ${key}`, { code: "LABEL_OVERRIDE_KEY_UNKNOWN", key });
    }
    if (raw === null) {
      delete next[key];
      continue;
    }
    if (typeof raw !== "string") {
      throw AppError.badRequest("Etiket alanı metin olmalı", { code: "LABEL_OVERRIDE_INVALID", key });
    }
    const v = raw.trim();
    if (v.length > LABEL_OVERRIDE_TEXT_MAX) {
      throw AppError.badRequest(`Etiket alanı en çok ${LABEL_OVERRIDE_TEXT_MAX} karakter olabilir`, {
        code: "LABEL_OVERRIDE_INVALID",
        key,
      });
    }
    const def = LABEL_OVERRIDE_KEYS.find((d) => d.key === key)!;
    if (def.type === "number" && v !== "") {
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n) || n <= 0 || n > 10000) {
        throw AppError.badRequest(`${def.label} pozitif bir sayı olmalı`, { code: "LABEL_OVERRIDE_INVALID", key });
      }
    }
    next[key] = v;
  }
  return next;
}

export class LabelOverrideService {
  async get(workOrderId: string): Promise<ApiResponse<WorkOrderLabelOverridesView>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, workOrderNumber: true, labelOverrides: true, updatedAt: true },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");
    return {
      success: true,
      data: {
        workOrderId: wo.id,
        workOrderNumber: wo.workOrderNumber,
        overrides: readLabelOverrides(wo.labelOverrides),
        keys: LABEL_OVERRIDE_KEYS,
        updatedAt: wo.updatedAt.toISOString(),
      },
    };
  }

  async update(
    workOrderId: string,
    input: { overrides: Record<string, unknown>; updatedAt?: string | null },
    userId?: string,
  ): Promise<ApiResponse<WorkOrderLabelOverridesView>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, workOrderNumber: true, labelOverrides: true, updatedAt: true },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    const before = readLabelOverrides(wo.labelOverrides);
    const after = normalizeLabelOverrideInput(before, input.overrides);

    // İstemci belirteci verdiyse ona, vermediyse okunan satıra göre claim — araya giren yazar 409.
    const expected = input.updatedAt ? new Date(input.updatedAt) : wo.updatedAt;
    if (Number.isNaN(expected.getTime())) {
      throw AppError.badRequest("updatedAt geçersiz", { code: "LABEL_OVERRIDE_INVALID" });
    }
    const claim = await prisma.workOrder.updateMany({
      where: { id: workOrderId, updatedAt: expected },
      data: { labelOverrides: Object.keys(after).length > 0 ? after : Prisma.DbNull },
    });
    if (claim.count === 0) {
      throw AppError.conflict("Etiket bilgisi başka biri tarafından değiştirildi; yenileyip tekrar deneyin", {
        code: "LABEL_OVERRIDE_STALE",
      });
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: workOrderId,
      oldData: { labelOverrides: before },
      newData: { labelOverrides: after, event: "WORK_ORDER_LABEL_OVERRIDE" },
    });

    return this.get(workOrderId);
  }
}
