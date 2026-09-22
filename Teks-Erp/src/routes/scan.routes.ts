// =============================================================================
// OKUTMA — SINIFLANDIRMA ROTALARI (2026-09-22, Faz B)
// =============================================================================
// ── İZİN FORMÜLÜ (yeni izin kodu ÜRETİLMEDİ, bilinçli) ──────────────────────
// İkisi de yalnız `verifyToken`. Gerekçe `GET /api/reason-presets` emsaliyle
// birebir aynı: okutma HER operatör ekranının ilk adımıdır ve dar bir izin kodu
// koymak, o kod atanmamış her tablette OKUTMAYI kırardı — yani özelliğin
// kendisini. Yük iş verisi değil BİÇİM meta verisidir (ön ek · hane · tarih
// segmenti); `resolve` DB'ye hiç inmez ve kaydın varlığını bile doğrulamaz.
// Sayaç `scripts/test_route_auth_coverage.ts` `BARE_CHAIN_BASELINE`te beyanlı.
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";

import { verifyToken } from "../middlewares/auth.middleware";
import { getSeriesClassifier, resolveScannedCode } from "../services/scan.service";

const router = Router();

// Kapı dosya başında (BE-30): sonradan eklenen uç guard'ı miras alır.
router.use(verifyToken);

const resolveQuerySchema = z
  .object({
    code: z.string().trim().min(1, "Kod boş olamaz").max(64),
  })
  .strict();

/**
 * @openapi
 * /api/scan/series:
 *   get:
 *     tags: [Scan]
 *     summary: Okutulan kod serilerinin sınıflandırma tablosu (ön ek · tarih segmenti · hane · infix)
 *     description: |
 *       İstemci bu tabloyu açılışta çeker ve önbelleğe alır; barkod türünü
 *       kendi sabit regex'iyle değil bu tabloyla çözer. Emekli ön ekler
 *       `prefixes` dizisinde yürürlüktekinden SONRA gelir.
 *       Yetki: yalnız auth — okutma her operatör ekranının ilk adımıdır.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sınıflandırma tablosu }
 */
router.get("/series", (_req: Request, res: Response) => {
  res.status(200).json(getSeriesClassifier());
});

/**
 * @openapi
 * /api/scan/resolve:
 *   get:
 *     tags: [Scan]
 *     summary: Tek kodu türüne çöz (emekli ön ekler dahil); çözülemezse UNKNOWN
 *     description: |
 *       Tabloyla eşleşmeyen kod için son adım. DB'ye inmez, kaydın varlığını
 *       doğrulamaz — yalnız stringi sınıflandırır. Çözülemeyen kod `UNKNOWN`
 *       döner ve istemci TAHMİN YÜRÜTMEZ.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ code, kind, key }" }
 *       400: { description: Kod eksik ya da çok uzun }
 */
router.get("/resolve", (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = resolveQuerySchema.parse(req.query);
    res.status(200).json(resolveScannedCode(code));
  } catch (e) {
    next(e);
  }
});

export default router;
