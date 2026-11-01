/**
 * İki kişilik kimlik sıfırlama onayı (güvenlik denetimi Bölge 2 B1b). Doğrudan uçlar (`/admin/users/:id/
 * reset-password` · `totp/reset` · `quick-pin` · `card-token`) daha yetkili hedefte 403
 * `CREDENTIAL_RESET_NEEDS_APPROVAL` döner; yol buradaki talep → onay akışıdır. Kural servis katmanında.
 */
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { newPasswordViolation } from "../lib/new-password-policy";
import {
  CREDENTIAL_RESET_KINDS,
  CREDENTIAL_RESET_STATUSES,
  CredentialResetService,
} from "../services/credential-reset.service";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requirePermission("admin:users"));

const createSchema = z.object({
  targetUserId: z.string().uuid(),
  kind: z.enum(CREDENTIAL_RESET_KINDS),
  reason: z.string().trim().max(500).nullable().optional(),
  clientToken: z.string().uuid().optional(),
});

const approveSchema = z.object({
  password: z
    .string()
    .superRefine((value, ctx) => {
      const violation = newPasswordViolation(value);
      if (violation) ctx.addIssue({ code: "custom", message: violation });
    })
    .optional(),
  // PIN onayda seçilmez, rastgele üretilir (Y-01); eski panelin `pin`i düşer.
});

const idParam = z.string().uuid("Geçersiz talep kimliği");
const listSchema = z.object({ status: z.enum(CREDENTIAL_RESET_STATUSES).optional() });

/**
 * @openapi
 * /api/admin/credential-reset-requests:
 *   get:
 *     tags: [Admin]
 *     summary: Kimlik sıfırlama onay talepleri (son 100; canApprove izleyiciye göre)
 *     security: [{ bearerAuth: [] }]
 *   post:
 *     tags: [Admin]
 *     summary: Daha yetkili hesap için kimlik sıfırlama onay talebi aç
 *     security: [{ bearerAuth: [] }]
 */
router.get("/", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status } = listSchema.parse(req.query);
    const data = await CredentialResetService.list(req.user!.userId, status);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = createSchema.parse(req.body ?? {});
    const data = await CredentialResetService.create(req.user!.userId, input);
    res.status(201).json({ success: true, message: "Onay talebi oluşturuldu — ikinci bir yönetici onaylamalı", data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/admin/credential-reset-requests/{id}/approve:
 *   post:
 *     tags: [Admin]
 *     summary: Talebi onayla ve işlemi uygula (onaylayan ≠ talep eden; hedefi kapsamalı). PIN/kart sonucu onaylayana döner.
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/approve", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = idParam.parse(req.params.id);
    const payload = approveSchema.parse(req.body ?? {});
    const data = await CredentialResetService.approve(id, req.user!.userId, payload);
    res.status(200).json({ success: true, message: "Onaylandı ve uygulandı", data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/admin/credential-reset-requests/{id}/reject:
 *   post:
 *     tags: [Admin]
 *     summary: Talebi reddet (talep eden için geri çekme)
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/reject", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = idParam.parse(req.params.id);
    const data = await CredentialResetService.reject(id, req.user!.userId);
    res.status(200).json({ success: true, message: data.status === "CANCELLED" ? "Talep geri çekildi" : "Talep reddedildi", data });
  } catch (error) {
    next(error);
  }
});

export default router;
