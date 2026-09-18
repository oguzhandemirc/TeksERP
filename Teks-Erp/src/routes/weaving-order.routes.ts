// =============================================================================
// TeksERP — Dokuma İşi (WeavingOrder) Routes · dokuma modülü
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireDokumaEnabled` → `requirePermission`.
// Kapı ekran dilimiyle doğdu (2026-09-13): `dokuma.enabled` üretime bağımlıdır ve
// kapı ön koşulu (üretim) ÖNCE ölçer. Jenerik `requireModule("…")` YASAK (ESLint +
// bekçi middleware ADINI arar). Ölçen bekçi: `test_dokuma_regime_gate`.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { WeavingExecutionKind, WeavingOrderStatus } from "@prisma/client";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { readFilterList, readIdCondition } from "../utils/query-parser";
import { AppError } from "../utils/app-error";
import {
  cancelWeavingOrder,
  closeWeavingOrder,
  createWeavingOrder,
  getWeavingOrder,
  listWeavingOrders,
  updateWeavingOrder,
} from "../services/weaving-order.service";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requireDokumaEnabled);

/** Tablet TEZGAH ekranı koşum açarken iş emri SEÇER — yalnız okuma uçları (2026-09-14). */
const MOBILE_DOKUMA = ["mobile:dokuma"] as const;

const uuidOrNull = z.string().uuid().nullable().optional();
const dateOrNull = z.string().datetime({ offset: true }).nullable().optional();

const createWeavingOrderSchema = z
  .object({
    itemId: z.string().uuid(),
    colorId: uuidOrNull,
    warpSpecId: uuidOrNull,
    plannedM: z.union([z.number(), z.string()]).nullable().optional(),
    executionKind: z.nativeEnum(WeavingExecutionKind),
    subcontractorId: uuidOrNull,
    plannedStartDate: dateOrNull,
    plannedEndDate: dateOrNull,
    notes: z.string().max(500).nullable().optional(),
    // Z1 (Y1): sipariş satırı bağları — verilirse küme REPLACE (`[]` temizler); yoksa dokunulmaz. Seçici ucu: order-lines/available.
    orderLines: z
      .array(z.object({ orderLineId: z.string().uuid(), allocatedM: z.union([z.number(), z.string()]).nullable().optional() }).strict())
      .max(200)
      .optional(),
    clientToken: z.string().uuid().nullable().optional(),
  })
  .strict();

const updateWeavingOrderSchema = createWeavingOrderSchema.omit({ clientToken: true }).partial().strict();

const cancelWeavingOrderSchema = z.object({ reason: z.string().trim().min(1).max(300) }).strict();

const listWeavingOrdersSchema = z
  .object({
    status: z.string().optional(),
    itemId: z.string().optional(),
    subcontractorId: z.string().uuid().optional(),
    // Z1: sipariş satırı / sipariş bağıyla süz (pivot).
    orderLineId: z.string().uuid().optional(),
    orderId: z.string().uuid().optional(),
    search: z.string().max(100).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    withTotal: z.enum(["true", "false"]).optional(),
  })
  .strict();

function parseStatuses(raw: string | undefined): WeavingOrderStatus[] {
  const list = readFilterList(raw);
  const known = new Set<string>(Object.values(WeavingOrderStatus));
  const bad = list.filter((s) => !known.has(s));
  if (bad.length > 0) throw AppError.badRequest(`Tanınmayan durum: ${bad.join(", ")}`);
  return list as WeavingOrderStatus[];
}

/**
 * @openapi
 * /api/weaving-orders:
 *   get:
 *     tags: [WeavingOrders]
 *     summary: Dokuma işi listesi (cursor'lu, en yeni önce)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string }, description: "CSV — PLANNED,IN_PROGRESS,COMPLETED,CANCELLED" }
 *       - { in: query, name: itemId, schema: { type: string }, description: "CSV kumaş id" }
 *       - { in: query, name: subcontractorId, schema: { type: string, format: uuid } }
 *       - { in: query, name: orderLineId, schema: { type: string, format: uuid }, description: "Z1 — bu sipariş satırına bağlı işler" }
 *       - { in: query, name: orderId, schema: { type: string, format: uuid }, description: "Z1 — bu siparişin herhangi bir satırına bağlı işler" }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100 } }
 *       - { in: query, name: withTotal, schema: { type: string, enum: ["true", "false"] } }
 *     responses:
 *       200: { description: Liste + cursor }
 *       400: { description: Tanınmayan durum / geçersiz parametre }
 *       403: { description: Dokuma işi modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get(
  "/",
  requireAnyPermission("weavingorder:read", ...MOBILE_DOKUMA),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = listWeavingOrdersSchema.parse(req.query);
      const result = await listWeavingOrders({
        status: parseStatuses(q.status),
        itemId: readIdCondition(q.itemId),
        subcontractorId: q.subcontractorId ?? null,
        orderLineId: q.orderLineId ?? null,
        orderId: q.orderId ?? null,
        search: q.search ?? null,
        cursor: q.cursor ?? null,
        limit: q.limit ?? null,
        withTotal: q.withTotal === "true",
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @openapi
 * /api/weaving-orders/{id}:
 *   get:
 *     tags: [WeavingOrders]
 *     summary: Dokuma işi detayı (açık koşum sayısıyla)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kayıt }
 *       404: { description: Bulunamadı }
 */
router.get(
  "/:id",
  requireAnyPermission("weavingorder:read", ...MOBILE_DOKUMA),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await getWeavingOrder(assertValidUuid(req.params.id)));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @openapi
 * /api/weaving-orders:
 *   post:
 *     tags: [WeavingOrders]
 *     summary: Dokuma işi oluştur (DK+GGAAYY+NNNN; clientToken ile idempotent)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 *       200: { description: Aynı clientToken — kayıt zaten var (replay) }
 *       400: { description: Kumaş değil · fasoncu XOR · metre ≤ 0 · tarih sırası }
 *       409: { description: CLIENT_TOKEN_COLLISION · WEAVING_ORDER_CANCELLED }
 */
router.post(
  "/",
  requirePermission("weavingorder:write"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createWeavingOrderSchema.parse(req.body ?? {});
      const result = await createWeavingOrder(body, req.user?.userId);
      res.status(result.message?.includes("zaten") ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @openapi
 * /api/weaving-orders/{id}:
 *   patch:
 *     tags: [WeavingOrders]
 *     summary: Dokuma işi planlama alanlarını güncelle (yalnız açık durumda)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: Alan yok · XOR · tarih sırası }
 *       404: { description: Bulunamadı }
 *       409: { description: WEAVING_ORDER_NOT_EDITABLE (kapanmış/iptal) }
 */
router.patch(
  "/:id",
  requirePermission("weavingorder:write"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = updateWeavingOrderSchema.parse(req.body ?? {});
      res.status(200).json(await updateWeavingOrder(assertValidUuid(req.params.id), body, req.user?.userId));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @openapi
 * /api/weaving-orders/{id}/close:
 *   post:
 *     tags: [WeavingOrders]
 *     summary: Dokuma işini kapat (açık bir karar; açık koşum varsa 409)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: COMPLETED }
 *       404: { description: Bulunamadı }
 *       409: { description: "WEAVING_ORDER_HAS_OPEN_RUNS (machines[] + runIds[]) · WEAVING_ORDER_NOT_OPEN" }
 */
router.post(
  "/:id/close",
  requirePermission("weavingorder:write"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await closeWeavingOrder(assertValidUuid(req.params.id), req.user?.userId));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @openapi
 * /api/weaving-orders/{id}/cancel:
 *   post:
 *     tags: [WeavingOrders]
 *     summary: Dokuma işini iptal et (yalnız durum geçişi; defter satırlarına dokunmaz)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: CANCELLED }
 *       400: { description: Sebep boş }
 *       404: { description: Bulunamadı }
 *       409: { description: WEAVING_ORDER_HAS_OPEN_RUNS · WEAVING_ORDER_NOT_OPEN }
 */
router.post(
  "/:id/cancel",
  requirePermission("weavingorder:write"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = cancelWeavingOrderSchema.parse(req.body ?? {});
      res
        .status(200)
        .json(await cancelWeavingOrder(assertValidUuid(req.params.id), body.reason, req.user?.userId));
    } catch (error) {
      next(error);
    }
  },
);

export default router;
