// =============================================================================
// TeksERP — OKUTMAYLA ROTA uçları (K29, 2026-11-03; ayar `production.routeMode=SCAN`)
// =============================================================================
// Tablet kartı okutunca `by-card` 400 `SCAN_ROUTE_AVAILABLE` (details.scanRoute) dönerse yeni istemci önce burada
// önizler, sonra POST ile uygular (clientToken mantıksal deneme başına). Karar ve yazım TEK kaynak:
// `services/workorder-scan-route.service.ts` → `helpers/okutmayla-rota.helper.ts`. İstasyon = cihazın çalışma oturumu.
// =============================================================================
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireProductionEnabled } from "../middlewares/module.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import { getStampContext } from "../services/helpers/work-session.helper";
import { applyScanRoute, previewScanRoute } from "../services/workorder-scan-route.service";
import { AppError } from "../utils/app-error";

const router = Router();
router.use(verifyToken, requireProductionEnabled);

const PERMS = ["workorder:write", "quality:write", "mobile:kk2-kursun", "mobile:tambur"] as const;

const applySchema = z.object({
  clientToken: z.string().uuid(),
  closeOpenStepId: z.string().uuid().nullish(),
});

/**
 * @openapi
 * /api/scan-route/by-card/{barcode}:
 *   get:
 *     tags: [ScanRoute]
 *     summary: Okutmaya göre rota önizlemesi (oturum istasyonunda bu kart okutulursa ne olur)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ enabled, view, canClose } — view.kind OPEN_EXISTING | MOVE | INSERT | BLOCKED; canClose = 'bitmiş say ve geç' yetkisi (quality:write | mobile:kk2-kursun)" }
 *       400: { description: Kart aktif değil / istasyon oturumu yok }
 *       404: { description: Refakat kartı bulunamadı }
 */
router.get("/by-card/:barcode", requireAnyPermission(...PERMS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stamp = await getStampContext(req);
    const data = await previewScanRoute(String(req.params.barcode).trim(), stamp?.stationId ?? null, req.user?.permissions ?? []);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/scan-route/by-card/{barcode}:
 *   post:
 *     tags: [ScanRoute]
 *     summary: Okutmaya göre rotayı uygula (adım ekle / öndekileri ATLANDI yap / topları taşı)
 *     description: |
 *       İdempotent (clientToken). Açık iş başka istasyondaysa 409 SCAN_ROUTE_OPEN_ELSEWHERE; tablet onayıyla
 *       `closeOpenStepId` gönderilirse o adım mevcut kapatma yoluyla bitirilir — kapatma ucunun yetkisi
 *       (quality:write | mobile:kk2-kursun) yoksa 403 SCAN_ROUTE_CLOSE_FORBIDDEN. Atlanamaz adım 409 SCAN_ROUTE_MANDATORY_STEP.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               closeOpenStepId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       200: { description: Uygulandı (kind NOOP | MOVE | INSERT) }
 *       400: { description: Doğrulama / istasyon oturumu yok }
 *       403: { description: "closeOpenStepId için adım kapatma yetkisi yok (SCAN_ROUTE_CLOSE_FORBIDDEN)" }
 *       409: { description: Engel ya da eşzamanlı değişiklik (details.code) }
 */
router.post("/by-card/:barcode", requireAnyPermission(...PERMS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = applySchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.badRequest("Geçersiz istek: clientToken (UUID) gerekli.", { code: "VALIDATION_ERROR" });
    const stamp = await getStampContext(req);
    const data = await applyScanRoute(String(req.params.barcode).trim(), parsed.data, {
      userId: req.user?.userId ?? null,
      stationId: stamp?.stationId ?? null,
      deviceId: req.device?.id ?? null,
      machineId: stamp?.machineId ?? null,
      permissions: req.user?.permissions ?? [],
    });
    res.status(200).json({ success: true, data, message: data.kind === "INSERT" ? "Adım sahada eklendi." : data.kind === "MOVE" ? "İş bu istasyona geçti." : "Değişiklik yok." });
  } catch (err) {
    next(err);
  }
});

export default router;
