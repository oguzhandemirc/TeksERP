// =============================================================================
// TeksERP - Customer Variant Alias Routes
// =============================================================================
// Mount: /api/customers/:customerId/variant-aliases
// Her müşteri için varyant → müşterinin kendi ismi eşleşmelerini yönetir.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { CustomerVariantAliasService } from "../services/customer-variant-alias.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const service = new CustomerVariantAliasService();

const createSchema = z.object({
  variantId: z.string().uuid("Geçerli bir varyant seçiniz"),
  customerLabel: z
    .string()
    .min(1, "Müşteri adı zorunludur")
    .max(120, "Müşteri adı en fazla 120 karakter olabilir"),
  customerCode: z.string().max(60).optional().nullable(),
});

const updateSchema = z.object({
  customerLabel: z.string().min(1).max(120).optional(),
  customerCode: z.string().max(60).optional().nullable(),
  isActive: z.boolean().optional(),
});

const router = Router({ mergeParams: true });

/**
 * @openapi
 * /api/customers/{customerId}/variant-aliases:
 *   get:
 *     tags: [Customer Variant Aliases]
 *     summary: Müşterinin desen isimleri listesi
 *     description: Bu müşteri için tanımlı varyant → müşteri-özel isim eşleşmelerini döner.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Alias listesi
 *       401: { description: Yetkilendirme başarısız }
 *       404: { description: Müşteri bulunamadı }
 */
router.get(
  "/",
  verifyToken,
  requirePermission("customer:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.params.customerId as string;
      const result = await service.findByCustomer(customerId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @openapi
 * /api/customers/{customerId}/variant-aliases:
 *   post:
 *     tags: [Customer Variant Aliases]
 *     summary: Müşteri için varyant karşılığı ekle
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [variantId, customerLabel]
 *             properties:
 *               variantId: { type: string, format: uuid }
 *               customerLabel: { type: string, example: "Selop" }
 *               customerCode: { type: string, nullable: true, example: "SEL-01" }
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: Doğrulama hatası }
 *       401: { description: Yetkilendirme başarısız }
 *       404: { description: Müşteri veya varyant bulunamadı }
 *       409: { description: Bu müşteri için bu varyant zaten kayıtlı }
 *       500: { description: Sunucu hatası }
 */
router.post(
  "/",
  verifyToken,
  requirePermission("customer:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.params.customerId as string;
      const body = createSchema.parse(req.body);
      const result = await service.create(
        { customerId, ...body },
        req.user?.userId,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @openapi
 * /api/customers/{customerId}/variant-aliases/{aliasId}:
 *   patch:
 *     tags: [Customer Variant Aliases]
 *     summary: Alias güncelle
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: aliasId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customerLabel: { type: string }
 *               customerCode: { type: string, nullable: true }
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: Doğrulama hatası }
 *       401: { description: Yetkilendirme başarısız }
 *       404: { description: Kayıt bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.patch(
  "/:aliasId",
  verifyToken,
  requirePermission("customer:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateSchema.parse(req.body);
      const result = await service.update(
        req.params.aliasId as string,
        body,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @openapi
 * /api/customers/{customerId}/variant-aliases/{aliasId}:
 *   delete:
 *     tags: [Customer Variant Aliases]
 *     summary: Alias sil
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: aliasId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Silindi }
 *       401: { description: Yetkilendirme başarısız }
 *       404: { description: Kayıt bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.delete(
  "/:aliasId",
  verifyToken,
  requirePermission("customer:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.delete(
        req.params.aliasId as string,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
