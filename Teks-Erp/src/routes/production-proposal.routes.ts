// Siparişten üretim önerisi (SY-M1): önizleme + uygula. Kapılar: verifyToken → üretim modülü → order:read;
// tür başına yazma izni (dokuma işi / terbiye iş emri) anahtar-kapsamlı olarak serviste ölçülür.
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { matchesPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireProductionEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { applyProductionProposal, previewProductionProposal, type ProposalAccess } from "../services/production-proposal.service";
import "../types/express-augment";

const router = Router();
router.use("/:id/production-proposal", verifyToken, requireProductionEnabled, requirePermission("order:read"));

function accessOf(req: Request): ProposalAccess {
  const p = req.user?.permissions ?? [];
  return {
    readWeaving: matchesPermission(p, "weavingorder:read"),
    writeWeaving: matchesPermission(p, "weavingorder:write"),
    writeWorkOrder: matchesPermission(p, "workorder:write"),
  };
}

const lineIds = z.array(z.uuid({ message: "Sipariş satırı kimliği geçersiz" })).min(1, { message: "Grupta en az bir sipariş satırı olmalı" }).max(500);
const applySchema = z.strictObject({
  clientToken: z.uuid({ message: "clientToken UUID olmalı" }),
  weavingOrders: z.array(z.strictObject({
    key: z.string().min(1).max(200),
    orderLineIds: lineIds,
    plannedM: z.number().positive({ message: "Plan metresi pozitif olmalı" }).max(10_000_000).nullable(),
  })).max(100).default([]),
  workOrders: z.array(z.strictObject({ key: z.string().min(1).max(200), orderLineIds: lineIds })).max(100).default([]),
});

/**
 * @openapi
 * /api/orders/{id}/production-proposal/preview:
 *   post:
 *     tags: [Orders]
 *     summary: Siparişten üretim önerisi — önizleme
 *     description: |
 *       Onaylı/kısmi sevk siparişin satırlarından önerilen dokuma işlerini (ürün + varyant) ve terbiye
 *       iş emirlerini (ürün + renk + en) listeler; zaten bağlı satırlar `excluded`ta. Ayar
 *       `siparis.uretimOnerisi` KAPALI iken 403 `PRODUCTION_PROPOSAL_DISABLED`. Hiçbir şey yazmaz.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Öneri }
 *       403: { description: Ayar/modül kapalı ya da yetki yok }
 *       409: { description: Sipariş onaylı değil (ORDER_NOT_PRODUCIBLE) }
 */
router.post("/:id/production-proposal/preview", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await previewProductionProposal(assertValidUuid(req.params.id), accessOf(req)));
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/orders/{id}/production-proposal/apply:
 *   post:
 *     tags: [Orders]
 *     summary: Siparişten üretim önerisi — seçilenleri oluştur
 *     description: |
 *       Önizlemede seçilen grupları tek işlemde yaratır. `clientToken` mantıksal deneme başınadır; aynı
 *       token'ın tekrarı aynı kayıt setini döner. Seçim taze öneriyle birebir değilse 409
 *       (`ORDER_LINE_ALREADY_PLANNED` + satır listesi ya da `PROPOSAL_STALE`).
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
 *             required: [clientToken]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               weavingOrders: { type: array, items: { type: object } }
 *               workOrders: { type: array, items: { type: object } }
 *     responses:
 *       201: { description: Oluşturuldu }
 *       200: { description: Aynı token'ın tekrarı (idempotentReplay) }
 *       409: { description: Seçim bayat ya da satır bu arada planlanmış }
 */
router.post("/:id/production-proposal/apply", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = applySchema.parse(req.body);
    const result = await applyProductionProposal(assertValidUuid(req.params.id), body, accessOf(req), req.user?.userId);
    res.status(result.idempotentReplay ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
