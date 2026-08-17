// =============================================================================
// TeksERP - WorkOrder Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { WorkOrderService } from "../services/workorder.service";
import { workOrderLinkService } from "../services/workorder-link.service";
import { foldTypeSchema } from "../services/helpers/fold-type";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { AppError } from "../utils/app-error";
import "../types/express-augment";

// Create + quick-start ortak alan şeması. refine'siz tutuluyor ki spread ile
// (quickStartSchema) yeniden kullanılabilsin — refine ZodEffects'e çevirir, spread'i bozar.
const workOrderCoreShape = {
  batchNumber:       z.string().trim().min(1).max(64, "Parti kodu en fazla 64 karakter olabilir").optional().nullable(),
  // İdempotency anahtarı — istemci form-oturumu başına üretir (UUID); timeout
  // sonrası tekrar gönderimde aynı token cached WO döner (mükerrer İE önlenir).
  // Yalnız create + quick-start alır; replace/update şemaları bilinçli almaz.
  clientToken:       z.string().uuid("Geçersiz istemci anahtarı").optional(),
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
  foldType:          foldTypeSchema,
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
  // İlk rota adımı fason (EXTERNAL) ise: WO oluşturulduktan sonra o adıma
  // planlanan firmaya otomatik fason sevki de yapılır (çeki listesi dahil).
  // Mobil "Fasona Gönder" toggle'ı; ilk adım fason değilse/firma yoksa yok sayılır.
  dispatchFirstStep: z.boolean().optional(),
}).refine(hasRoute, ROUTE_REFINE_MSG);

const targetPropertiesSchema = z.object({
  propertyIds: z.array(z.string().uuid()),
});

const splitBranchSchema = z.object({
  batchId: z.string().uuid(),
  mode: z.enum(["REDYE_SAME_COLOR", "NEW_COLOR", "UNDYED_MOVE"]),
  /** Yalnız NEW_COLOR modunda gerekli; REDYE_SAME_COLOR'da yasak. */
  newColorId: z.string().uuid().optional().nullable(),
  orderMode: z.enum(["stock", "keep"]).default("stock"),
  /** Ayrılacak topların alt-kümesi (yok/boş = partinin tümü uygun toplar). */
  rollIds: z.array(z.string().uuid()).max(500).optional(),
  /** Tebdil sebebi (opsiyonel) — audit'e yazılır (renk/ton reddi vb.). */
  reason: z.string().max(500).optional(),
});

// Manuel konum düzeltme: parti (batchId) VEYA seçili toplar (rollIds) → hedef adım.
const manualMovePreviewSchema = z
  .object({
    batchId: z.string().uuid().optional(),
    rollIds: z.array(z.string().uuid()).max(500).optional(),
    targetStepId: z.string().uuid(),
  })
  .refine((v) => Boolean(v.batchId) || (v.rollIds && v.rollIds.length > 0), {
    message: "batchId veya rollIds gerekli",
  });

const manualMoveSchema = z
  .object({
    batchId: z.string().uuid().optional(),
    rollIds: z.array(z.string().uuid()).max(500).optional(),
    targetStepId: z.string().uuid(),
    /** keep = kimlik korunur · new = yeni parti (splitFrom) · join = hedef partiye kat. */
    partyMode: z.enum(["keep", "new", "join"]).optional(),
    joinBatchId: z.string().uuid().optional(),
    reason: z.string().min(3).max(500),
  })
  .refine((v) => Boolean(v.batchId) || (v.rollIds && v.rollIds.length > 0), {
    message: "batchId veya rollIds gerekli",
  });

// Manuel kapatma: istasyonda kalan her top için dispozisyon kararı (WIP disposition).
// Kalite yalnız WAREHOUSE/A1_STOCK'ta anlamlı ve OPSİYONEL — servis diğer aksiyonlarda
// gelirse reddeder. `reason` dispozisyon varsa zorunlu (servis doğrular).
const cancelSchema = z.object({
  reason: z.string().trim().min(3, "İptal nedeni en az 3 karakter olmalı").max(500),
  /**
   * İşlemdeki topların ALT KÜMESİ — gönderilmeyen top varsayılan `STOCK`'a döner.
   * Kapatmadaki altı aksiyondan farklı olarak üç seçenek: iptal "üretildi" demez.
   * ⚠️ `z.object` bilinmeyen anahtarı sessizce ATAR — `qualityGradeId` gönderen bir
   * istemci 400 almaz, alan düşer. Üç aksiyonda kalite anlamsız olduğu için bu
   * kabul edilir; aksiyon kümesi genişletilirse şema da genişletilmeli.
   */
  dispositions: z
    .array(
      z.object({
        rollId: z.string().uuid("Geçersiz top ID"),
        action: z.enum(["STOCK", "SCRAP", "CANCELLED"]),
      })
    )
    .max(200, "Tek iptalde en fazla 200 top için karar verilebilir")
    .optional(),
});

/** Parti düşürme — iptalle AYNI üç aksiyon (kapsam farklı, karar dili aynı). */
const batchDropSchema = z.object({
  reason: z.string().trim().min(3, "Düşürme nedeni en az 3 karakter olmalı").max(500),
  dispositions: z
    .array(
      z.object({
        rollId: z.string().uuid("Geçersiz top ID"),
        action: z.enum(["STOCK", "SCRAP", "CANCELLED"]),
      })
    )
    .max(200, "Tek işlemde en fazla 200 top için karar verilebilir")
    .optional(),
});

const completeSchema = z.object({
  reason: z.string().max(500).optional(),
  dispositions: z
    .array(
      z.object({
        rollId: z.string().uuid("Geçersiz top ID"),
        action: z.enum(["STOCK", "WAREHOUSE", "A1_STOCK", "SCRAP", "CANCELLED", "TRANSFER"]),
        qualityGradeId: z.string().uuid().optional().nullable(),
      }),
    )
    .max(200)
    .optional(),
  /** TRANSFER varsa: yeni iş emri siparişe bağlı kalsın mı ("keep") yoksa stok mu. */
  transferOrderMode: z.enum(["stock", "keep"]).optional(),
});

const updateStepPlanningSchema = z.object({
  requiredCategoryId: z.string().uuid().nullable().optional(),
  plannedSubcontractorId: z.string().uuid().nullable().optional(),
  // 2026-08-17 "ekru" kuralı — adım fasona renksiz gitsin (bkz. schema.prisma).
  dispatchWithoutColor: z.boolean().optional(),
});

// ── Sipariş bağlama + hedef düzeltme şemaları (2026-08-17) ───────────────────
const linkOrderLinesSchema = z.object({
  orderLineIds: z
    .array(z.string().uuid("Geçersiz sipariş satırı ID"))
    .min(1, "En az bir sipariş satırı seçmelisiniz"),
});
// `reason` ZORUNLU ve boş geçilemez: bu iki uç varlık sebebini sebepten alıyor.
// Sebepsiz bir renk/en değişikliği zaten "Düzenle" ekranında vardı.
const changeTargetColorSchema = z.object({
  colorId: z.string().uuid("Geçersiz renk ID").nullable().optional(),
  reason: z.string().trim().min(3, "Sebep yazmalısınız").max(500),
});
const changeWidthSchema = z.object({
  width: z.number().positive("En pozitif olmalı").max(1000, "En en fazla 1000 cm").nullable().optional(),
  reason: z.string().trim().min(3, "Sebep yazmalısınız").max(500),
  source: z.enum(["MANUAL", "FASON_RECEIPT"]).optional().default("MANUAL"),
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
  foldType: foldTypeSchema,
});

/**
 * Full replace: createSchema ile aynı yapı. Sadece PLANNED + üretime başlanmamış
 * iş emirlerinde çalışır. Rota, kalemler, hedef ürün/özellikler hepsi değişebilir.
 */
const replaceWorkOrderSchema = z.object({
  batchNumber:       z.string().trim().min(1).max(64, "Parti kodu en fazla 64 karakter olabilir").optional().nullable(),
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
  foldType:          foldTypeSchema,
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
    this.getBatchTimeline = this.getBatchTimeline.bind(this);
    this.getSplitPreview = this.getSplitPreview.bind(this);
    this.splitBranch = this.splitBranch.bind(this);
    this.getManualMovePreview = this.getManualMovePreview.bind(this);
    this.manualMove = this.manualMove.bind(this);
    this.updateStepPlanning = this.updateStepPlanning.bind(this);
    // ⚠️ Yeni metot ekleyen HERKES buraya da yazmalı. `print-event` ucu 2026-08-05'te
    // tam bu satır unutulduğu için aylarca 500 verdi ve servis testleri göremedi.
    this.getLinkableOrderLines = this.getLinkableOrderLines.bind(this);
    this.linkOrderLines = this.linkOrderLines.bind(this);
    this.unlinkOrderLine = this.unlinkOrderLine.bind(this);
    this.changeTargetColor = this.changeTargetColor.bind(this);
    this.changeWidth = this.changeWidth.bind(this);
    this.update = this.update.bind(this);
    this.replace = this.replace.bind(this);
    this.lockWorkOrder = this.lockWorkOrder.bind(this);
    this.getAttachedRolls = this.getAttachedRolls.bind(this);
    this.getDocuments = this.getDocuments.bind(this);
    this.getTravelCard = this.getTravelCard.bind(this);
    this.getManifest = this.getManifest.bind(this);
    this.createManifest = this.createManifest.bind(this);
    this.listManifests = this.listManifests.bind(this);
    this.getManifestById = this.getManifestById.bind(this);
    this.cancelImpact = this.cancelImpact.bind(this);
    this.softDelete = this.softDelete.bind(this);
    this.cancelWorkOrder = this.cancelWorkOrder.bind(this);
    this.batchDropPreview = this.batchDropPreview.bind(this);
    this.dropBatch = this.dropBatch.bind(this);
    this.completePreview = this.completePreview.bind(this);
    this.completeWorkOrder = this.completeWorkOrder.bind(this);
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
   * İş emri no alanı blur kontrolü — kaydetmeden önce benzersizlik uyarısı.
   * KÖPRÜ (Faz 2): query alanı hâlâ `batchNumber` adıyla geliyor (Electron Faz 6'da
   * `workOrderNumber`'a döner); değer artık İŞ EMRİ NO'yu (İE…) kontrol eder. Yanıtta
   * yeni `workOrderNumber` + eski `batchNumber` (alias) birlikte döner.
   */
  async checkBatchNumber(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workOrderNumber =
        (req.query.workOrderNumber as string | undefined) ??
        (req.query.batchNumber as string | undefined) ??
        "";
      const excludeId = (req.query.excludeId as string | undefined) || undefined;
      const result = await this.service.checkWorkOrderNumber(workOrderNumber, excludeId);
      res.status(200).json({
        success: true,
        data: { ...result, batchNumber: result.workOrderNumber },
      });
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
   * GET /api/work-orders/:id/batches/:batchId/timeline — parti rota-zaman çizelgesi
   * (birleşik hareket + operasyon geçmişi, adıma göre gruplu).
   */
  async getBatchTimeline(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getBatchTimeline(
        req.params.id as string,
        req.params.batchId as string,
      );
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
   * GET /api/work-orders/:id/split-preview?batchId=... — partiyi ayırma önizleme
   */
  async getSplitPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId =
        typeof req.query.batchId === "string" ? req.query.batchId : "";
      if (!batchId) {
        res.status(400).json({ success: false, data: null, message: "batchId gerekli" });
        return;
      }
      const result = await this.service.getSplitPreview(req.params.id as string, batchId);
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

  /**
   * POST /api/work-orders/:id/manual-move-preview — manuel konum düzeltme önizleme
   * (salt-okunur; rollIds array gövdede taşınsın diye POST).
   */
  async getManualMovePreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = manualMovePreviewSchema.parse(req.body);
      const result = await this.service.getManualMovePreview(req.params.id as string, body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/work-orders/:id/manual-move — parti/top bazında rotada manuel taşıma
   */
  async manualMove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = manualMoveSchema.parse(req.body);
      const result = await this.service.manualMove(req.params.id as string, body, req.user?.userId);
      res.status(200).json(result);
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

  // ── Sipariş bağlama + hedef düzeltme (2026-08-17 talepleri 8/10/12) ────────

  /** GET /api/work-orders/:id/linkable-order-lines */
  async getLinkableOrderLines(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await workOrderLinkService.getLinkableOrderLines(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/work-orders/:id/order-links — YALNIZ bağ kurar, miras almaz. */
  async linkOrderLines(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = linkOrderLinesSchema.parse(req.body);
      const result = await workOrderLinkService.linkOrderLines(
        req.params.id as string,
        body.orderLineIds,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /api/work-orders/:id/order-links/:orderLineId */
  async unlinkOrderLine(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await workOrderLinkService.unlinkOrderLine(
        req.params.id as string,
        req.params.orderLineId as string,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /api/work-orders/:id/target-color */
  async changeTargetColor(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = changeTargetColorSchema.parse(req.body);
      const result = await workOrderLinkService.changeTargetColor(
        req.params.id as string,
        body.colorId ?? null,
        body.reason,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /api/work-orders/:id/width */
  async changeWidth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = changeWidthSchema.parse(req.body);
      const result = await workOrderLinkService.changeWidth(
        req.params.id as string,
        body.width ?? null,
        body.reason,
        req.user?.userId,
        body.source,
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
   * GET /api/work-orders/:id/documents — iş emrinin TÜM belgeleri (tek liste)
   */
  async getDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getDocuments(req.params.id as string);
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
   * POST /api/work-orders/:id/cancel
   * Karar vererek iptal: gerekçe ZORUNLU + istasyondaki toplar için üç seçenek.
   *
   * ⚠️ Neden `DELETE` değil de ayrı bir POST: gövdeli DELETE bazı ara katmanlarda
   * sessizce düşer (bu repo aynı kararı `inventory.controller.ts` iptal ucunda da
   * verdi) ve 200 satırlık karar listesi query string'e sığmaz. Ayrıca `DELETE /:id`
   * dokunulmadan kalınca sahadaki eski mobil APK'lar YAPISAL olarak çalışmaya devam
   * eder — geriye uyum ispatlanacak bir şey değil, kurulumun sonucu olur.
   */
  async cancelWorkOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = cancelSchema.parse(req.body ?? {});
      // Yetki kontrolü STOCK'u DIŞLAR: `STOCK` bu ucun bugün de `workorder:write`
      // ile ürettiği sonuçtur, onun için süpervizör yetkisi istemek mobil iptali
      // yeni APK açık karar göndermeye başladığı gün kırardı. Envanteri yok eden
      // `SCRAP`/`CANCELLED` ise tam olarak `roll:manual-adjust`'ın konusudur.
      const needsAdjust = (body.dispositions ?? []).some((d) => d.action !== "STOCK");
      if (needsAdjust && !matchesPermission(req.user?.permissions ?? [], "roll:manual-adjust")) {
        throw AppError.forbidden(
          "Fire / hatalı kayıt kararı için 'roll:manual-adjust' yetkisi gerekli."
        );
      }
      const result = await this.service.softDelete(
        req.params.id as string,
        req.user?.userId,
        body
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/work-orders/:id/batches/:batchId/drop-preview */
  async batchDropPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getBatchDropPreview(
        req.params.id as string,
        req.params.batchId as string
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/work-orders/:id/batches/:batchId/drop
   * Partiyi iş emrinden düşürür — iş emri diğer partileriyle DEVAM eder.
   */
  async dropBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = batchDropSchema.parse(req.body ?? {});
      const needsAdjust = (body.dispositions ?? []).some((d) => d.action !== "STOCK");
      if (needsAdjust && !matchesPermission(req.user?.permissions ?? [], "roll:manual-adjust")) {
        throw AppError.forbidden(
          "Fire / hatalı kayıt kararı için 'roll:manual-adjust' yetkisi gerekli."
        );
      }
      const result = await this.service.dropBatch(
        req.params.id as string,
        req.params.batchId as string,
        body,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders/:id/complete-preview
   * Manuel kapatma önizleme: atlanacak adımlar + engelleyen in-flight top (read-only).
   */
  async completePreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getCompletePreview(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/work-orders/:id/complete
   * Manuel kapatma: IN_PROGRESS WO'yu COMPLETED'a çeker. İstasyonda kalan toplar
   * için `dispositions` taşınır (bkz. completeSchema).
   *
   * Koşullu yetki: dispozisyon top statüsü değiştirdiği için `roll:manual-adjust`
   * de aranır (`workorder:write` route'ta zaten var). RBAC middleware koşullu
   * çalışmadığından kontrol burada — payload'a bakmak gerekiyor.
   */
  async completeWorkOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = completeSchema.parse(req.body ?? {});
      if (body.dispositions && body.dispositions.length > 0) {
        if (!matchesPermission(req.user?.permissions ?? [], "roll:manual-adjust")) {
          throw AppError.forbidden(
            "İşlemdeki topların statüsüne karar vermek için 'roll:manual-adjust' yetkisi gerekli."
          );
        }
      }
      const result = await this.service.completeWorkOrder(
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
