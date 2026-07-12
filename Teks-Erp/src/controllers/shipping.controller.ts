import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ShippingService } from "../services/shipping.service";
import { sackSearchService, type SackSearchScope } from "../services/sack-search.service";
import { buildDispatchAccountingExport } from "../services/accounting-export.service";
import "../types/express-augment";

// ---- Zod şemaları ----------------------------------------------------------
// Çuval aç — müşteri OPSİYONEL (depoda genel stok da olabilir).
const openSackSchema = z.object({
  customerId: z.string().uuid("Geçersiz müşteri ID").nullable().optional(),
  branchId: z.string().uuid("Geçersiz şube ID").nullable().optional(),
  weightKg: z.number().positive("Kg pozitif olmalı").max(999_999_999, "Kg çok büyük").optional().nullable(),
  sackNo: z.string().trim().min(1).max(64).optional().nullable(),
});
const scanSchema = z.object({ barcode: z.string().trim().min(1, "Barkod gerekli").max(64) });
const addKartelaSchema = z.object({
  itemId: z.string().uuid("Geçersiz ürün ID"),
  colorId: z.string().uuid("Geçersiz renk ID").nullable().optional(),
  count: z.number().int().positive("Adet pozitif tam sayı olmalı").max(10000),
});
const weighSackSchema = z.object({
  weightKg: z.number().positive("Kg pozitif olmalı").max(999_999_999, "Kg çok büyük"),
});
const removeSackSchema = z.object({ withContents: z.boolean().optional() });
const distributeSackSchema = z.object({
  rollIds: z.array(z.string().uuid()).optional(),
  swatchIds: z.array(z.string().uuid()).optional(),
});
const moveRollsSchema = z.object({
  rollIds: z.array(z.string().uuid()).min(1, "En az bir top seçilmeli"),
  targetSackId: z.string().uuid(),
});
const moveSackSchema = z.object({ sackId: z.string().uuid("Geçersiz çuval ID") });

// Sevkiyat kur — depodan çuval seç + müşteri/şube ata + (opsiyonel) sipariş seç.
const createShipmentSchema = z.object({
  sackIds: z.array(z.string().uuid("Geçersiz çuval ID")).min(1, "En az bir çuval seçilmeli"),
  customerId: z.string().uuid("Geçersiz müşteri ID"),
  branchId: z.string().uuid("Geçersiz şube ID").nullable().optional(),
  orderIds: z.array(z.string().uuid("Geçersiz sipariş ID")).optional(),
  destination: z.enum(["DOMESTIC", "EXPORT"]).optional(),
  procedureCode: z.string().trim().max(64).nullable().optional(),
  // Sevk onayı kapalıyken (varsayılan) doğrudan sevk → araç bilgisi opsiyonel.
  plateNumber: z.string().trim().max(32).nullable().optional(),
  driverName: z.string().trim().max(100).nullable().optional(),
  carrier: z.string().trim().max(100).nullable().optional(),
});
// Sevk önizleme — çuval + (opsiyonel) müşteri/şube/sipariş; salt-okunur.
const previewShipmentSchema = z.object({
  sackIds: z.array(z.string().uuid("Geçersiz çuval ID")).min(1, "Çuval seçilmeli").max(500),
  customerId: z.string().uuid("Geçersiz müşteri ID").nullable().optional(),
  branchId: z.string().uuid("Geçersiz şube ID").nullable().optional(),
  orderIds: z.array(z.string().uuid("Geçersiz sipariş ID")).optional(),
});
const sackIdsSchema = z.object({ sackIds: z.array(z.string().uuid("Geçersiz çuval ID")).min(1, "Çuval seçilmeli").max(500) });
const removeShipmentSackSchema = z.object({ sackId: z.string().uuid("Geçersiz çuval ID") });
const destinationSchema = z.object({ destination: z.enum(["DOMESTIC", "EXPORT"]) });
const procedureCodeSchema = z.object({ procedureCode: z.string().trim().max(64).nullable().optional() });
const dispatchSchema = z.object({
  plateNumber: z.string().trim().max(32).optional().nullable(),
  driverName: z.string().trim().max(100).optional().nullable(),
  carrier: z.string().trim().max(100).optional().nullable(),
});

export class ShippingController {
  private service = new ShippingService();

  // ---- ÇUVAL DEPO (çuval aç / okut / tart) --------------------------------
  openSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = openSackSchema.parse(req.body);
      const result = await this.service.openSack({ customerId: body.customerId ?? null, branchId: body.branchId ?? null, weightKg: body.weightKg, sackNo: body.sackNo }, req.user?.userId);
      res.status(201).json(result);
    } catch (e) { next(e); }
  };

  scanIntoSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = scanSchema.parse(req.body);
      const result = await this.service.scanIntoSack({ sackId: req.params.id as string, barcode: body.barcode }, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  addKartelaToSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = addKartelaSchema.parse(req.body);
      const result = await this.service.addKartelaToSack({ sackId: req.params.id as string, itemId: body.itemId, colorId: body.colorId ?? null, count: body.count }, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  weighSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = weighSackSchema.parse(req.body);
      const result = await this.service.weighSack({ sackId: req.params.id as string, weightKg: body.weightKg }, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  removeSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = removeSackSchema.parse(req.body ?? {});
      const result = await this.service.removeSack(req.params.id as string, req.user?.userId, body.withContents ?? false);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  removeRollFromSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.removeRollFromSack({ rollId: req.params.rollId as string }, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  removeSwatchFromSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.removeSwatchFromSack({ swatchId: req.params.swatchId as string }, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  moveRollToSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = moveSackSchema.parse(req.body);
      const result = await this.service.moveRollToSack({ rollId: req.params.rollId as string, sackId: body.sackId }, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /** Çuvalı dağıt — seçili (rollIds/swatchIds) veya tüm içeriği depoya çıkar. */
  distributeSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = distributeSackSchema.parse(req.body ?? {});
      const result = await this.service.distributeSackContents(
        { sackId: req.params.id as string, rollIds: body.rollIds, swatchIds: body.swatchIds },
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /** Seçili topları başka depo çuvalına toplu taşı. */
  moveRollsToSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = moveRollsSchema.parse(req.body);
      const result = await this.service.moveRollsToSack(
        { sackId: req.params.id as string, rollIds: body.rollIds, targetSackId: body.targetSackId },
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  listPool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listPool({ customerId: (req.query.customerId as string | undefined) || undefined, search: (req.query.search as string | undefined) || undefined });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  listCustomerPoolSacks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const customerId = z.string().uuid("Geçersiz müşteri ID").parse(req.query.customerId);
      const result = await this.service.listCustomerPoolSacks(customerId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- SEVKİYAT (depodan çuval seçerek kur + yaşam döngüsü) -----------------
  createShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createShipmentSchema.parse(req.body);
      const result = await this.service.createShipment({ sackIds: body.sackIds, customerId: body.customerId, branchId: body.branchId ?? null, orderIds: body.orderIds, destination: body.destination, procedureCode: body.procedureCode ?? null, plateNumber: body.plateNumber ?? null, driverName: body.driverName ?? null, carrier: body.carrier ?? null }, req.user?.userId);
      res.status(201).json(result);
    } catch (e) { next(e); }
  };

  previewCreateShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = previewShipmentSchema.parse(req.body);
      const result = await this.service.previewCreateShipment({ sackIds: body.sackIds, customerId: body.customerId ?? null, branchId: body.branchId ?? null, orderIds: body.orderIds });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  addSacksToShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = sackIdsSchema.parse(req.body);
      const result = await this.service.addSacksToShipment(req.params.id as string, body.sackIds, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  removeSackFromShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = removeShipmentSackSchema.parse(req.body);
      const result = await this.service.removeSackFromShipment(req.params.id as string, body.sackId, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  setDestination = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = destinationSchema.parse(req.body);
      const result = await this.service.setDestination(req.params.id as string, body.destination, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  setProcedureCode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = procedureCodeSchema.parse(req.body);
      const result = await this.service.setProcedureCode(req.params.id as string, body.procedureCode ?? null, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  dispatchShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = dispatchSchema.parse(req.body);
      const result = await this.service.dispatchShipment(req.params.id as string, body, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  cancelPreview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getCancelPreview(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  cancelShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.cancelShipment(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- LİSTE / DETAY / RAPOR -----------------------------------------------
  listShipments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listShipments(req);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getShipmentById(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

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
    } catch (e) { next(e); }
  };

  getShipmentSackContents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getShipmentSackContents(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getDispatchReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getDispatchReport(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getAccountingExport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await buildDispatchAccountingExport(req);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- ÇUVAL/TOP ARAMA — salt-okunur ---------------------------------------
  // useDataTable uyumlu: filter[*] + search + sortBy/sortOrder + withTotal + cursor/limit.
  searchSacks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filt = (k: string): string | undefined => {
        const v = req.query[`filter[${k}]`];
        return typeof v === "string" && v.trim() ? v.trim() : undefined;
      };
      const num = (v: string | undefined): number | undefined => {
        if (v == null || v === "") return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };
      const scopeRaw = filt("scope");
      const scope = (["POOL", "PLANNED", "DISPATCHED", "ALL"] as const).includes(scopeRaw as SackSearchScope)
        ? (scopeRaw as SackSearchScope)
        : undefined;
      const sortOrderRaw = req.query.sortOrder;
      const result = await sackSearchService.searchSacks({
        itemId: filt("itemId"),
        colorId: filt("colorId"),
        widthMin: num(filt("widthMin")),
        widthMax: num(filt("widthMax")),
        customerId: filt("customerId"),
        scope,
        search: typeof req.query.search === "string" ? req.query.search.trim() || undefined : undefined,
        sortBy: typeof req.query.sortBy === "string" ? req.query.sortBy : undefined,
        sortOrder: sortOrderRaw === "asc" ? "asc" : sortOrderRaw === "desc" ? "desc" : undefined,
        withTotal: req.query.withTotal === "true",
        cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
        limit: num(typeof req.query.limit === "string" ? req.query.limit : undefined),
      });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getSackContents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await sackSearchService.getSackContents(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getPickList = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = z.object({ sackIds: z.array(z.string().uuid()).min(1).max(200) }).parse(req.body);
      const result = await sackSearchService.getPickList(body.sackIds);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  locateRoll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const barcode = z.string().trim().min(1, "Barkod gerekli").max(64).parse(req.query.barcode);
      const result = await sackSearchService.locateRoll(barcode);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- SİPARİŞ SEÇİM (paketleme rehberi) -----------------------------------
  openOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const branchRaw = req.query.branchId as string | undefined;
      const result = await this.service.listOpenOrdersWithCoverage({
        customerId: (req.query.customerId as string | undefined) || undefined,
        branchId: branchRaw === undefined ? undefined : branchRaw || null,
      });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };
}
