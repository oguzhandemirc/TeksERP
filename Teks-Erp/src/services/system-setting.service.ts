// =============================================================================
// TeksERP - System Setting Service
// =============================================================================
// Runtime'da güncellenebilir konfigürasyon (key-value).
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";

/**
 * SystemSetting.value bir JsonValue. Reader yardımcıları: gelen değer
 * hangi tipte olursa olsun beklenen tipe çevirmeye çalışır (backward
 * compatible — eski string-encoded değerleri de okur).
 */
function asNumber(value: Prisma.JsonValue | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: Prisma.JsonValue | null | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return false;
}

const TABLE = "SYSTEM_SETTING";

export const SETTING_KEYS = {
  SHIPPING_TOLERANCE_METERS: "shipping.toleranceMeters",
  /** Pricing/currency UI'da gösterilsin mi (sipariş ve ileride sevkiyat). */
  FINANCE_PRICING_ENABLED: "finance.pricingEnabled",
  /** İş emrinde "hedef metraj" alanı gösterilsin mi. Default false (proses-only fabrika). */
  WORKORDER_TARGET_QUANTITY_ENABLED: "workorder.targetQuantityEnabled",
  /** Sipariş oluştururken termin (deadline) verilmediyse orderDate + N gün. Default 7. */
  ORDER_DEFAULT_DEADLINE_DAYS: "order.defaultDeadlineDays",
  /** İş emri oluştururken plannedEndDate verilmediyse plannedStartDate + N gün. Default 7. */
  WORKORDER_DEFAULT_PLAN_DURATION_DAYS: "workorder.defaultPlanDurationDays",
} as const;

const DEFAULT_DEADLINE_DAYS = 7;

/**
 * Tüm public feature flag'lerin tek atışta okunmuş hali. Frontend app
 * açılışında 1 kez çekip context'e koyar; UI bu flag'lere göre alanları
 * gösterir/gizler. Backend tarafı feature flag'i ENFORCE ETMEZ — sadece
 * UI rehberi (admin/test araçları field'ları gönderebilir).
 */
export interface FeatureFlags {
  pricingEnabled: boolean;
  targetQuantityEnabled: boolean;
}

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
    value: Prisma.InputJsonValue,
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
      oldData: existing ? { value: existing.value as Prisma.InputJsonValue } : null,
      newData: { value: updated.value as Prisma.InputJsonValue },
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
    const parsed = asNumber(setting.value);
    if (parsed === null || parsed < 0) return 5;
    return parsed;
  }

  /**
   * Tüm feature flag'leri tek atışta. Default: tüm flag'ler false (en
   * konservatif — fabrika fiyat görmek istemiyor şu an).
   */
  async getFeatureFlags(): Promise<ApiResponse<FeatureFlags>> {
    const flags: FeatureFlags = {
      pricingEnabled: await readPricingEnabled(),
      targetQuantityEnabled: await readTargetQuantityEnabled(),
    };
    return { success: true, data: flags };
  }

  /**
   * Bir feature flag'i toggle et. Kabul: { pricingEnabled: boolean }.
   * Verilmeyen alanlar dokunulmaz.
   */
  async setFeatureFlags(
    input: Partial<FeatureFlags>,
    userId: string | undefined
  ): Promise<ApiResponse<FeatureFlags>> {
    if (!userId) throw AppError.unauthorized();

    if (Object.prototype.hasOwnProperty.call(input, "pricingEnabled")) {
      if (typeof input.pricingEnabled !== "boolean") {
        throw AppError.badRequest("pricingEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FINANCE_PRICING_ENABLED,
        input.pricingEnabled,
        "Sipariş/sevkiyat ekranlarında para birimi + fiyat alanlarını göster",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "targetQuantityEnabled")) {
      if (typeof input.targetQuantityEnabled !== "boolean") {
        throw AppError.badRequest("targetQuantityEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.WORKORDER_TARGET_QUANTITY_ENABLED,
        input.targetQuantityEnabled,
        "İş emri formunda hedef metraj alanını göster",
        userId
      );
    }

    return this.getFeatureFlags();
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
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 0) return 5;
  return parsed;
}

/**
 * Pricing/currency UI gösterilsin mi? Default false (kayıt yoksa). Frontend
 * bu flag'e göre order create/list/detail ekranlarındaki currency dropdown +
 * unitPrice + totalAmount alanlarını render eder.
 */
export async function readPricingEnabled(): Promise<boolean> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_PRICING_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * İş emri "hedef metraj" alanı gösterilsin mi? Default false (proses-only
 * fabrika; üretim miktarını giren kumaş belirler). İleride örgü/üretim eklenirse açılır.
 */
export async function readTargetQuantityEnabled(): Promise<boolean> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.WORKORDER_TARGET_QUANTITY_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Pozitif tamsayı setting okuyucu — yoksa veya geçersizse default döner.
 * 0/negatif/NaN/Infinity → default. Float verilirse Math.floor uygulanır.
 */
async function readPositiveIntSetting(
  key: string,
  fallback: number,
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key },
    select: { value: true },
  });
  if (!setting) return fallback;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 1) return fallback;
  return Math.floor(parsed);
}

/**
 * Sipariş termini default gün sayısı. Order.create'de deadline verilmediyse
 * orderDate + N gün hesaplanır. Yoksa/geçersizse 7.
 */
export async function readOrderDefaultDeadlineDays(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  return readPositiveIntSetting(
    SETTING_KEYS.ORDER_DEFAULT_DEADLINE_DAYS,
    DEFAULT_DEADLINE_DAYS,
    tx,
  );
}

/**
 * İş emri planlama default süresi (gün). WorkOrder.create/update'de
 * plannedEndDate verilmediyse plannedStartDate + N gün hesaplanır.
 * Yoksa/geçersizse 7.
 */
export async function readWorkOrderDefaultPlanDurationDays(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  return readPositiveIntSetting(
    SETTING_KEYS.WORKORDER_DEFAULT_PLAN_DURATION_DAYS,
    DEFAULT_DEADLINE_DAYS,
    tx,
  );
}
