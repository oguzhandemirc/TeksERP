// =============================================================================
// TeksERP — FASON DEVERE DÖNÜŞ KABUL BELGESİ (`/api/warping-receive-docs`, devere ek E1)
// =============================================================================
// Tek irsaliyeyle gelen, aynı deverecinin N siparişinin leventleri tek belgede (hep-ya-hiç). Kapı sırası: `router.use`
// HER uçtan önce; iplik kapısı uç başına (kabul iplik dağıtır, önizleme ölçer — emsal `/receive`). Okuma `read`,
// önizleme/kabul `write`. İrsaliye no ile kabul grubu belgeli + eski tek-sipariş kabullerini birlikte döner.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AppError } from "../utils/app-error";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireDevereEnabled, requireIplikEnabled } from "../middlewares/module.middleware";
import { assertNoBareFilterParams, parseQueryParams, readIdCondition } from "../utils/query-parser";
import { qtyText } from "../services/helpers/qty-text.helper";
import { WARPING_RECEIVE_MAX_BEAMS } from "../services/warping-order/receive-core";
import { createWarpingReceiveDoc, previewWarpingReceiveDoc, WARPING_RECEIVE_DOC_MAX_ORDERS } from "../services/warping-order/receive-doc";
import { getDeliveryNoteGroup, getWarpingReceiveDoc, listWarpingReceiveDocs } from "../services/warping-order/receive-doc-read";
import { cancelWarpingReceiveDoc, previewCancelWarpingReceiveDoc } from "../services/warping-order/receive-doc-cancel";
import { DeliveryNoteNo, ReceiveBeamLine, ReceiveId } from "./warping-receive.schemas";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requireDevereEnabled);
// Devere ek D1: tablet dönüş kabulü (depo) önizleme/kabul/belge okuma — aynı servis, ayrı izin; liste/irsaliye grubu panelde kalır.
const MOBILE_DEVERE_KABUL = ["mobile:devere-kabul"] as const;

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

const OrderLine = z.strictObject({
  warpingOrderId: ReceiveId,
  beams: z.array(ReceiveBeamLine).min(1, "Her siparişte en az bir levent satırı gerekli").max(WARPING_RECEIVE_MAX_BEAMS, `En çok ${WARPING_RECEIVE_MAX_BEAMS} levent`),
});
const Fields = {
  subcontractorId: ReceiveId.nullable().optional(),
  deliveryNoteNo: DeliveryNoteNo,
  orders: z.array(OrderLine).min(1, "En az bir sipariş seçilmeli").max(WARPING_RECEIVE_DOC_MAX_ORDERS, `En çok ${WARPING_RECEIVE_DOC_MAX_ORDERS} sipariş`),
};
const PreviewBody = z.strictObject(Fields);
const CreateBody = z.strictObject({ clientToken: z.uuid("clientToken geçersiz (UUID)"), ...Fields });
const ListQuery = z.object({
  search: z.string().max(64).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).passthrough();
const FILTERS = ["subcontractorId", "deliveryNoteNo"];
const ByNoteQuery = z.object({ subcontractorId: ReceiveId, deliveryNoteNo: z.string().trim().min(1, "İrsaliye no gerekli").max(64, "İrsaliye no en çok 64 karakter") });

/**
 * @openapi
 * /api/warping-receive-docs/preview:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Dönüş kabul belgesi önizlemesi — sipariş başına levent/dağıtım/mutabakat (tek sipariş önizlemesiyle aynı), irsaliye no tekrarı; yazmaz
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ success, data: WarpingReceiveDocPreview }" }
 *       400: { description: "WARPING_RECEIVE_DOC_EMPTY · WARPING_RECEIVE_DOC_TOO_MANY · WARPING_RECEIVE_DOC_DUPLICATE_ORDER · WARPING_RECEIVE_DOC_MIXED_SUBCONTRACTOR · WARPING_RECEIVE_WEIGHING_OFF · WARPING_RECEIVE_WEIGHING_REQUIRED" }
 *       409: { description: WARPING_ORDER_NOT_RECEIVABLE }
 * /api/warping-receive-docs:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Dönüş kabul belgesi (DK-YYMM-NNNN) — aynı deverecinin N siparişinin leventleri tek işlemde, hep-ya-hiç; sipariş başı kabul anahtarı korunur
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken, orders]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               subcontractorId: { type: string, format: uuid, nullable: true }
 *               deliveryNoteNo: { type: string, nullable: true }
 *               orders: { type: array, items: { type: object, properties: { warpingOrderId: { type: string, format: uuid }, beams: { type: array, items: { type: object, description: "/api/warping-orders/{id}/receive satırıyla aynı" } } } } }
 *     responses:
 *       201: { description: "Kabul edildi — { data: WarpingReceiveDocDto, warnings }" }
 *       200: { description: Aynı denemenin tekrarı (replay) }
 *       400: { description: "WARPING_RECEIVE_DOC_* · WARPING_RECEIVE_* · WARPING_REWORK_* · BEAM_BODY_*" }
 *       409: { description: "WARPING_ORDER_NOT_RECEIVABLE (bir sipariş kapalıysa hiçbiri yazılmaz) · WARPING_DELIVERY_NOTE_USED · WARP_BEAM_CANCELLED · CLIENT_TOKEN_COLLISION · BEAM_BODY_* · WARPING_REWORK_TAKEN" }
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Dönüş kabul belgeleri listesi (filter[subcontractorId], filter[deliveryNoteNo], search, cursor) + özet
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ success, data[], nextCursor, summary{count, beamCount} }" }
 */
router.post("/preview", requireAnyPermission("warping-order:write", ...MOBILE_DEVERE_KABUL), requireIplikEnabled, wrap(async (req) => {
  const body = parse(PreviewBody, req.body);
  return { status: 200, body: { success: true, data: await previewWarpingReceiveDoc(body) } };
}));

router.post("/", requireAnyPermission("warping-order:write", ...MOBILE_DEVERE_KABUL), requireIplikEnabled, wrap(async (req) => {
  const body = parse(CreateBody, req.body);
  const { data, warnings, replayed } = await createWarpingReceiveDoc(body, req.user!.userId);
  return {
    status: replayed ? 200 : 201,
    body: {
      success: true, data,
      message: replayed ? `${data.docNo} zaten kayıtlı` : `${data.docNo}: ${data.totals.orderCount} siparişte ${data.totals.liveBeamCount} levent kabul edildi (${qtyText(data.totals.lengthM)} m)`,
      ...(warnings.length > 0 ? { warnings } : {}),
    },
  };
}));

router.get("/", requirePermission("warping-order:read"), wrap(async (req) => {
  assertNoBareFilterParams(req, FILTERS);
  const f = parseQueryParams(req).filters;
  const unknown = Object.keys(f).filter((k) => !FILTERS.includes(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan süzgeç: ${unknown.join(", ")}`, { code: "FILTER_UNKNOWN", params: unknown });
  const q = parse(ListQuery, req.query);
  const note = typeof f.deliveryNoteNo === "string" ? f.deliveryNoteNo : undefined;
  const out = await listWarpingReceiveDocs({ subcontractorId: readIdCondition(f.subcontractorId), deliveryNoteNo: note, search: q.search, cursor: q.cursor, limit: q.limit });
  return { status: 200, body: { success: true, ...out } };
}));

/**
 * @openapi
 * /api/warping-receive-docs/by-delivery-note:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: İrsaliye no ile kabul grubu — deverecinin bu no'lu bütün kabulleri (belgeli + eski tek-sipariş), sipariş başı kabul DTO'su
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: subcontractorId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: deliveryNoteNo, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "{ success, data: { subcontractorId, deliveryNoteNo, docs[], receipts[] } }" }
 * /api/warping-receive-docs/{id}:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Dönüş kabul belgesi — başlık + sipariş başı kabuller (leventler, dağıtım, mutabakat)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: WarpingReceiveDocDto }" }
 *       404: { description: WARPING_RECEIVE_DOC_NOT_FOUND }
 */
router.get("/by-delivery-note", requirePermission("warping-order:read"), wrap(async (req) => {
  const q = parse(ByNoteQuery, req.query);
  return { status: 200, body: { success: true, data: await getDeliveryNoteGroup(q.subcontractorId, q.deliveryNoteNo) } };
}));

router.get("/:id", requireAnyPermission("warping-order:read", ...MOBILE_DEVERE_KABUL), wrap(async (req) => {
  const id = parse(ReceiveId, req.params.id);
  return { status: 200, body: { success: true, data: await getWarpingReceiveDoc(id) } };
}));

const CancelBody = z.strictObject({ reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(300, "İptal sebebi en çok 300 karakter") });

/**
 * @openapi
 * /api/warping-receive-docs/{id}/cancel-preview:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Kabul belgesi stornosu önizlemesi (E6) — etkilenen her sipariş/levent, serbest kalacak iplik, engeller (LIFO, faturalı, ret, HAZIR olmayan levent); yazmaz
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: WarpingReceiveDocCancelPreview }" }
 *       404: { description: WARPING_RECEIVE_DOC_NOT_FOUND }
 * /api/warping-receive-docs/{id}/cancel:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Kabul belgesi stornosu (E6) — belgenin canlı bütün kabulleri tek işlemde WOUND_CANCEL; bir engel varsa hiçbiri geri alınmaz
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody: { required: true, content: { application/json: { schema: { type: object, required: [reason], properties: { reason: { type: string, minLength: 3, maxLength: 300 } } } } } }
 *     responses:
 *       200: { description: Geri alındı }
 *       404: { description: WARPING_RECEIVE_DOC_NOT_FOUND }
 *       409: { description: "WARPING_RECEIVE_DOC_NOT_OPEN · WARPING_RECEIPT_LIFO · WARPING_ORDER_COMPLETED · WARPING_RECEIPT_INVOICED · WARPING_RECEIPT_HAS_REJECTION · WARP_BEAM_STATE" }
 */
router.get("/:id/cancel-preview", requirePermission("warpbeam:cancel"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(ReceiveId, req.params.id);
  return { status: 200, body: { success: true, data: await previewCancelWarpingReceiveDoc(id) } };
}));

router.post("/:id/cancel", requirePermission("warpbeam:cancel"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(ReceiveId, req.params.id);
  const body = parse(CancelBody, req.body);
  const data = await cancelWarpingReceiveDoc(id, body.reason, req.user!.userId);
  const n = data.orders.reduce((s, o) => s + o.cancelledBeams.length, 0);
  return { status: 200, body: { success: true, data, message: `${data.docNo}: ${data.orders.length} siparişte ${n} levent dönüşü geri alındı` } };
}));

export default router;
