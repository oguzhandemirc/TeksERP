// =============================================================================
// TeksERP - User Preference Controller
// =============================================================================
// Self-service: kullanıcı yalnız kendi tercihlerini okur/yazar (req.user.userId).
// Ekstra permission gerekmez — `verifyToken` yeterli (`/me` gibi).
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { UserPreferenceService } from "../services/user-preference.service";
import "../types/express-augment";

// Gevşek doğrulama: frontend AppPreferences şeklini sahiplenir.
// Boyut sınırı: blob JSON kolonuna olduğu gibi yazıldığından (sorgulanmıyor),
// bozuk/kötü niyetli bir istemcinin kullanıcı başına çok-MB satır şişirmesini
// engellemek için serileştirilmiş boyut 64KB ile sınırlı (tipik tercih <5KB).
const MAX_PREFERENCES_BYTES = 64_000;
const preferencesSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (v) => JSON.stringify(v).length <= MAX_PREFERENCES_BYTES,
    "Tercih verisi çok büyük (en fazla 64KB)",
  );

export class UserPreferenceController {
  /**
   * @openapi
   * /api/auth/preferences:
   *   get:
   *     tags: [Auth]
   *     summary: Mevcut kullanıcının UI tercihleri
   *     description: Giriş yapan kullanıcının kişisel UI tercihlerini döner (yoksa boş obje).
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Tercihler }
   *       401: { description: Yetkisiz erişim }
   */
  static async getMine(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: "Token bulunamadı" });
        return;
      }
      const data = await UserPreferenceService.get(userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * @openapi
   * /api/auth/preferences:
   *   put:
   *     tags: [Auth]
   *     summary: UI tercihlerini kaydet
   *     description: Giriş yapan kullanıcının tüm tercih blob'unu değiştirir (upsert).
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { type: object }
   *     responses:
   *       200: { description: Kaydedildi }
   *       400: { description: Validasyon hatası }
   *       401: { description: Yetkisiz erişim }
   */
  static async updateMine(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: "Token bulunamadı" });
        return;
      }
      const preferences = preferencesSchema.parse(req.body);
      const data = await UserPreferenceService.save(userId, preferences);
      res.status(200).json({ success: true, data, message: "Tercihler kaydedildi" });
    } catch (error) {
      next(error);
    }
  }
}
