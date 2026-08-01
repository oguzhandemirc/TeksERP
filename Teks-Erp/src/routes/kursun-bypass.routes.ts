// =============================================================================
// TeksERP - Kurşun Dağıtım (Kurşun Bypass) Routes
// =============================================================================
// Tüm uçlar `workorder:distribute` (web) VEYA `mobile:kursun-dagitim` (mobil
// ekran ikizi) ister — mobil kullanıcı yalnız web izniyle korunsaydı 403 alırdı.
// =============================================================================

import { Router } from "express";
import { KursunBypassController } from "../controllers/kursun-bypass.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";

const controller = new KursunBypassController();
const router = Router();

const canDistribute = requireAnyPermission(
  "workorder:distribute",
  "mobile:kursun-dagitim",
);

/**
 * @openapi
 * /api/kursun-bypass/distribution:
 *   get:
 *     tags: [KursunBypass]
 *     summary: Kurşun Dağıtım ekranının tek payload'ı (bayrak + makineler + bekleyen + dağıtılmış)
 *     description: |
 *       Electron ve mobil AYNI yanıtı tüketir. `machines` = PROCESS_QC
 *       istasyonuna bağlı AKTİF fiziksel kurşun makineleri (atama hedefleri);
 *       her satır `id`, `code`, `name`, `stationId`, `stationName` taşır.
 *       `waiting` satırları `eligible` + `blockReason` taşır (uygunluk
 *       kurallarından hangisi düştü); `assigned` satırları atandığı makineyi
 *       (`machineId` / `machineCode` / `machineName` + istasyon adı) ve `stale`
 *       + `staleReason` taşır (adım kapandı / açık top kalmadı → UI iptal
 *       önerir). `flagEnabled=false` ise yalnız YENİ atama kapalıdır, mevcut
 *       dağıtımlar tamamlanabilir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Dağıtım listesi }
 *       401: { description: Yetkisiz }
 *       500: { description: Sunucu hatası }
 */
router.get("/distribution", verifyToken, canDistribute, controller.listDistribution);

/**
 * @openapi
 * /api/kursun-bypass/assign:
 *   post:
 *     tags: [KursunBypass]
 *     summary: İş emrinin kurşun adımını fiziksel bir kurşun MAKİNESİNE dağıt
 *     description: |
 *       Zaten dağıtılmışsa satır güncellenir (makine değişimi) — bu durumda
 *       `production.kursunBypassEnabled` bayrağına BAKILMAZ. Adımın `stationId`'si
 *       DEĞİŞTİRİLMEZ: PROCESS_QC istasyonu tektir, atamanın taşıdığı tek bilgi
 *       makinedir ve atama satırında yaşar. Üretim atfı, kapanan kurşun
 *       movement'ına yazılan `RollMovement.machineId` damgasıyla tutulur —
 *       makine bazlı hacim raporları bu sayede çalışır.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [workOrderId, machineId]
 *             properties:
 *               workOrderId: { type: string, format: uuid }
 *               machineId:   { type: string, format: uuid, description: "Aktif Machine; bağlı olduğu Station.kind = PROCESS_QC ve istasyonun KURSUN yeteneği tanımlı olmalı" }
 *               notes:       { type: string, maxLength: 500 }
 *     responses:
 *       201: { description: Dağıtım kaydedildi }
 *       400: { description: "Bayrak kapalı / adım uygun değil / makine pasif, PROCESS_QC dışı ya da istasyonu kurşun uygulayamıyor" }
 *       401: { description: Yetkisiz }
 *       404: { description: İş emri veya makine bulunamadı }
 *       409: { description: İş emri durumu uygun değil, adımda dijital iz var ya da eşzamanlı dağıtım }
 *       500: { description: Sunucu hatası }
 */
router.post("/assign", verifyToken, canDistribute, controller.assign);

/**
 * @openapi
 * /api/kursun-bypass/{id}/cancel:
 *   post:
 *     tags: [KursunBypass]
 *     summary: Açık dağıtımı iptal et (adım normal tabletli akışa döner)
 *     description: |
 *       Atomik claim (yalnız açık kayıt) ile ATAMA SATIRI soft-cancel edilir;
 *       başka hiçbir şeye dokunulmaz. Geri yüklenecek istasyon YOKTUR — atama
 *       makine bazındadır ve adımın `stationId`'si zaten hiç değiştirilmedi.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: KursunBypassAssignment.id
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string, maxLength: 200 }
 *     responses:
 *       200: { description: Dağıtım iptal edildi }
 *       400: { description: Geçersiz UUID veya gövde }
 *       401: { description: Yetkisiz }
 *       404: { description: Dağıtım kaydı bulunamadı }
 *       409: { description: Dağıtım zaten tamamlanmış/iptal edilmiş }
 *       500: { description: Sunucu hatası }
 */
router.post("/:id/cancel", verifyToken, canDistribute, controller.cancelAssignment);

/**
 * @openapi
 * /api/kursun-bypass/{id}/complete-preview:
 *   get:
 *     tags: [KursunBypass]
 *     summary: '"İşi Bitir" öncesi salt-okunur önizleme'
 *     description: |
 *       Hiçbir şeyi değiştirmez. `canComplete=false` ise `blockReason` somut
 *       sebebi söyler. `willFinalize` toplara ne olacağını gösterir (WAREHOUSE,
 *       kalite NULL kalır, kaç barkod üretilecek).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Önizleme }
 *       400: { description: Geçersiz UUID }
 *       401: { description: Yetkisiz }
 *       404: { description: Dağıtım kaydı bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.get(
  "/:id/complete-preview",
  verifyToken,
  canDistribute,
  controller.getCompletePreview,
);

/**
 * @openapi
 * /api/kursun-bypass/{id}/complete:
 *   post:
 *     tags: [KursunBypass]
 *     summary: Kurşun SON adımsa dağıtım ekranından "İşi Bitir"
 *     description: |
 *       Yalnız kurşundan sonra non-SKIPPED adım YOKSA çalışır (aksi halde 400 —
 *       kapanış Tambur kartı okutmasıyla yapılır). Açık movement'lar
 *       `KURSUN_BYPASS_FINISHED:<uuid>` marker'ı + ATANAN MAKİNE damgasıyla
 *       (`RollMovement.machineId`) kapanır, makinenin istasyonunun yetenekleri
 *       toplara kopyalanır ve toplar WAREHOUSE'a finalize edilir (kalite NULL kalır).
 *       Idempotent: iş zaten bitmişse `alreadyDone=true` döner.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
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
 *               rollIds:
 *                 type: array
 *                 minItems: 1
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200: { description: İş tamamlandı (veya idempotent tekrar) }
 *       400: { description: Kurşun son adım değil / geçersiz gövde }
 *       401: { description: Yetkisiz }
 *       404: { description: Dağıtım kaydı bulunamadı }
 *       409: { description: Kapsam değişmiş, adıma yeni top girmiş ya da iş emri ölü }
 *       500: { description: Sunucu hatası }
 */
router.post("/:id/complete", verifyToken, canDistribute, controller.complete);

export default router;
