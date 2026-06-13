// =============================================================================
// TeksERP - WorkOrder Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { WorkOrderService } from "../services/workorder.service";
import "../types/express-augment";

// Create + quick-start ortak alan şeması. refine'siz tutuluyor ki spread ile
// (quickStartSchema) yeniden kullanılabilsin — refine ZodEffects'e çevirir, spread'i bozar.
const workOrderCoreShape = {
  batchNumber:       z.string().trim().min(1).optional().nullable(),
  type:              z.enum(["ORDER_PRODUCTION", "STOCK_PRODUCTION"]).default("ORDER_PRODUCTION"),
  width:             z.number().positive("En değeri pozitif olmalı").max(999_999_999, "En çok büyük").optional().nullable(),
  targetQuantity:    z.number().positive().max(999_999_999, "Hedef metraj çok büyük").optional().nullable(),
  targetWeight:      z.number().positive().max(999_999_999, "Hedef ağırlık çok büyük").optional().nullable(),
  parameters:        z.record(z.string(), z.unknown()).optional().nullable(),
  plannedStartDate:  z.string().optional().nullable(),
  plannedEndDate:    z.string().optional().nullable(),
  routeTemplateId:   z.string().uuid().optional().nullable(),
  targetItemId:      z.string().uuid().optional().nullable(),
  targetColorId:     z.string().uuid().optional().nullable(),
  // Tambur planlama bilgisi — operatör override edebilir.
  foldType:          z.string().trim().max(32).optional().nullable(),
  // Boyahaneye özel talimat — fason sevkinde kullanılır.
  dyehouseNote:      z.string().trim().max(1000).optional().nullable(),
  steps: z
    .array(z.object({
      stationId:              z.string().uuid("Geçersiz istasyon ID"),
      notes:                  z.string().max(500).optional().nullable(),
      requiredCategoryId:     z.string().uuid().optional().nullable(),
      plannedSubcontractorId: z.string().uuid().optional().nullable(),
    }))
    .optional(),
  /**
   * routeTemplateId ile birlikte verilir: şablondan klonlanan adımların fason
   * planlamasını üzerine yazar. `sequence` adımın rotadaki sırasıdır
   * (aynı istasyon iki kez gözükebileceğinden stationId yerine sequence ile eşleşir).
   */
  stepPlanning: z
    .array(z.object({
      sequence:               z.number().int().positive(),
      requiredCategoryId:     z.string().uuid().optional().nullable(),
      plannedSubcontractorId: z.string().uuid().optional().nullable(),
      notes:                  z.string().max(500).optional().nullable(),
    }))
    .optional(),
  orderLineAllocations: z
    .array(z.object({
      orderLineId:  z.string().uuid(),
      allocatedQty: z.number().nonnegative().optional(),
    }))
    .optional(),
  orderLineIds: z.array(z.string().uuid()).optional().nullable(),
  targetPropertyIds: z.array(z.string().uuid()).optional(),
};

const hasRoute = (d: { routeTemplateId?: string | null; steps?: unknown[] | null }) =>
  Boolean(d.routeTemplateId) || (Array.isArray(d.steps) && d.steps.length > 0);
const ROUTE_REFINE_MSG = {
  message: "Rota şablonu seçin veya özel rota adımları tanımlayın.",
  path: ["steps"],
};

const createSchema = z.object(workOrderCoreShape).refine(hasRoute, ROUTE_REFINE_MSG);

/**
 * Mobil "Hızlı İş Emri": create alanları + okutulan stok top barkodları.
 * targetItemId opsiyonel — verilmezse servis okutulan topların ürününden türetir
 * (basit modda operatör ürün seçmez). type verilmezse sipariş bağı varsa
 * ORDER_PRODUCTION, yoksa STOCK_PRODUCTION'a düşer.
 */
const quickStartSchema = z.object({
  ...workOrderCoreShape,
  // Hızlı İş Emri: type verilmezse servis okutulan topların sipariş bağına göre
  // türetir (sipariş bağı yok → STOCK_PRODUCTION). workOrderCoreShape'deki
  // .default("ORDER_PRODUCTION") bu türetmeyi bozuyordu (client type yollamayınca
  // Zod ORDER_PRODUCTION yazıp "sipariş kalemi şart" hatasına düşürüyordu) →
  // override: optional, default YOK. Sipariş bağlanırsa servis ORDER_PRODUCTION türetir.
  type: z.enum(["ORDER_PRODUCTION", "STOCK_PRODUCTION"]).optional(),
  rollBarcodes: z
    .array(z.string().trim().min(1))
    .min(1, "En az bir top barkodu okutmalısınız")
    .max(300, "Tek seferde en fazla 300 top bağlanabilir"),
}).refine(hasRoute, ROUTE_REFINE_MSG);

const targetPropertiesSchema = z.object({
  propertyIds: z.array(z.string().uuid()),
});

const splitBranchSchema = z.object({
  batchSplitId: z.string().uuid(),
  newColorId: z.string().uuid(),
  newBatchNumber: z.string().trim().min(1).max(64).optional().nullable(),
  orderMode: z.enum(["stock", "keep"]).default("stock"),
});

const updateStepPlanningSchema = z.object({
  requiredCategoryId: z.string().uuid().nullable().optional(),
  plannedSubcontractorId: z.string().uuid().nullable().optional(),
});

const updateWorkOrderSchema = z.object({
  batchNumber: z.string().trim().min(1).max(64).optional(),
  width: z.number().positive().nullable().optional(),
  targetQuantity: z.number().positive().nullable().optional(),
  targetWeight: z.number().positive().nullable().optional(),
  plannedStartDate: z.string().nullable().optional(),
  plannedEndDate: z.string().nullable().optional(),
  targetItemId: z.string().uuid().nullable().optional(),
  targetColorId: z.string().uuid().nullable().optional(),
  foldType: z.string().trim().max(32).nullable().optional(),
  dyehouseNote: z.string().trim().max(1000).nullable().optional(),
});

/**
 * Full replace: createSchema ile aynı yapı. Sadece PLANNED + üretime başlanmamış
 * iş emirlerinde çalışır. Rota, kalemler, hedef ürün/özellikler hepsi değişebilir.
 */
const replaceWorkOrderSchema = z.object({
  batchNumber:       z.string().trim().min(1).optional().nullable(),
  type:              z.enum(["ORDER_PRODUCTION", "STOCK_PRODUCTION"]).optional(),
  width:             z.number().positive("En değeri pozitif olmalı").max(999_999_999, "En çok büyük").optional().nullable(),
  targetQuantity:    z.number().positive().max(999_999_999, "Hedef metraj çok büyük").optional().nullable(),
  targetWeight:      z.number().positive().max(999_999_999, "Hedef ağırlık çok büyük").optional().nullable(),
  parameters:        z.record(z.string(), z.unknown()).optional().nullable(),
  plannedStartDate:  z.string().optional().nullable(),
  plannedEndDate:    z.string().optional().nullable(),
  routeTemplateId:   z.string().uuid().optional().nullable(),
  targetItemId:      z.string().uuid().optional().nullable(),
  targetColorId:     z.string().uuid().optional().nullable(),
  foldType:          z.string().trim().max(32).optional().nullable(),
  dyehouseNote:      z.string().trim().max(1000).optional().nullable(),
  steps: z
    .array(z.object({
      // smart-merge için: mevcut step'i güncellemek istersen id gönder.
      // Boş bırakırsan yeni adım eklenir.
      id:                     z.string().uuid().optional(),
      stationId:              z.string().uuid("Geçersiz istasyon ID"),
      notes:                  z.string().max(500).optional().nullable(),
      requiredCategoryId:     z.string().uuid().optional().nullable(),
      plannedSubcontractorId: z.string().uuid().optional().nullable(),
    }))
    .optional(),
  stepPlanning: z
    .array(z.object({
      sequence:               z.number().int().positive(),
      requiredCategoryId:     z.string().uuid().optional().nullable(),
      plannedSubcontractorId: z.string().uuid().optional().nullable(),
      notes:                  z.string().max(500).optional().nullable(),
    }))
    .optional(),
  orderLineAllocations: z
    .array(z.object({
      orderLineId:  z.string().uuid(),
      allocatedQty: z.number().nonnegative().optional(),
    }))
    .optional(),
  orderLineIds: z.array(z.string().uuid()).optional().nullable(),
  targetPropertyIds: z.array(z.string().uuid()).optional(),
}).refine(
  (d) => Boolean(d.routeTemplateId) || (d.steps && d.steps.length > 0),
  { message: "Rota şablonu seçin veya özel rota adımları tanımlayın.", path: ["steps"] },
);


export class WorkOrderController {
  private service: WorkOrderService;

  constructor() {
    this.service = new WorkOrderService();
    this.create = this.create.bind(this);
    this.quickStart = this.quickStart.bind(this);
    this.findAll = this.findAll.bind(this);
    this.checkBatchNumber = this.checkBatchNumber.bind(this);
    this.findById = this.findById.bind(this);
    this.getBranches = this.getBranches.bind(this);
    this.getSplitPreview = this.getSplitPreview.bind(this);
    this.splitBranch = this.splitBranch.bind(this);
    this.updateStepPlanning = this.updateStepPlanning.bind(this);
    this.update = this.update.bind(this);
    this.replace = this.replace.bind(this);
    this.lockWorkOrder = this.lockWorkOrder.bind(this);
    this.getAttachedRolls = this.getAttachedRolls.bind(this);
    this.getTravelCard = this.getTravelCard.bind(this);
    this.getManifest = this.getManifest.bind(this);
    this.createManifest = this.createManifest.bind(this);
    this.listManifests = this.listManifests.bind(this);
    this.getManifestById = this.getManifestById.bind(this);
    this.cancelImpact = this.cancelImpact.bind(this);
    this.softDelete = this.softDelete.bind(this);
    this.hardDelete = this.hardDelete.bind(this);
    this.getTargetPropertiesImpact = this.getTargetPropertiesImpact.bind(this);
    this.updateTargetProperties = this.updateTargetProperties.bind(this);
  }

  /**
   * POST /api/work-orders
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = createSchema.parse(req.body);
      const result = await this.service.create(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/work-orders/quick-start
   * Mobil hızlı başlangıç: okutulan stok toplarını doğrula → WO oluştur → topları
   * bağla (tek istek). Hiç top bağlanamazsa WO geri alınır (yetim WO bırakmaz).
   */
  async quickStart(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { rollBarcodes, ...woData } = quickStartSchema.parse(req.body);
      const result = await this.service.quickStart(
        { ...woData, rollBarcodes },
        req.user?.userId,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders
   */
  async findAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.findAll(req);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders/check-batch-number?batchNumber=...&excludeId=...
   * Parti kodu alanı blur kontrolü — kaydetmeden önce benzersizlik uyarısı.
   */
  async checkBatchNumber(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchNumber = (req.query.batchNumber as string | undefined) ?? "";
      const excludeId = (req.query.excludeId as string | undefined) || undefined;
      const result = await this.service.checkBatchNumber(batchNumber, excludeId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders/:id
   */
  async findById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.findById(req.params.id as string);
      if (!result.success) {
        res.status(404).json(result);
        return;
      }
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders/:id/branches — fason dalları (lane görünümü)
   */
  async getBranches(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getBranches(req.params.id as string);
      if (!result.success) {
        res.status(404).json(result);
        return;
      }
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders/:id/split-preview?batchSplitId=... — partiyi ayırma önizleme
   */
  async getSplitPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchSplitId =
        typeof req.query.batchSplitId === "string" ? req.query.batchSplitId : "";
      if (!batchSplitId) {
        res.status(400).json({ success: false, data: null, message: "batchSplitId gerekli" });
        return;
      }
      const result = await this.service.getSplitPreview(req.params.id as string, batchSplitId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/work-orders/:id/split — partiyi yeni iş emrine ayır
   */
  async splitBranch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = splitBranchSchema.parse(req.body);
      const result = await this.service.splitBranch(req.params.id as string, body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  // K6 (2026-06-12): attachRolls/detachRolls/findAvailableForAttach controller
  // metodları kaldırıldı — HTTP uçları ölüydü (frontend çağırmıyor). Servis
  // metodları (workorder.service attachRolls/detachRolls) içeriden kullanılıyor.

  /**
   * PATCH /api/work-orders/:id
   * İş emrinin temel alanlarını günceller. Sadece PLANNED durumdayken çalışır.
   */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = updateWorkOrderSchema.parse(req.body);
      const result = await this.service.update(
        req.params.id as string,
        body,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/work-orders/:id
   * Tam replace: rota/kalem/hedef ürün/özellikler dahil tüm WO yeniden yazılır.
   * Sadece PLANNED + üretime başlanmamış WO'lar.
   */
  async replace(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = replaceWorkOrderSchema.parse(req.body);
      const result = await this.service.replace(
        req.params.id as string,
        body,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/work-orders/:id/steps/:stepId/planning
   * Adımın requiredCategory ve plannedSubcontractor alanlarını ayarlar.
   */
  async updateStepPlanning(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = updateStepPlanningSchema.parse(req.body);
      const result = await this.service.updateStepPlanning(
        req.params.id as string,
        req.params.stepId as string,
        body,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/work-orders/:id/lock
   */
  async lockWorkOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.lockWorkOrder(
        req.params.id as string,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders/:id/rolls
   */
  async getAttachedRolls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getAttachedRolls(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }


  /**
   * GET /api/work-orders/:id/travel-card
   */
  async getTravelCard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getTravelCard(req.params.id as string);
      if (!result.success) {
        res.status(404).json(result);
        return;
      }
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders/:id/manifest
   */
  async getManifest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getManifest(req.params.id as string);
      if (!result.success) {
        res.status(404).json(result);
        return;
      }
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/work-orders/:id/manifest
   * Kalıcı Çeki Listesi belgesi oluşturur.
   */
  async createManifest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const notes = typeof req.body?.notes === "string" ? req.body.notes : undefined;
      const result = await this.service.createManifest(
        req.params.id as string,
        req.user?.userId,
        notes
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders/:id/manifests
   * Geçmiş tüm manifest belgeleri.
   */
  async listManifests(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listManifests(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders/manifest-by-id/:manifestId
   * Tek manifest'i ID ile getir (snapshot dahil) — yazdırma/preview için.
   */
  async getManifestById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getManifestById(req.params.manifestId as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders/:id/cancel-impact
   * İptal önizleme: stoğa dönecek toplar + void olacak kart sayısı (read-only).
   */
  async cancelImpact(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getCancelImpact(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/work-orders/:id
   * Soft-delete: sets status = CANCELLED
   */
  async softDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.softDelete(
        req.params.id as string,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/work-orders/:id/permanent
   * Hard-delete: physically removes the record from the database
   */
  async hardDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.hardDelete(
        req.params.id as string,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders/:id/target-properties/impact
   * Frontend update öncesi "kaç rulo etkilenir" uyarısı için.
   */
  async getTargetPropertiesImpact(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getTargetPropertyChangeImpact(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/work-orders/:id/target-properties
   * Replace WO.targetProperties + senkronize bağlı Roll.properties.
   */
  async updateTargetProperties(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = targetPropertiesSchema.parse(req.body);
      const result = await this.service.updateTargetProperties(
        req.params.id as string,
        body.propertyIds,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
