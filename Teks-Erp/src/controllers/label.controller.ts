// =============================================================================
// TeksERP - Label Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { LabelKind } from "@prisma/client";
import { LabelService } from "../services/label.service";
import "../types/express-augment";

const updateNamesSchema = z.object({
  customerItemName:  z.string().max(200).nullable().optional(),
  customerColorName: z.string().max(200).nullable().optional(),
});

const previewSchema = z.object({
  kind: z.enum([LabelKind.ROLL_RAW, LabelKind.ROLL_FINISHED]),
  fields: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    order: z.number().int().min(1),
    isVisible: z.boolean(),
    isBold: z.boolean().optional(),
    fontSize: z.enum(["sm", "md", "lg", "xl"]).optional(),
  })),
});

export class LabelController {
  private service = new LabelService();

  getRollLabel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getRollLabel(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /**
   * Roll etiketinin tam HTML'i. Mobil expo-print bunu basar, Electron iframe
   * srcDoc ile preview gösterir. Kind otomatik (renksiz STOCK SUPPLIER → RAW,
   * aksi FINISHED); `?kind=ROLL_RAW|ROLL_FINISHED` ile override.
   *
   * Response: text/html (raw), JSON sarmalama yok — iframe ve Print için direkt.
   */
  /**
   * Şablon düzenleme önizlemesi için HTML. Body: { kind, fields[] }. Henüz
   * kaydedilmemiş değişiklikleri preview için backend render eder; Electron
   * iframe srcDoc ile gösterir. text/html döner.
   */
  getPreviewHtml = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = previewSchema.parse(req.body);
      const result = await this.service.getPreviewHtml(body);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(result.data.html);
    } catch (e) { next(e); }
  };

  getRollLabelHtml = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const kindParam = typeof req.query.kind === "string" ? req.query.kind : undefined;
      const kindOverride =
        kindParam === LabelKind.ROLL_RAW || kindParam === LabelKind.ROLL_FINISHED
          ? (kindParam as LabelKind)
          : undefined;
      const result = await this.service.getRollLabelHtml(
        req.params.id as string,
        kindOverride,
      );
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Label-Kind", result.data.kind);
      res.status(200).send(result.data.html);
    } catch (e) { next(e); }
  };

  getSwatchLabel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getSwatchLabel(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  updateOrderLineCustomerNames = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = updateNamesSchema.parse(req.body);
      const result = await this.service.updateOrderLineCustomerNames(
        req.params.id as string,
        body,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  recordPrintEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.recordPrintEvent(
        req.params.id as string,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };
}
