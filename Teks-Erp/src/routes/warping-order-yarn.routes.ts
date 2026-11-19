// =============================================================================
// TeksERP — FASON DEVERE: deverecideki iplik — İADE · AKTARMA · DEVREDEN bakiye okuyucusu (D4b-2)
// =============================================================================
// ⚠️ BU ROUTER KENDİ BAŞINA MOUNT EDİLMEZ. `warping-order.routes.ts` onu `router.use("/", warpingOrderYarnRoutes)` ile
// `/:id` uçlarından ÖNCE bağlar ve `verifyToken` + `requireDevereEnabled` kapısını MİRAS ALIR. İplik defterine dokunan
// ve iplik bakiyesi okuyan her uç `requireIplikEnabled`'ı UÇ BAŞINA alır (aktarma stok hareketi yazmaz; kapı yine burada).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { WarpingOrderStatus } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireIplikEnabled } from "../middlewares/module.middleware";
import { assertNoBareFilterParams, parseQueryParams, readFilterList } from "../utils/query-parser";
import { previewWarpingTransfer, transferWarpingYarn, WARPING_TRANSFER_MAX_LINES } from "../services/warping-order/yarn-transfer";
import { cancelWarpingTransfer, previewCancelWarpingTransfer } from "../services/warping-order/yarn-transfer-cancel";
import { listWarpingTransfers, listWarpingYarnHoldings, warpingYarnAtSubcontractors } from "../services/warping-order/yarn-return";
import { cancelWarpingYarnReturn, previewWarpingYarnReturn, returnWarpingYarn } from "../services/warping-order/yarn-return-waste";
import { qtyText } from "../services/helpers/qty-text.helper";
import { listWarpingDispatches } from "../services/warping-order/dispatches-read";
import { listWarpingYarnReturns } from "../services/warping-order/returns-read";
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
const Kg = z.number({ message: "Miktar (kg) sayı olmalı" }).positive("Miktar sıfırdan büyük olmalı").max(1_000_000, "Miktar çok büyük");
const TransferLine = z.strictObject({ yarnItemId: Id, qtyKg: Kg, lotId: Id.nullable().optional(), dispatchItemId: Id.optional() });
const TransferFields = {
  toWarpingOrderId: Id,
  lines: z.array(TransferLine).min(1, "En az bir iplik satırı gerekli").max(WARPING_TRANSFER_MAX_LINES, `En çok ${WARPING_TRANSFER_MAX_LINES} satır`),
  note: z.string().max(300, "Not en çok 300 karakter").nullable().optional(),
};
const TransferBody = z.strictObject({ clientToken: z.uuid("clientToken geçersiz (UUID)"), ...TransferFields });
const TransferPreviewBody = z.strictObject(TransferFields);
const ReturnFields = {
  dispatchItemId: Id,
  qtyKg: Kg,
  reasonCode: z.string().trim().min(1, "Dönüş sebebi zorunlu").max(64, "Sebep kodu en çok 64 karakter"),
  /** Kullanılamaz (fire) kg — isteğe bağlı; boş/0 = yalnız iade. */
  wasteKg: z.number({ message: "Fire (kg) sayı olmalı" }).min(0, "Fire negatif olamaz").max(1_000_000, "Miktar çok büyük").nullable().optional(),
};
const ReturnBody = z.strictObject({
  ...ReturnFields,
  warehouseId: Id.nullable().optional(),
  lotId: Id.nullable().optional(),
  wasteReason: z.string().max(300, "Fire gerekçesi en çok 300 karakter").nullable().optional(),
  // İsteğe bağlı: eski panel token'sız gönderir (bugünkü davranış); yeni panel MANTIKSAL DENEME başına.
  clientToken: z.uuid("clientToken geçersiz (UUID)").optional(),
});
// Önizleme sebep seçilmeden de çağrılır (canlı özet): sebep yazımda zorunlu, önizlemede isteğe bağlı.
const ReturnPreviewBody = z.strictObject({ ...ReturnFields, reasonCode: z.string().trim().max(64, "Sebep kodu en çok 64 karakter").optional() });
const CancelBody = z.strictObject({ reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(300, "İptal sebebi en çok 300 karakter") });
const AT_FILTERS = ["subcontractorId", "yarnItemId", "status"];

/**
 * @openapi
 * /api/warping-orders/yarn-at-subcontractor:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Deverecide duran iplik — fasoncu × iplik × lot (sipariş kırılımı, en eski sevk); filter[status]=COMPLETED → devreden bakiye
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: "filter[subcontractorId]", schema: { type: string } }
 *       - { in: query, name: "filter[yarnItemId]", schema: { type: string } }
 *       - { in: query, name: "filter[status]", schema: { type: string } }
 *     responses:
 *       200: { description: "{ success, data: [{ subcontractorId, subcontractorCode, subcontractorName, yarnItemId, yarnItemCode, yarnItemName, lotId, lotNo, ownerCustomerId, ownerCustomerName, kg, oldestDispatchedAt, orders[{ warpingOrderId, orderNo, status, kg }] }] }" }
 */
router.get("/yarn-at-subcontractor", requirePermission("warping-order:read"), requireIplikEnabled, wrap(async (req) => {
  assertNoBareFilterParams(req, AT_FILTERS);
  const f = parseQueryParams(req).filters;
  const unknown = Object.keys(f).filter((k) => !AT_FILTERS.includes(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan süzgeç: ${unknown.join(", ")}`, { code: "FILTER_UNKNOWN", params: unknown });
  const ids = (k: string): string[] | undefined => {
    const v = readFilterList(f[k]);
    if (v.length === 0) return undefined;
    if (v.some((x) => !Id.safeParse(x).success)) throw AppError.badRequest(`filter[${k}] geçersiz kimlik.`, { code: "FILTER_INVALID" });
    return v;
  };
  const status = readFilterList(f.status);
  const bad = status.find((s) => !(Object.values(WarpingOrderStatus) as string[]).includes(s));
  if (bad) throw AppError.badRequest(`filter[status] geçersiz: ${bad}`, { code: "FILTER_INVALID" });
  const data = await warpingYarnAtSubcontractors({ subcontractorIds: ids("subcontractorId"), yarnItemIds: ids("yarnItemId"), statuses: status.length > 0 ? (status as WarpingOrderStatus[]) : undefined });
  return { status: 200, body: { success: true, data } };
}));

/**
 * @openapi
 * /api/warping-orders/{id}/yarn-holdings:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Siparişin deverecide tuttuğu iplik, kalem kalem (kendi sevki + aktarımla gelen)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: [{ dispatchItemId, own, yarnItemId, lotNo, outKg, returnedKg, transferInKg, transferOutKg, holdingKg }] }" }
 * /api/warping-orders/{id}/dispatches:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Siparişin iplik sevkleri — iptal edilmişler DAHİL (status), kalem kalem BRÜT çıkış · net iade · aktarma · dağıtım; iptal edilebilirlik + neden
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: WarpingDispatchListRow[] }" }
 *       404: { description: WARPING_ORDER_NOT_FOUND }
 * /api/warping-orders/{id}/yarn-returns:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Siparişin iplik iadeleri (en yeni önce) — movementId, iplik, lot, kg, sebep, durum, storno edilebilirlik
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: WarpingYarnReturnRow[] }" }
 *       404: { description: WARPING_ORDER_NOT_FOUND }
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Kapanış dışında iplik İADESİ (SUBCONTRACT_RETURN) + isteğe bağlı FİRE (wasteKg, kapanış firesiyle aynı defter) — tavan siparişin tutması (iade + fire); aktarımla gelen kalemde aynı tx'te geri aktarım; kalan 0 ve kapanış yüklemi izin verirse sipariş aynı tx'te kapanır (data.autoClosed); clientToken isteğe bağlı (replay 200)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Replay — aynı token, kayıtlı iade }
 *       201: { description: "İade (+fire) yazıldı; warnings? = fire toleransı aşımı (yalnız uyarı)" }
 *       400: { description: "YARN_RETURN_EXCEEDS · REASON_CODE_INVALID · eksi bakiye" }
 *       404: { description: WARPING_YARN_NOT_HELD }
 *       409: { description: "WARPING_RETURN_STATUS · CLIENT_TOKEN_COLLISION · YARN_RETURN_CANCELLED" }
 * /api/warping-orders/{id}/yarn-returns/preview:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: İade(+fire) önizlemesi — yazmaz; fire % ve tolerans kapanış planının aynı hesabından, willClose = kaydedilince sipariş kapanır mı
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: { holdingKg, returnKg, wasteKg, keepKg, wastePct, tolerancePct, overTolerance, willClose, warnings } }" }
 *       400: { description: YARN_RETURN_EXCEEDS }
 *       404: { description: WARPING_YARN_NOT_HELD }
 * /api/warping-orders/{id}/yarn-returns/{movementId}/cancel:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: İade stornosu (SUBCONTRACT_RETURN_CANCEL) — iplik kalemin kendi siparişine döner; çift storno 409
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: movementId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Storno yazıldı }
 *       409: { description: YARN_RETURN_NOT_OPEN }
 */
router.get("/:id/yarn-holdings", requirePermission("warping-order:read"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await listWarpingYarnHoldings(id) } };
}));

router.get("/:id/dispatches", requirePermission("warping-order:read"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await listWarpingDispatches(id) } };
}));

router.get("/:id/yarn-returns", requirePermission("warping-order:read"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await listWarpingYarnReturns(id) } };
}));

router.post("/:id/yarn-returns/preview", requirePermission("warping-order:write"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(ReturnPreviewBody, req.body);
  // Uyarılar yalnız `data` içinde: canlı önizleme her girişte çağrılır, interceptor tostu basmasın.
  return { status: 200, body: { success: true, data: await previewWarpingYarnReturn(id, body) } };
}));

router.post("/:id/yarn-returns", requirePermission("warping-order:write"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(ReturnBody, req.body);
  const { warnings, replayed, ...data } = await returnWarpingYarn(id, body, req.user!.userId);
  return { status: replayed ? 200 : 201, body: { success: true, data: { ...data, replayed }, message: returnMessage(data), ...(warnings.length > 0 ? { warnings } : {}) } };
}));

router.post("/:id/yarn-returns/:movementId/cancel", requirePermission("warping-order:write"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const movementId = parse(Id, req.params.movementId);
  const body = parse(CancelBody, req.body);
  const data = await cancelWarpingYarnReturn(id, movementId, body.reason, req.user!.userId);
  const fire = Number(data.wasteCancelledKg) > 0 ? ` (iadeyle yazılan ${qtyText(data.wasteCancelledKg)} kg fire de geri alındı)` : "";
  return { status: 200, body: { success: true, data, message: `${data.itemCode} iadesi iptal edildi — iplik yeniden deverecide${fire}` } };
}));

/** Başarı cümlesi: iplik ADI birincil; fire ve otomatik kapanış açıkça söylenir. */
function returnMessage(d: { itemCode: string; itemName: string; qtyKg: string; wasteKg: string; autoClosed: boolean }): string {
  const name = d.itemName || d.itemCode;
  const fire = Number(d.wasteKg) > 0 ? ` · ${qtyText(d.wasteKg)} kg fire` : "";
  return `${name} devereciden iade alındı — ${qtyText(d.qtyKg)} kg${fire}${d.autoClosed ? "; deverecide iplik kalmadı, sipariş kapandı" : ""}`;
}

/**
 * @openapi
 * /api/warping-orders/{id}/yarn-transfers:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Siparişin giren/çıkan iplik aktarma ve storno belgeleri
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: WarpingTransferBatch[] }" }
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Deverecideki ipliği AYNI devecinin başka siparişine aktar (stok hareketi yok); kaynak IN_PROGRESS|COMPLETED, hedef OPEN|IN_PROGRESS
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       201: { description: Aktarıldı }
 *       200: { description: Aynı denemenin tekrarı (replay) }
 *       400: { description: "WARPING_TRANSFER_EXCEEDS · WARPING_YARN_NOT_IN_PLAN · WARPING_TRANSFER_OTHER_SUBCONTRACTOR · WARPING_TRANSFER_SAME_ORDER" }
 *       409: { description: "WARPING_TRANSFER_SOURCE_STATUS · WARPING_TRANSFER_TARGET_STATUS · OWNER_MISMATCH · WARPING_LOT_MIXED · CLIENT_TOKEN_COLLISION" }
 * /api/warping-orders/{id}/yarn-transfers/preview:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Aktarma önizlemesi — kalem kalem FIFO seçimi, sahip, lot uyarıları (yazmaz)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: { allocations, totalKg, ownerCustomerId }, warnings? }" }
 * /api/warping-orders/{id}/yarn-transfers/{batchId}/cancel-preview:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Aktarma stornosu önizlemesi — etkilenen her kalem, hedefin bugün tuttuğu kg, LIFO engeli
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: batchId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ success, data: WarpingTransferCancelPreview }" }
 * /api/warping-orders/{id}/yarn-transfers/{batchId}/cancel:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Aktarma stornosu (TRANSFER_CANCEL, reversesId) — hedef aktarılanı hâlâ tutmuyorsa 409; çift storno 409
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: batchId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Storno yazıldı }
 *       409: { description: "WARPING_TRANSFER_CONSUMED · WARPING_TRANSFER_ALREADY_CANCELLED" }
 */
router.get("/:id/yarn-transfers", requirePermission("warping-order:read"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await listWarpingTransfers(id) } };
}));

router.post("/:id/yarn-transfers/preview", requirePermission("warping-order:write"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(TransferPreviewBody, req.body);
  const { warnings, ...data } = await previewWarpingTransfer(id, body);
  return { status: 200, body: { success: true, data, ...(warnings.length > 0 ? { warnings } : {}) } };
}));

router.post("/:id/yarn-transfers", requirePermission("warping-order:write"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(TransferBody, req.body);
  const { warnings, replayed, ...data } = await transferWarpingYarn(id, body, req.user!.userId);
  return {
    status: replayed ? 200 : 201,
    body: { success: true, data, message: replayed ? "Aktarma zaten kayıtlı" : `${qtyText(data.totalKg)} kg ${data.toOrderNo} siparişine aktarıldı${data.sourceAutoClosed ? `; ${data.fromOrderNo} siparişinde iplik kalmadı, sipariş kapandı` : ""}`, ...(warnings.length > 0 ? { warnings } : {}) },
  };
}));

router.get("/:id/yarn-transfers/:batchId/cancel-preview", requirePermission("warping-order:write"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const batchId = parse(Id, req.params.batchId);
  return { status: 200, body: { success: true, data: await previewCancelWarpingTransfer(id, batchId) } };
}));

router.post("/:id/yarn-transfers/:batchId/cancel", requirePermission("warping-order:write"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const batchId = parse(Id, req.params.batchId);
  const body = parse(CancelBody, req.body);
  const data = await cancelWarpingTransfer(id, batchId, body.reason, req.user!.userId);
  return { status: 200, body: { success: true, data, message: `Aktarma iptal edildi — ${data.totalKg} kg ${data.fromOrderNo} siparişine döndü` } };
}));

export default router;
