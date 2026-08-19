// =============================================================================
// MÜKERRER ANA VERİ BİRLEŞTİRME UÇLARI (Faz B3)
// =============================================================================
// ⚠️ YETKİ İKİ KATMANLI: `master-data:merge` (birleştirme yeteneği) **VE**
// hedef varlığın kendi write izni. Biri "birleştirebilir", diğeri "bu veriye
// dokunabilir" der; ikisi ayrı sorulardır (`data:import` emsali).
//
// ⚠️ İkinci bir varlık→izin listesi TUTULMUYOR: eşleme `import-registry`den
// okunuyor (dört varlığın hepsi zaten orada `writePermission` + `label` ile
// duruyor). Kayıt defterinin kendi başlığındaki kural: "ikinci bir liste
// tutulmaz — kopyalanan liste zamanla ayrışır."
//   ⚠️ RENK write izni `property:write`tir; `color:write` diye bir kod YOK.
//   Elle yazılmış bir allowlist tam da burada sessizce yanlış olurdu.
//
// Önizleme POST'tur ve bu bilinçli: N kaynak id'si yola sığmaz
// (`workorder.controller.ts` toplu önizleme emsali). Yan etkisizdir.

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { AppError } from "../utils/app-error";
import { getImportAdapter } from "../services/import/import-registry";
import {
  MasterDataMergeService,
  MAX_MERGE_SOURCES,
} from "../services/master-data-merge.service";
import { MERGE_ENTITIES } from "../constants/merge-map";

const router = Router();

/** İkinci kapı: varlığın kendi write izni (kayıt defterinden çözülür). */
function requireEntityWrite(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(AppError.unauthorized("Kimlik doğrulama gerekli."));
  const entity = String(req.params.entity);
  if (!(MERGE_ENTITIES as readonly string[]).includes(entity)) {
    return next(AppError.badRequest(`Birleştirme desteklenmiyor: '${entity}'.`));
  }
  let adapter;
  try {
    adapter = getImportAdapter(entity);
  } catch (e) {
    return next(e);
  }
  if (!matchesPermission(req.user.permissions, adapter.writePermission)) {
    return next(
      AppError.forbidden(
        `'${adapter.label}' kayıtlarını birleştirmek için '${adapter.writePermission}' yetkisi de gerekli.`,
      ),
    );
  }
  next();
}

const previewSchema = z.object({
  survivorId: z.uuid(),
  sourceIds: z.array(z.uuid()).min(1).max(MAX_MERGE_SOURCES),
});

const mergeSchema = previewSchema.extend({
  // 10 karakter, ManualMoveModal'ın 3'ünden fazla: "neden aynı firma" kararının
  // BAŞKA HİÇBİR KAYDI YOK — tombstone'a bakan kişinin elindeki tek açıklama bu.
  reason: z.string().trim().min(10, "Gerekçe en az 10 karakter olmalı"),
  // Önizlemede GÖRÜLEN çakışma sayısı. Uyuşmazlık → 409: per-satır onay yükü
  // olmadan "operatör gerçekten gördü" garantisi veren tek mekanizma.
  acknowledgedConflicts: z.number().int().min(0),
});

/**
 * @openapi
 * /api/master-data/{entity}/merge/preview:
 *   post:
 *     tags: [MasterData]
 *     summary: Birleştirme önizlemesi (yan etkisiz)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Önizleme }
 */
router.post(
  "/:entity/merge/preview",
  verifyToken,
  requirePermission("master-data:merge"),
  requireEntityWrite,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = previewSchema.parse(req.body);
      const data = await MasterDataMergeService.preview(
        String(req.params.entity),
        body.survivorId,
        body.sourceIds,
      );
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/master-data/{entity}/merge:
 *   post:
 *     tags: [MasterData]
 *     summary: Mükerrer kayıtları birleştir (GERİ ALINAMAZ)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Birleştirildi }
 *       409: { description: Çakışma / veri bu sırada değişti }
 */
router.post(
  "/:entity/merge",
  verifyToken,
  requirePermission("master-data:merge"),
  requireEntityWrite,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = mergeSchema.parse(req.body);
      const data = await MasterDataMergeService.merge(String(req.params.entity), {
        survivorId: body.survivorId,
        sourceIds: body.sourceIds,
        reason: body.reason,
        acknowledgedConflicts: body.acknowledgedConflicts,
        userId: req.user?.userId,
      });
      res.json({
        success: true,
        data,
        message: `${data.mergedCount} kayıt birleştirildi.`,
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/master-data/duplicates:
 *   get:
 *     tags: [MasterData]
 *     summary: Mükerrer aday listesi (katlanmış ada göre)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Gruplar }
 */
router.get(
  "/duplicates",
  verifyToken,
  requirePermission("master-data:merge"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entity = z.enum(MERGE_ENTITIES).parse(req.query.entity);
      const data = await MasterDataMergeService.findDuplicates(entity);
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
