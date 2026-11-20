// =============================================================================
// TeksERP — LEVENT GÖVDESİ HAREKETLERİ: elle geçiş (boş gönder/dön · bakım · hurda) + son hareketi geri al (devere ek B2)
// =============================================================================
// ⚠️ BU ROUTER KENDİ BAŞINA MOUNT EDİLMEZ. `beam-body.routes.ts` onu `router.use("/", beamBodyMovementRoutes)` ile
// bağlar ve `verifyToken` + `requireDevereEnabled` + `requireBeamBodyTracking` kapısını MİRAS ALIR.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AppError } from "../utils/app-error";
import { requirePermission } from "../middlewares/rbac.middleware";
import { applyBeamBodyTransition, previewBeamBodyTransition, previewUndoBeamBodyEvent, undoBeamBodyEvent } from "../services/beam-body/transition";
import { BEAM_BODY_MANUAL_KINDS, type BeamBodyManualKind } from "../constants/beam-body";
import "../types/express-augment";

const router = Router();

const wrap = (fn: (req: Request) => Promise<{ status: number; body: unknown }>) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req);
    res.status(out.status).json(out.body);
  } catch (err) {
    next(err);
  }
};

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const first = r.error.issues[0];
    throw AppError.badRequest(first?.message ?? "Geçersiz istek", { code: "VALIDATION_ERROR", issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  return r.data;
}

const Id = z.uuid("Geçersiz kimlik");
const TransitionBody = z.strictObject({
  kind: z.enum(BEAM_BODY_MANUAL_KINDS as [BeamBodyManualKind, ...BeamBodyManualKind[]], { message: "Hareket SHIP_EMPTY, RETURN_EMPTY, MAINTENANCE_IN, MAINTENANCE_OUT ya da SCRAP olmalı" }),
  subcontractorId: Id.nullable().optional(),
  warehouseId: Id.nullable().optional(),
  reason: z.string().trim().max(300, "Sebep/not en çok 300 karakter").nullable().optional(),
});
const UndoBody = z.strictObject({ reason: z.string().trim().min(3, "Geri alma sebebi en az 3 karakter").max(300, "Geri alma sebebi en çok 300 karakter") });

/**
 * @openapi
 * /api/beam-bodies/{id}/transition-preview:
 *   post:
 *     tags: [BeamBody]
 *     summary: Elle gövde hareketi önizlemesi — hedef durum/yer, uyarılar (YAZMAZ; aynı doğrulama)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: { body, kind, from, to, place, warnings } }" }
 *       409: { description: "BEAM_BODY_STATE · BEAM_BODY_INACTIVE" }
 * /api/beam-bodies/{id}/transition:
 *   post:
 *     tags: [BeamBody]
 *     summary: Elle gövde hareketi — SHIP_EMPTY (devereci zorunlu) · RETURN_EMPTY · MAINTENANCE_IN/OUT · SCRAP (sebep zorunlu)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [kind]
 *             properties:
 *               kind: { type: string, enum: [SHIP_EMPTY, RETURN_EMPTY, MAINTENANCE_IN, MAINTENANCE_OUT, SCRAP] }
 *               subcontractorId: { type: string, format: uuid, nullable: true }
 *               warehouseId: { type: string, format: uuid, nullable: true }
 *               reason: { type: string, nullable: true }
 *     responses:
 *       200: { description: "{ success, data: BeamBody, warnings? }" }
 *       400: { description: "BEAM_BODY_PLACE_REQUIRED · BEAM_BODY_PLACE_INVALID · BEAM_BODY_SCRAP_REASON_REQUIRED · VALIDATION_ERROR" }
 *       409: { description: "BEAM_BODY_STATE · BEAM_BODY_INACTIVE" }
 */
router.post("/:id/transition-preview", requirePermission("beam-body:write"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(TransitionBody, req.body);
  return { status: 200, body: { success: true, data: await previewBeamBodyTransition(id, body) } };
}));

router.post("/:id/transition", requirePermission("beam-body:write"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(TransitionBody, req.body);
  const out = await applyBeamBodyTransition(id, body, req.user!.userId);
  return { status: 200, body: { success: true, data: out.body, message: `${out.body.bodyNo}: ${out.body.statusLabel}`, ...(out.warnings.length > 0 ? { warnings: out.warnings } : {}) } };
}));

/**
 * @openapi
 * /api/beam-bodies/{id}/events/{eventId}/undo-preview:
 *   get:
 *     tags: [BeamBody]
 *     summary: Gövde hareketini geri alma önizlemesi — yalnız son, belgesiz elle hareket; dönülecek durum (yazmaz)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: eventId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ success, data: { body, event, undoable, blocker, restoresTo } }" }
 * /api/beam-bodies/{id}/events/{eventId}/undo:
 *   post:
 *     tags: [BeamBody]
 *     summary: Gövde hareketini geri al (tipli *_CANCEL ters olayı; durum ve yer bir önceki harekete döner)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: eventId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Geri alındı }
 *       409: { description: "BEAM_BODY_EVENT_NOT_LATEST · BEAM_BODY_EVENT_DOCUMENT · BEAM_BODY_EVENT_KIND · BEAM_BODY_EVENT_REVERSED" }
 */
router.get("/:id/events/:eventId/undo-preview", requirePermission("beam-body:write"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const eventId = parse(Id, req.params.eventId);
  return { status: 200, body: { success: true, data: await previewUndoBeamBodyEvent(id, eventId) } };
}));

router.post("/:id/events/:eventId/undo", requirePermission("beam-body:write"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const eventId = parse(Id, req.params.eventId);
  const body = parse(UndoBody, req.body);
  const data = await undoBeamBodyEvent(id, eventId, body.reason, req.user!.userId);
  return { status: 200, body: { success: true, data, message: `${data.bodyNo}: hareket geri alındı (${data.statusLabel})` } };
}));

export default router;
