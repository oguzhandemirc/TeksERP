// =============================================================================
// TeksERP — HAM DURUŞ KODU EŞLEMESİ (MachineStopCodeMap) yazma yolu · makine kaynaklı duruş D2
// =============================================================================
// Genel CRUD (`BaseService`) üstünde iki kapı: gövde ALLOWLIST'tir (Zod `.strict()` — yeni kolon
// kendiliğinden yazılabilir olmaz) ve anahtar (kart tipi · ham kod · tezgah) doğuştan sonra
// DEĞİŞMEZ; yanlış anahtar pasife alınıp yenisi açılır. Sebep yalnız aktif, kayıp sınıflı
// `MACHINE_STOP` olabilir. Okuyucu tek: `helpers/machine-stop-code.helper.ts`.
// =============================================================================
import { ReasonPresetKind } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma";
import { BaseService } from "./base.service";
import { AppError } from "../utils/app-error";
import { p2002Mentions } from "../utils/p2002";
import type { ApiResponse } from "../types/api.types";

/** Kart tipi kimliği — `MachineCollector.collectorType` ile birebir karşılaştırılır, biçim burada sabitlenir. */
export const COLLECTOR_TYPE_RE = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;

const createSchema = z
  .object({
    collectorType: z.string().trim().regex(COLLECTOR_TYPE_RE, "Kart tipi büyük harf, rakam ve . _ - ile en çok 32 karakter olmalı (örn. TEKS-ESP32-V1)."),
    rawStopCode: z.string().trim().min(1, "Ham duruş kodu zorunlu.").max(32, "Ham duruş kodu en çok 32 karakter olabilir."),
    machineId: z.string().uuid("Tezgah kimliği geçersiz.").nullable().optional(),
    stopReasonId: z.string().uuid("Duruş sebebi kimliği geçersiz."),
  })
  .strict();

const updateSchema = z
  .object({
    stopReasonId: z.string().uuid("Duruş sebebi kimliği geçersiz.").optional(),
    isActive: z.boolean().optional(),
  })
  .strict(); // anahtar alanları burada YOK — değişmez (400)

const LIVE_UQ = /machine_stop_code_maps_live_uq|collectorType/i;

function duplicate(): AppError {
  return AppError.conflict("Bu kart tipi ve ham kod için bu kapsamda (tezgah ya da genel) etkin bir eşleme zaten var.", {
    code: "STOP_CODE_MAP_DUPLICATE",
  });
}

export class MachineStopCodeMapService extends BaseService {
  private async assertStopReason(stopReasonId: string): Promise<void> {
    const r = await prisma.reasonPreset.findUnique({
      where: { id: stopReasonId },
      select: { kind: true, isActive: true, stopLossClass: true, code: true },
    });
    if (!r || r.kind !== ReasonPresetKind.MACHINE_STOP) {
      throw AppError.badRequest("Seçilen kayıt bir tezgah duruş sebebi değil.", { code: "STOP_REASON_INVALID" });
    }
    if (!r.isActive) throw AppError.badRequest(`Duruş sebebi pasif: ${r.code}`, { code: "STOP_REASON_INVALID" });
    if (!r.stopLossClass) throw AppError.badRequest(`Duruş sebebinin kayıp sınıfı yok: ${r.code}`, { code: "STOP_LOSS_CLASS_MISSING" });
  }

  private async assertNoLiveTwin(key: { collectorType: string; rawStopCode: string; machineId: string | null }, exceptId?: string): Promise<void> {
    const twin = await prisma.machineStopCodeMap.count({
      where: { ...key, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (twin > 0) throw duplicate();
  }

  async create(rawData: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    const data = createSchema.parse(rawData);
    const machineId = data.machineId ?? null;
    if (machineId) {
      const m = await prisma.machine.findUnique({ where: { id: machineId }, select: { isActive: true } });
      if (!m) throw AppError.notFound("Tezgah bulunamadı", { machineId });
      if (!m.isActive) throw AppError.badRequest("Pasif tezgaha eşleme tanımlanamaz.", { code: "MACHINE_INACTIVE" });
    }
    await this.assertStopReason(data.stopReasonId);
    const key = { collectorType: data.collectorType, rawStopCode: data.rawStopCode, machineId };
    await this.assertNoLiveTwin(key);
    try {
      return await super.create({ ...key, stopReasonId: data.stopReasonId }, userId);
    } catch (e) {
      if (p2002Mentions(e, LIVE_UQ)) throw duplicate(); // yarışı DB seddi kapatır
      throw e;
    }
  }

  async update(id: string, rawData: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    const data = updateSchema.parse(rawData);
    const row = await prisma.machineStopCodeMap.findUnique({
      where: { id },
      select: { collectorType: true, rawStopCode: true, machineId: true, isActive: true },
    });
    if (!row) throw AppError.notFound("Eşleme bulunamadı", { id });
    if (data.stopReasonId) await this.assertStopReason(data.stopReasonId);
    if (data.isActive === true && !row.isActive) {
      await this.assertNoLiveTwin({ collectorType: row.collectorType, rawStopCode: row.rawStopCode, machineId: row.machineId }, id);
    }
    try {
      return await super.update(id, data, userId);
    } catch (e) {
      if (p2002Mentions(e, LIVE_UQ)) throw duplicate();
      throw e;
    }
  }
}
