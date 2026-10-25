// =============================================================================
// /api/rapor-semantik — semantik katman uçları (Raporlar v2, R1-SEMCEK)
// =============================================================================
// Kapı: kimlik + HERHANGİ bir rapor izni. Asıl veri yetkisi DERLEYİCİDEDİR (küp/ölçü/boyut başına
// izin + modül → 403 `SEMANTIK_IZIN_YOK`); bu uçlar katalog raporu DEĞİL (rapor kapısı anahtarı
// yok), kayıtlı rapor ekranı R1-KAYIT'ta bu uçları çağırır.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import { REPORT_PERMISSION_CODES } from "../constants/permission-catalog";
import { loadAccessContext } from "../services/reports/semantik/izin";
import { buildCatalogTree } from "../services/reports/semantik/katalog";
import { semanticQuerySchema } from "../services/reports/semantik/derleyici";
import { abortDisconnectedRun, runSemanticQuery } from "../services/reports/semantik/calistirici";

const router = Router();

router.use(verifyToken, requireAnyPermission(...REPORT_PERMISSION_CODES));

/**
 * @openapi
 * /api/rapor-semantik/katalog:
 *   get:
 *     tags: [Reports]
 *     summary: Semantik katman kataloğu — kullanıcının görebildiği küp, ölçü ve boyutlar
 *     description: İzin ve modül süzülmüş ağaç; ölçü adı/açıklaması tek sözlükten (`tanimlar.ts`).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Küp ağacı" }
 */
router.get("/katalog", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await loadAccessContext(req.user!);
    res.status(200).json({ success: true, data: buildCatalogTree(ctx) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/rapor-semantik/sorgu:
 *   post:
 *     tags: [Reports]
 *     summary: Semantik sorgu önizlemesi (küp + ölçüler + boyutlar + süzgeç)
 *     description: |
 *       Kimlikler yalnız sözlükte aranır (tanınmayan → 400 `SEMANTIK_ALAN_BILINMIYOR`), izin/modül
 *       eksiği 403 `SEMANTIK_IZIN_YOK`; değerler parametredir. Koşu sınırı 429 `RAPOR_SIRADA`, zaman
 *       aşımı 503 `RAPOR_ZAMAN_ASIMI`. İsteğe bağlı `kosuId` (uuid) iptal ucunun anahtarıdır.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object } } }
 *     responses:
 *       200: { description: "Satırlar, toplam (tavandan önce tam küme), kıyas, uyarılar" }
 */
router.post("/sorgu", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = semanticQuerySchema.parse(req.body);
    const ctx = await loadAccessContext(req.user!);
    const runId = input.kosuId ?? randomUUID();
    // Bağlantı yanıt bitmeden koparsa koşu boşuna sürmesin (pg_cancel_backend).
    res.on("close", () => {
      if (!res.writableFinished) void abortDisconnectedRun(runId, ctx.userId);
    });
    const data = await runSemanticQuery(input, ctx, runId);
    res.status(200).json({ success: true, data, ...(data.uyarilar.length ? { warnings: data.uyarilar } : {}) });
  } catch (e) {
    next(e);
  }
});

export default router;
