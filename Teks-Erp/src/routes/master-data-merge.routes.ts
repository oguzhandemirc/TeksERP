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
import { MasterDataUnmergeService } from "../services/master-data-unmerge.service";
import { MERGE_ENTITIES } from "../constants/merge-map";
import { DuplicateDetectionService } from "../services/duplicate-detection.service";
import { DuplicateReviewService } from "../services/duplicate-review.service";

const router = Router();

/** Geri alma gövdesi — gerekçe birleştirmeyle aynı eşikte (10), ad çakışmasında yeni adlar. */
const revertSchema = z.object({
  reason: z.string().trim().min(10, "Gerekçe en az 10 karakter olmalı"),
  /** `{ kaynakId: yeniAd }` — yalnız adı hayattaki kayıtla çakışan kaynaklar için. */
  renames: z.record(z.uuid(), z.string().trim().min(1).max(255)).optional(),
});

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
  // ALAN SEÇİMİ (P2): `{ alan: kayıtId }` — hangi alanın değeri HANGİ KAYITTAN
  // alınacak. Değer DEĞİL kayıt taşınır: uç serbest bir alan düzenleme API'sine
  // dönüşmesin (gerekçe `constants/merge-fields.ts` başlığında). Alan adı ve
  // kayıt üyeliği serviste ayrıca doğrulanır (Zod yalnız biçimi bilir).
  fieldPicks: z.record(z.string().min(1).max(64), z.uuid()).optional(),
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
        fieldPicks: body.fieldPicks,
        userId: req.user?.userId,
      });
      res.json({
        success: true,
        data,
        message:
          `${data.mergedCount} kayıt birleştirildi.` +
          (data.fieldsApplied.length > 0
            ? ` ${data.fieldsApplied.length} alan kaynak kayıttan alındı.`
            : ""),
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

// ─────────────────────────────────────────────────────────────────────────────
// MÜKERRER PANELİ v2 (P1, 2026-08-22) — aday tarama + inceleme kuyruğu
// ─────────────────────────────────────────────────────────────────────────────
const candidatesQuerySchema = z.object({
  entity: z.enum(MERGE_ENTITIES),
  includeNotDuplicate: z.enum(["true", "false"]).optional(),
});

/**
 * @openapi
 * /api/master-data/duplicates/candidates:
 *   get:
 *     tags: [MasterData]
 *     summary: "Mükerrer aday taraması (kesin ad + kimlik + bulanık ad), gerekçeli çiftler ve gruplar"
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Tarama sonucu }
 */
router.get(
  "/duplicates/candidates",
  verifyToken,
  requirePermission("master-data:merge"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = candidatesQuerySchema.parse(req.query);
      const data = await DuplicateDetectionService.scan(q.entity, {
        includeNotDuplicate: q.includeNotDuplicate === "true",
      });
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },
);

const recordsQuerySchema = z.object({
  entity: z.enum(MERGE_ENTITIES as unknown as [string, ...string[]]),
  search: z.string().trim().max(200).optional(),
  onlySuspect: z.enum(["true", "false"]).optional(),
  includeInactive: z.enum(["true", "false"]).optional(),
  includeNotDuplicate: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * @openapi
 * /api/master-data/duplicates/records:
 *   get:
 *     tags: [MasterData]
 *     summary: "Varlığın TAM listesi + şüpheli süzgeci (panelin ana ekranı)"
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kayıt listesi }
 */
router.get(
  "/duplicates/records",
  verifyToken,
  requirePermission("master-data:merge"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = recordsQuerySchema.parse(req.query);
      const data = await DuplicateDetectionService.listRecords(q.entity, {
        search: q.search,
        onlySuspect: q.onlySuspect === "true",
        includeInactive: q.includeInactive === "true",
        includeNotDuplicate: q.includeNotDuplicate === "true",
        page: q.page,
        limit: q.limit,
      });
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/master-data/duplicates/candidates.csv:
 *   get:
 *     tags: [MasterData]
 *     summary: "Aday raporu CSV (noktalı virgül + BOM, tr-TR Excel)"
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: CSV dosyası }
 */
router.get(
  "/duplicates/candidates.csv",
  verifyToken,
  requirePermission("master-data:merge"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = candidatesQuerySchema.parse(req.query);
      const result = await DuplicateDetectionService.scan(q.entity, {
        includeNotDuplicate: q.includeNotDuplicate === "true",
      });
      const csv = DuplicateDetectionService.toCsv(result);
      const stamp = result.scannedAt.slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="mukerrer-adaylar-${q.entity}-${stamp}.csv"`,
      );
      res.status(200).send(csv);
    } catch (e) {
      next(e);
    }
  },
);

const reviewsQuerySchema = z.object({
  entity: z.enum(MERGE_ENTITIES),
  decision: z.enum(["NOT_DUPLICATE", "MERGED", "DEFERRED"]).optional(),
});

/**
 * @openapi
 * /api/master-data/duplicates/reviews:
 *   get:
 *     tags: [MasterData]
 *     summary: "İnceleme kararları (mükerrer değil / ertelendi / birleştirildi)"
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Karar listesi }
 *   post:
 *     tags: [MasterData]
 *     summary: "Çift için karar ver (NOT_DUPLICATE | DEFERRED) — aynı çift tek satır"
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Karar }
 */
router.get(
  "/duplicates/reviews",
  verifyToken,
  requirePermission("master-data:merge"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = reviewsQuerySchema.parse(req.query);
      const data = await DuplicateReviewService.list(q.entity, q.decision);
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },
);

const decideSchema = z.object({
  entity: z.enum(MERGE_ENTITIES),
  aId: z.uuid(),
  bId: z.uuid(),
  decision: z.enum(["NOT_DUPLICATE", "DEFERRED"]),
  note: z.string().trim().max(500).optional().nullable(),
  // Karar anındaki gerekçe snapshot'ı (panel tarama sonucundan geçirir) — sorgulanmaz.
  evidence: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
});

router.post(
  "/duplicates/reviews",
  verifyToken,
  requirePermission("master-data:merge"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = decideSchema.parse(req.body);
      const data = await DuplicateReviewService.decide({
        entity: body.entity,
        aId: body.aId,
        bId: body.bId,
        decision: body.decision,
        note: body.note ?? null,
        evidence: body.evidence,
        userId: req.user?.userId,
      });
      res.json({
        success: true,
        data,
        message: body.decision === "NOT_DUPLICATE" ? "Çift 'mükerrer değil' olarak işaretlendi." : "Çift ertelendi.",
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/master-data/duplicates/reviews/{id}:
 *   delete:
 *     tags: [MasterData]
 *     summary: "Kararı geri aç (çift bir sonraki taramada yine kuyruğa düşer); MERGED geri açılamaz"
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Geri açıldı }
 *       409: { description: Birleştirilmiş çift geri açılamaz }
 */
router.delete(
  "/duplicates/reviews/:id",
  verifyToken,
  requirePermission("master-data:merge"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.uuid().parse(req.params.id);
      await DuplicateReviewService.reopen(id, req.user?.userId);
      res.json({ success: true, message: "Karar geri açıldı." });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/master-data/merges:
 *   get:
 *     tags: [MasterData]
 *     summary: Birleştirme defteri — en yeni önce (geri alma ekranının listesi)
 *     security: [{ bearerAuth: [] }]
 */
router.get("/merges", verifyToken, requirePermission("master-data:merge"), async (req, res, next) => {
  try {
    const q = z
      .object({ entity: z.enum(MERGE_ENTITIES).optional(), limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse(req.query);
    res.json({ success: true, data: await MasterDataUnmergeService.list(q) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/master-data/merges/{id}/revert-preview:
 *   get:
 *     tags: [MasterData]
 *     summary: Geri alma önizlemesi — engeller, ad çakışmaları, geri yazılacak satır sayıları
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/merges/:id/revert-preview",
  verifyToken,
  requirePermission("master-data:merge"),
  async (req, res, next) => {
    try {
      res.json({ success: true, data: await MasterDataUnmergeService.preview(String(req.params.id)) });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/master-data/merges/{id}/revert:
 *   post:
 *     tags: [MasterData]
 *     summary: Birleştirmeyi geri al (defterden; LIFO, ad çakışmasında yeni ad ister)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Geri alındı }
 *       409: { description: Engel var (details.code UNMERGE_BLOCKED / UNMERGE_NEEDS_RENAME) }
 */
router.post(
  "/merges/:id/revert",
  verifyToken,
  // ⚠️ İkinci kapı `requireEntityWrite` BURADA KULLANILAMAZ: yol `:entity`
  // taşımıyor, varlık DEFTERDEN çözülür. Karar: birleştirmenin kendi izni
  // (`master-data:merge`) yeterli sayılır — aynı izinle yapılan işin geri alınması
  // için İKİNCİ bir yetki aramak, yanlış birleştirmeyi düzeltmeyi birleştirmekten
  // zor yapardı (SoD gerekçesi yok: geri alma yeni veri üretmez, eskiyi geri yazar).
  requirePermission("master-data:merge"),
  async (req, res, next) => {
    try {
      const body = revertSchema.parse(req.body ?? {});
      const data = await MasterDataUnmergeService.revert(String(req.params.id), {
        reason: body.reason,
        renames: body.renames,
        userId: req.user?.userId,
      });
      res.json({
        success: true,
        data,
        message:
          `${data.restoredSources} kayıt geri alındı; ${data.repointedRows} referans kaynağına döndü` +
          (data.restoredDeletedRows > 0 ? `, ${data.restoredDeletedRows} silinmiş satır yeniden yazıldı` : "") +
          (data.skippedRows > 0 ? `. ${data.skippedRows} satır geri yazılamadı (sonradan değişmiş).` : "."),
      });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
