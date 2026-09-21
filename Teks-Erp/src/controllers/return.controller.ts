import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ReturnService } from "../services/return.service";
import { lookupLotForReturn, lookupShipmentForReturn } from "../services/helpers/return-scope.helper";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import "../types/express-augment";

// ---- Zod şemaları ----------------------------------------------------------
const createReturnSchema = z.object({
  // Tekil iade (mobil + eski istemciler). ÇOKLU iadede `rollIds` gönderilir; en az
  // biri zorunlu (servis boş listeyi 400'le reddeder, ama kontrat burada da yazılı).
  rollId: z.string().uuid("Geçersiz top ID").optional(),
  rollIds: z.array(z.string().uuid("Geçersiz top ID")).max(200).optional(),
  // Personelin seçtiği sipariş (tek aday otomatik; yoksa null)
  orderId: z.string().uuid("Geçersiz sipariş ID").optional().nullable(),
  // İade nedeni — seçilebilir (katalog) ve/veya yazılabilir; ikisi de opsiyonel/boş
  reasonId: z.string().uuid("Geçersiz neden ID").optional().nullable(),
  reasonText: z.string().trim().max(500).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  // Kalite override — yalnız returnGradingEnabled açıkken honor edilir (servis enforce eder)
  qualityGradeId: z.string().uuid("Geçersiz kalite ID").optional().nullable(),
}).refine((v) => Boolean(v.rollId) || (v.rollIds?.length ?? 0) > 0, {
  message: "İade alınacak top seçilmeli (rollId veya rollIds)",
  path: ["rollId"],
});

// Toplu iade (sevkiyat / sevk partisi kapsamı): grup = tek sevkiyatın topları.
const createReturnBatchSchema = z.object({
  groups: z
    .array(
      z.object({
        rollIds: z.array(z.string().uuid("Geçersiz top ID")).min(1).max(200),
        orderId: z.string().uuid("Geçersiz sipariş ID").optional().nullable(),
      }),
    )
    .min(1, "En az bir grup")
    .max(50),
  reasonId: z.string().uuid("Geçersiz neden ID").optional().nullable(),
  reasonText: z.string().trim().max(500).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  qualityGradeId: z.string().uuid("Geçersiz kalite ID").optional().nullable(),
});
const lookupShipmentSchema = z
  .object({
    shipmentNo: z.string().trim().min(1).max(64).optional(),
    shipmentId: z.string().uuid("Geçersiz sevkiyat ID").optional(),
  })
  .refine((v) => Boolean(v.shipmentNo) || Boolean(v.shipmentId), { message: "shipmentNo ya da shipmentId gerekli" });

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

  /** Çuval kodu okut → çuvalın sevk edilmiş topları (toplu iade girişi). */
  lookupSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const code = (req.query.sackCode as string | undefined) ?? "";
      const result = await this.service.lookupSackForReturn(code);
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

  createBatch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createReturnBatchSchema.parse(req.body ?? {});
      res.status(201).json(await this.service.createReturnBatch(body, req.user?.userId));
    } catch (e) { next(e); }
  };

  // ---- Kapsam sorguları (sevkiyat · sevk partisi) — helper, servis değil ------
  lookupShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = lookupShipmentSchema.parse({
        shipmentNo: typeof req.query.shipmentNo === "string" ? req.query.shipmentNo : undefined,
        shipmentId: typeof req.query.shipmentId === "string" ? req.query.shipmentId : undefined,
      });
      res.status(200).json(await lookupShipmentForReturn(q));
    } catch (e) { next(e); }
  };

  lookupLot = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = z.string().uuid("Geçersiz sevk partisi ID").parse(req.query.packingGroupId);
      res.status(200).json(await lookupLotForReturn(id));
    } catch (e) { next(e); }
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
      const id = assertValidUuid(req.params.id);
      const result = await this.service.getReturnById(id);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  /** İade kaydını düzelt (neden + not) — top statüsü/sevkiyatı değişmez. */
  edit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = assertValidUuid(req.params.id);
      const body = editReturnSchema.parse(req.body);
      const result = await this.service.editReturn(
        id,
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
      const id = assertValidUuid(req.params.id);
      const body = cancelReturnSchema.parse(req.body);
      const result = await this.service.cancelReturn(
        id,
        body.reason,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };
}
