// =============================================================================
// TeksERP - Customer Template Routes (müşteriye özel etiket şablonu ataması)
// =============================================================================
// Mount: /api/customers/:customerId/template-routes
// İnce ayar-endpoint kalıbı (route içinde Zod parse + servise delege; prisma
// import'u YOK). İzinler etiket şablonu yönetimiyle aynı: label-template:read/write.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { CustomerTemplateRouteService } from "../services/customer-template-route.service";
import type { LabelKind } from "@prisma/client";
import "../types/express-augment";

const service = new CustomerTemplateRouteService();
const router = Router({ mergeParams: true });

// Enum string-literal (TDZ kuralı — modül-üstü enum üyesi deref yasak).
const setSchema = z.object({
  kind: z.enum(["ROLL_RAW", "ROLL_FINISHED", "SWATCH", "SACK"] as [string, ...string[]]),
  templateId: z.string().uuid().nullable(),
});

/**
 * @openapi
 * /api/customers/{customerId}/template-routes:
 *   get:
 *     tags: [Customer Template Routes]
 *     summary: Müşterinin etiket şablonu atamaları (bağlam → şablon)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "[{ kind, templateId, templateName, templateActive }]" }
 *   put:
 *     tags: [Customer Template Routes]
 *     summary: Atama upsert/kaldır — body { kind, templateId|null }
 *     description: |
 *       Çözüm zinciri: explicit > MÜŞTERİ > cihaz route > bağlam default.
 *       Stok/müşterisiz baskıda müşteri ataması hiç devreye girmez (etiket
 *       müşterisi EXPLICIT-ONLY). null → atama kaldırılır.
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/template-routes",
  verifyToken,
  requirePermission("label-template:read"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await service.list(req.params.customerId as string));
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  "/template-routes",
  verifyToken,
  requirePermission("label-template:write"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = setSchema.parse(req.body);
      const result = await service.set(
        req.params.customerId as string,
        body.kind as LabelKind,
        body.templateId,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
