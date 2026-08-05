// =============================================================================
// TeksERP - Document Profile Routes (belge şablon profilleri)
// =============================================================================
// Okuma: auth-only (müşteri/fason formlarındaki profil seçici için — SALES/
// SUBCONTRACTOR yazarları da listeler). Yazma: DOCUMENT_DESIGN_WRITE
// (`admin:settings` VEYA `document-template:write` — constants/document-design.ts).
// Controller'sız ince route (bilinçli istisna) — Zod parse + servise delege.

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import { DOCUMENT_DESIGN_WRITE } from "../constants/document-design";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { documentProfileService } from "../services/document-profile.service";
// NOT: assertValidUuid saf fonksiyondur (middleware değil) — handler içinde çağrılır.
import "../types/express-augment";

const router = Router();

const upsertSchema = z.object({
  name: z.string().min(1, "Profil adı gerekli").max(80).optional(),
  description: z.string().max(300).nullable().optional(),
  // İç yapı servis katmanında sanitizeDocumentsConfig ile süzülür.
  config: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

/**
 * @openapi
 * /api/document-profiles:
 *   get:
 *     tags: [DocumentProfiles]
 *     summary: Belge şablon profilleri (default yalnız aktif; ?withInactive=true hepsi)
 *     security: [{ bearerAuth: [] }]
 */
router.get("/", verifyToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await documentProfileService.list(req.query.withInactive === "true"));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/document-profiles/{id}:
 *   get:
 *     tags: [DocumentProfiles]
 *     summary: Profil detayı (config dahil)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/:id",
  verifyToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await documentProfileService.get(assertValidUuid(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/document-profiles:
 *   post:
 *     tags: [DocumentProfiles]
 *     summary: Yeni profil (admin)
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/",
  verifyToken,
  requireAnyPermission(...DOCUMENT_DESIGN_WRITE),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = upsertSchema.parse(req.body);
      res.status(201).json(await documentProfileService.create(body, req.user?.userId));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/document-profiles/{id}:
 *   put:
 *     tags: [DocumentProfiles]
 *     summary: Profil güncelle (admin)
 *     security: [{ bearerAuth: [] }]
 */
router.put(
  "/:id",
  verifyToken,
  requireAnyPermission(...DOCUMENT_DESIGN_WRITE),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = upsertSchema.parse(req.body);
      res.json(await documentProfileService.update(assertValidUuid(req.params.id), body, req.user?.userId));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/document-profiles/{id}:
 *   delete:
 *     tags: [DocumentProfiles]
 *     summary: Profili pasifleştir (soft delete — atamalar korunur)
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  "/:id",
  verifyToken,
  requireAnyPermission(...DOCUMENT_DESIGN_WRITE),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await documentProfileService.deactivate(assertValidUuid(req.params.id), req.user?.userId));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
