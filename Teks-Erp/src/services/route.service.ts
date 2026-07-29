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
import { BaseService, type BaseServiceConfig } from "./base.service";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";

/**
 * Route servis konfigürasyonu — TEK KAYNAK. Hem canlı wiring (route.routes.ts)
 * hem regresyon testi (scripts/test_route_firm_roundtrip.ts) buradan tüketir.
 * Amaç: Saha #14 fason firma (`plannedSubcontractorId`) round-trip'i, biri
 * `defaultInclude`'dan `plannedSubcontractor`'ı düşürürse SESSİZCE bozulmasın —
 * test gerçek config'i doğrular.
 */
export const ROUTE_SERVICE_CONFIG: BaseServiceConfig = {
  modelName: "route",
  tableName: "ROUTE",
  searchFields: ["name"],
  nestedCreateFields: ["steps"],
  defaultInclude: {
    steps: {
      include: {
        station: {
          include: {
            defaultCategory: {
              select: {
                id: true,
                code: true,
                name: true,
                // Hızlı İş Emri "Gelişmiş" renk/özellik uygulaması, rotanın bu adımı
                // gerçekten uygulayıp uygulayamayacağını bu bayraklardan ölçer
                // (sadece kategori atanmış olması yetmez — appliesColor/Property gerekir).
                appliesColor: true,
                appliesProperty: true,
              },
            },
          },
        },
        // Saha #14: rota şablonunda saklı fason firması — istemci kayıtlı firmanın
        // adını ayrı sorgu olmadan gösterebilsin. (Scalar plannedSubcontractorId
        // zaten include ile dönüyor; bu yalnız adı ekler.)
        plannedSubcontractor: { select: { id: true, name: true } },
      },
      orderBy: { sequence: "asc" },
    },
  },
  uniqueField: "code",
  duplicateNameField: "name",
  entityLabel: "rota",
  // Kod backend-authoritative: `ROT+GGAAYY+NNNN` günlük sıralı (istemci kodu yok sayılır).
  autoCode: { prefix: "ROT" },
};

interface IncomingStep {
  stationId?: string;
  requiredCategoryId?: string | null;
  plannedSubcontractorId?: string | null;
  sequence?: number;
  defaultNotes?: string | null;
}

export class RouteService extends BaseService {
  // F209: rota adımında izinli alanlar — nested create çocukları sanitizeWriteData'yı
  // baypas eder; yalnız bunlar geçer (mass-assignment kapatılır).
  private static readonly ALLOWED_STEP_KEYS = new Set([
    "stationId",
    "sequence",
    "defaultNotes",
    "requiredCategoryId",
    "plannedSubcontractorId",
  ]);

  /** Dizi-form VE nested-write ({create:[...]}) formundan step nesnelerini çıkarır. */
  private extractSteps(rawSteps: unknown): IncomingStep[] | null {
    if (Array.isArray(rawSteps)) return rawSteps as IncomingStep[];
    if (rawSteps && typeof rawSteps === "object") {
      const create = (rawSteps as Record<string, unknown>).create;
      if (Array.isArray(create)) return create as IncomingStep[];
      if (create && typeof create === "object") return [create as IncomingStep];
    }
    return null;
  }

  private async validateSteps(data: Record<string, unknown>): Promise<void> {
    if (!("steps" in data) || data.steps == null) return;
    const steps = this.extractSteps(data.steps);
    if (steps === null) {
      throw AppError.badRequest(
        "Rota adımları geçersiz biçimde (dizi veya { create: [...] } bekleniyor)",
      );
    }
    if (steps.length === 0) return;

    // F209: mass-assignment guard — nested create çocukları için izinli-alan kontrolü.
    for (const s of steps) {
      for (const k of Object.keys(s as Record<string, unknown>)) {
        if (!RouteService.ALLOWED_STEP_KEYS.has(k)) {
          throw AppError.badRequest(`Rota adımında izin verilmeyen alan: ${k}`);
        }
      }
    }

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

    // Planlanan fason firma, adımın gerektirdiği kategoride hizmet vermeli —
    // planStep (workorder.service) ve fason sevk (subcontractor.service) bu
    // kuralı zaten dayatıyor; şablon yazım yolu asimetrik biçimde atlıyordu.
    // Yalnız İKİ alan da dolu adımlar denetlenir (tek bulk sorgu, perf kuralı).
    const catPairs = steps
      .map((s) => ({ sub: s.plannedSubcontractorId, cat: s.requiredCategoryId }))
      .filter((p): p is { sub: string; cat: string } =>
        typeof p.sub === "string" && p.sub.length > 0 &&
        typeof p.cat === "string" && p.cat.length > 0,
      );
    if (catPairs.length > 0) {
      const links = await prisma.subcontractorToCategory.findMany({
        where: { OR: catPairs.map((p) => ({ subcontractorId: p.sub, categoryId: p.cat })) },
        select: { subcontractorId: true, categoryId: true },
      });
      const have = new Set(links.map((l) => `${l.subcontractorId}:${l.categoryId}`));
      if (catPairs.some((p) => !have.has(`${p.sub}:${p.cat}`))) {
        throw AppError.badRequest(
          "Rota adımında seçilen fason firma, adımın gerektirdiği kategoride hizmet vermiyor",
        );
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
