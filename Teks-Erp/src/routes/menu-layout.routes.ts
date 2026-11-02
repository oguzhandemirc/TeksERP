// =============================================================================
// MENÜ DÜZENİ (K19) — GET herkese (panel + tablet menüyü süzer), PUT yalnız admin:settings + ayar şifresi.
// Gizleme güvenlik sınırı DEĞİL: menüden kalkan ekran doğrudan bağlantıyla açılır, izin ayrı.
// =============================================================================
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireSettingsPassword } from "../middlewares/settings-password.middleware";
import { getMenuLayoutView, updateMenuLayout } from "../services/menu-layout.service";
import "../types/express-augment";

const router = Router();
router.use(verifyToken);

const UpdateBody = z.strictObject({
  hiddenScreens: z.array(z.string().trim().min(1).max(120)).max(500, "En çok 500 ekran").optional(),
  advancedGroup: z.boolean().optional(),
});

/**
 * @openapi
 * /api/menu-layout:
 *   get:
 *     tags: [System]
 *     summary: Menü düzeni — gizlenen ekranlar, Gelişmiş grubu, gizlenemez küme ve hazır setler (giriş yapmış herkes)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "hiddenScreens string[] · advancedGroup boolean · unhideable {key,reason}[] · advancedScreens string[] · presets {id,label,description,screens {key,app,title,reason}[]}[]" }
 *   put:
 *     tags: [System]
 *     summary: Menü düzenini yaz (admin:settings + ayar şifresi); bilinmeyen ekran 400 MENU_SCREEN_UNKNOWN, gizlenemez ekran 400 MENU_SCREEN_LOCKED
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hiddenScreens: { type: array, items: { type: string }, description: "SCREEN_CATALOG ekran anahtarları (desktop + mobile); liste TAMAMEN değişir" }
 *               advancedGroup: { type: boolean, description: "Teknik ekranlar kenar menüde Gelişmiş grubunda (varsayılan false)" }
 *     responses:
 *       200: { description: Güncel menü düzeni }
 *       400: { description: MENU_SCREEN_UNKNOWN · MENU_SCREEN_LOCKED · doğrulama }
 */
router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getMenuLayoutView() });
  } catch (err) {
    next(err);
  }
});

router.put("/", requirePermission("admin:settings"), requireSettingsPassword, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = UpdateBody.parse(req.body);
    res.json({ success: true, data: await updateMenuLayout(body, req.user!.userId) });
  } catch (err) {
    next(err);
  }
});

export default router;
