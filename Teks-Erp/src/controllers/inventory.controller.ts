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
  variantId:    z.string().uuid("Geçersiz varyant ID").optional().nullable(),
  initialQty:   z.number().positive("Miktar pozitif olmalı"),
  weightKg:     z.number().positive("Ağırlık pozitif olmalı").optional(),
  qualityGrade: z.string().optional(),
  width:        z.number().positive("En pozitif olmalı").optional(),
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
    this.softDelete = this.softDelete.bind(this);
    this.hardDelete = this.hardDelete.bind(this);
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
      const barcode = req.params.barcode as string;
      const result = await this.service.findRollByBarcode(barcode);
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
