// =============================================================================
// TeksERP - Defect Type (Hata Kataloğu) Routes
// =============================================================================
// Operatör ekranında butona dönüşen hata tipleri buradan yönetilir.
// CRUD tamamen BaseController pattern'ı ile çalışır; özel iş kuralı yok.

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { BaseService } from "../services/base.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";
import { defectTypeHardRemove } from "../services/helpers/guarded-hard-remove";

const MOBILE_DEFECT_READ = ["mobile:kk2-kursun", "mobile:tambur"] as const;

export const defectTypeService = new BaseService({
  modelName: "defectType",
  tableName: "DEFECT_TYPE",
  searchFields: ["name", "description"],
  codeSearchFields: ["code"],
  defaultInclude: undefined,
  uniqueField: "code",
  duplicateNameField: "name",
  entityLabel: "hata tipi",
  // Kod backend-authoritative: `HATA+GGAAYY+NNNN` günlük sıralı (istemci kodu yok sayılır).
  autoCode: { prefix: "HATA" },
});

const controller = new BaseController(defectTypeService);
const router = Router();

/**
 * @openapi
 * /api/defect-types:
 *   get:
 *     tags: [DefectTypes]
 *     summary: Hata tipi listesi
 *     description: |
 *       Aktif hata tipleri operatör ekranında (Kurşun+QC2) buton olarak çıkar.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 100 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: filter[severity]
 *         schema: { type: string, enum: [MINOR, MAJOR, CRITICAL] }
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string, enum: [true, false] }
 *     responses:
 *       200:
 *         description: Sayfalanmış hata tipi listesi
 */
router.get("/", verifyToken, requireAnyPermission("quality:read", ...MOBILE_DEFECT_READ), controller.findAll);

/**
 * @openapi
 * /api/defect-types/{id}:
 *   get:
 *     tags: [DefectTypes]
 *     summary: Hata tipi detayı
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Hata tipi detayı
 *       404:
 *         description: Kayıt bulunamadı
 */
router.get("/:id", verifyToken, requireAnyPermission("quality:read", ...MOBILE_DEFECT_READ), controller.findById);

/**
 * @openapi
 * /api/defect-types:
 *   post:
 *     tags: [DefectTypes]
 *     summary: Yeni hata tipi oluştur
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               code: { type: string, example: "LEKE" }
 *               name: { type: string, example: "Leke" }
 *               description: { type: string, example: "Boya/kir lekesi" }
 *               severity:
 *                 type: string
 *                 enum: [MINOR, MAJOR, CRITICAL]
 *                 description: UI renklendirme / öncelik için opsiyonel.
 *     responses:
 *       201:
 *         description: Hata tipi oluşturuldu
 *       409:
 *         description: Kod zaten mevcut
 */
router.post("/", verifyToken, requirePermission("quality:write"), controller.create);

/**
 * @openapi
 * /api/defect-types/{id}:
 *   patch:
 *     tags: [DefectTypes]
 *     summary: Hata tipini güncelle
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               severity: { type: string, enum: [MINOR, MAJOR, CRITICAL] }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Güncellendi
 */
router.patch("/:id", verifyToken, requirePermission("quality:write"), controller.update);

/**
 * @openapi
 * /api/defect-types/{id}:
 *   delete:
 *     tags: [DefectTypes]
 *     summary: Hata tipini pasife al
 *     description: Soft-delete — historik RollError snapshot'ları (errorType alanı) korunur.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Pasife alındı
 */
router.delete("/:id", verifyToken, requirePermission("quality:write"), controller.remove);

/**
 * @openapi
 * /api/defect-types/{id}/permanent:
 *   delete:
 *     tags: [DefectTypes]
 *     summary: Hata tipini kalıcı olarak sil
 *     description: |
 *       Geri alınamaz. Daha önce bu tipi kullanmış RollError kayıtlarında
 *       `defectTypeId` NULL olur ancak `errorType` (name snapshot) korunur.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Kalıcı olarak silindi
 *       404:
 *         description: Kayıt bulunamadı
 */
// F39: guard'lı kalıcı silme — kullanılmış (RollError'da geçen) hata tipi 409 alır.
router.delete(
  "/:id/permanent",
  verifyToken,
  requirePermission("quality:write"),
  defectTypeHardRemove,
);

export default router;
