// =============================================================================
// GLOBAL ARAMA UCU — /api/search (2026-08-19)
// =============================================================================
// ⚠️ ROUTE'TA İZİN MIDDLEWARE'İ YOK ve bu bilinçli. Arama zaten KOVA BAZINDA
// eleniyor (`SearchService` her varlığı `matchesPermission` ile süzer). Buraya
// `requirePermission` koymak yeni bir izin kodu icat etmeyi gerektirirdi
// (`permission-catalog.ts` tek kaynak kuralı) ve hiçbir şey kazandırmazdı:
// izinsiz kullanıcı zaten boş sonuç alıyor.
// =============================================================================
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { searchService, MIN_TERM_LENGTH } from "../services/search.service";

const router = Router();

const querySchema = z.object({
  q: z.string().trim().min(MIN_TERM_LENGTH).max(100),
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

/**
 * @openapi
 * /api/search:
 *   get:
 *     tags: [Search]
 *     summary: Global arama — izin verilen tüm varlıklarda tek terimle ara
 *     description: >
 *       Ctrl+K komut paletini besler. Sonuçlar varlık başına gruplanır ve yalnız
 *       kullanıcının o varlığı GÖRME izni varsa döner. Tam-format barkod
 *       okutulduğunda tek deterministik sonuç (`exact`) döner, gruplar boş kalır.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, minLength: 2, maxLength: 100 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 10, default: 5 }
 *         description: Kova başına satır (toplam sayım DÖNMEZ — `hasMore` bayrağı var).
 *     responses:
 *       200: { description: Gruplanmış sonuçlar }
 *       400: { description: Terim çok kısa/uzun }
 */
router.get("/", verifyToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    // Kısa terim bir HATA değil, "henüz aramaya değmez" durumudur — palet her
    // tuşta çağırıyor. 400 yerine boş sonuç döndürmek istemciyi basitleştirir.
    if (!parsed.success) {
      res.status(200).json({ success: true, data: { term: "", exact: null, groups: [] } });
      return;
    }
    const data = await searchService.search(parsed.data.q, {
      permissions: req.user?.permissions ?? [],
      ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

export default router;
