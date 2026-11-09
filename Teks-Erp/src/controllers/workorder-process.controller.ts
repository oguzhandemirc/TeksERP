// =============================================================================
// İş emri hedef çeşit değeri + gramaj özeti uçları (KQ-D6)
// =============================================================================
import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { targetValueItemSchema } from "./workorder.controller";
import {
  getBatchProcessSummary,
  getWorkOrderKursunGramaj,
  getWorkOrderProcessSummary,
  replaceWorkOrderTargetValues,
} from "../services/workorder-target-value.service";
import { updateStepPlannedMachine } from "../services/step-planned-machine.service";
import { changeWorkOrderFoldType } from "../services/workorder/fold-change";
import { normalizeFoldType } from "../services/helpers/fold-type";

/** Yalnız gövdedeki özellikler değişir; `valueId: null` = o özelliğin hedefini kaldır.
 *  Boş liste = eski istemci "hepsini kaldır" sözleşmesi. Tanınmayan anahtar 400 (fail-closed). */
const targetValueUpdateItemSchema = targetValueItemSchema.extend({
  valueId: z.string().uuid("Geçersiz değer ID").nullable(),
});
export const targetValuesBodySchema = z.object({
  items: z.array(targetValueUpdateItemSchema).max(20),
  /** Tablet gramaj düzeltmesinin sebebi — İE hareket defterine yazılır (eski istemci göndermez). */
  reason: z.string().trim().max(500, "En çok 500 karakter").nullable().optional(),
}).strict();

/** PUT /api/work-orders/:id/target-values */
export async function putTargetValues(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const body = targetValuesBodySchema.parse(req.body);
    // `workorder:write` yoksa kapı `mobile:is-emri-duzelt`ten geçmiştir → yalnız kurşun gramajı (servis 403/409).
    const kursunOnly = !matchesPermission(req.user?.permissions ?? [], "workorder:write");
    res.status(200).json(await replaceWorkOrderTargetValues(id, body.items, req.user?.userId, { kursunOnly, reason: body.reason ?? null }));
  } catch (err) {
    next(err);
  }
}

/** Kat Tipini Değiştir — `null` katı kaldırır; tanınmayan anahtar 400. */
export const foldTypeBodySchema = z.object({
  foldType: z.string().max(64).transform((v) => normalizeFoldType(v)).nullable(),
  reason: z.string().trim().min(3, "Sebep yazmalısınız").max(500, "En çok 500 karakter"),
  reasonCode: z.string().trim().min(1).max(64).optional(),
}).strict();

/** PATCH /api/work-orders/:id/fold-type */
export async function patchFoldType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const body = foldTypeBodySchema.parse(req.body);
    res.status(200).json(await changeWorkOrderFoldType(id, { foldType: body.foldType, reason: body.reason, reasonCode: body.reasonCode ?? null }, req.user?.userId));
  } catch (err) {
    next(err);
  }
}

/** GET /api/work-orders/:id/kursun-gramaj — tablet Düzelt "Gramajı Değiştir" önizlemesi */
export async function getKursunGramaj(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ success: true, data: await getWorkOrderKursunGramaj(assertValidUuid(req.params.id, "id")) });
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

/** Gülkesim 2026-11-02: önerilen makine — `null` öneriyi kaldırır; tanınmayan anahtar 400. */
export const plannedMachineBodySchema = z.object({ plannedMachineId: z.string().uuid("Geçersiz makine ID").nullable() }).strict();

/** PATCH /api/work-orders/:id/steps/:stepId/planned-machine */
export async function patchStepPlannedMachine(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const stepId = assertValidUuid(req.params.stepId, "stepId");
    const body = plannedMachineBodySchema.parse(req.body);
    res.status(200).json(await updateStepPlannedMachine(id, stepId, body.plannedMachineId, req.user?.userId));
  } catch (err) {
    next(err);
  }
}
