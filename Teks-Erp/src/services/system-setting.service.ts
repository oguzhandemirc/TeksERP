// =============================================================================
// TeksERP - System Setting Service
// =============================================================================
// Runtime'da güncellenebilir konfigürasyon (key-value).
// Şu anda kullanılan key'ler:
//   - shipping.toleranceMeters: sevk metraj fire payı (string → float)
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";

const TABLE = "SYSTEM_SETTING";

export const SETTING_KEYS = {
  SHIPPING_TOLERANCE_METERS: "shipping.toleranceMeters",
} as const;

export class SystemSettingService {
  async list(): Promise<ApiResponse<unknown[]>> {
    const items = await prisma.systemSetting.findMany({
      orderBy: { key: "asc" },
      include: {
        updatedBy: { select: { id: true, fullName: true } },
      },
    });
    return { success: true, data: items };
  }

  async get(key: string): Promise<ApiResponse<unknown | null>> {
    const item = await prisma.systemSetting.findUnique({ where: { key } });
    return { success: true, data: item };
  }

  /**
   * Upsert: yoksa oluştur, varsa güncelle.
   * description sadece ilk oluşturmada set edilir; sonraki update'lerde değişmez
   * (admin niyetlerinin bozulmaması için).
   */
  async set(
    key: string,
    value: string,
    description: string | undefined,
    userId: string | undefined
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const existing = await prisma.systemSetting.findUnique({ where: { key } });

    const updated = await prisma.systemSetting.upsert({
      where: { key },
      create: {
        key,
        value,
        description: description ?? null,
        updatedById: userId,
      },
      update: {
        value,
        updatedById: userId,
      },
    });

    await AuditService.log({
      userId,
      action: existing ? "UPDATE" : "CREATE",
      tableName: TABLE,
      recordId: key,
      oldData: existing ? { value: existing.value } : null,
      newData: { value: updated.value },
    });

    return { success: true, data: updated, message: "Ayar güncellendi" };
  }

  /**
   * Tolerance değerini DB'den okur. Kayıt yoksa default 5m döner.
   * NOT: Bu fonksiyon çok sık çağrılmaz (sevk onayı sırasında); cache'siz kabul.
   */
  async getShippingToleranceMeters(): Promise<number> {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.SHIPPING_TOLERANCE_METERS },
      select: { value: true },
    });
    if (!setting) return 5;
    const parsed = parseFloat(setting.value);
    if (!Number.isFinite(parsed) || parsed < 0) return 5;
    return parsed;
  }
}

// Module-level singleton — helper'lar import edip kullanır.
export const systemSettingService = new SystemSettingService();

/**
 * Transaction içinden çağrılabilen tolerance okuma. tx verilirse aynı tx'i
 * kullanır (recomputeOrderStatus için kritik). tx yoksa dış prisma client.
 */
export async function readShippingToleranceMeters(
  tx?: Pick<typeof prisma, "systemSetting">
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_TOLERANCE_METERS },
    select: { value: true },
  });
  if (!setting) return 5;
  const parsed = parseFloat(setting.value);
  if (!Number.isFinite(parsed) || parsed < 0) return 5;
  return parsed;
}
