// =============================================================================
// TeksERP — EMANET ÇIKIŞ BELGESİ (`/api/consignment-dispatches`, genel fason F5)
// =============================================================================
// Kapı sırası: `verifyToken` → `requireEmanetEnabled` → izin. Levent satırı ayrıca devere, iplik satırı iplik modülü
// kapısında (servis `assertLineModules` + tek yazarların ikinci hattı). Sözleşme: `services/consignment-dispatch/types.ts`.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AppError } from "../utils/app-error";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireEmanetEnabled } from "../middlewares/module.middleware";
import { assertNoBareFilterParams, parseQueryParams, readFilterList, readIdCondition } from "../utils/query-parser";
import { createConsignmentDispatch, previewConsignmentDispatch } from "../services/consignment-dispatch/create";
import { cancelConsignmentDispatch, cancelPreviewConsignmentDispatch } from "../services/consignment-dispatch/cancel";
import { getConsignmentDispatch, listConsignmentDispatches } from "../services/consignment-dispatch/read";
import { CANDIDATE_DEFAULT_LIMIT, CANDIDATE_MAX_LIMIT, listConsignmentCandidates } from "../services/consignment-dispatch/candidates";

const router = Router();
router.use(verifyToken, requireEmanetEnabled);

const wrap = (fn: (req: Request) => Promise<{ status: number; body: unknown }>) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req);
    res.status(out.status).json(out.body);
  } catch (err) {
    next(err);
  }
};

const Id = z.uuid("Geçersiz kimlik");
const optText = (max: number) => z.string().max(max, `En çok ${max} karakter`).nullable().optional();
const Kg = z.string().regex(/^\d+(\.\d{1,3})?$/, "Miktar (kg) ondalıklı sayı olmalı (en çok 3 hane)");
const ItemBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("WARP_BEAM"), warpBeamId: Id }).strict(),
  z.object({ kind: z.literal("YARN"), yarnItemId: Id, warehouseId: Id, lotId: z.uuid("İplik satırında lot zorunlu (geçerli lot kimliği)"), qtyKg: Kg }).strict(),
], { error: "Kalem türü WARP_BEAM ya da YARN olmalı; iplik satırında lot zorunlu" });
const BaseBody = z.object({
  ownerCustomerId: Id,
  items: z.array(ItemBody).max(200, "Bir belge en çok 200 satır taşır"),
  plateNumber: optText(32),
  driverName: optText(100),
  notes: optText(500),
});
const PreviewBody = BaseBody.extend({ clientToken: z.string().optional() }).strict();
const CreateBody = BaseBody.extend({ clientToken: z.uuid("clientToken geçersiz (UUID)") }).strict();
const CancelBody = z.object({ reason: z.string().trim().min(1, "İptal sebebi zorunlu").max(300), expectedUpdatedAt: z.iso.datetime({ offset: true }).optional() }).strict();
const ListQuery = z.object({
  search: z.string().max(64).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).passthrough();
// Aday listesi: `.strict()` ⇒ tanınmayan parametre 400 (fail-closed).
const CandidatesQuery = z.object({
  ownerCustomerId: Id,
  search: z.string().max(64, "Arama en çok 64 karakter").optional(),
  limit: z.coerce.number().int().min(1).max(CANDIDATE_MAX_LIMIT).default(CANDIDATE_DEFAULT_LIMIT),
}).strict();
const STATUSES = ["ACTIVE", "CANCELLED", "ALL"] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const first = r.error.issues[0];
    // `items` boş ⇒ sözleşme kodu; diğer biçim hataları 400 VALIDATION_ERROR.
    throw AppError.badRequest(first?.message ?? "Geçersiz istek", { code: "VALIDATION_ERROR", issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  return r.data;
}

/**
 * @openapi
 * /api/consignment-dispatches:
 *   get:
 *     tags: [Consignment]
 *     summary: Emanet çıkış belgeleri — liste + cursor + özet şeridi (tek where)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: "filter[ownerCustomerId]", schema: { type: string }, description: "CSV müşteri id" }
 *       - { in: query, name: "filter[status]", schema: { type: string, enum: [ACTIVE, CANCELLED, ALL] } }
 *       - { in: query, name: "filter[from]", schema: { type: string, format: date }, description: "Fabrika günü (dispatchedAt)" }
 *       - { in: query, name: "filter[to]", schema: { type: string, format: date } }
 *       - { in: query, name: search, schema: { type: string }, description: "Belge no" }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 200 } }
 *     responses:
 *       200: { description: "{ success, data, nextCursor, summary }" }
 *       400: { description: Geçersiz süzgeç }
 *       403: { description: Emanet modülü kapalı (MODULE_DISABLED) ya da consignment:read yok }
 *   post:
 *     tags: [Consignment]
 *     summary: Emanet çıkış belgesi oluştur (levent READY→SHIPPED_TO_OWNER, iplik CONSIGNMENT_OUT; clientToken idempotent)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ownerCustomerId, items, clientToken]
 *             properties:
 *               ownerCustomerId: { type: string, format: uuid }
 *               clientToken: { type: string, format: uuid }
 *               items: { type: array, items: { type: object } }
 *               plateNumber: { type: string, nullable: true }
 *               driverName: { type: string, nullable: true }
 *               notes: { type: string, nullable: true }
 *     responses:
 *       201: { description: Belge oluştu }
 *       200: { description: Aynı denemenin tekrarı (replay) — aynı belge }
 *       400: { description: Boş/tekrarlı kalem (CONSIGNMENT_ITEMS_EMPTY), lotsuz iplik satırı }
 *       403: { description: Modül kapalı (MODULE_DISABLED) }
 *       409: { description: CONSIGNMENT_OWNER_MISMATCH · CONSIGNMENT_BEAM_NOT_READY · CONSIGNMENT_YARN_INSUFFICIENT · CONSIGNMENT_DISPATCH_CANCELLED · CLIENT_TOKEN_COLLISION }
 */
router.get("/", requirePermission("consignment:read"), wrap(async (req) => {
  assertNoBareFilterParams(req, ["ownerCustomerId", "status", "from", "to"]);
  const f = parseQueryParams(req).filters;
  const unknown = Object.keys(f).filter((k) => !["ownerCustomerId", "status", "from", "to"].includes(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan süzgeç: ${unknown.join(", ")}`, { code: "FILTER_UNKNOWN", params: unknown });
  const statusList = readFilterList(f.status);
  if (statusList.length > 1 || (statusList[0] && !(STATUSES as readonly string[]).includes(statusList[0]))) {
    throw AppError.badRequest("filter[status] yalnız ACTIVE, CANCELLED ya da ALL olabilir.", { code: "FILTER_INVALID" });
  }
  const one = (k: "from" | "to"): string | undefined => {
    const v = readFilterList(f[k]);
    if (v.length === 0) return undefined;
    if (v.length > 1 || !YMD.test(v[0]!)) throw AppError.badRequest(`filter[${k}] YYYY-AA-GG olmalı.`, { code: "FILTER_INVALID" });
    return v[0];
  };
  const q = parse(ListQuery, req.query);
  const out = await listConsignmentDispatches({
    ownerCustomerId: readIdCondition(f.ownerCustomerId),
    status: (statusList[0] as (typeof STATUSES)[number] | undefined) ?? "ALL",
    from: one("from"),
    to: one("to"),
    search: q.search,
    cursor: q.cursor,
    limit: q.limit,
  });
  return { status: 200, body: { success: true, ...out } };
}));

router.post("/", requireAnyPermission("consignment:write", "mobile:depo"), wrap(async (req) => {
  const body = parse(CreateBody, req.body);
  const out = await createConsignmentDispatch(body, req.user!.userId);
  // Aynı denemenin tekrarı yeni belge açmadı → 201 değil 200.
  return { status: out.replayed ? 200 : 201, body: { success: true, data: out.data } };
}));

/**
 * @openapi
 * /api/consignment-dispatches/preview:
 *   post:
 *     tags: [Consignment]
 *     summary: Emanet çıkış önizlemesi — yazmaz; engelli satır blockedReason taşır
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { required: true, content: { application/json: { schema: { type: object } } } }
 *     responses:
 *       200: { description: "{ data: ConsignmentDispatchPreview }" }
 *       400: { description: Geçersiz gövde }
 *       403: { description: Modül kapalı (MODULE_DISABLED) }
 */
router.post("/preview", requireAnyPermission("consignment:write", "mobile:depo"), wrap(async (req) => {
  const body = parse(PreviewBody, req.body);
  return { status: 200, body: { success: true, data: await previewConsignmentDispatch(body) } };
}));

/**
 * @openapi
 * /api/consignment-dispatches/candidates:
 *   get:
 *     tags: [Consignment]
 *     summary: Sahibe çıkabilecek leventler (READY) + depo bakiyeli lotlar — seçilebilirlik oluşturla aynı yüklem
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: ownerCustomerId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: search, schema: { type: string, maxLength: 64 }, description: "Levent no / çözgü · lot no / iplik kodu-adı" }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 100, default: 50 }, description: "Tür başına satır tavanı" }
 *     responses:
 *       200: { description: "{ success, data: { ownerCustomer, modules, beams, yarns, truncated } }" }
 *       400: { description: Tanınmayan/geçersiz parametre (VALIDATION_ERROR) }
 *       403: { description: Emanet kapalı (MODULE_DISABLED) ya da consignment:write / mobile:depo yok }
 *       404: { description: Sahip müşteri yok (OWNER_CUSTOMER_INVALID) }
 */
// `/:id`ten ÖNCE kalmalı — yoksa "candidates" kimlik diye okunur.
router.get("/candidates", requireAnyPermission("consignment:write", "mobile:depo"), wrap(async (req) => {
  const q = parse(CandidatesQuery, req.query);
  return { status: 200, body: { success: true, data: await listConsignmentCandidates({ ownerCustomerId: q.ownerCustomerId, search: q.search?.trim() || undefined, limit: q.limit }) } };
}));

/**
 * @openapi
 * /api/consignment-dispatches/{id}:
 *   get:
 *     tags: [Consignment]
 *     summary: Emanet çıkış belgesi detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ data: ConsignmentDispatchDto }" }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", requirePermission("consignment:read"), wrap(async (req) => ({ status: 200, body: { success: true, data: await getConsignmentDispatch(parse(Id, req.params.id)) } })));

/**
 * @openapi
 * /api/consignment-dispatches/{id}/cancel-preview:
 *   get:
 *     tags: [Consignment]
 *     summary: İptal önizlemesi — READY'ye dönecek HER levent, geri yazılacak HER iplik satırı, damgalanacak fatura bağları
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ data: ConsignmentDispatchCancelPreview }" }
 *       404: { description: Bulunamadı }
 */
router.get("/:id/cancel-preview", requirePermission("consignment:write"), wrap(async (req) => ({ status: 200, body: { success: true, data: await cancelPreviewConsignmentDispatch(parse(Id, req.params.id)) } })));

/**
 * @openapi
 * /api/consignment-dispatches/{id}/cancel:
 *   post:
 *     tags: [Consignment]
 *     summary: Emanet çıkış belgesini iptal et (ters çiftler SHIP_TO_OWNER_CANCEL · CONSIGNMENT_OUT_CANCEL)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string, maxLength: 300 }
 *               expectedUpdatedAt: { type: string, format: date-time }
 *     responses:
 *       200: { description: "{ data: ConsignmentDispatchDto }" }
 *       404: { description: Bulunamadı }
 *       409: { description: CONSIGNMENT_DISPATCH_CANCELLED · CONSIGNMENT_DISPATCH_CHANGED · CONSIGNMENT_BEAM_MOVED_AFTER · CONSIGNMENT_BEAM_INVOICED }
 */
router.post("/:id/cancel", requirePermission("consignment:write"), wrap(async (req) => {
  const body = parse(CancelBody, req.body);
  return { status: 200, body: { success: true, data: await cancelConsignmentDispatch(parse(Id, req.params.id), body, req.user!.userId) } };
}));

export default router;
