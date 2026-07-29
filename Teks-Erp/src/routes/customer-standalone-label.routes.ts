// =============================================================================
// TeksERP - Customer Standalone Label Routes (müşteriye bağlı serbest etiketler)
// =============================================================================
// Mount: /api/customers/:customerId/standalone-labels
// İnce ayar-endpoint kalıbı (route içinde Zod parse + servise delege; prisma
// import'u YOK). ROTA DEĞİL — rulo/kartela çözümüne katılmaz; yalnız baskı
// seçicisini müşteriye göre filtrelemek için M:N kolaylık bağı. İzinler etiket
// şablonu yönetimiyle aynı: label-template:read/write.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { CustomerStandaloneLabelService } from "../services/customer-standalone-label.service";
import "../types/express-augment";

const service = new CustomerStandaloneLabelService();
const router = Router({ mergeParams: true });

const setSchema = z.object({
  templateIds: z.array(z.string().uuid("Geçersiz şablon ID")).max(200),
});

/**
 * @openapi
 * /api/customers/{customerId}/standalone-labels:
 *   get:
 *     tags: [Customer Standalone Labels]
 *     summary: Müşterinin bağlı serbest (statik) etiketleri
 *     description: |
 *       Yalnız bağlı, aktif + kalıcı-silinmemiş serbest şablonlar döner
 *       ([{ id, name }]). "Genel" (bağsız) şablonlar burada listelenmez —
 *       onlar baskı seçicisinde (`/api/labels/standalone-templates?customerId=`)
 *       her müşteride görünür.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ data: [{ id, name }] }" }
 *       404: { description: "Müşteri bulunamadı" }
 *   put:
 *     tags: [Customer Standalone Labels]
 *     summary: "Bağ kümesini değiştir — body { templateIds: string[] }"
 *     description: |
 *       Replace-set: verilen id'ler bağ kümesi olur (eksikler silinir, yeniler
 *       eklenir). Her id AKTİF + standalone=true bir şablon olmalı; değilse 400.
 *       Boş dizi → tüm bağlar kalkar (müşteri yalnız genel serbest etiketleri
 *       görür). Rulo/kartela etiket çözümüne KATILMAZ.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ data: { customerId, templateIds } }" }
 *       400: { description: "Şablon serbest değil / pasif / bulunamadı" }
 *       404: { description: "Müşteri bulunamadı" }
 */
router.get(
  "/standalone-labels",
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
  "/standalone-labels",
  verifyToken,
  requirePermission("label-template:write"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = setSchema.parse(req.body);
      const result = await service.set(req.params.customerId as string, body.templateIds, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
