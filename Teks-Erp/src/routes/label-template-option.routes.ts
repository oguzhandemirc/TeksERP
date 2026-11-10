// =============================================================================
// TeksERP - Çoklu etiket seti uçları (2026-11-11)
// =============================================================================
// Mount: /api/label-templates/global-options (label-template.routes, `/:id`den ÖNCE) ve
//        /api/customers/:customerId/label-template-options (customer.routes, dar önekle: toplu kapı yalnız bu uçlara).
// İnce ayar-endpoint kalıbı: Zod parse + servise delege; prisma import'u YOK. Yeni izin yok.
// =============================================================================
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { LabelTemplateOptionService, LABEL_OPTION_MAX } from "../services/label-template-option.service";
import { labelKindSchema } from "../config/label-kind.schema";
import "../types/express-augment";

const service = new LabelTemplateOptionService();

const kindQuery = z.object({ kind: labelKindSchema });
export const labelOptionSetBody = z.object({
  kind: labelKindSchema,
  templateIds: z.array(z.string().uuid("Geçersiz şablon ID")).max(LABEL_OPTION_MAX, `Bir sette en çok ${LABEL_OPTION_MAX} şablon olabilir`),
  defaultTemplateId: z.string().uuid("Geçersiz şablon ID").nullable(),
});
export const customerLabelOptionSetBody = labelOptionSetBody.extend({ showGlobalTemplates: z.boolean().optional() });

/** /api/label-templates/global-options */
export const globalLabelOptionRoutes = Router();
// Toplu kapı (BE-30): handler başına verifyToken yeni uçta guard'ı unutturur.
globalLabelOptionRoutes.use(verifyToken);

/**
 * @openapi
 * /api/label-templates/global-options:
 *   get:
 *     tags: [Label Templates]
 *     summary: Herkes için etiket seti (bağlam başına sıralı) + bağlam varsayılanı
 *     parameters: [{ name: kind, in: query, required: true, schema: { type: string, enum: [ROLL_RAW, ROLL_FINISHED] } }]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ kind, defaultTemplateId, items:[{templateId,name,sortOrder,isDefault,active}] } — varsayılan sette satırı olmasa da başta" }
 *       400: { description: "LABEL_OPTION_KIND_UNSUPPORTED" }
 *   put:
 *     tags: [Label Templates]
 *     summary: Herkes için etiket setini kaydet — body { kind, templateIds (sıralı, ≤20, tekrarsız), defaultTemplateId|null }
 *     description: |
 *       Tek tx'te replace + `LabelContextDefault` yazımı. Varsayılan setin içinde olmalı (400 `LABEL_DEFAULT_NOT_IN_SET`);
 *       yeni şablon aktif ve atanabilir olmalı (400 `LABEL_TEMPLATE_NOT_USABLE`); yalnız ROLL_RAW/ROLL_FINISHED.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Güncel set (GET biçimi) }
 *       400: { description: "LABEL_DEFAULT_NOT_IN_SET · LABEL_OPTION_KIND_UNSUPPORTED · LABEL_OPTION_DUPLICATE · LABEL_TEMPLATE_NOT_USABLE" }
 */
globalLabelOptionRoutes.get(
  "/",
  requirePermission("label-template:read"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind } = kindQuery.parse(req.query);
      res.status(200).json(await service.getGlobal(kind));
    } catch (e) { next(e); }
  },
);
globalLabelOptionRoutes.put(
  "/",
  requirePermission("label-template:write"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await service.setGlobal(labelOptionSetBody.parse(req.body ?? {}), req.user?.userId));
    } catch (e) { next(e); }
  },
);

/** /api/customers/:customerId/label-template-options (mergeParams). */
export const customerLabelOptionRoutes = Router({ mergeParams: true });
customerLabelOptionRoutes.use(verifyToken);

/**
 * @openapi
 * /api/customers/{customerId}/label-template-options:
 *   get:
 *     tags: [Customer Template Routes]
 *     summary: Müşterinin etiket seti + "herkes için seti göster" + global set önizlemesi
 *     parameters:
 *       - { name: customerId, in: path, required: true, schema: { type: string, format: uuid } }
 *       - { name: kind, in: query, required: true, schema: { type: string, enum: [ROLL_RAW, ROLL_FINISHED] } }
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ kind, customerId, defaultTemplateId, items, showGlobalTemplates, globalItems }" }
 *       404: { description: Müşteri bulunamadı }
 *   put:
 *     tags: [Customer Template Routes]
 *     summary: Müşteri etiket setini kaydet — body { kind, templateIds, defaultTemplateId|null, showGlobalTemplates? }
 *     description: Tek tx'te seçenek replace + `CustomerTemplateRoute` (varsayılan) + `Customer.labelShowGlobalTemplates`.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Güncel set (GET biçimi) }
 *       400: { description: "LABEL_DEFAULT_NOT_IN_SET · LABEL_OPTION_KIND_UNSUPPORTED · LABEL_OPTION_DUPLICATE · LABEL_TEMPLATE_NOT_USABLE" }
 *       404: { description: Müşteri bulunamadı }
 */
customerLabelOptionRoutes.get(
  "/",
  requirePermission("label-template:read"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind } = kindQuery.parse(req.query);
      res.status(200).json(await service.getCustomer(req.params.customerId as string, kind));
    } catch (e) { next(e); }
  },
);
customerLabelOptionRoutes.put(
  "/",
  requirePermission("label-template:write"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = customerLabelOptionSetBody.parse(req.body ?? {});
      res.status(200).json(await service.setCustomer(req.params.customerId as string, body, req.user?.userId));
    } catch (e) { next(e); }
  },
);
