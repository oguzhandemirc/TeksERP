// =============================================================================
// TeksERP — FASON DEVERE: sipariş KAPANIŞI (iade / fire / deverecide kalır) · kapanış geçmişi · yeniden açma (D5b)
// =============================================================================
// ⚠️ BU ROUTER KENDİ BAŞINA MOUNT EDİLMEZ. `warping-order.routes.ts` onu `router.use("/", warpingOrderSettleRoutes)` ile
// `/:id` uçlarından ÖNCE bağlar ve `verifyToken` + `requireDevereEnabled` kapısını MİRAS ALIR. İplik bakiyesini değiştiren
// ve okuyan her uç `requireIplikEnabled`'ı UÇ BAŞINA alır (kapanış deverecideki ipliği iade/fire eder).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AppError } from "../utils/app-error";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireIplikEnabled } from "../middlewares/module.middleware";
import { previewSettleWarpingOrder, settleWarpingOrder } from "../services/warping-order/settle";
import { listWarpingSettlements } from "../services/warping-order/settle-record";
import { previewReopenWarpingOrder, reopenWarpingOrder } from "../services/warping-order/reopen";
import { qtyText } from "../services/helpers/qty-text.helper";
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
const Kg = (ad: string) => z.number({ message: `${ad} sayı olmalı` }).min(0, `${ad} negatif olamaz`).max(1_000_000, `${ad} çok büyük`);
const Line = z.strictObject({
  dispatchItemId: z.uuid("Sevk kalemi kimliği geçersiz"),
  returnKg: Kg("İade kg").optional(),
  wasteKg: Kg("Fire kg").optional(),
  returnReasonCode: z.string().trim().max(64, "İade sebebi en çok 64 karakter").nullable().optional(),
  warehouseId: z.uuid("Depo kimliği geçersiz").nullable().optional(),
});
const SettleFields = {
  reason: z.string().trim().max(300, "Gerekçe en çok 300 karakter").nullable().optional(),
  returnReasonCode: z.string().trim().max(64, "İade sebebi en çok 64 karakter").nullable().optional(),
  lines: z.array(Line).max(500, "En çok 500 kalem").optional(),
};
const SettleBody = z.strictObject({ clientToken: z.uuid("clientToken geçersiz (UUID)"), ...SettleFields });
const SettlePreviewBody = z.strictObject(SettleFields);
const ReopenBody = z.strictObject({ reason: z.string().trim().min(3, "Yeniden açma sebebi en az 3 karakter").max(300, "Sebep en çok 300 karakter") });

/**
 * @openapi
 * /api/warping-orders/{id}/settlement-preview:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Kapanış önizlemesi (gövdesiz öneri `devere.settleDefault` kipinden, varsayılan A1-a) — kalem kalem tutulan iplik, önerilen fire (A1-a ile plan brüt − net kadar) ve deverecide kalan, fire %, tolerans uyarısı; yazmaz
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: WarpingSettlePreview }" }
 * /api/warping-orders/{id}/settle/preview:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Kullanıcının bölüşümüyle kapanış önizlemesi (satır satır iade / fire; kalan deverecide kalır); yazmaz
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: WarpingSettlePreview }" }
 */
router.get("/:id/settlement-preview", requirePermission("warping-order:settle"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await previewSettleWarpingOrder(id) } };
}));

router.post("/:id/settle/preview", requirePermission("warping-order:settle"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(SettlePreviewBody, req.body);
  return { status: 200, body: { success: true, data: await previewSettleWarpingOrder(id, body) } };
}));

/**
 * @openapi
 * /api/warping-orders/{id}/settle:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Sipariş kapanışı — kalan iplik satır satır İADE (depoya, lot korunur) / FİRE (fire defteri) / DEVERECİDE KALIR (kayıt yok, sonraki siparişe devreder); satırsız gövde = `devere.settleDefault` kipi (varsayılan A1-a; RETURN kipinde returnReasonCode zorunlu); tolerans aşımı yalnız uyarır; sipariş COMPLETED
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               reason: { type: string, nullable: true }
 *               returnReasonCode: { type: string, nullable: true }
 *               lines: { type: array, items: { type: object, properties: { dispatchItemId: { type: string, format: uuid }, returnKg: { type: number }, wasteKg: { type: number }, returnReasonCode: { type: string, nullable: true }, warehouseId: { type: string, nullable: true } } } }
 *     responses:
 *       201: { description: "Kapandı — { data: WarpingSettlementRecord, warnings }" }
 *       200: { description: Aynı denemenin tekrarı (replay) }
 *       400: { description: "WARPING_SETTLE_LINE_UNKNOWN · WARPING_SETTLE_LINE_DUPLICATE · WARPING_SETTLE_EXCEEDS · WARPING_SETTLE_RETURN_REASON · REASON_CODE_INVALID" }
 *       409: { description: "WARPING_ORDER_COMPLETED · WARPING_ORDER_NOT_SETTLEABLE · WARPING_SETTLE_EMPTY · WARPING_SETTLEMENT_REOPENED · CLIENT_TOKEN_COLLISION" }
 */
router.post("/:id/settle", requirePermission("warping-order:settle"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(SettleBody, req.body);
  const { warnings, replayed, keepKg, ...data } = await settleWarpingOrder(id, body, req.user!.userId);
  // Deverecide kalan da söylenir; yoksa "iade 0, fire 0" kalan ipliği gizler (prova Ü2).
  const kept = keepKg !== null && Number(keepKg) > 0 ? `, deverecide kalır ${qtyText(keepKg)} kg` : "";
  return {
    status: replayed ? 200 : 201,
    body: { success: true, data, message: replayed ? "Bu kapanış zaten kayıtlı" : `Sipariş kapandı — iade ${qtyText(data.totalReturnKg)} kg, fire ${qtyText(data.totalWasteKg)} kg${kept}`, ...(warnings.length > 0 ? { warnings } : {}) },
  };
}));

/**
 * @openapi
 * /api/warping-orders/{id}/settlements:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Siparişin kapanış / yeniden açma geçmişi (fire satırları, kapanış iadeleri, tolerans hükmü)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: WarpingSettlementRecord[] }" }
 */
router.get("/:id/settlements", requirePermission("warping-order:read"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await listWarpingSettlements(id) } };
}));

/**
 * @openapi
 * /api/warping-orders/{id}/reopen-preview:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Yeniden açma önizlemesi — storno edilecek her fire satırı, kapanış iadesi ve geri aktarım
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: WarpingReopenPreview }" }
 * /api/warping-orders/{id}/reopen:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Kapanış stornosu — fire satırlarına WASTE_CANCEL, kapanış iadelerine SUBCONTRACT_RETURN_CANCEL, geri aktarımlara TRANSFER_CANCEL; sipariş IN_PROGRESS
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Yeniden açıldı }
 *       409: { description: "WARPING_ORDER_NOT_COMPLETED · WARPING_REOPEN_TRANSFER_HELD · YARN_NEGATIVE_STOCK" }
 */
router.get("/:id/reopen-preview", requirePermission("warping-order:settle"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await previewReopenWarpingOrder(id) } };
}));

router.post("/:id/reopen", requirePermission("warping-order:settle"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(ReopenBody, req.body);
  const data = await reopenWarpingOrder(id, body.reason, req.user!.userId);
  return { status: 200, body: { success: true, data, message: `Sipariş yeniden açıldı — ${data.wastesCancelled} fire satırı, ${data.returnsCancelled.length} iade geri alındı` } };
}));

export default router;
