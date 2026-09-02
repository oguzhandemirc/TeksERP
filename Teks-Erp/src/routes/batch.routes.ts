// =============================================================================
// TeksERP - Batch (Parti) Routes — K8 düzeltme araçları
// =============================================================================
// Sevksiz parti düzeltme uçları. Tümü workorder:write gerektirir. Servis katmanı
// (batch.service) türetilmiş kilit + izsiz-boş silme + audit'i yönetir.
// =============================================================================

import { Router } from "express";
import { BatchController } from "../controllers/batch.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireProductionEnabled } from "../middlewares/module.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";

const controller = new BatchController();
const router = Router();

// Modül kapısı — bu router'daki HER uç için (2026-09-02).
// ⚠️ Kapı `verifyToken`dan SONRA: kimliksiz istek 401 almalı, 403 değil
// (403 "kaynak var ama modül kapalı" bilgisini kimliksiz kişiye sızdırırdı).
// ⚠️ `router.use` ile TOPLU: uç uç yazılırsa biri unutulur ve unutulan uç
// sessizce açık kalır. Sıra da load-bearing — bu satırdan ÖNCE tanımlanan bir
// uç kapıyı HİÇ görmez (Express kayıt sırası; hata da log da üretmez).
router.use(verifyToken, requireProductionEnabled);

/**
 * @openapi
 * /api/batches/number-state:
 *   get:
 *     tags: [Batches]
 *     summary: Kısa parti sayacının durumu (salt-okunur)
 *     description: >
 *       `batch.shortNumberEnabled` açıkken en son kullanılan ve sıradaki parti
 *       numarasını döner. `next` bir ÖNİZLEMEDİR (rezervasyon değil) — kilit
 *       dışında okunur, arada bir parti doğarsa gerçekleşen numara farklı olur.
 *       Bayrak kapalıyken sayaç yoktur ve numara alanları null döner.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ enabled, min, max, last, next, lastCode, nextCode }" }
 */
// `admin:settings` DE kabul edilir: göstergenin tüketicisi Genel Ayarlar ekranı ve
// oradaki yönetici `workorder:read` taşımak zorunda değil. Tersi kurgu göstergeyi
// panelde sessizce boş bırakırdı.
// `mobile:hizli-is-emri` — Hızlı İş Emri sihirbazının ilk adımı "SON PARTİ: P47"
// göstergesini basar (2026-08-17). Saha kullanıcısı `workorder:read` taşımaz.
router.get(
  "/number-state",
  verifyToken,
  requireAnyPermission("workorder:read", "admin:settings", "mobile:hizli-is-emri"),
  controller.numberState,
);

/**
 * @openapi
 * /api/batches/move-rolls:
 *   post:
 *     tags: [Batches]
 *     summary: Topları başka sevksiz partiye taşı (K8)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollIds, toBatchId]
 *             properties:
 *               rollIds: { type: array, items: { type: string, format: uuid } }
 *               toBatchId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Taşındı }
 *       409: { description: Kaynak/hedef parti sevk edilmiş (kilitli) }
 */
router.post("/move-rolls", verifyToken, requirePermission("workorder:write"), controller.moveRolls);

/**
 * @openapi
 * /api/batches/merge:
 *   post:
 *     tags: [Batches]
 *     summary: Sevksiz partileri birleştir — en eski no yaşar (K8)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [batchIds]
 *             properties:
 *               batchIds: { type: array, items: { type: string, format: uuid }, minItems: 2 }
 *     responses:
 *       200: { description: Birleştirildi }
 *       409: { description: Partilerden biri sevk edilmiş (kilitli) }
 */
router.post("/merge", verifyToken, requirePermission("workorder:write"), controller.mergeBatches);

/**
 * @openapi
 * /api/batches/{batchId}/split:
 *   post:
 *     tags: [Batches]
 *     summary: Partiden seçili topları yeni partiye ayır (K8 elle böl)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: batchId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollIds]
 *             properties:
 *               rollIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Yeni parti oluşturuldu }
 *       409: { description: Kaynak parti sevk edilmiş (kilitli) }
 */
router.post("/:batchId/split", verifyToken, requirePermission("workorder:write"), controller.splitBatch);

export default router;
