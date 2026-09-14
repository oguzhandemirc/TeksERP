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
import {
  assertDefaultWriteConsistent,
  assertNotDeactivatingDefaultById,
  setDefaultDefectType,
} from "../services/helpers/default-defect-type.helper";
import { AuditService } from "../services/audit.service";
import type { NextFunction, Request, Response } from "express";

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
// BENZER KAYITLAR — mükerreri REDDETMEK yerine ÖNLEMEK için (2026-08-19).
// ⚠️ `/:id`den ÖNCE tanımlı olmalı; sonra gelirse Express "similar-names"i id
// sanar ve `uuid-param` middleware'i 400 döndürür.
// ⚠️ İzin WRITE: bu uç var olan adları listeler ve yalnız KAYIT AÇAN kişiye
// lazımdır; okuma iznine bakmak görünürlüğü gereksiz genişletirdi.
router.get("/similar-names", verifyToken, requirePermission("quality:write"), controller.similarNames);

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
/**
 * `isDefault: true` DÜZ yazılmaz: partial unique (`defect_types_one_default`) ikinci
 * varsayılanı P2002 ile reddederdi. Gövdeden çıkarılır, kayıt yazılır, sonra tek tx'te
 * eski varsayılan düşürülüp bu kayıt yükseltilir (`setDefaultDefectType`). `false`
 * düz geçer (varsayılansız katalog admin kararıdır; tipsiz giriş o zaman 400).
 */
async function writeWithDefault(
  req: Request,
  res: Response,
  next: NextFunction,
  mode: "create" | "update",
): Promise<void> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    assertDefaultWriteConsistent(body); // K2: pasif + varsayılan birlikte gelmez (yarım yazım yok)
    const wantDefault = body.isDefault === true;
    if (wantDefault) delete body.isDefault;
    if (mode === "update") await assertNotDeactivatingDefaultById(String(req.params.id), body); // K3
    const result =
      mode === "create"
        ? await defectTypeService.create(body, req.user?.userId)
        : await defectTypeService.update(String(req.params.id), body, req.user?.userId);
    const id = (result.data as { id?: string } | undefined)?.id ?? String(req.params.id);
    if (wantDefault) {
      const r = await setDefaultDefectType(id);
      await AuditService.log({
        userId: req.user?.userId,
        action: "UPDATE",
        tableName: "DEFECT_TYPE",
        recordId: id,
        oldData: { defaultDefectTypeId: r.previousId },
        newData: { defaultDefectTypeId: id },
      });
      (result.data as Record<string, unknown>).isDefault = true;
    }
    res.status(mode === "create" ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
}

router.post("/", verifyToken, requirePermission("quality:write"), (req, res, next) => writeWithDefault(req, res, next, "create"));

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
router.patch("/:id", verifyToken, requirePermission("quality:write"), (req, res, next) => writeWithDefault(req, res, next, "update"));

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
/**
 * @openapi
 * /api/defect-types/{id}/set-default:
 *   post:
 *     tags: [DefectTypes]
 *     summary: Hata tipini VARSAYILAN yap (kurulumda en fazla bir)
 *     description: |
 *       Tipsiz hata girişi (tablet Tambur "hata tipi seçilmedi") bu tipe düşer; varsayılan yoksa giriş 400.
 *       Eski varsayılan aynı tx'te düşer. Pasif tip varsayılan yapılamaz.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ id, previousId }" }
 *       400: { description: "Pasif tip" }
 *       404: { description: "Bulunamadı" }
 */
router.post(
  "/:id/set-default",
  verifyToken,
  requirePermission("quality:write"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const result = await setDefaultDefectType(id);
      await AuditService.log({
        userId: req.user?.userId,
        action: "UPDATE",
        tableName: "DEFECT_TYPE",
        recordId: id,
        oldData: { defaultDefectTypeId: result.previousId },
        newData: { defaultDefectTypeId: id },
      });
      res.status(200).json({ success: true, data: { id, previousId: result.previousId } });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/:id",
  verifyToken,
  requirePermission("quality:write"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await assertNotDeactivatingDefaultById(String(req.params.id)); // K3: varsayılan pasife alınmaz
      await controller.remove(req, res, next);
    } catch (error) {
      next(error);
    }
  },
);

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
