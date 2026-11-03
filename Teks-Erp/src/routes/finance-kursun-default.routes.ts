// =============================================================================
// MÜŞTERİYE ÖZEL VARSAYILAN KURŞUN GRAMAJI — `/api/finance/kursun-customer-defaults` (S3, fabrika cevabı 14)
// =============================================================================
// ⚠️ KENDİ BAŞINA MOUNT EDİLMEZ: `finance.routes.ts` içinde bağlanır, `requireFinanceEnabled` kapısını miras alır
// (değer cari kartında yaşar). Ön muhasebe kapalıyken 403 → İE formu istasyon varsayılanına düşer (bugünkü).
// =============================================================================
import { Router } from "express";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import { listKursunCustomerDefaults } from "../services/kursun-customer-default.service";

const router = Router();

/**
 * @openapi
 * /api/finance/kursun-customer-defaults:
 *   get:
 *     tags: [Finance]
 *     summary: Müşteriye özel varsayılan kurşun gramajları (İE formu ön seçimi)
 *     description: |
 *       S3 (fabrika cevabı 14): cari kartında girilen "Varsayılan kurşun gramajı". İE formu müşteri seçilince
 *       bu gramajı ön seçer; listede olmayan müşteride istasyon varsayılanı (bugünkü). Pasif değer listeye girmez.
 *       Ön muhasebe kapalıysa 403 MODULE_DISABLED (istemci boş eşlemeye düşer).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "[{ customerId, valueId }]" }
 *       403: { description: Ön muhasebe kapalı ya da yetki yok }
 */
router.get(
  "/",
  requireAnyPermission("workorder:read", "workorder:write", "mobile:hizli-is-emri"),
  async (_req, res, next) => {
    try {
      res.status(200).json({ success: true, data: await listKursunCustomerDefaults() });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
