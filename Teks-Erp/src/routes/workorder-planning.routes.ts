// =============================================================================
// İş emri planlama uçları (2026-11-19): sipariş paylaştırması + planlama notu.
// /api/work-orders/:id altında mount edilir; kimlik + üretim modülü kapısı ÜST router'ın
// `router.use(verifyToken, requireProductionEnabled)` satırından MİRAS (sub-mount ondan sonra).
// =============================================================================

import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { setOrderLinkAllocations } from "../services/workorder-allocation.service";
import { WORK_ORDER_NOTE_MAX, getWorkOrderNote, setWorkOrderNote } from "../services/workorder-note.service";

export const workOrderPlanningRouter = Router({ mergeParams: true });

const allocationsBody = z
  .object({
    allocations: z
      .array(
        z.object({
          orderLineId: z.string().uuid("Geçersiz sipariş satırı ID"),
          allocatedQty: z
            .number({ error: "Metre sayı olmalı" })
            .finite("Metre sayı olmalı")
            .nonnegative("Metre negatif olamaz")
            .max(999_999_999, "Metre çok büyük"),
        }),
      )
      .min(1, "En az bir sipariş satırı için metre girin")
      .max(200, "En fazla 200 sipariş satırı gönderilebilir"),
  })
  .strict();

const noteBody = z
  .object({
    body: z.string().max(WORK_ORDER_NOTE_MAX, `Not en fazla ${WORK_ORDER_NOTE_MAX} karakter olabilir`).nullable(),
  })
  .strict();

/**
 * @openapi
 * /api/work-orders/{id}/order-links/allocations:
 *   put:
 *     tags: [WorkOrders]
 *     summary: İş emri metresini AÇIK sipariş bağlarına paylaştır (yalnız plan)
 *     description: >
 *       Gönderilmeyen bağın miktarı korunur; 0 = paylaştırma yok. Tavan iş emrine giren
 *       ham metre (top yoksa hedef metre). Top↔sipariş bağı yaratmaz; sevk ve sipariş
 *       karşılaması değişmez. Mutlak değer yazar (yeniden gönderim aynı sonucu verir).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [allocations]
 *             properties:
 *               allocations:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [orderLineId, allocatedQty]
 *                   properties:
 *                     orderLineId: { type: string, format: uuid }
 *                     allocatedQty: { type: number, minimum: 0 }
 *     responses:
 *       200: { description: "{ changed, warnings[], allocation: { basis, basisKind, allocated, remaining } }" }
 *       400: { description: "Tavan aşımı (ALLOCATION_OVER_BASIS) · MT dışı satır (ALLOCATION_UNIT_NOT_MEASURED) · bağlı değil (ORDER_LINK_NOT_ACTIVE)" }
 *       409: { description: "İptal/devredilmiş iş emri (WO_PLAN_FROZEN) · bağ bu sırada koparıldı (ORDER_LINK_CHANGED)" }
 */
workOrderPlanningRouter.put(
  "/order-links/allocations",
  verifyToken,
  requirePermission("workorder:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = allocationsBody.parse(req.body);
      res.json(await setOrderLinkAllocations(req.params.id as string, body.allocations, req.user?.userId));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/work-orders/{id}/note:
 *   get:
 *     tags: [WorkOrders]
 *     summary: İş emri planlama notu (yalnız panel; kart/etiket/tablet/bulut görmez)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ workOrderId, body (boşsa null), updatedAt, updatedBy { id, fullName } | null }" }
 *       404: { description: İş emri bulunamadı }
 *   put:
 *     tags: [WorkOrders]
 *     summary: Planlama notunu yaz (≤ 2000 karakter; boş/null = temizle, satır silinmez)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               body: { type: string, nullable: true, maxLength: 2000 }
 *     responses:
 *       200: { description: Güncel not görünümü (GET ile aynı şekil) }
 *       400: { description: 2000 karakteri aşan not }
 */
workOrderPlanningRouter.get(
  "/note",
  verifyToken,
  requireAnyPermission("workorder:read", "workorder:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await getWorkOrderNote(req.params.id as string));
    } catch (e) {
      next(e);
    }
  },
);

workOrderPlanningRouter.put(
  "/note",
  verifyToken,
  requirePermission("workorder:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = noteBody.parse(req.body);
      res.json(await setWorkOrderNote(req.params.id as string, body.body ?? "", req.user?.userId));
    } catch (e) {
      next(e);
    }
  },
);
