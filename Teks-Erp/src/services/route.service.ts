// =============================================================================
// TeksERP - Route (Rota Şablonu) Service
// =============================================================================
// Route = WorkOrder adımlarının klonlandığı yeniden-kullanılabilir kaynak şablon.
// Bare BaseController Zod taşımadığından (createInitialEntry/ProductRecipeService
// deseni) nested RouteStep referanslarının soft-delete giriş guard'ını + sequence
// geçerliliğini serviste doğrularız. (WO yolundaki assertRouteRefsActive'in
// master-data CRUD karşılığı — pasif istasyon/kategori/fason şablona sızmasın.)
// =============================================================================

import prisma from "../lib/prisma";
import { BaseService } from "./base.service";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";

interface IncomingStep {
  stationId?: string;
  requiredCategoryId?: string | null;
  plannedSubcontractorId?: string | null;
  sequence?: number;
}

export class RouteService extends BaseService {
  private async validateSteps(data: Record<string, unknown>): Promise<void> {
    if (!Array.isArray(data.steps)) return;
    const steps = data.steps as IncomingStep[];
    if (steps.length === 0) return;

    // sequence: pozitif tam sayı + tekrarsız
    const seqs = steps.map((s) => s.sequence);
    if (seqs.some((s) => typeof s !== "number" || !Number.isInteger(s) || (s as number) <= 0)) {
      throw AppError.badRequest("Rota adımı sırası (sequence) pozitif tam sayı olmalı");
    }
    if (new Set(seqs).size !== seqs.length) {
      throw AppError.badRequest("Rota adımı sıraları tekrarlı olamaz");
    }

    const pick = (key: keyof IncomingStep): string[] => [
      ...new Set(
        steps
          .map((s) => s[key])
          .filter((x): x is string => typeof x === "string" && x.length > 0)
      ),
    ];

    const stationIds = pick("stationId");
    if (stationIds.length > 0) {
      const found = await prisma.station.findMany({
        where: { id: { in: stationIds }, isActive: true },
        select: { id: true },
      });
      if (found.length !== stationIds.length) {
        throw AppError.badRequest("Rota adımında bulunmayan veya pasif istasyon var");
      }
    }

    const categoryIds = pick("requiredCategoryId");
    if (categoryIds.length > 0) {
      const found = await prisma.subcontractorCategory.findMany({
        where: { id: { in: categoryIds }, isActive: true },
        select: { id: true },
      });
      if (found.length !== categoryIds.length) {
        throw AppError.badRequest("Rota adımında bulunmayan veya pasif kategori var");
      }
    }

    const subcontractorIds = pick("plannedSubcontractorId");
    if (subcontractorIds.length > 0) {
      const found = await prisma.subcontractor.findMany({
        where: { id: { in: subcontractorIds }, isActive: true },
        select: { id: true },
      });
      if (found.length !== subcontractorIds.length) {
        throw AppError.badRequest("Rota adımında bulunmayan veya pasif fason firma var");
      }
    }
  }

  async create(data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    await this.validateSteps(data);
    return super.create(data, userId);
  }

  async update(id: string, data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    await this.validateSteps(data);
    return super.update(id, data, userId);
  }
}
