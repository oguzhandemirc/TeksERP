// =============================================================================
// TeksERP - Fason Üretim Kabul (Service Production Intake) Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { StationKind } from "@prisma/client";
import { ServiceProductionService } from "../services/service-production.service";
import "../types/express-augment";

const rollSchema = z.object({
  initialQty: z.number().positive("Metraj pozitif olmalı"),
  weightKg: z.number().positive("Ağırlık pozitif olmalı").optional().nullable(),
  qualityGrade: z.string().optional().nullable(),
  width: z.number().positive("En pozitif olmalı").optional().nullable(),
  customerDescription: z.string().max(200).optional().nullable(),
});

// PACKAGING / SHIPPING rotaya konulmaz — fulfillment WO dışı.
const routeKinds = z.enum([
  "RAW_QC",
  "PROCESS_QC",
  "SUBCONTRACTOR",
  "TAMBUR",
  "OTHER",
]);

const intakeSchema = z.object({
  customerId: z.string().uuid("Geçersiz müşteri ID"),
  itemId: z.string().uuid("Geçersiz ürün ID"),
  variantId: z.string().uuid("Geçersiz varyant ID").optional().nullable(),
  servicePricePerMeter: z.number().positive("Metre başı bedel pozitif olmalı"),
  routeStationKinds: z.array(routeKinds).min(1, "En az bir rota adımı seçilmelidir"),
  batchNumber: z.string().max(40).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  rolls: z.array(rollSchema).min(1, "En az bir top bilgisi gerekli"),
});

export class ServiceProductionController {
  private service: ServiceProductionService;

  constructor() {
    this.service = new ServiceProductionService();
    this.createIntake = this.createIntake.bind(this);
  }

  /**
   * POST /api/service-production/intake
   * Fason üretim kabul — müşteri malı topları kaydet ve WO aç.
   */
  async createIntake(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = intakeSchema.parse(req.body);
      const result = await this.service.createIntake(
        {
          ...body,
          routeStationKinds: body.routeStationKinds as StationKind[],
        },
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
}
