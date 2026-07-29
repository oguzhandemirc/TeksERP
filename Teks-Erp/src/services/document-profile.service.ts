// =============================================================================
// Document Profile Service — belge şablon profilleri (adlandırılmış override)
// =============================================================================
// Profil = genel Belge Şablonları ayarının üzerine binen { [belgeKey]: DocumentConfig }
// paketi (örn. "İhracat"). Müşteri/fason kartına atanır; freeze anında
// printed-document.service çözüm zincirinde merge edilir. Soft delete (isActive).
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { ApiResponse } from "../types/api.types";
import { sanitizeDocumentsConfig } from "./system-setting.service";

const TABLE = "DOCUMENT_PROFILE";

export interface DocumentProfileInput {
  name?: string;
  description?: string | null;
  config?: unknown;
  isActive?: boolean;
}

function sanitizeInput(input: DocumentProfileInput): {
  name?: string;
  description?: string | null;
  config?: Prisma.InputJsonValue;
  isActive?: boolean;
} {
  const out: ReturnType<typeof sanitizeInput> = {};
  if (typeof input.name === "string") {
    const name = input.name.trim().slice(0, 80);
    if (!name) throw AppError.badRequest("Profil adı boş olamaz");
    out.name = name;
  }
  if (input.description !== undefined) {
    out.description =
      typeof input.description === "string" ? input.description.trim().slice(0, 300) || null : null;
  }
  if (input.config !== undefined) {
    if (!input.config || typeof input.config !== "object" || Array.isArray(input.config)) {
      throw AppError.badRequest("Profil config nesne olmalı");
    }
    out.config = sanitizeDocumentsConfig(
      input.config as Record<string, unknown>,
    ) as unknown as Prisma.InputJsonValue;
  }
  if (typeof input.isActive === "boolean") out.isActive = input.isActive;
  return out;
}

export class DocumentProfileService {
  /** Liste — default yalnız aktifler; ?withInactive=true hepsini döner. */
  async list(withInactive: boolean): Promise<ApiResponse<unknown[]>> {
    const profiles = await prisma.documentProfile.findMany({
      where: withInactive ? {} : { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        updatedAt: true,
        _count: { select: { customers: true, subcontractors: true } },
      },
    });
    return { success: true, data: profiles };
  }

  /** Detay — config dahil (düzenleme ekranı). */
  async get(id: string): Promise<ApiResponse<unknown>> {
    const profile = await prisma.documentProfile.findUnique({ where: { id } });
    if (!profile) throw AppError.notFound("Profil bulunamadı");
    return { success: true, data: profile };
  }

  async create(input: DocumentProfileInput, userId?: string): Promise<ApiResponse<unknown>> {
    const data = sanitizeInput(input);
    if (!data.name) throw AppError.badRequest("Profil adı gerekli");
    try {
      const created = await prisma.documentProfile.create({
        data: { name: data.name, description: data.description ?? null, config: data.config ?? {} },
      });
      await AuditService.log({
        userId,
        action: "CREATE",
        tableName: TABLE,
        recordId: created.id,
        newData: { name: created.name },
      });
      return { success: true, data: created, message: "Profil oluşturuldu" };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw AppError.conflict("Bu adla bir profil zaten var");
      }
      throw err;
    }
  }

  async update(
    id: string,
    input: DocumentProfileInput,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = sanitizeInput(input);
    try {
      const updated = await prisma.documentProfile.update({ where: { id }, data });
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: TABLE,
        recordId: id,
        newData: { name: updated.name, isActive: updated.isActive },
      });
      return { success: true, data: updated, message: "Profil güncellendi" };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2025") throw AppError.notFound("Profil bulunamadı");
        if (err.code === "P2002") throw AppError.conflict("Bu adla bir profil zaten var");
      }
      throw err;
    }
  }

  /** Soft delete — atamalar korunur (isActive=false profil çözümde YOK sayılır). */
  async deactivate(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    return this.update(id, { isActive: false }, userId);
  }
}

export const documentProfileService = new DocumentProfileService();
