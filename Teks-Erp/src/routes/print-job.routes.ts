// =============================================================================
// TeksERP - Print Job Routes (yazdırma geçmişi, izlenebilirlik A1)
// =============================================================================
// Yazma: oturum açmış HER istemci kendi basımını bildirir (kullanıcı token'dan).
// Okuma: ayar yöneticisi ya da `system:print-history` (Süpervizör · Sevkiyat sorumlusu).

import { Router } from "express";
import { PrintJobController } from "../controllers/print-job.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";

const controller = new PrintJobController();
const router = Router();

// Dosya kapısı (BE-30): her uç oturum ister; okuma uçları ayrıca izin ister.
router.use(verifyToken);

/** Okuma izni kümesi — ekran kaydı (`screen-catalog`) ile aynı. */
export const PRINT_HISTORY_READ = ["admin:settings", "system:print-history"] as const;

/**
 * @openapi
 * /api/print-jobs:
 *   post:
 *     tags: [PrintJobs]
 *     summary: İstemcinin basım bildirimi (yazıcı hatası · iptal · PDF · belge)
 *     description: |
 *       `clientToken` zorunlu; aynı token aynı gövdeyle tek satır, farklı gövdeyle 409.
 *       Kullanıcı token'dan, cihaz başlıktan çözülür. Bilinmeyen `subjectKind` → 400
 *       `PRINT_SUBJECT_UNKNOWN`; `status=HATA` ise `errorCode` zorunlu. Gövde ≤ 8 KB;
 *       kullanıcı başına dakikada 120 bildirim (429 `PRINT_JOB_RATE_LIMIT`).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken, subjectKind, status]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               subjectKind: { type: string, example: ETIKET_TOP }
 *               status: { type: string, enum: [ILETILDI, HATA, IPTAL, BELIRSIZ, SIMULE] }
 *               outputKind: { type: string, enum: [PRINTER, PDF] }
 *               transport: { type: string }
 *               subjectTable: { type: string }
 *               subjectId: { type: string, format: uuid }
 *               subjectIds: { type: array, items: { type: string, format: uuid } }
 *               printerName: { type: string }
 *               errorCode: { type: string }
 *               errorMessage: { type: string }
 *     responses:
 *       201: { description: Basım satırı }
 *       400: { description: Doğrulama hatası }
 *       409: { description: Token başka bir basıma ait }
 *       429: { description: Hız sınırı }
 *   get:
 *     tags: [PrintJobs]
 *     summary: Yazdırma geçmişi listesi (cursor; `ozet=1` ile özet şeridi)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: userId, schema: { type: string } }
 *       - { in: query, name: peripheralDeviceId, schema: { type: string } }
 *       - { in: query, name: printerName, schema: { type: string } }
 *       - { in: query, name: deviceRefId, schema: { type: string } }
 *       - { in: query, name: stationId, schema: { type: string } }
 *       - { in: query, name: subjectKind, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string } }
 *       - { in: query, name: source, schema: { type: string } }
 *       - { in: query, name: outputKind, schema: { type: string } }
 *       - { in: query, name: subjectId, description: "kayıt (subjectId/subjectIds) ya da belge (printedDocumentId) kimliği", schema: { type: string, format: uuid } }
 *       - { in: query, name: gunBas, schema: { type: string, format: date } }
 *       - { in: query, name: gunBit, schema: { type: string, format: date } }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: ozet, schema: { type: string, enum: ["1"] } }
 *     responses:
 *       200: { description: "{ data, nextCursor, ozet? }" }
 *       403: { description: İzin yok }
 */
router.post("/", controller.report);
router.get("/", requireAnyPermission(...PRINT_HISTORY_READ), controller.list);

/**
 * @openapi
 * /api/print-jobs/{id}:
 *   get:
 *     tags: [PrintJobs]
 *     summary: Tek basım kaydı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Basım satırı }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", requireAnyPermission(...PRINT_HISTORY_READ), controller.getById);

export default router;
