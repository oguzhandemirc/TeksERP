// =============================================================================
// TeksERP — Bildirim uçları (`/api/bildirim/*`, plan §3.9 + §5.6 F1)
// =============================================================================
// İçeriksiz SSE zili (`/zil`) + uzun yoklama (`/bekle`) + gelen kutusu okuma/işaretleme. Uçlar kişisel:
// verifyToken yeter (izin kodu YOK), satır kapsamı servisteki `userId`. Bayrak kapalı → özet dışı 409
// `BILDIRIM_KAPALI`. `/zil` sıkıştırmadan muaftır (app.ts filtresi), `/zil` + `/bekle` gecikme ölçümünden.
// =============================================================================
import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import * as c from "../controllers/bildirim.controller";

const router = Router();
router.use(verifyToken);

/**
 * @openapi
 * /api/bildirim/zil:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'İçeriksiz SSE zil akışı (text/event-stream) — `merhaba {epoch,rev,alarmRev}`, sonra `zil {k,rev,alarmRev}`, 25 sn `: ping`'
 *     description: 'Akış bildirim İÇERİĞİ taşımaz; istemci zili duyunca `/api/bildirim/ozet` ve `/api/bildirim` okur. Kullanıcı başı 5 akış (6.''da en eski kapanır), genel 500.'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "SSE akışı", content: { text/event-stream: { schema: { type: string } } } }
 *       401: { description: Oturum yok }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 *       503: { description: Genel bağlantı tavanı dolu (BILDIRIM_ZIL_DOLU) ya da sunucu kapanıyor }
 */
router.get("/zil", c.getBellStream);

/**
 * @openapi
 * /api/bildirim/bekle:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'Uzun yoklama (SSE kurulamazsa) — bilinen sürüm güncelse ≤25 sn bekler, zil gelince hemen döner'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: rev, required: false, schema: { type: integer, minimum: 0 } }
 *       - { in: query, name: alarmRev, required: false, schema: { type: integer, minimum: 0 } }
 *       - { in: query, name: epoch, required: false, schema: { type: integer, minimum: 0 } }
 *     responses:
 *       200: { description: "{epoch, rev, alarmRev, degisti}" }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.get("/bekle", c.getWait);

/**
 * @openapi
 * /api/bildirim/ozet:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'Zil özeti — `{enabled, okunmamis, alarmAcik, vardiyaBitis, epoch, rev, alarmRev}` (vardiyaBitis: süren vardiyanın bitişi ya da null); bayrak kapalı → `{enabled:false}`'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Özet }
 */
router.get("/ozet", c.getSummary);

/**
 * @openapi
 * /api/bildirim/katalog:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'Kişinin görebildiği bildirim türleri (F1 — tercihsiz)'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{turler: [...]}" }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.get("/katalog", c.getCatalog);

/**
 * @openapi
 * /api/bildirim:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'Gelen kutusu listesi — liste, cursor ve `sayi` aynı where''den; izni gitmiş tür görünmez'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: sekme, required: false, schema: { type: string, enum: [tumu, okunmamis, alarmlar, ertelenen] } }
 *       - { in: query, name: cursor, required: false, schema: { type: string } }
 *       - { in: query, name: limit, required: false, schema: { type: integer, minimum: 1, maximum: 100 } }
 *       - { in: query, name: "filter[tur]", required: false, schema: { type: string }, description: "Katalog tür kodları (CSV)" }
 *     responses:
 *       200: { description: "{items, nextCursor, sayi, epoch, rev, alarmRev}" }
 *       400: { description: Geçersiz sekme/imleç/süzgeç }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.get("/", c.getList);

/**
 * @openapi
 * /api/bildirim/tumunu-okundu:
 *   post:
 *     tags: [Bildirim]
 *     summary: 'Okunmamış sekmesinin tamamını okundu yap; dönen `ids` geri al için'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ids}" }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.post("/tumunu-okundu", c.postReadAll);

/**
 * @openapi
 * /api/bildirim/geri-al-okundu:
 *   post:
 *     tags: [Bildirim]
 *     summary: '"Tümünü okundu"yu geri al — verilen kendi satırlarını yeniden okunmamış yapar'
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [ids], properties: { ids: { type: array, maxItems: 500, items: { type: string, format: uuid } } } }
 *     responses:
 *       200: { description: "{ids} — gerçekten geri alınanlar" }
 *       400: { description: Geçersiz gövde }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.post("/geri-al-okundu", c.postUndoRead);

/**
 * @openapi
 * /api/bildirim/{id}/okundu:
 *   post:
 *     tags: [Bildirim]
 *     summary: 'Okundu işaretle (atomik; zaten okunmuşsa `{degisti:false}`)'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{degisti}" }
 *       404: { description: Kişinin görünür satırı değil (BILDIRIM_YOK) }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.post("/:id/okundu", c.postRead);

/**
 * @openapi
 * /api/bildirim/{id}/okunmadi:
 *   post:
 *     tags: [Bildirim]
 *     summary: 'Okunmadı işaretle (atomik; zaten okunmamışsa `{degisti:false}`)'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{degisti}" }
 *       404: { description: Kişinin görünür satırı değil (BILDIRIM_YOK) }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.post("/:id/okunmadi", c.postUnread);

/**
 * @openapi
 * /api/bildirim/{id}/ertele:
 *   post:
 *     tags: [Bildirim]
 *     summary: 'Ertele — 1 saat · yarın sabah (fabrika günü 08:00) · vardiya sonu'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [sure], properties: { sure: { type: string, enum: ["1s", yarin-sabah, vardiya-sonu] } } }
 *     responses:
 *       200: { description: "{erteleBitis}" }
 *       400: { description: Geçersiz süre ya da süren vardiya yok (VARDIYA_YOK) }
 *       404: { description: Kişinin görünür satırı değil (BILDIRIM_YOK) }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.post("/:id/ertele", c.postSnooze);

export default router;
