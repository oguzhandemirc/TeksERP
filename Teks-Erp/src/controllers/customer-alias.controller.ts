// =============================================================================
// TeksERP - Customer Alias Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { CustomerAliasService } from "../services/customer-alias.service";
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
