// =============================================================================
// TeksERP — ÖZEL DOKUMA İŞ EMRİ ŞABLONU (WeavingOrderTemplate) yazma yolu · dokuma modülü
// =============================================================================
// Genel CRUD (`BaseService`) üstünde gövde ALLOWLIST'i (Zod `.strict()` — yeni kolon kendiliğinden
// yazılabilir olmaz). Şablon yalnız formu ön-doldurur; asıl doğrulama iş emri kaydında. Burada yalnız
// referansın varlığı/türü (FK 500'ü yerine Türkçe 400) ve içeride ↔ fasoncu XOR'u.
// =============================================================================
import { ItemType, WeavingExecutionKind } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma";
import { BaseService } from "./base.service";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";

const uuidOrNull = z.string().uuid("Kimlik geçersiz.").nullable().optional();
const textOrNull = (max: number, label: string) =>
  z.string().trim().max(max, `${label} en çok ${max} karakter olabilir.`).nullable().optional();

const fields = {
  name: z.string().trim().min(1, "Şablon adı zorunlu.").max(100, "Şablon adı en çok 100 karakter olabilir."),
  description: textOrNull(300, "Açıklama"),
  itemId: uuidOrNull,
  executionKind: z.nativeEnum(WeavingExecutionKind).nullable().optional(),
  subcontractorId: uuidOrNull,
  plannedM: z.union([z.number(), z.string()]).nullable().optional(),
  notes: textOrNull(500, "Not"),
  sortOrder: z.number().int().min(0).max(9999).optional(),
};

const createSchema = z.object(fields).strict();
const updateSchema = z.object({ ...fields, name: fields.name.optional(), isActive: z.boolean().optional() }).strict();
type TemplateInput = z.infer<typeof updateSchema>;

/** Boş metin/boş sayı = alan yok (form boş bıraktı); geçersiz ya da sıfır/negatif metre 400. */
export function normalizePlannedM(v: number | string | null | undefined): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === "string" && v.trim() === "")) return null;
  const n = typeof v === "number" ? v : Number(v.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) throw AppError.badRequest("Planlanan metre sıfırdan büyük bir sayı olmalı.");
  return n;
}

export class WeavingOrderTemplateService extends BaseService {
  private async assertRefs(d: TemplateInput, current?: { executionKind: WeavingExecutionKind | null; subcontractorId: string | null }): Promise<void> {
    if (d.itemId) {
      const item = await prisma.item.findUnique({ where: { id: d.itemId }, select: { itemType: true } });
      if (!item) throw AppError.badRequest("Kumaş kartı bulunamadı");
      if (item.itemType !== ItemType.FABRIC) throw AppError.badRequest("Dokuma şablonu yalnız KUMAŞ kartına bağlanır");
    }
    if (d.subcontractorId) {
      const n = await prisma.subcontractor.count({ where: { id: d.subcontractorId, isActive: true } });
      if (n === 0) throw AppError.badRequest("Fasoncu bulunamadı ya da pasif");
    }
    const kind = d.executionKind !== undefined ? d.executionKind : (current?.executionKind ?? null);
    const sub = d.subcontractorId !== undefined ? d.subcontractorId : (current?.subcontractorId ?? null);
    if (kind === WeavingExecutionKind.IN_HOUSE && sub) {
      throw AppError.badRequest("İçeride dokunan şablona fasoncu seçilemez.", { code: "WEAVING_TEMPLATE_PARTY_XOR" });
    }
  }

  async create(rawData: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    const data = createSchema.parse(rawData);
    await this.assertRefs(data);
    return super.create({ ...data, plannedM: normalizePlannedM(data.plannedM) }, userId);
  }

  async update(id: string, rawData: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    const data = updateSchema.parse(rawData);
    const row = await prisma.weavingOrderTemplate.findUnique({ where: { id }, select: { executionKind: true, subcontractorId: true } });
    if (!row) throw AppError.notFound("Dokuma şablonu bulunamadı", { id });
    await this.assertRefs(data, row);
    const plannedM = normalizePlannedM(data.plannedM);
    return super.update(id, { ...data, ...(plannedM !== undefined ? { plannedM } : {}) }, userId);
  }
}
