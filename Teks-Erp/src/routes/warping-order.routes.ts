// =============================================================================
// TeksERP — FASON DEVERE SİPARİŞİ (`/api/warping-orders`, devere D4)
// =============================================================================
// Kapı sırası: `verifyToken` → `requireDevereEnabled` → izin. İplik kapısı sipariş CRUD'una konmaz (stok sütunu iplik
// kapalıyken `null` = bilinmiyor); iplik HAREKETİ yazan sevk uçları (D4b) `requireIplikEnabled`'ı uç başına alır. Plan sunucuda hesaplanır; istemci sayı türetmez.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { Currency, WarpingFeeUnit, WarpingOrderStatus } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDevereEnabled } from "../middlewares/module.middleware";
import { assertNoBareFilterParams, parseQueryParams, readFilterList, readIdCondition } from "../utils/query-parser";
import { createWarpingOrder, patchWarpingOrder, previewWarpingOrder, WARPING_ORDER_MAX_SALES_ORDERS } from "../services/warping-order/create";
import { cancelPreviewWarpingOrder, cancelWarpingOrder } from "../services/warping-order/cancel";
import { getWarpingOrder, listWarpingOrders } from "../services/warping-order/read";
import { WARPING_ORDER_MAX_BEAM_LINES, WARPING_ORDER_MAX_EXTRA_SPECS } from "../services/warping-order/plan";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requireDevereEnabled);

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
const BeamLine = z.strictObject({
  beamCount: z.number({ message: "Levent adedi sayı olmalı" }).int("Levent adedi tam sayı olmalı").positive("Levent adedi sıfırdan büyük olmalı").max(10_000, "Levent adedi çok büyük"),
  beamLengthM: z.number({ message: "Levent boyu sayı olmalı" }).positive("Levent boyu sıfırdan büyük olmalı").max(1_000_000, "Levent boyu çok büyük"),
});
const PlanFields = {
  beamLines: z.array(BeamLine).min(1, "En az bir levent satırı gerekli").max(WARPING_ORDER_MAX_BEAM_LINES, `En çok ${WARPING_ORDER_MAX_BEAM_LINES} levent satırı`),
  extraWarpSpecIds: z.array(Id).max(WARPING_ORDER_MAX_EXTRA_SPECS, `En çok ${WARPING_ORDER_MAX_EXTRA_SPECS} ek tel grubu`).optional(),
  fixedWasteM: z.number({ message: "Sabit fire sayı olmalı" }).min(0, "Sabit fire negatif olamaz").max(1000, "Sabit fire en çok 1000 m").optional(),
};
const MetaFields = {
  salesOrderIds: z.array(Id).max(WARPING_ORDER_MAX_SALES_ORDERS, `En çok ${WARPING_ORDER_MAX_SALES_ORDERS} müşteri siparişi`).optional(),
  wasteTolerancePct: z.number({ message: "Fire toleransı sayı olmalı" }).min(0, "Fire toleransı negatif olamaz").max(99, "Fire toleransı en çok %99").nullable().optional(),
  feeUnit: z.enum(WarpingFeeUnit, { message: "Ücret birimi METRE, KG ya da ENDS_METRE olmalı" }).optional(),
  feeUnitPrice: z.number({ message: "Devere ücreti sayı olmalı" }).min(0, "Devere ücreti negatif olamaz").max(1_000_000, "Devere ücreti çok büyük").nullable().optional(),
  feeCurrency: z.enum(Currency, { message: "Para birimi geçersiz" }).nullable().optional(),
  expectedReturnAt: z.iso.datetime({ offset: true, message: "Termin ISO tarih-saat olmalı" }).nullable().optional(),
  notes: z.string().max(500, "Not en çok 500 karakter").nullable().optional(),
};
const PreviewBody = z.strictObject({ warpSpecId: Id, ...PlanFields });
const CreateBody = z.strictObject({ clientToken: z.uuid("clientToken geçersiz (UUID)"), warpSpecId: Id, subcontractorId: Id, ...PlanFields, ...MetaFields });
const PatchBody = z.strictObject({ ...PlanFields, beamLines: PlanFields.beamLines.optional(), ...MetaFields });
const CancelBody = z.strictObject({ reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(300, "İptal sebebi en çok 300 karakter") });
const ListQuery = z.object({
  search: z.string().max(64).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).passthrough();
const FILTERS = ["status", "subcontractorId", "warpSpecId", "salesOrderId", "from", "to"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @openapi
 * /api/warping-orders:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Fason devere siparişleri — liste + cursor + özet şeridi (tek where)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: "filter[status]", schema: { type: string }, description: "CSV — OPEN, IN_PROGRESS, COMPLETED, CANCELLED" }
 *       - { in: query, name: "filter[subcontractorId]", schema: { type: string }, description: "CSV devereci id" }
 *       - { in: query, name: "filter[warpSpecId]", schema: { type: string }, description: "CSV çözgü kartı id" }
 *       - { in: query, name: "filter[salesOrderId]", schema: { type: string }, description: "CSV müşteri siparişi id" }
 *       - { in: query, name: "filter[from]", schema: { type: string, format: date }, description: "Fabrika günü (createdAt)" }
 *       - { in: query, name: "filter[to]", schema: { type: string, format: date } }
 *       - { in: query, name: search, schema: { type: string }, description: "Sipariş no" }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 200 } }
 *     responses:
 *       200: { description: "{ success, data, nextCursor, summary }" }
 *       400: { description: Tanınmayan/geçersiz süzgeç (FILTER_UNKNOWN · FILTER_INVALID) }
 *       403: { description: Devere modülü kapalı (MODULE_DISABLED) ya da warping-order:read yok }
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Fason devere siparişi aç (plan sunucuda hesaplanır ve donar; clientToken idempotent)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken, warpSpecId, subcontractorId, beamLines]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               warpSpecId: { type: string, format: uuid }
 *               subcontractorId: { type: string, format: uuid }
 *               beamLines: { type: array, items: { type: object, properties: { beamCount: { type: integer }, beamLengthM: { type: number } } } }
 *               extraWarpSpecIds: { type: array, items: { type: string, format: uuid }, description: "Aynı levente sarılan ek tel grubu kartları" }
 *               salesOrderIds: { type: array, items: { type: string, format: uuid }, description: "K3 — boş = stoğa çözgü" }
 *               fixedWasteM: { type: number, description: "Verilmezse devere.warpFixedWasteM" }
 *               wasteTolerancePct: { type: number, nullable: true, description: "Verilmezse devere.fasonWasteTolerancePct (0 = denetim yok)" }
 *               feeUnit: { type: string, enum: [METRE, KG, ENDS_METRE] }
 *               feeUnitPrice: { type: number, nullable: true }
 *               feeCurrency: { type: string, nullable: true }
 *               expectedReturnAt: { type: string, format: date-time, nullable: true }
 *               notes: { type: string, nullable: true }
 *     responses:
 *       201: { description: Sipariş açıldı }
 *       200: { description: Aynı denemenin tekrarı (replay) }
 *       400: { description: "WARP_SPEC_INACTIVE · YARN_DENIER_MISSING · WARPING_EXTRA_NOT_SHARED · SALES_ORDER_CANCELLED · VALIDATION_ERROR" }
 *       409: { description: "WARPING_ORDER_CANCELLED · CLIENT_TOKEN_COLLISION" }
 */
router.get("/", requirePermission("warping-order:read"), wrap(async (req) => {
  assertNoBareFilterParams(req, FILTERS);
  const f = parseQueryParams(req).filters;
  const unknown = Object.keys(f).filter((k) => !FILTERS.includes(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan süzgeç: ${unknown.join(", ")}`, { code: "FILTER_UNKNOWN", params: unknown });
  const status = readFilterList(f.status);
  const bad = status.find((s) => !(Object.values(WarpingOrderStatus) as string[]).includes(s));
  if (bad) throw AppError.badRequest(`filter[status] geçersiz: ${bad}`, { code: "FILTER_INVALID" });
  const one = (k: "from" | "to"): string | undefined => {
    const v = readFilterList(f[k]);
    if (v.length === 0) return undefined;
    if (v.length > 1 || !YMD.test(v[0]!)) throw AppError.badRequest(`filter[${k}] YYYY-AA-GG olmalı.`, { code: "FILTER_INVALID" });
    return v[0];
  };
  const q = parse(ListQuery, req.query);
  const out = await listWarpingOrders({
    status: status as WarpingOrderStatus[],
    subcontractorId: readIdCondition(f.subcontractorId),
    warpSpecId: readIdCondition(f.warpSpecId),
    salesOrderId: readIdCondition(f.salesOrderId),
    from: one("from"),
    to: one("to"),
    search: q.search,
    cursor: q.cursor,
    limit: q.limit,
  });
  return { status: 200, body: { success: true, ...out } };
}));

router.post("/", requirePermission("warping-order:write"), wrap(async (req) => {
  const body = parse(CreateBody, req.body);
  const out = await createWarpingOrder(body, req.user!.userId);
  return { status: out.replayed ? 200 : 201, body: { success: true, data: out.data, message: out.replayed ? `${out.data.orderNo} zaten kayıtlı` : `Fason devere siparişi ${out.data.orderNo} açıldı` } };
}));

/**
 * @openapi
 * /api/warping-orders/preview:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Sipariş planı önizlemesi — iplik başına formül (firesiz) ve fireli kg, depo stoğu, ek tel grubu önerisi; yazmaz
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ success, data: WarpingOrderPreview }" }
 *       400: { description: Geçersiz kart/satır }
 */
router.post("/preview", requirePermission("warping-order:write"), wrap(async (req) => {
  const body = parse(PreviewBody, req.body);
  return { status: 200, body: { success: true, data: await previewWarpingOrder(body) } };
}));

/**
 * @openapi
 * /api/warping-orders/{id}:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Fason devere siparişi detayı (plan satırları, levent satırları, bağlı müşteri siparişleri)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data }" }
 *       404: { description: WARPING_ORDER_NOT_FOUND }
 *   patch:
 *     tags: [WarpingOrder]
 *     summary: Düzenle — plan alanları yalnız OPEN (sevksiz); not/termin/ücret/tolerans/sipariş bağı OPEN ve IN_PROGRESS
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncel sipariş }
 *       409: { description: WARPING_ORDER_NOT_EDITABLE }
 */
router.get("/:id", requirePermission("warping-order:read"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await getWarpingOrder(id) } };
}));

router.patch("/:id", requirePermission("warping-order:write"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(PatchBody, req.body);
  const data = await patchWarpingOrder(id, body, req.user!.userId);
  return { status: 200, body: { success: true, data, message: `${data.orderNo} güncellendi` } };
}));

/**
 * @openapi
 * /api/warping-orders/{id}/cancel-preview:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: İptal önizlemesi — iptal edilebilir mi, etkilenen kayıtlar
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: { canCancel, blockedReason, salesOrders, affected } }" }
 * /api/warping-orders/{id}/cancel:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Siparişi iptal et (yalnız OPEN — sevksiz; soft, durum geçişi)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: İptal edildi }
 *       409: { description: WARPING_ORDER_NOT_CANCELLABLE }
 */
router.get("/:id/cancel-preview", requirePermission("warping-order:cancel"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await cancelPreviewWarpingOrder(id) } };
}));

router.post("/:id/cancel", requirePermission("warping-order:cancel"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(CancelBody, req.body);
  const data = await cancelWarpingOrder(id, body.reason, req.user!.userId);
  return { status: 200, body: { success: true, data, message: `${data.orderNo} iptal edildi` } };
}));

export default router;
