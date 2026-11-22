// =============================================================================
// TeksERP — LEVENT GÖVDESİ SAHİBİNE İADE BELGESİ (`/api/beam-body-returns`, devere ek B2)
// =============================================================================
// Kapı sırası gövde uçlarıyla aynı: `verifyToken` → `requireDevereEnabled` → `requireBeamBodyTracking` (OFF → 403
// BEAM_BODY_MODE_OFF) → izin (`beam-body:read` / `beam-body:write`; iptal `beam-body:cancel`). Aday listesi statik yol, `/:id`den ÖNCE.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AppError } from "../utils/app-error";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireBeamBodyTracking, requireDevereEnabled } from "../middlewares/module.middleware";
import { assertNoBareFilterParams, parseQueryParams, readFilterList, readIdCondition } from "../utils/query-parser";
import {
  cancelBeamBodyReturn, createBeamBodyReturn, getBeamBodyReturn, listBeamBodyReturns, listOwnerReturnCandidates, previewCancelBeamBodyReturn,
} from "../services/beam-body/returns";
import { BEAM_BODY_RETURN_MAX_ITEMS } from "../constants/beam-body";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requireDevereEnabled, requireBeamBodyTracking);

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
const CreateBody = z.strictObject({
  clientToken: z.uuid("clientToken geçersiz (UUID)"),
  ownerCustomerId: Id,
  bodyIds: z.array(Id).min(1, "En az bir gövde seçilmeli").max(BEAM_BODY_RETURN_MAX_ITEMS, `En çok ${BEAM_BODY_RETURN_MAX_ITEMS} gövde`),
  returnedAt: z.iso.datetime({ offset: true, message: "İade tarihi ISO tarih-saat olmalı" }).nullable().optional(),
  plateNumber: z.string().max(32, "Plaka en çok 32 karakter").nullable().optional(),
  driverName: z.string().max(100, "Şoför adı en çok 100 karakter").nullable().optional(),
  notes: z.string().max(500, "Not en çok 500 karakter").nullable().optional(),
});
const CancelBody = z.strictObject({ reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(300, "İptal sebebi en çok 300 karakter") });
const ListQuery = z.object({
  search: z.string().max(64).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).passthrough();
const FILTERS = ["ownerCustomerId", "status"];
const STATUS = ["active", "cancelled", "all"] as const;

/**
 * @openapi
 * /api/beam-body-returns/candidates:
 *   get:
 *     tags: [BeamBody]
 *     summary: Sahibine iade edilecek gövdeler (bizim olmayan, boş, bizde) — sahip bazında gruplu
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: "filter[ownerCustomerId]", schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: [{ owner, bodies: BeamBody[] }] }" }
 */
router.get("/candidates", requirePermission("beam-body:read"), wrap(async (req) => {
  assertNoBareFilterParams(req, ["ownerCustomerId"]);
  const f = parseQueryParams(req).filters;
  const unknown = Object.keys(f).filter((k) => k !== "ownerCustomerId");
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan süzgeç: ${unknown.join(", ")}`, { code: "FILTER_UNKNOWN", params: unknown });
  const owner = readFilterList(f.ownerCustomerId);
  if (owner.length > 1) throw AppError.badRequest("filter[ownerCustomerId] tek cari olmalı", { code: "FILTER_INVALID" });
  const ownerId = owner[0] ? parse(Id, owner[0]) : null;
  return { status: 200, body: { success: true, data: await listOwnerReturnCandidates(ownerId) } };
}));

/**
 * @openapi
 * /api/beam-body-returns:
 *   get:
 *     tags: [BeamBody]
 *     summary: Gövde iade belgeleri — liste + cursor + özet (belge ve gövde sayısı; tek where)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: "filter[ownerCustomerId]", schema: { type: string }, description: "CSV sahip cari id" }
 *       - { in: query, name: "filter[status]", schema: { type: string, enum: [active, cancelled, all], default: active } }
 *       - { in: query, name: search, schema: { type: string }, description: "Belge no ya da gövde no" }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 200 } }
 *     responses:
 *       200: { description: "{ success, data, nextCursor, summary: { count, bodyCount } }" }
 *   post:
 *     tags: [BeamBody]
 *     summary: Sahibine iade belgesi (LGI-YYMM-NNNN) — her gövde RETURN_TO_OWNER (Depoda boş → Sahibine iade edildi); clientToken idempotent
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken, ownerCustomerId, bodyIds]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               ownerCustomerId: { type: string, format: uuid }
 *               bodyIds: { type: array, items: { type: string, format: uuid } }
 *               returnedAt: { type: string, format: date-time, nullable: true }
 *               plateNumber: { type: string, nullable: true }
 *               driverName: { type: string, nullable: true }
 *               notes: { type: string, nullable: true }
 *     responses:
 *       201: { description: Belge açıldı }
 *       200: { description: Aynı denemenin tekrarı (replay) }
 *       400: { description: "BEAM_BODY_OWNER_MISMATCH · BEAM_BODY_RETURN_EMPTY · BEAM_BODY_RETURN_DATE_INVALID · VALIDATION_ERROR" }
 *       409: { description: "BEAM_BODY_STATE · BEAM_BODY_INACTIVE · BEAM_BODY_RETURN_CANCELLED · CLIENT_TOKEN_COLLISION" }
 */
router.get("/", requirePermission("beam-body:read"), wrap(async (req) => {
  assertNoBareFilterParams(req, FILTERS);
  const f = parseQueryParams(req).filters;
  const unknown = Object.keys(f).filter((k) => !FILTERS.includes(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan süzgeç: ${unknown.join(", ")}`, { code: "FILTER_UNKNOWN", params: unknown });
  const status = readFilterList(f.status);
  if (status.length > 1 || (status[0] !== undefined && !(STATUS as readonly string[]).includes(status[0]))) throw AppError.badRequest("filter[status] active, cancelled ya da all olmalı", { code: "FILTER_INVALID" });
  const q = parse(ListQuery, req.query);
  const out = await listBeamBodyReturns({
    ownerCustomerId: readIdCondition(f.ownerCustomerId),
    status: (status[0] ?? "active") as (typeof STATUS)[number],
    search: q.search, cursor: q.cursor, limit: q.limit,
  });
  return { status: 200, body: { success: true, ...out } };
}));

router.post("/", requirePermission("beam-body:write"), wrap(async (req) => {
  const body = parse(CreateBody, req.body);
  const out = await createBeamBodyReturn(body, req.user!.userId);
  return { status: out.replayed ? 200 : 201, body: { success: true, data: out.data, message: out.replayed ? `${out.data.docNo} zaten kayıtlı` : `İade belgesi ${out.data.docNo} açıldı (${out.data.items.length} gövde)` } };
}));

/**
 * @openapi
 * /api/beam-body-returns/{id}:
 *   get:
 *     tags: [BeamBody]
 *     summary: Gövde iade belgesi detayı (kalemler; iptal edilmişse ters olaylı)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data }" }
 *       404: { description: BEAM_BODY_RETURN_NOT_FOUND }
 * /api/beam-body-returns/{id}/cancel-preview:
 *   get:
 *     tags: [BeamBody]
 *     summary: İade belgesi iptal önizlemesi — etkilenen her gövde ve engeli (yazmaz)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: { doc, cancellable, blocker, items } }" }
 * /api/beam-body-returns/{id}/cancel:
 *   post:
 *     tags: [BeamBody]
 *     summary: İade belgesini iptal et — her gövde RETURN_TO_OWNER_CANCEL ile "Depoda boş"a döner
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: İptal edildi }
 *       409: { description: "BEAM_BODY_RETURN_CANCELLED · BEAM_BODY_EVENT_NOT_LATEST · BEAM_BODY_INACTIVE" }
 */
router.get("/:id", requirePermission("beam-body:read"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await getBeamBodyReturn(id) } };
}));

router.get("/:id/cancel-preview", requirePermission("beam-body:cancel"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await previewCancelBeamBodyReturn(id) } };
}));

router.post("/:id/cancel", requirePermission("beam-body:cancel"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(CancelBody, req.body);
  const data = await cancelBeamBodyReturn(id, body.reason, req.user!.userId);
  return { status: 200, body: { success: true, data, message: `${data.docNo} iptal edildi` } };
}));

export default router;
