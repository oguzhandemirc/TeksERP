// =============================================================================
// TeksERP - Label Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { LabelService } from "../services/label.service";
import "../types/express-augment";

const updateNamesSchema = z.object({
  customerItemName:  z.string().max(200).nullable().optional(),
  customerColorName: z.string().max(200).nullable().optional(),
});

export class LabelController {
  private service = new LabelService();

  getRollLabel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getRollLabel(req.params.id as string);
      res.status(200).json(result);
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
