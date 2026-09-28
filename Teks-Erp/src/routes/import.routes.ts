import { Router, type NextFunction, type Request, type Response } from "express";
import express from "express";
import { BUYUK_GOVDE_LIMITI } from "../constants/body-limits";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { matchesPermission, requirePermission } from "../middlewares/rbac.middleware";
import { ImportRevertService } from "../services/import/import-revert.service";
import { AppError } from "../utils/app-error";
import { ImportService } from "../services/import/import.service";
import { getImportAdapter } from "../services/import/import-registry";

// =============================================================================
// TOPLU İÇE / DIŞA AKTARIM UÇLARI
// =============================================================================
// Tasarım: docs/design/IMPORT-EXPORT-TASARIM.md
//
// ⚠️ GÖVDE LİMİTİ: bu router KENDİ `express.json` katmanını taşır (10 MB).
// Global limit 1 MB'dir ve DEĞİŞMEZ (`app.ts` konumu load-bearing) — 10.000
// satırlık bir dosya JSON'a çevrildiğinde 1 MB'ı rahatça aşar, ama bu gevşemenin
// diğer TÜM uçlara yayılması gereksiz bir saldırı yüzeyi olurdu.
//
// ⚠️ YETKİ İKİ KATMANLI: `data:import` (toplu yükleme yeteneği) **VE** hedef
// varlığın kendi write izni. Biri "toplu yükleyebilir", diğeri "bu veriye
// dokunabilir" der; ikisi ayrı sorulardır. Dışa aktarımda yalnız READ aranır
// (karar D6 — ek izin yok).

const router = Router();

// 10 MB — yalnız bu router için.
const jsonBig = express.json({ limit: BUYUK_GOVDE_LIMITI });

/** `data:import` + hedef varlığın write izni. Adaptör `:entity`den çözülür. */
function requireEntityWrite(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(AppError.unauthorized("Kimlik doğrulama gerekli."));
  let adapter;
  try {
    adapter = getImportAdapter(String(req.params.entity));
  } catch (e) {
    return next(e);
  }
  if (!matchesPermission(req.user.permissions, adapter.writePermission)) {
    return next(
      AppError.forbidden(
        `'${adapter.label}' için içe aktarım yapabilmek üzere '${adapter.writePermission}' yetkisi de gerekli.`,
      ),
    );
  }
  next();
}

/** Dışa aktarım: yalnız varlığın READ izni (D6). */
function requireEntityRead(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(AppError.unauthorized("Kimlik doğrulama gerekli."));
  let adapter;
  try {
    adapter = getImportAdapter(String(req.params.entity));
  } catch (e) {
    return next(e);
  }
  if (!matchesPermission(req.user.permissions, adapter.readPermission)) {
    return next(
      AppError.forbidden(`Bu liste için '${adapter.readPermission}' yetkisi gerekli.`),
    );
  }
  next();
}

const rowSchema = z.object({
  rowNo: z.number().int().min(1),
  // Hücreler her zaman METİNDİR — tip dönüşümü sunucuda, tek yerde yapılır
  // (panel "12,5"i sayıya çevirmeye kalkarsa iki farklı yorum doğar).
  cells: z.record(z.string(), z.string()),
});

const optionsSchema = z
  .object({
    mode: z.enum(["upsert", "createOnly", "updateOnly"]).optional(),
    onError: z.enum(["abort", "skip"]).optional(),
    clientToken: z.uuid().optional(),
    fileName: z.string().max(255).optional(),
  })
  .default({});

const payloadSchema = z.object({
  rows: z.array(rowSchema).min(1, "En az bir satır gönderin"),
  options: optionsSchema,
});

/**
 * @openapi
 * /api/import/entities:
 *   get:
 *     tags: [Import]
 *     summary: İçe aktarılabilir varlıklar (kullanıcının yetkisine göre işaretli)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 */
router.get(
  "/entities",
  verifyToken,
  requirePermission("data:import"),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: ImportService.listEntities(req.user?.permissions ?? []) });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/import/runs:
 *   get:
 *     tags: [Import]
 *     summary: İçe aktarım geçmişi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: entity
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Liste }
 */
router.get(
  "/runs",
  verifyToken,
  requirePermission("data:import"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entity = typeof req.query.entity === "string" ? req.query.entity : undefined;
      const limit = Number(req.query.limit) || undefined;
      res.json({ success: true, data: await ImportService.listRuns({ entity, limit }) });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/import/runs/{id}:
 *   get:
 *     tags: [Import]
 *     summary: Tek içe aktarım koşumu (hatalı satır raporu dahil)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Kayıt }
 *       404: { description: Bulunamadı }
 */
router.get(
  "/runs/:id",
  verifyToken,
  requirePermission("data:import"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await ImportService.getRun(String(req.params.id)) });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/import/runs/{id}/records:
 *   get:
 *     tags: [Import]
 *     summary: Koşumda dokunulan kayıtlar (koşumun satır defterinden)
 *     description: >
 *       Kaynak `ImportRunLine` (kalıcı); audit okunmaz. Satır defterinden önceki
 *       koşumda liste boştur ve `legacy: true` döner.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kayıt listesi }
 *       404: { description: Koşum bulunamadı }
 */
router.get(
  "/runs/:id/records",
  verifyToken,
  requirePermission("data:import"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await ImportService.getRunRecords(String(req.params.id)) });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/import/runs/{id}/revert-preview:
 *   get:
 *     tags: [Import]
 *     summary: Geri sarma planı — HİÇBİR ŞEY yazmaz, etkilenen HER satırı döner
 *     description: >
 *       Atlanacak satırlar GEREKÇESİYLE görünür; yan etkiler ayrı bölümde
 *       "kalacak" diye listelenir. Yeni izin kodu YOK: `data:import` + varlığın
 *       kendi write izni (varlık koşumun kendisinden çözülür, `:entity`den değil).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Geri sarma planı }
 *       403: { description: Varlığın write izni yok }
 *       404: { description: Koşum bulunamadı }
 */
router.get(
  "/runs/:id/revert-preview",
  verifyToken,
  requirePermission("data:import"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        success: true,
        data: await ImportRevertService.preview(
          String(req.params.id),
          req.user?.permissions ?? [],
        ),
      });
    } catch (e) {
      next(e);
    }
  },
);

const revertSchema = z.object({
  // Gerekçe ZORUNLU ve kısa olamaz: geri sarma bir İŞ KARARIdır, defterde durur.
  reason: z.string().trim().min(10, "Geri sarma gerekçesi en az 10 karakter olmalı"),
  // Seçim ZORUNLU: boş gövdeyi "hepsini geri sar" diye okumak sessiz yıkım olurdu.
  selectedRowNos: z.array(z.number().int().min(1)).min(1, "Geri sarılacak satır seçilmedi"),
});

/**
 * @openapi
 * /api/import/runs/{id}/revert:
 *   post:
 *     tags: [Import]
 *     summary: Seçilen satırları geri sarar (ters kayıt — ileri satır DEĞİŞMEZ)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Geri sarılan + atlanan satırlar }
 *       400: { description: Gerekçe/seçim eksik }
 *       409: { description: Seçilen satırlar zaten geri sarıldı }
 */
router.post(
  "/runs/:id/revert",
  verifyToken,
  requirePermission("data:import"),
  jsonBig,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = revertSchema.parse(req.body);
      res.json({
        success: true,
        data: await ImportRevertService.revert(String(req.params.id), {
          reason: body.reason,
          selectedRowNos: body.selectedRowNos,
          permissions: req.user?.permissions ?? [],
          userId: req.user?.userId,
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/import/{entity}/template:
 *   get:
 *     tags: [Import]
 *     summary: Şablon tarifi (sütunlar + kurallar) — panel bundan .xlsx üretir
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: entity
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Şablon tarifi }
 */
router.get(
  "/:entity/template",
  verifyToken,
  requirePermission("data:import"),
  requireEntityWrite,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: ImportService.template(String(req.params.entity)) });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/import/{entity}/preview:
 *   post:
 *     tags: [Import]
 *     summary: Kuru koşum — satır satır ne olacağını döner, HİÇBİR ŞEY yazmaz
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Önizleme sonucu }
 */
router.post(
  "/:entity/preview",
  verifyToken,
  requirePermission("data:import"),
  requireEntityWrite,
  jsonBig,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = payloadSchema.parse(req.body);
      const data = await ImportService.preview(
        String(req.params.entity),
        body.rows,
        body.options,
        req.user?.userId,
      );
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/import/{entity}/apply:
 *   post:
 *     tags: [Import]
 *     summary: Uygula — doğrulamayı SIFIRDAN koşar, sonra yazar
 *     description: >
 *       Varsayılan `onError=abort`: tek hatalı satır varsa hiçbir şey yazılmaz
 *       (400 + satır raporu). Yazma sırasında beklenmedik hata çıkarsa ilk
 *       hatada durulur ve sonuç `PARTIAL` + `stoppedAtRowNo` ile döner.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sonuç }
 *       400: { description: Doğrulama hatası — hiçbir kayıt yazılmadı }
 */
router.post(
  "/:entity/apply",
  verifyToken,
  requirePermission("data:import"),
  requireEntityWrite,
  jsonBig,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = payloadSchema.parse(req.body);
      const data = await ImportService.apply(
        String(req.params.entity),
        body.rows,
        body.options,
        req.user?.userId,
      );
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/import/{entity}/export:
 *   get:
 *     tags: [Import]
 *     summary: Round-trip dışa aktarım — içe aktarım şablonuyla AYNI sütunlar
 *     description: >
 *       İndirilen dosya düzenlenip aynı uçtan geri yüklenebilir. Liste
 *       ekranlarındaki "İndir" bundan farklıdır (o ekrandaki sütunları basar).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sütunlar + satırlar }
 */
router.get(
  "/:entity/export",
  verifyToken,
  requireEntityRead,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // `?limit=N` → önizleme (ilk N satır + gerçek toplam). Limitsiz = indirme.
      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : undefined;
      res.json({
        success: true,
        data: await ImportService.exportRows(String(req.params.entity), { limit }),
      });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
