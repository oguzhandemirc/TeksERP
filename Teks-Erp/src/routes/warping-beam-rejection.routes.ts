// =============================================================================
// TeksERP — KUSURLU LEVENT RET BELGESİ (`/api/warping-beam-rejections`, devere ek C1)
// =============================================================================
// Kapı sırası load-bearing: `router.use` satırı HER uçtan önce. Bu yol global 1 MB JSON katmanını ATLAR
// (`BUYUK_GOVDE_YOLLARI`) ve kendi katmanını taşır — ret fotoğrafları base64 gövdeyle gelir. İplik kapısı uç başına:
// yalnız iplik tutmasını ölçen/değiştiren ret ve iptal uçlarında (emsal settle). Okuma `read`; ret/foto `write`; iptal `cancel`.
// =============================================================================
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AppError } from "../utils/app-error";
import { WARPING_REJECTION_BODY_LIMIT } from "../constants/body-limits";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDevereEnabled, requireIplikEnabled } from "../middlewares/module.middleware";
import { assertNoBareFilterParams, parseQueryParams, readFilterList, readIdCondition } from "../utils/query-parser";
import { createWarpingBeamRejection, previewWarpingBeamRejection, WARPING_REJECT_MAX_BEAMS } from "../services/warping-order/beam-rejection";
import { cancelWarpingBeamRejection, previewCancelWarpingBeamRejection } from "../services/warping-order/beam-rejection-cancel";
import { getWarpingBeamRejection, listWarpingBeamRejections } from "../services/warping-order/beam-rejection-read";
import { addRejectionPhotos, readRejectionPhoto, WARPING_REJECT_PHOTOS_PER_REQUEST } from "../services/warping-order/beam-rejection-photo";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requireDevereEnabled, express.json({ limit: WARPING_REJECTION_BODY_LIMIT }));

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
const Photo = z.strictObject({ fileName: z.string().max(200).nullable().optional(), contentBase64: z.string().min(1, "Fotoğraf içeriği boş") });
const Photos = z.array(Photo).max(WARPING_REJECT_PHOTOS_PER_REQUEST, `Bir seferde en çok ${WARPING_REJECT_PHOTOS_PER_REQUEST} fotoğraf`);
const Fields = {
  warpingOrderId: Id,
  beamIds: z.array(Id).min(1, "En az bir sarım seçilmeli").max(WARPING_REJECT_MAX_BEAMS, `En çok ${WARPING_REJECT_MAX_BEAMS} sarım`),
  reasonCode: z.string().trim().min(1, "Ret sebebi seçin").max(64),
  reasonText: z.string().max(300, "Açıklama en çok 300 karakter").nullable().optional(),
  notes: z.string().max(500, "Not en çok 500 karakter").nullable().optional(),
  expectRework: z.boolean({ message: "Kip seçin: yeniden sarılsın mı?" }),
  rejectedAt: z.iso.datetime({ offset: true, message: "Ret tarihi ISO tarih-saat olmalı" }).nullable().optional(),
};
const PreviewBody = z.strictObject({ ...Fields, reasonCode: z.string().trim().max(64).optional().default(""), expectRework: z.boolean().optional().default(true), photoCount: z.number().int().min(0).max(WARPING_REJECT_PHOTOS_PER_REQUEST).optional() });
const CreateBody = z.strictObject({ clientToken: z.uuid("clientToken geçersiz (UUID)"), ...Fields, photos: Photos.optional() });
const PhotosBody = z.strictObject({ photos: Photos.min(1, "En az bir fotoğraf gönderin") });
const CancelBody = z.strictObject({ reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(300, "İptal sebebi en çok 300 karakter") });
const ListQuery = z.object({
  search: z.string().max(64).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).passthrough();
const FILTERS = ["warpingOrderId", "subcontractorId", "status"];
const STATUS = ["active", "cancelled", "all"] as const;

/**
 * @openapi
 * /api/warping-beam-rejections/preview:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Kusurlu levent ret önizlemesi — sarımlar (metre, gövde, kabul), deverecinin tutmasına dönecek iplik, engeller (yazmaz)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [warpingOrderId, beamIds]
 *             properties:
 *               warpingOrderId: { type: string, format: uuid }
 *               beamIds: { type: array, items: { type: string, format: uuid } }
 *               reasonCode: { type: string }
 *               reasonText: { type: string, nullable: true }
 *               expectRework: { type: boolean }
 *               photoCount: { type: integer }
 *     responses:
 *       200: { description: "{ success, data: { order, beams, returnedYarn, totals, reason, photoRequired, blockers, warnings, rejectable } }" }
 */
router.post("/preview", requirePermission("warping-order:write"), requireIplikEnabled, wrap(async (req) => {
  const body = parse(PreviewBody, req.body);
  return { status: 200, body: { success: true, data: await previewWarpingBeamRejection(body) } };
}));

/**
 * @openapi
 * /api/warping-beam-rejections:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Ret belgeleri — liste + cursor + özet (belge ve sarım sayısı; tek where)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: "filter[warpingOrderId]", schema: { type: string }, description: "CSV sipariş id" }
 *       - { in: query, name: "filter[subcontractorId]", schema: { type: string }, description: "CSV devereci id" }
 *       - { in: query, name: "filter[status]", schema: { type: string, enum: [active, cancelled, all], default: all } }
 *       - { in: query, name: search, schema: { type: string }, description: "Belge no ya da sarım no" }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 200 } }
 *     responses:
 *       200: { description: "{ success, data, nextCursor, summary: { count, beamCount } }" }
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Kusurlu levent ret belgesi (DR-YYMM-NNNN) — her sarım REJECT_OUT (Hazır → Reddedildi); iplik deverecinin tutmasına döner; clientToken idempotent
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken, warpingOrderId, beamIds, reasonCode, expectRework]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               warpingOrderId: { type: string, format: uuid }
 *               beamIds: { type: array, items: { type: string, format: uuid } }
 *               reasonCode: { type: string }
 *               reasonText: { type: string, nullable: true }
 *               notes: { type: string, nullable: true }
 *               expectRework: { type: boolean }
 *               rejectedAt: { type: string, format: date-time, nullable: true }
 *               photos: { type: array, items: { type: object, properties: { fileName: { type: string }, contentBase64: { type: string } } } }
 *     responses:
 *       201: { description: Belge açıldı }
 *       200: { description: Aynı denemenin tekrarı (replay) }
 *       400: { description: "WARPING_REJECT_REASON_INVALID · WARPING_REJECT_REASON_TEXT_REQUIRED · WARPING_REJECT_PHOTO_REQUIRED · WARPING_REJECT_PHOTO_TYPE · VALIDATION_ERROR" }
 *       409: { description: "WARPING_BEAM_NOT_REJECTABLE · WARPING_RECEIPT_INVOICED · WARPING_ORDER_COMPLETED · WARPING_REJECTION_CANCELLED · CLIENT_TOKEN_COLLISION" }
 *       413: { description: WARPING_REJECT_PHOTO_TOO_LARGE }
 */
router.get("/", requirePermission("warping-order:read"), wrap(async (req) => {
  assertNoBareFilterParams(req, FILTERS);
  const f = parseQueryParams(req).filters;
  const unknown = Object.keys(f).filter((k) => !FILTERS.includes(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan süzgeç: ${unknown.join(", ")}`, { code: "FILTER_UNKNOWN", params: unknown });
  const status = readFilterList(f.status);
  if (status.length > 1 || (status[0] !== undefined && !(STATUS as readonly string[]).includes(status[0]))) throw AppError.badRequest("filter[status] active, cancelled ya da all olmalı", { code: "FILTER_INVALID" });
  const q = parse(ListQuery, req.query);
  const out = await listWarpingBeamRejections({
    warpingOrderId: readIdCondition(f.warpingOrderId), subcontractorId: readIdCondition(f.subcontractorId),
    status: (status[0] ?? "all") as (typeof STATUS)[number], search: q.search, cursor: q.cursor, limit: q.limit,
  });
  return { status: 200, body: { success: true, ...out } };
}));

router.post("/", requirePermission("warping-order:write"), requireIplikEnabled, wrap(async (req) => {
  const body = parse(CreateBody, req.body);
  const out = await createWarpingBeamRejection(body, req.user!.userId);
  return { status: out.replayed ? 200 : 201, body: { success: true, data: out.data, message: out.replayed ? `${out.data.docNo} zaten kayıtlı` : `Ret belgesi ${out.data.docNo} açıldı (${out.data.items.length} sarım)` } };
}));

/**
 * @openapi
 * /api/warping-beam-rejections/{id}:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Ret belgesi detayı = basım verisi (sipariş, devereci, sebep, sarımlar, fotoğraf künyeleri; ücret yok)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data }" }
 *       404: { description: WARPING_REJECTION_NOT_FOUND }
 * /api/warping-beam-rejections/{id}/photos:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Ret belgesine fotoğraf ekle (JPEG/PNG, ≤ 5 MB; aynı dosya ikinci kez yazılmaz)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [photos], properties: { photos: { type: array, items: { type: object, properties: { fileName: { type: string }, contentBase64: { type: string } } } } } }
 *     responses:
 *       200: { description: "{ success, data: [künye + duplicate] }" }
 *       409: { description: WARPING_REJECTION_CANCELLED }
 *       413: { description: WARPING_REJECT_PHOTO_TOO_LARGE }
 * /api/warping-beam-rejections/{id}/photos/{photoId}:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Ret fotoğrafını indir (ikili)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: photoId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Fotoğraf }
 *       404: { description: WARPING_REJECT_PHOTO_NOT_FOUND }
 * /api/warping-beam-rejections/{id}/cancel-preview:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Ret iptal önizlemesi — etkilenen her sarım, tutmadan yeniden düşecek iplik, engeller (yazmaz)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: { doc, cancellable, blockers, items, yarn } }" }
 * /api/warping-beam-rejections/{id}/cancel:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Ret belgesini iptal et — her sarım REJECT_OUT_CANCEL ile "Hazır"a döner, dağıtım yeniden sayılır
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [reason], properties: { reason: { type: string } } }
 *     responses:
 *       200: { description: İptal edildi }
 *       409: { description: "WARPING_REJECTION_CANCELLED · WARPING_REWORK_ACTIVE · WARPING_HOLDING_INSUFFICIENT · WARPING_RECEIPT_INVOICED · WARPING_ORDER_COMPLETED · BEAM_BODY_EVENT_NOT_LATEST" }
 */
router.get("/:id", requirePermission("warping-order:read"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await getWarpingBeamRejection(id) } };
}));

router.post("/:id/photos", requirePermission("warping-order:write"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(PhotosBody, req.body);
  return { status: 200, body: { success: true, data: await addRejectionPhotos(id, body.photos, req.user!.userId) } };
}));

router.get("/:id/photos/:photoId", requirePermission("warping-order:read"), async (req, res, next) => {
  try {
    const f = await readRejectionPhoto(parse(Id, req.params.id), parse(Id, req.params.photoId));
    const ascii = f.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    res.setHeader("Content-Type", f.mimeType);
    res.setHeader("Content-Length", String(f.content.length));
    res.setHeader("Content-Disposition", `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).end(Buffer.from(f.content));
  } catch (err) {
    next(err);
  }
});

router.get("/:id/cancel-preview", requirePermission("warping-order:cancel"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await previewCancelWarpingBeamRejection(id) } };
}));

router.post("/:id/cancel", requirePermission("warping-order:cancel"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(CancelBody, req.body);
  const data = await cancelWarpingBeamRejection(id, body.reason, req.user!.userId);
  return { status: 200, body: { success: true, data, message: `${data.docNo} iptal edildi` } };
}));

export default router;
