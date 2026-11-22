// =============================================================================
// TeksERP — LEVENT GÖVDESİ: devereci mutabakatı ("sizdeki gövdelerimiz", devere S6)
// =============================================================================
// ⚠️ BU ROUTER KENDİ BAŞINA MOUNT EDİLMEZ. `beam-body.routes.ts` onu `/:id`den ÖNCE `router.use("/", …)` ile bağlar ve
// `verifyToken` + `requireDevereEnabled` + `requireBeamBodyTracking` kapısını MİRAS ALIR. Belge bir OKUMANIN kâğıdıdır:
// ikisi de `beam-body:read` (basım deftere yazmaz, yalnız basılı belge sürümü doğurur).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AppError } from "../utils/app-error";
import { requirePermission } from "../middlewares/rbac.middleware";
import { getBeamBodyStatement, printBeamBodyStatement } from "../services/beam-body/statement";
import "../types/express-augment";

const router = Router();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw AppError.badRequest(r.error.issues[0]?.message ?? "Geçersiz istek", { code: "VALIDATION_ERROR" });
  return r.data;
}

const SubcontractorQuery = z.object({ subcontractorId: z.uuid("Devereci seçin (geçersiz kimlik)") });
const PrintBody = z.strictObject({ subcontractorId: z.uuid("Devereci seçin (geçersiz kimlik)") });

/**
 * @openapi
 * /api/beam-bodies/statement:
 *   get:
 *     tags: [BeamBody]
 *     summary: Devereci gövde mutabakatı — deverecideki gövdeler (sahibi, kaç gün) + son 30 gün giden/dönen hareketler (YAZMAZ)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: subcontractorId, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: { header, bodies, moves, totals } }" }
 *       403: { description: "MODULE_DISABLED · BEAM_BODY_MODE_OFF · beam-body:read yok" }
 *       404: { description: SUBCONTRACTOR_NOT_FOUND }
 * /api/beam-bodies/statement/print:
 *   post:
 *     tags: [BeamBody]
 *     summary: Mutabakatı basıma hazırla — içerik son sürümden farklıysa yeni sürüm dondurur (BEAM_BODY_STATEMENT, kaynak devereci)
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { required: true, content: { application/json: { schema: { type: object, required: [subcontractorId], properties: { subcontractorId: { type: string, format: uuid } } } } } }
 *     responses:
 *       200: { description: "{ success, data: { version, documentNo, created } }" }
 *       409: { description: BEAM_BODY_STATEMENT_RACE }
 */
router.get("/statement", requirePermission("beam-body:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = parse(SubcontractorQuery, req.query);
    res.json({ success: true, data: await getBeamBodyStatement(q.subcontractorId) });
  } catch (err) {
    next(err);
  }
});

router.post("/statement/print", requirePermission("beam-body:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const b = parse(PrintBody, req.body);
    res.json({ success: true, data: await printBeamBodyStatement(b.subcontractorId, req.user!.userId) });
  } catch (err) {
    next(err);
  }
});

export default router;
