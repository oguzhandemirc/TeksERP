// =============================================================================
// DEMO SENARYO UÇLARI — `/api/demo/*`
// =============================================================================
// Yalnız DEMO/EĞİTİM kurulumlarında açıktır. Kapalıyken hepsi 403 döner
// (`requireDemoMode`), yani sürüm paketine sızan bir yardımcı sahada
// KENDİLİĞİNDEN etkisizdir — "release'de elle kaldırmayı unutma" adımı yok.
//
// ⚠️ İKİ KAPI ÜST ÜSTE, biri diğerinin yerine geçmez:
//   ① `requireDemoMode` — "bu kurulum bir demo mu"
//   ② `requirePermission` — "bu kişi simüle edilen İŞİ yapabilir mi"
// ② olmasaydı demo modu açık bir kurulumda, etiket basma yetkisi OLMAYAN biri
// bu uçtan etiket damgası attırabilirdi: bayrak bir yetki yükseltme yüzeyine
// dönerdi. Kapı sırası da bilinçli — önce rejim, sonra yetki: demo olmayan bir
// kurulumda yetki hatası vermek, ucun orada olduğunu sızdırırdı.
// =============================================================================
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireDemoMode } from "../middlewares/demo.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import { demoService } from "../services/demo.service";

const router = Router();

router.use(verifyToken);
router.use(requireDemoMode);

/**
 * @swagger
 * /api/demo/scenarios:
 *   get:
 *     summary: Demo senaryolarının listesi (izne göre `allowed` işaretli)
 *     tags: [Demo]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Senaryo listesi
 *       403:
 *         description: Bu kurulum demo değil
 */
router.get("/scenarios", (req: Request, res: Response, next: NextFunction) => {
  try {
    const izinler = req.user?.permissions ?? [];
    res.json({ success: true, data: demoService.listScenarios(izinler) });
  } catch (e) {
    next(e);
  }
});

const relabelSchema = z.strictObject({
  /** Belirtilmezse sunucu uygun bir top SEÇER — demoyu gezen kişi top aramak zorunda kalmasın. */
  rollId: z.string().uuid().optional(),
});

/**
 * @swagger
 * /api/demo/scenarios/relabel-stale:
 *   post:
 *     summary: Yeniden Etiketle senaryosu — topu etiketli + bayat hâle getirir
 *     tags: [Demo]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Senaryo uygulandı
 *       400:
 *         description: Uygun top bulunamadı
 *       403:
 *         description: Bu kurulum demo değil ya da yetki yok
 */
router.post(
  "/scenarios/relabel-stale",
  requireAnyPermission("label:print", "roll:manual-adjust"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const govde = relabelSchema.parse(req.body ?? {});
      const sonuc = await demoService.relabelStale(govde.rollId, req.user?.userId);
      res.json({
        success: true,
        data: sonuc,
        message: sonuc.zatenHazir
          ? `Top ZATEN hazır (${sonuc.barcode ?? sonuc.rollId.slice(0, 8)}): etiketi basılmış ve güncel değil. Hiçbir şey değiştirilmedi.`
          : `Top hazır (${sonuc.barcode ?? sonuc.rollId.slice(0, 8)}): etiket basılmış olarak damgalandı, ` +
            `metraj ${sonuc.oncekiMetraj} → ${sonuc.yeniMetraj} değişti. Artık "etiket güncel değil" uyarısını taşıyor.`,
      });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
