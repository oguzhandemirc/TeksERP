// =============================================================================
// TeksERP - Inventory Controller
// =============================================================================
// Handles HTTP layer for inventory/roll operations.
// Delegates business logic to InventoryService.
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { InventoryService } from "../services/inventory.service";
import "../types/express-augment";

// Zod validation schemas
const initialEntrySchema = z.object({
  itemId:       z.string().uuid("Geçersiz ürün ID"),
  colorId:      z.string().uuid("Geçersiz renk ID").optional().nullable(),
  initialQty:   z.number().positive("Miktar pozitif olmalı"),
  weightKg:     z.number().positive("Ağırlık pozitif olmalı").optional(),
  qualityGrade: z.string().optional(),
  width:        z.number().positive("En pozitif olmalı").optional().nullable(),
  workOrderId:  z.string().uuid("Geçersiz iş emri ID").optional().nullable(),
});

const applyPropertiesSchema = z.object({
  colorId:     z.string().uuid("Geçersiz renk ID").nullable(),
  propertyIds: z.array(z.string().uuid()).default([]),
});

const openFabricSchema = z.object({
  receiptId: z.string().uuid("Geçersiz mal kabul ID"),
  stepId:    z.string().uuid("Geçersiz adım ID"),
  notes:     z.string().max(1000).optional().nullable(),
});

const kursunFinishSchema = z.object({
  totalMeters: z.number().positive("Toplam metraj pozitif olmalı"),
  errors: z
    .array(
      z.object({
        startMeter:   z.number().nonnegative("startMeter negatif olamaz"),
        endMeter:     z.number().nonnegative().optional().nullable(),
        defectTypeId: z.string().uuid().optional().nullable(),
      }),
    )
    .optional()
    .default([]),
  notes: z.string().max(1000).optional().nullable(),
});

export class InventoryController {
  private service: InventoryService;

  constructor() {
    this.service = new InventoryService();
    // Bind methods for Express route handler usage
    this.createInitialEntry = this.createInitialEntry.bind(this);
    this.findAllRolls = this.findAllRolls.bind(this);
    this.findRollById = this.findRollById.bind(this);
    this.findRollByBarcode = this.findRollByBarcode.bind(this);
    this.getRollHistory = this.getRollHistory.bind(this);
    this.softDelete = this.softDelete.bind(this);
    this.hardDelete = this.hardDelete.bind(this);
    this.applyManualProperties = this.applyManualProperties.bind(this);
    this.getKk1ContextByCard = this.getKk1ContextByCard.bind(this);
    this.createOpenFabric = this.createOpenFabric.bind(this);
    this.kursunFinish = this.kursunFinish.bind(this);
  }

  /**
   * POST /api/rolls/open-fabric
   * Kurşun/KK2'de açık kumaş Roll oluştur (boyahane fason kabul sonrası).
   */
  async createOpenFabric(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = openFabricSchema.parse(req.body);
      const result = await this.service.createOpenFabric(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/rolls/:id/kursun-finish
   * Açık kumaş Roll'unun Kurşun/KK2 sonunu işle: metraj + hata + Tambur'a ilerlet.
   */
  async kursunFinish(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = kursunFinishSchema.parse(req.body);
      const result = await this.service.kursunFinish(id, body, req.user?.userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/inventory/kk1-context/:cardBarcode
   * KK1 tabletinde refakat kartı okutulduğunda WO context döner.
   */
  async getKk1ContextByCard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cardBarcode = req.params.cardBarcode as string;
      if (!cardBarcode) {
        res.status(400).json({ success: false, message: "cardBarcode parametresi gerekli" });
        return;
      }
      const result = await this.service.getKk1ContextByCard(cardBarcode);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/rolls/:id/identity
   * Manuel renk/özellik override (hibrit mod).
   */
  async applyManualProperties(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = applyPropertiesSchema.parse(req.body);
      const result = await this.service.applyManualProperties(
        id,
        body,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/rolls/:id/history
   */
  async getRollHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const result = await this.service.getRollHistory(id);
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
   * POST /api/rolls/initial-entry
   * Create a new roll via goods receipt (Mal Kabul / QC1).
   */
  async createInitialEntry(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = initialEntrySchema.parse(req.body);
      const result = await this.service.createInitialEntry(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/rolls
   * List rolls with dynamic filtering, sorting, pagination.
   */
  async findAllRolls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.findAllRolls(req);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/rolls/:id
   * Get roll by ID with all relations.
   */
  async findRollById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const result = await this.service.findRollById(id);
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
   * GET /api/rolls/barcode/:barcode
   * Get roll by barcode (for hand-held scanner use).
   */
  async findRollByBarcode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // `/barcode/` (trailing slash, boş) Express'te `:barcode` param'ını
      // hiç route etmiyor; başka bir route'a düşüp (örn. `/:id`) yanıltıcı
      // "Top bulunamadı" mesajı veriyordu. Şu kontrol explicit 400 verir.
      // (Bu method'a giriyorsak param zaten matched ama yine de güvenlik
      // ağı — whitespace-only veya bekleneneden farklı bir string).
      const rawBarcode = req.params.barcode;
      if (typeof rawBarcode !== "string" || rawBarcode.trim() === "") {
        res.status(400).json({
          success: false,
          message: "Barkod parametresi gerekli",
        });
        return;
      }
      const result = await this.service.findRollByBarcode(rawBarcode.trim());
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
   * DELETE /api/rolls/:id
   * Soft-delete: sets roll status to SCRAP.
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
   * DELETE /api/rolls/:id/permanent
   * Hard-delete: physically removes the roll from the database.
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
}
