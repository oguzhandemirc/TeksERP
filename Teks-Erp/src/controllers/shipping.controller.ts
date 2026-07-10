import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ShippingService } from "../services/shipping.service";
import { sackSearchService } from "../services/sack-search.service";
import { buildDispatchAccountingExport } from "../services/accounting-export.service";
import "../types/express-augment";

// Çuval/Top Arama (saha #1+#23) sorgu şeması — tümü opsiyonel, kombinlenebilir.
const sackSearchQuerySchema = z.object({
  itemId: z.string().uuid("Geçersiz ürün ID").optional(),
  colorId: z.string().uuid("Geçersiz renk ID").optional(),
  width: z.coerce.number().positive("En pozitif olmalı").optional(),
  customerId: z.string().uuid("Geçersiz müşteri ID").optional(),
  shipmentNo: z.string().trim().max(64).optional(),
  sackCode: z.string().trim().max(64).optional(),
  includeDispatched: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ---- Zod şemaları ----------------------------------------------------------
const createShipmentSchema = z.object({
  orderIds: z.array(z.string().uuid("Geçersiz sipariş ID")).min(1, "En az bir sipariş seçilmeli"),
  // Saha #19: yurtiçi/yurtdışı — verilmezse DOMESTIC.
  destination: z.enum(["DOMESTIC", "EXPORT"]).optional(),
});

const destinationSchema = z.object({ destination: z.enum(["DOMESTIC", "EXPORT"]) });
// Saha #21: prosedür/ihracat kodu override (boş = temizle)
const procedureCodeSchema = z.object({
  procedureCode: z.string().trim().max(64).nullable().optional(),
});

const orderIdsSchema = z.object({
  orderIds: z.array(z.string().uuid("Geçersiz sipariş ID")).min(1, "Sipariş seçilmeli"),
});

const removeOrderSchema = z.object({ orderId: z.string().uuid("Geçersiz sipariş ID") });

const scanSchema = z.object({
  barcode: z.string().trim().min(1, "Barkod gerekli").max(64),
  // Aktif çuval — verilirse top/kartela bu çuvala yazılır (çuval-önce akış)
  sackId: z.string().uuid("Geçersiz çuval ID").optional().nullable(),
});

const removeRollSchema = z.object({ rollId: z.string().uuid("Geçersiz top ID") });
const removeSwatchSchema = z.object({ swatchId: z.string().uuid("Geçersiz kartela ID") });
// Seçerek kartela ekle — ürün+renk stok grubundan N adet (barkod okutmadan).
const addKartelaSchema = z.object({
  itemId: z.string().uuid("Geçersiz ürün ID"),
  colorId: z.string().uuid("Geçersiz renk ID").nullable().optional(),
  count: z.number().int().positive("Adet pozitif tam sayı olmalı").max(10000),
  sackId: z.string().uuid("Geçersiz çuval ID").nullable().optional(),
});
// Dolu çuval silme kısa yolu — true ise içerik depoya döndürülüp çuval silinir.
const removeSackSchema = z.object({ withContents: z.boolean().optional() });
const moveSackSchema = z.object({ sackId: z.string().uuid("Geçersiz çuval ID") });
// Saha #3: iki topun çuvalını takas et (aynı sevkiyat içi)
const swapRollsSchema = z.object({
  rollAId: z.string().uuid("Geçersiz top ID"),
  rollBId: z.string().uuid("Geçersiz top ID"),
});

const addSackSchema = z.object({
  // Çuval-önce akışta boş açılır (kg + kod sonra girilir) → opsiyonel
  weightKg: z.number().positive("Kg pozitif olmalı").max(999_999_999, "Kg çok büyük").optional().nullable(),
  sackNo: z.string().trim().min(1).max(64).optional().nullable(),
  manualCode: z.string().trim().max(64).optional().nullable(),
});
// Çuval güncelle — tartı ve/veya elle yazılan kod. En az biri verilmeli.
const weighSackSchema = z
  .object({
    weightKg: z.number().positive("Kg pozitif olmalı").max(999_999_999, "Kg çok büyük").optional(),
    manualCode: z.string().trim().max(64).optional(),
  })
  .refine((v) => v.weightKg !== undefined || v.manualCode !== undefined, {
    message: "Tartı veya çuval kodu girilmeli",
  });

const dispatchSchema = z.object({
  plateNumber: z.string().trim().max(32).optional().nullable(),
  driverName: z.string().trim().max(100).optional().nullable(),
  carrier: z.string().trim().max(100).optional().nullable(),
});

export class ShippingController {
  private service = new ShippingService();

  // ---- SEVKİYAT OTURUMU ---------------------------------------------------
  createShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createShipmentSchema.parse(req.body);
      const result = await this.service.createShipment(body, req.user?.userId);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  };

  listShipments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listShipments(req);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  getShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getShipmentById(req.params.id as string);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // Çuval Depo board'u (Electron + mobil) — hafif + cursor sayfalı + sunucu-aramalı.
  listSackStoreBoard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limitRaw = parseInt(req.query.limit as string, 10);
      const result = await this.service.listSackStoreBoard({
        status: (req.query.status as string | undefined) || undefined,
        search: (req.query.search as string | undefined) || undefined,
        destination: (req.query.destination as string | undefined) || undefined,
        cursor: (req.query.cursor as string | undefined) || undefined,
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      });
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  getShipmentSackContents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getShipmentSackContents(req.params.id as string);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // Saha #2: muhasebe sevk fişi (ürün/çuval/çeki listesi) — salt-okunur.
  getDispatchReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getDispatchReport(req.params.id as string);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // Muhasebe Excel dökümü — ekran filtresine (tarih + müşteri) göre DISPATCHED
  // veri seti (sevk listesi / detay / icmal / iade). Frontend exceljs ile basar.
  getAccountingExport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await buildDispatchAccountingExport(req);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // ---- ÇUVAL/TOP ARAMA (saha #1+#23) — salt-okunur -------------------------
  searchSacks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = sackSearchQuerySchema.parse(req.query);
      const result = await sackSearchService.searchSacks(q);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  getSackContents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await sackSearchService.getSackContents(req.params.id as string);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // Çeki listesi — seçilen çuvalların içerik özetli dökümü (salt-okunur;
  // body taşıyan okuma: id listesi query-string'e sığmaz).
  getPickList = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = z
        .object({ sackIds: z.array(z.string().uuid()).min(1).max(200) })
        .parse(req.body);
      const result = await sackSearchService.getPickList(body.sackIds);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  locateRoll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const barcode = z.string().trim().min(1, "Barkod gerekli").max(64).parse(req.query.barcode);
      const result = await sackSearchService.locateRoll(barcode);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  addOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = orderIdsSchema.parse(req.body);
      const result = await this.service.addOrders(req.params.id as string, body.orderIds, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  removeOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = removeOrderSchema.parse(req.body);
      const result = await this.service.removeOrder(req.params.id as string, body.orderId, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // ---- OKUTMA -------------------------------------------------------------
  scan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = scanSchema.parse(req.body);
      const result = await this.service.scanIntoShipment(
        { shipmentId: req.params.id as string, barcode: body.barcode, sackId: body.sackId },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  removeRoll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = removeRollSchema.parse(req.body);
      const result = await this.service.removeRollFromShipment(
        { shipmentId: req.params.id as string, rollId: body.rollId },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  removeSwatch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = removeSwatchSchema.parse(req.body);
      const result = await this.service.removeSwatchFromShipment(
        { shipmentId: req.params.id as string, swatchId: body.swatchId },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  addKartela = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = addKartelaSchema.parse(req.body);
      const result = await this.service.addKartelaToShipment(
        {
          shipmentId: req.params.id as string,
          itemId: body.itemId,
          colorId: body.colorId ?? null,
          count: body.count,
          sackId: body.sackId ?? null,
        },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  moveRollToSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = moveSackSchema.parse(req.body);
      const result = await this.service.moveRollToSack(
        { rollId: req.params.rollId as string, sackId: body.sackId },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  swapRollSacks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = swapRollsSchema.parse(req.body);
      const result = await this.service.swapRollSacks(body, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  setDestination = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = destinationSchema.parse(req.body);
      const result = await this.service.setDestination(
        req.params.id as string,
        body.destination,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  retargetOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = orderIdsSchema.parse(req.body);
      const result = await this.service.retargetOrders(req.params.id as string, body.orderIds, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // Saha #7 (artımlı): retarget SALT-OKUNUR önizleme — aday sipariş kümesi için
  // karşılanma projeksiyonu (commit etmeden). DB'ye yazmaz.
  retargetPreview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = orderIdsSchema.parse(req.body);
      const result = await this.service.previewRetargetOrders(req.params.id as string, body.orderIds);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  setProcedureCode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = procedureCodeSchema.parse(req.body);
      const result = await this.service.setProcedureCode(
        req.params.id as string,
        body.procedureCode ?? null,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // ---- ÇUVAL (tartı) ------------------------------------------------------
  addSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = addSackSchema.parse(req.body);
      const result = await this.service.addSack(
        { shipmentId: req.params.id as string, weightKg: body.weightKg, sackNo: body.sackNo, manualCode: body.manualCode },
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  };

  weighSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = weighSackSchema.parse(req.body);
      const result = await this.service.updateSack(
        { sackId: req.params.id as string, weightKg: body.weightKg, manualCode: body.manualCode },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  removeSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = removeSackSchema.parse(req.body ?? {});
      const result = await this.service.removeSack(
        req.params.id as string,
        req.user?.userId,
        body.withContents ?? false
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // ---- SEVKE HAZIR / SEVK / İPTAL ----------------------------------------
  markReady = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.markReady(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  unmarkReady = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.unmarkReady(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  moveToDoor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.moveToDoor(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  pullBackFromDoor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.pullBackFromDoor(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  dispatchShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = dispatchSchema.parse(req.body);
      const result = await this.service.dispatchShipment(req.params.id as string, body, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  cancelPreview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getCancelPreview(req.params.id as string);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  cancelShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.cancelShipment(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // ---- SİPARİŞ SEÇİM (Mod A) ---------------------------------------------
  openOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const branchRaw = req.query.branchId as string | undefined;
      const result = await this.service.listOpenOrdersWithCoverage({
        customerId: (req.query.customerId as string | undefined) || undefined,
        branchId: branchRaw === undefined ? undefined : branchRaw || null,
      });
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };
}
