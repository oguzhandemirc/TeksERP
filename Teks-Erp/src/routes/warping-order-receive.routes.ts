// =============================================================================
// TeksERP — FASON DEVERE: devereciden DÖNEN LEVENT kabulü · kabul listesi · kabul stornosu (D5a)
// =============================================================================
// ⚠️ BU ROUTER KENDİ BAŞINA MOUNT EDİLMEZ. `warping-order.routes.ts` onu `router.use("/", warpingOrderReceiveRoutes)` ile
// `/:id` uçlarından ÖNCE bağlar ve `verifyToken` + `requireDevereEnabled` kapısını MİRAS ALIR. İplik bakiyesini değiştiren
// ve okuyan her uç `requireIplikEnabled`'ı UÇ BAŞINA alır (dağıtım deverecideki ipliği düşer).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AppError } from "../utils/app-error";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireIplikEnabled } from "../middlewares/module.middleware";
import { previewWarpingReceive, receiveWarpingOrder, WARPING_RECEIVE_MAX_BEAMS } from "../services/warping-order/receive";
import { cancelWarpingReceipt, previewCancelWarpingReceipt } from "../services/warping-order/receive-cancel";
import { listWarpingReceipts } from "../services/warping-order/receipts";
import { qtyText } from "../services/helpers/qty-text.helper";
import { BEAM_BODY_MAX_MACHINES } from "../services/beam-body/write";
import { BEAM_BODY_OWNER_KINDS, type BeamBodyOwnerKind } from "../constants/beam-body";
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
const Kg = z.number({ message: "Tartı (kg) sayı olmalı" }).min(0, "Tartı negatif olamaz").max(100_000, "Tartı çok büyük");
const Cm = z.number({ message: "Ölçü sayı olmalı" }).positive("Ölçü sıfırdan büyük olmalı").max(10_000, "Ölçü çok büyük");
// B3: tanımsız gövde yerinde (sahip zorunlu); `devere.beamBodyMode=OFF`ta servis 403 verir.
const NewBody = z.strictObject({
  bodyNo: z.string().trim().max(32, "Gövde no en çok 32 karakter").nullable().optional(),
  owner: z.strictObject({
    kind: z.enum(BEAM_BODY_OWNER_KINDS as [BeamBodyOwnerKind, ...BeamBodyOwnerKind[]], { message: "Gövde sahibi geçersiz" }),
    customerId: Id.nullable().optional(),
    subcontractorId: Id.nullable().optional(),
  }),
  widthCm: Cm.nullable().optional(),
  flangeDiameterCm: Cm.nullable().optional(),
  tareKg: Kg.positive("Gövde darası sıfırdan büyük olmalı").nullable().optional(),
  machineIds: z.array(Id).max(BEAM_BODY_MAX_MACHINES, `En çok ${BEAM_BODY_MAX_MACHINES} tezgâh`).optional(),
});
const BeamLine = z.strictObject({
  lengthM: z.number({ message: "Levent metresi sayı olmalı" }).positive("Levent metresi sıfırdan büyük olmalı").max(1_000_000, "Levent metresi çok büyük"),
  physicalBeamNo: z.string().trim().max(32, "Gövde no en çok 32 karakter").nullable().optional(),
  grossKg: Kg.nullable().optional(),
  tareKg: Kg.nullable().optional(),
  beamBodyId: Id.nullable().optional(),
  newBody: NewBody.nullable().optional(),
});
const ReceiveFields = {
  deliveryNoteNo: z.string().trim().max(64, "İrsaliye no en çok 64 karakter").nullable().optional(),
  beams: z.array(BeamLine).min(1, "En az bir levent satırı gerekli").max(WARPING_RECEIVE_MAX_BEAMS, `En çok ${WARPING_RECEIVE_MAX_BEAMS} levent`),
};
const ReceiveBody = z.strictObject({ clientToken: z.uuid("clientToken geçersiz (UUID)"), ...ReceiveFields });
const ReceivePreviewBody = z.strictObject(ReceiveFields);
const CancelBody = z.strictObject({ reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(300, "İptal sebebi en çok 300 karakter") });

/**
 * @openapi
 * /api/warping-orders/{id}/receipts:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Dönen levent kabulleri (irsaliye no, leventler, tartı farkı, iplik dağıtımı) + mutabakat (hedef ↔ gelen metre, iplik başına sarılan/devir/kalan)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: { receipts[], settlement } }" }
 */
router.get("/:id/receipts", requirePermission("warping-order:read"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await listWarpingReceipts(id) } };
}));

/**
 * @openapi
 * /api/warping-orders/{id}/receive/preview:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Dönüş kabulü önizlemesi — levent başına nominal kg, sevk sırasıyla dağıtım (devir dahil), hedef ↔ gelen metre, tartı farkı; yazmaz
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: WarpingReceivePreview }" }
 * /api/warping-orders/{id}/receive:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Devereciden dönen levent kabulü — N levent tek işlemde doğar (köken fason, kg hesaptan, tartı ayrıca saklanır); iplik sevk kalemlerine sevk sırasıyla dağıtılır
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken, beams]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               deliveryNoteNo: { type: string, nullable: true }
 *               beams: { type: array, items: { type: object, properties: { lengthM: { type: number }, physicalBeamNo: { type: string, nullable: true }, grossKg: { type: number, nullable: true }, tareKg: { type: number, nullable: true }, beamBodyId: { type: string, format: uuid, nullable: true, description: "B3 okutulan levent gövdesi" }, newBody: { type: object, nullable: true, description: "B3 tanımsız gövde yerinde: bodyNo?, owner{kind OURS/WARPER/CUSTOMER/OTHER, customerId?, subcontractorId?}, widthCm?, flangeDiameterCm?, tareKg?, machineIds?" } } } }
 *     responses:
 *       201: { description: "Kabul edildi — { data: WarpingReceiptDto, warnings }" }
 *       200: { description: Aynı denemenin tekrarı (replay) }
 *       400: { description: "WARPING_RECEIVE_EMPTY · WARPING_RECEIVE_DUPLICATE_PHYSICAL · WARPING_RECEIVE_TARE_EXCEEDS · BEAM_BODY_REQUIRED · BEAM_BODY_INPUT_AMBIGUOUS · WARPING_RECEIVE_DUPLICATE_BODY · BEAM_BODY_PHYSICAL_MISMATCH · BEAM_BODY_OWNER_*" }
 *       403: { description: "BEAM_BODY_MODE_OFF (gövde girdisi, ayar kapalı)" }
 *       409: { description: "WARPING_ORDER_NOT_RECEIVABLE · OWNER_MISMATCH · WARP_BEAM_PHYSICAL_BUSY · WARP_BEAM_CANCELLED · CLIENT_TOKEN_COLLISION · BEAM_BODY_BUSY · BEAM_BODY_ELSEWHERE · BEAM_BODY_STATE · BEAM_BODY_INACTIVE · BEAM_BODY_NO_TAKEN" }
 */
router.post("/:id/receive/preview", requirePermission("warping-order:write"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(ReceivePreviewBody, req.body);
  return { status: 200, body: { success: true, data: await previewWarpingReceive(id, body) } };
}));

router.post("/:id/receive", requirePermission("warping-order:write"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(ReceiveBody, req.body);
  const { warnings, replayed, ...data } = await receiveWarpingOrder(id, body, req.user!.userId);
  return {
    status: replayed ? 200 : 201,
    body: { success: true, data, message: replayed ? "Bu kabul zaten kayıtlı" : `${data.liveBeamCount} levent kabul edildi (${qtyText(data.lengthM)} m)`, ...(warnings.length > 0 ? { warnings } : {}) },
  };
}));

/**
 * @openapi
 * /api/warping-orders/{id}/receipts/{receiptKey}/cancel-preview:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Kabul stornosu önizlemesi — etkilenen her levent, geri gelecek iplik tutması, engeller (LIFO, kapanmış sipariş, takılı levent)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: receiptKey, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ success, data: WarpingReceiptCancelPreview }" }
 * /api/warping-orders/{id}/receipts/{receiptKey}/cancel:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Kabul stornosu — kabulün canlı leventleri WOUND_CANCEL (tipli ters); dağıtım düşer; yalnız en yeni kabul (LIFO); kapanmış siparişte 409
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: receiptKey, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Geri alındı }
 *       409: { description: "WARPING_RECEIPT_LIFO · WARPING_ORDER_COMPLETED · WARP_BEAM_STATE · WARPING_RECEIPT_NOT_OPEN" }
 */
router.get("/:id/receipts/:receiptKey/cancel-preview", requirePermission("warpbeam:cancel"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const key = parse(Id, req.params.receiptKey);
  return { status: 200, body: { success: true, data: await previewCancelWarpingReceipt(id, key) } };
}));

router.post("/:id/receipts/:receiptKey/cancel", requirePermission("warpbeam:cancel"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const key = parse(Id, req.params.receiptKey);
  const body = parse(CancelBody, req.body);
  const data = await cancelWarpingReceipt(id, key, body.reason, req.user!.userId);
  return { status: 200, body: { success: true, data, message: `${data.cancelledBeams.length} levent dönüşü geri alındı` } };
}));

export default router;
