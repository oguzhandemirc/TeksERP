// =============================================================================
// El terminali sevkiyat (v2) — HTTP + Zod. Gövde `services/shipping/handheld-*.ts`; bayrak kapısı serviste.
// Gövdeler `.strict()`: istemci sessiz allowlist'tir, bilinmeyen alan 400 olur (sözleşme PLAN-elt-sevk-v2 §a).
// =============================================================================
import { Request, Response, NextFunction } from "express";
import { z } from "zod";

import { ShippingService } from "../services/shipping.service";
import { requestImmediatePhotoRetentionRun } from "../jobs/gelen-belge-foto-saklama.job";
import "../types/express-augment";

const openSchema = z.object({
  customerId: z.string().uuid("Geçersiz cari"),
  branchId: z.string().uuid("Geçersiz şube").nullable().optional(),
  clientToken: z.string().uuid("Geçersiz istek anahtarı"),
}).strict();

const scanSchema = z.object({
  barcode: z.string().trim().min(1, "Barkod boş").max(64, "Barkod en fazla 64 karakter"),
  targetSackId: z.string().uuid("Geçersiz çuval").nullable(),
  confirmRemove: z.boolean().optional(),
  confirmNotReady: z.boolean().optional(),
  isRetry: z.boolean().optional(),
  clientToken: z.string().uuid("Geçersiz istek anahtarı"),
}).strict();

const sackOpenSchema = z.object({ clientToken: z.string().uuid("Geçersiz istek anahtarı") }).strict();

const weightSchema = z.object({
  weightKg: z.number().positive("Kg sıfırdan büyük olmalı").max(9999.999, "Kg en fazla 9999,999").nullable(),
}).strict();

const dispatchSchema = z.object({
  plateNumber: z.string().trim().max(20, "Plaka en fazla 20 karakter").nullable().optional(),
  driverName: z.string().trim().max(100, "Şoför adı en fazla 100 karakter").nullable().optional(),
  expectedRollCount: z.number().int().min(0),
}).strict();

export class ShippingHandheldController {
  private service = new ShippingService();

  open = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = openSchema.parse(req.body);
      const r = await this.service.openHandheldShipment(body, req.user?.userId);
      res.status(r.created ? 201 : 200).json({ success: true, data: r.state, message: r.created ? `Sevkiyat açıldı: ${r.state.shipment.shipmentNo}` : `Sevkiyat zaten açılmış: ${r.state.shipment.shipmentNo}` });
    } catch (e) { next(e); }
  };

  state = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const state = await this.service.getHandheldLoadState(req.params.id as string);
      res.status(200).json({ success: true, data: state });
    } catch (e) { next(e); }
  };

  scan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = scanSchema.parse(req.body);
      const data = await this.service.scanIntoShipment(req.params.id as string, body, req.user?.userId);
      res.status(200).json({ success: true, data });
    } catch (e) { next(e); }
  };

  openSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = sackOpenSchema.parse(req.body);
      const r = await this.service.openSackInShipment(req.params.id as string, body, req.user?.userId);
      res.status(r.created ? 201 : 200).json({ success: true, data: { sack: r.sack, state: r.state }, message: `Çuval açıldı: ${r.sack.sackNo}` });
    } catch (e) { next(e); }
  };

  weight = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = weightSchema.parse(req.body);
      const r = await this.service.setSackWeightInShipment(req.params.id as string, req.params.sackId as string, body, { userId: req.user?.userId, permissions: req.user?.permissions });
      res.status(200).json({ success: true, data: { state: r.state }, ...(r.warning ? { warnings: [r.warning] } : {}) });
    } catch (e) { next(e); }
  };

  dispatch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = dispatchSchema.parse(req.body);
      const data = await this.service.handheldDispatch(req.params.id as string, body, req.user?.userId);
      // K28 "sevkte sil" — eski sevk ucuyla aynı kanca.
      if (!data.replayed) requestImmediatePhotoRetentionRun();
      res.status(200).json({ success: true, data, message: `Sevk edildi: ${data.shipmentNo}` });
    } catch (e) { next(e); }
  };
}
