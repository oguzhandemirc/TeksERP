// =============================================================================
// TeksERP — PATRON ÖZETİ ROTASI
// =============================================================================
// ⚠️ İZİN GUARD'I YOK ve bu BİLİNÇLİ — `GET /api/search` ile aynı desen. Özet
// beş bağımsız bölümden oluşuyor ve her biri KENDİ iznine bakıyor (serviste).
// Route'a tek bir `requirePermission` koymak iki kötü sonuçtan birini üretirdi:
// dar bir kod seçilirse yalnız o bölümü görmesi gereken kullanıcı 403 alır;
// geniş bir kod seçilirse izin gerçekte hiçbir şeyi kapılamaz.
//
// ⚠️ YENİ İZİN KODU EKLENMEDİ. Yeni bir kod, sahada kullanıcılara ATANMASI
// unutulabilecek bir adım daha demekti (2026-08-01 kurşun bypass vakası:
// ekran canlıya çıktı, izin satırı olmadığı için Admin dışı herkes 403 aldı,
// teşhis saatler sürdü). Patron rolü mevcut `report:*` + `*:read` kodlarından
// kuruluyor (`role-template-catalog` → WEB_BOSS).
// =============================================================================

import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { getBossOverview } from "../services/boss/overview.service";
import { resolveDateRange } from "../services/reports/_shared";

const router = Router();

// Rapor uçlarıyla AYNI sözleşme: mutlak an'lar, gün sınırını istemci çizer.
// `.strict()` — tanınmayan parametre sessizce yok sayılmaz.
const querySchema = z
  .object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  })
  .strict();

/**
 * @openapi
 * /api/boss/overview:
 *   get:
 *     tags: [Boss]
 *     summary: Patron özeti — stok · sipariş · üretim · sevkiyat · fason (TEK istek)
 *     description: >
 *       Her bölüm kullanıcının iznine göre doldurulur; izin yoksa `null` döner ve
 *       adı `denied` dizisine yazılır (istemci kartı çizmez). Rakamlar mevcut
 *       rapor servislerinden gelir — bu uç hiçbir şeyi yeniden hesaplamaz.
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/overview",
  verifyToken,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = querySchema.parse(req.query);
      const data = await getBossOverview({
        permissions: req.user?.permissions ?? [],
        range: resolveDateRange(q),
      });
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
