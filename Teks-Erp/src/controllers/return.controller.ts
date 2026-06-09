import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ReturnService } from "../services/return.service";
import "../types/express-augment";

// ---- Zod şemaları ----------------------------------------------------------
const createReturnSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  // Personelin seçtiği sipariş (tek aday otomatik; yoksa null)
  orderId: z.string().uuid("Geçersiz sipariş ID").optional().nullable(),
  // İade nedeni — seçilebilir (katalog) ve/veya yazılabilir; ikisi de opsiyonel/boş
  reasonId: z.string().uuid("Geçersiz neden ID").optional().nullable(),
  reasonText: z.string().trim().max(500).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  // Kalite override — yalnız returnGradingEnabled açıkken honor edilir (servis enforce eder)
  qualityGradeId: z.string().uuid("Geçersiz kalite ID").optional().nullable(),
});

const cancelReturnSchema = z.object({
  reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter olmalı").max(500),
});

// Düzelt — yalnız defter alanları (neden + not). Gönderilmeyen alan dokunulmaz.
const editReturnSchema = z.object({
  reasonId: z.string().uuid("Geçersiz neden ID").optional().nullable(),
  reasonText: z.string().trim().max(500).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

export class ReturnController {
  private service = new ReturnService();

  /** QR okut → iade ekranı için top + sevkiyat + aday siparişler + flag. */
  lookup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const barcode = (req.query.barcode as string | undefined) ?? "";
      const result = await this.service.lookupForReturn(barcode);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  /** İade al → top Hazır Depo'ya + RollReturn kaydı. */
  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createReturnSchema.parse(req.body);
      const result = await this.service.createReturn(body, req.user?.userId);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  };

  /** İade Takibi raporu — filtre + toplam. */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listReturns(req);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  /** Tek iade kaydı detayı (geçmiş ekranı detay sheet'i). */
  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getReturnById(req.params.id as string);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  /** İade kaydını düzelt (neden + not) — top statüsü/sevkiyatı değişmez. */
  edit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = editReturnSchema.parse(req.body);
      const result = await this.service.editReturn(
        req.params.id as string,
        body,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  /** İadeyi iptal et (geri al) — sebep zorunlu; top sevkiyatına geri döner. */
  cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = cancelReturnSchema.parse(req.body);
      const result = await this.service.cancelReturn(
        req.params.id as string,
        body.reason,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };
}
