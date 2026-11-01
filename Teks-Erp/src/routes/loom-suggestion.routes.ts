// Tezgâh önerisi (SY-M2): "bu iş için hangi tezgâh hazır?" — salt okuma, sıralama; iş vermeyi engellemez.
// Kapılar: verifyToken → dokuma modülü → weavingorder:read.
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { getLoomSuggestion } from "../services/loom-suggestion.service";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requireDokumaEnabled);
router.use(requirePermission("weavingorder:read"));

const optionalUuid = (label: string) => z.uuid({ message: `${label} kimliği geçersiz` }).optional();
const draftQuery = z.strictObject({
  itemId: z.uuid({ message: "Ürün kimliği geçersiz" }),
  recipeId: optionalUuid("Varyant"),
  warpSpecId: optionalUuid("Çözgü kartı"),
  plannedM: z.coerce.number({ message: "Plan metresi sayı olmalı" }).positive({ message: "Plan metresi pozitif olmalı" }).max(10_000_000).optional(),
});

/**
 * @openapi
 * /api/loom-suggestions:
 *   get:
 *     tags: [WeavingOrders]
 *     summary: Taslak dokuma işi için tezgâh önerisi
 *     description: |
 *       Henüz kaydedilmemiş iş (ürün + varyant + plan metresi) için tezgâhları T1 HAZIR · T2 LEVENT YETMEZ ·
 *       T3 ÇÖZGÜ DEĞİŞİMİ diye sıralar. Tarak eni ürün eninden darsa uyarı (`REED_NARROWER_THAN_FABRIC`), eleme yok.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: itemId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: recipeId, schema: { type: string, format: uuid } }
 *       - { in: query, name: warpSpecId, schema: { type: string, format: uuid } }
 *       - { in: query, name: plannedM, schema: { type: number } }
 *     responses:
 *       200: { description: Öneri }
 *       400: { description: Geçersiz parametre }
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLoomSuggestion(draftQuery.parse(req.query)));
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/loom-suggestions/weaving-orders/{id}:
 *   get:
 *     tags: [WeavingOrders]
 *     summary: Dokuma işi için tezgâh önerisi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Öneri }
 *       404: { description: Dokuma işi yok }
 */
router.get("/weaving-orders/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLoomSuggestion({ weavingOrderId: assertValidUuid(req.params.id) }));
  } catch (error) {
    next(error);
  }
});

export default router;
