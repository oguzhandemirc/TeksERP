// =============================================================================
// İş emri hedef çeşit değeri + gramaj özeti uçları (KQ-D6)
// =============================================================================
import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { targetValueItemSchema } from "./workorder.controller";
import {
  getBatchProcessSummary,
  getWorkOrderProcessSummary,
  replaceWorkOrderTargetValues,
} from "../services/workorder-target-value.service";

/** Yalnız gövdedeki özellikler değişir; `valueId: null` = o özelliğin hedefini kaldır.
 *  Boş liste = eski istemci "hepsini kaldır" sözleşmesi. Tanınmayan anahtar 400 (fail-closed). */
const targetValueUpdateItemSchema = targetValueItemSchema.extend({
  valueId: z.string().uuid("Geçersiz değer ID").nullable(),
});
export const targetValuesBodySchema = z.object({ items: z.array(targetValueUpdateItemSchema).max(20) }).strict();

/** PUT /api/work-orders/:id/target-values */
export async function putTargetValues(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const body = targetValuesBodySchema.parse(req.body);
    res.status(200).json(await replaceWorkOrderTargetValues(id, body.items, req.user?.userId));
  } catch (err) {
    next(err);
  }
}

/** GET /api/work-orders/:id/process-summary */
export async function getWorkOrderSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await getWorkOrderProcessSummary(assertValidUuid(req.params.id, "id")));
  } catch (err) {
    next(err);
  }
}

/** GET /api/batches/:id/process-summary */
export async function getBatchSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await getBatchProcessSummary(assertValidUuid(req.params.id, "id")));
  } catch (err) {
    next(err);
  }
}
