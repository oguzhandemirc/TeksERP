// =============================================================================
// TeksERP - Currency Routes (sabit liste — config-driven, DB yok)
// =============================================================================
// Frontend currency dropdown'unu beslemek için. Sipariş/sevkiyat/finance
// modülleri bu listeyi tüketir. Yeni currency eklemek için
// src/config/currencies.ts'yi düzenle — endpoint otomatik yansır.
// =============================================================================

import { Router, Request, Response } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { CURRENCIES } from "../config/currencies";

const router = Router();

/**
 * @openapi
 * /api/currencies:
 *   get:
 *     tags: [Currencies]
 *     summary: Desteklenen para birimleri (sabit liste)
 *     description: |
 *       Faz 1: TRY, USD, EUR, GBP. Sipariş/sevkiyat/finance ekranlarında
 *       dropdown kaynağı. Yetki: sadece auth (özel permission yok — referans
 *       liste).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: "{ code, name, symbol } dizisi"
 */
router.get("/", verifyToken, (_req: Request, res: Response) => {
  res.status(200).json({ success: true, data: CURRENCIES });
});

export default router;
