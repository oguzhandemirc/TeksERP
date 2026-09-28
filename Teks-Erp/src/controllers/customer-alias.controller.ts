// =============================================================================
// TeksERP - Customer Alias Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { CustomerAliasService, type ItemColorKey } from "../services/customer-alias.service";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import "../types/express-augment";

const aliasSchema = z.object({
  alias: z.string().min(1, "Alias boş olamaz").max(200, "Alias 200 karakteri aşamaz"),
});

const suggestQuerySchema = z.object({
  itemId: z.string().uuid("Geçersiz ürün ID"),
  colorId: z.string().uuid("Geçersiz renk ID").optional(),
});

export class CustomerAliasController {
  private service = new CustomerAliasService();

  // ---- ITEM ALIASES ----

  listItemAliases = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listItemAliases(req.params.customerId as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  upsertItemAlias = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { alias } = aliasSchema.parse(req.body);
      const result = await this.service.upsertItemAlias(
        req.params.customerId as string,
        req.params.itemId as string,
        alias,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  deleteItemAlias = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.deleteItemAlias(
        req.params.customerId as string,
        req.params.itemId as string,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- COLOR ALIASES ----

  listColorAliases = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listColorAliases(req.params.customerId as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  upsertColorAlias = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { alias } = aliasSchema.parse(req.body);
      const result = await this.service.upsertColorAlias(
        req.params.customerId as string,
        req.params.colorId as string,
        alias,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  deleteColorAlias = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.deleteColorAlias(
        req.params.customerId as string,
        req.params.colorId as string,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- KUMAŞA ÖZEL RENK ADLARI (müşteri × kumaş × renk) ----

  listItemColorAliases = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listItemColorAliases(req.params.customerId as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /** Kumaş kartı girişi (`/api/items/:id/customer-color-aliases`) — yazma yine C/D'den. */
  listItemColorAliasesByItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listItemColorAliasesByItem(assertValidUuid(req.params.id, "id"));
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  upsertItemColorAlias = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = itemColorKey(req);
      const { alias } = aliasSchema.parse(req.body);
      const result = await this.service.upsertItemColorAlias(key, alias, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  deleteItemColorAlias = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.deleteItemColorAlias(itemColorKey(req), req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- SUGGEST — sipariş giriş ekranı için tek-atış öneri ----

  suggest = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { itemId, colorId } = suggestQuerySchema.parse(req.query);
      const result = await this.service.lookupAlias(
        req.params.customerId as string,
        itemId,
        colorId ?? null,
      );
      res.status(200).json({ success: true, data: result });
    } catch (e) { next(e); }
  };
}

/** Yol parametreleri UUID değilse açıkça 400 (kardeş uçlar bunu yapmıyor). */
function itemColorKey(req: Request): ItemColorKey {
  return {
    customerId: assertValidUuid(req.params.customerId, "customerId"),
    itemId: assertValidUuid(req.params.itemId, "itemId"),
    colorId: assertValidUuid(req.params.colorId, "colorId"),
  };
}
