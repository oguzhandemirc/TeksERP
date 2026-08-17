// =============================================================================
// TeksERP - Kayıt Bilgisi (ⓘ) Routes
// =============================================================================
// İnce okuma ucu — controller'sız (ARCHITECTURE §"bilinçli istisna"): route
// içinde doğrulama + servise delege, iş mantığı serviste.
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { AppError } from "../utils/app-error";
import { recordInfoService } from "../services/record-info.service";
import "../types/express-augment";

const router = Router();

/**
 * İzin verilen tablolar ve okunması için gereken yetki.
 *
 * ⚠️ Bu harita GÜVENLİK SINIRIDIR ve bilinçli olarak ROUTE katmanında durur:
 * yetkilendirme kararı guard'ın işidir, servisin değil. Serbest `tableName`
 * kabul eden bir uç, audit günlüğünü dolaylı bir arama yüzeyine çevirirdi
 * (kim hangi kaydı ne zaman değiştirdi — `report:audit` arkasında olması
 * gereken bilgi). Yeni tablo eklerken o tablonun OKUMA yetkisini yaz.
 *
 * Bekçi: `scripts/test_permission_catalog.ts` bu sabiti dinamik izin kaynağı
 * olarak tanır (`DINAMIK_IZIN_KAYNAKLARI`) ve içindeki kodların katalogda
 * bulunmasını arar.
 */
const TABLE_PERMISSIONS: Readonly<Record<string, string>> = {
  WORK_ORDER: "workorder:read",
  ORDER: "order:read",
  ROLL: "roll:read",
  SHIPMENT: "shipping:read",
  SACK: "shipping:read",
  CUSTOMER: "customer:read",
  ITEM: "item:read",
  SUBCONTRACTOR_DISPATCH: "subcontractor:read",
  SUBCONTRACTOR_RECEIPT: "subcontractor:read",
};

const paramsSchema = z.object({
  // Tablo adı allowlist'ten geçer (servis); burada yalnız biçim kontrolü.
  table: z.string().regex(/^[A-Z_]{3,40}$/, "Geçersiz kayıt türü"),
  id: z.string().uuid("Geçersiz kayıt ID"),
});

/**
 * @openapi
 * /api/record-info/{table}/{id}:
 *   get:
 *     tags: [System]
 *     summary: Kaydı kim oluşturdu / en son kim değiştirdi
 *     description: >
 *       YALNIZ "kim" sorusunu cevaplar; tarihler istemcinin elindeki kayıtta
 *       zaten var. Audit 6 ayda bir arşivlendiği için eski kayıtlarda `null`
 *       dönebilir (`auditEmpty: true`) — bu bir hata değil, dürüst cevaptır.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: table
 *         required: true
 *         schema: { type: string, example: WORK_ORDER }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ created, lastChange, auditEmpty }" }
 *       400: { description: Desteklenmeyen kayıt türü }
 *       403: { description: O kayıt türünü okuma yetkisi yok }
 */
router.get(
  "/:table/:id",
  verifyToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { table, id } = paramsSchema.parse(req.params);
      // Yetki KAYIT TÜRÜNE göre: siparişi okuyamayan biri siparişin
      // "kim değiştirdi"sini de okuyamamalı (audit sızıntısı).
      const permission = TABLE_PERMISSIONS[table];
      if (!permission) {
        throw AppError.badRequest(`Bu kayıt türü için bilgi görüntülenemiyor: ${table}`);
      }
      if (!matchesPermission(req.user?.permissions ?? [], permission)) {
        throw AppError.forbidden(`Bu işlem için '${permission}' yetkisi gerekli.`);
      }
      res.status(200).json(await recordInfoService.get(table, id));
    } catch (error) {
      next(error);
    }
  },
);

export default router;
