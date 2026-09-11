// =============================================================================
// TeksERP — Depo (Warehouse) Routes
// =============================================================================
// Fiziksel depo tanımları. Tek depolu kurulumda (fabrika) arayüzde hiçbir depo
// yüzeyi çizilmez — bu uçlar yine çalışır, yalnız kimse çağırmaz. İkinci depo
// açıldığı an tüm depo yüzeyleri kendiliğinden belirir.
// =============================================================================

import { Router } from "express";
import { z } from "zod";
import { WarehouseEventType } from "@prisma/client";
import { BaseController } from "../controllers/base.controller";
import { warehouseService } from "../services/warehouse.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

const controller = new BaseController(warehouseService);
const router = Router();

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

/**
 * @openapi
 * /api/warehouses:
 *   get:
 *     tags: [Warehouses]
 *     summary: Depo listesi
 *     description: >
 *       Aktif depolar seçicilerde çıkar. İSTEMCİ KURALI — depo sayısı 1 ise depo
 *       seçici/kolon/filtre çizilmez (tek depolu kurulumda görünür fark olmamalı).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string, enum: [true, false] }
 *     responses:
 *       200: { description: Sayfalanmış depo listesi }
 */
router.get(
  "/",
  verifyToken,
  // Depo seçicisi mal kabul / transfer / envanter ekranlarında da açılıyor →
  // salt-okuma yetkisi geniş tutulur (yazma dar kalır).
  requireAnyPermission("warehouse:read", "warehouse:write", "warehouse:transfer", "goods-receipt:read", "goods-receipt:write", "roll:read"),
  controller.findAll,
);

/**
 * @openapi
 * /api/warehouses/movements:
 *   get:
 *     tags: [Warehouses]
 *     summary: Depo hareket dökümü (cursor'lu)
 *     description: >
 *       Append-only depo defteri — "mal hangi depoya girdi / hangisinden çıktı".
 *       İplik defterinin (`GET /api/yarn/movements`) ikizidir; DÜZELTME/SİLME ucu
 *       YOKTUR ve eklenmeyecek (yanlış satır ters olayla kapanır).
 *       `warehouseId` verilirse her satır o depoya göre `direction` (IN/OUT)
 *       taşır; verilmezse `direction` null'dur (hangi depodan bakıldığı belirsiz).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, maximum: 200 }
 *       - in: query
 *         name: warehouseId
 *         schema: { type: string, format: uuid }
 *         description: Bu depoya DOKUNAN hareketler (giren VEYA çıkan)
 *       - in: query
 *         name: eventType
 *         schema:
 *           type: string
 *           enum: [ENTRY, TRANSFER, TRANSFER_REVERSAL, SHIPMENT, SHIPMENT_REVERSAL, RETURN, CANCEL, CANCEL_REVERSAL]
 *       - in: query
 *         name: rollId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: sackId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200: { description: Hareket sayfası + nextCursor }
 */
// ⚠️ `/:id`'DEN ÖNCE (`/stats` emsali): sonra kaydedilseydi Express "movements"ı
// path param sanar ve uç ya 404 ya P2007 verirdi.
//
// ⚠️ REJİM KAPISI BİLEREK YOK — gerekçe `warehouse.service.ts` başlığında:
// defteri fabrika yolları da yazıyor (KK1 girişi · top iptali · sevk · iade),
// kapı koymak fabrikada YAZILAN defteri fabrikada OKUNAMAZ yapardı.
// ⚠️ Kardeş `/api/warehouse-transfers/*` 2026-09-02'den beri KAPILI
// (`requireDepoMultiEnabled`) — burası "depo tanımı/defteri", orası "çoklu
// depo yüzeyi". Bu satırı okuyup transferdeki kapıyı tutarsızlık sanma.
//
// ⚠️ UUID alanları `.uuid()` ile doğrulanır: ham CSV/serbest metin doğrudan
// Prisma'ya giderse P2007 doğar ve `error.middleware` onu jenerik "Geçersiz veri
// formatı" 400'üne çevirir — HANGİ alanın hatalı olduğu hiçbir yerde yazmaz.
router.get(
  "/movements",
  verifyToken,
  // Okuma geniş: transfer yapan kişi de defteri görebilmeli (transfer detayının
  // kendisi zaten defterden okunuyor). Yazma yetkisi okumayı KAPSAR.
  requireAnyPermission("warehouse:read", "warehouse:write", "warehouse:transfer"),
  async (req, res, next) => {
    try {
      const q = z
        .object({
          cursor: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          warehouseId: z.string().uuid().optional(),
          eventType: z.nativeEnum(WarehouseEventType).optional(),
          rollId: z.string().uuid().optional(),
          sackId: z.string().uuid().optional(),
          dateFrom: isoDate.optional(),
          dateTo: isoDate.optional(),
        })
        .parse(req.query);

      res.json(
        await warehouseService.listMovements({
          cursor: q.cursor,
          limit: q.limit,
          warehouseId: q.warehouseId,
          eventType: q.eventType,
          rollId: q.rollId,
          sackId: q.sackId,
          // Gün sınırı İSTEMCİNİNDİR (yerel 00:00 / 23:59:59.999); backend
          // ekstra yuvarlama YAPMAZ, yoksa istemcinin niyeti iki kez yorumlanır.
          dateFrom: q.dateFrom ? new Date(q.dateFrom) : undefined,
          dateTo: q.dateTo ? new Date(q.dateTo) : undefined,
        }),
      );
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/warehouses/{id}:
 *   get:
 *     tags: [Warehouses]
 *     summary: Depo detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Depo detayı }
 *       404: { description: Bulunamadı }
 */
/**
 * @openapi
 * /api/warehouses/similar-names:
 *   get:
 *     tags: [Warehouses]
 *     summary: Benzer depo adları (mükerreri REDDETMEK yerine ÖNLEMEK)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: name
 *         schema: { type: string }
 *     responses:
 *       200: { description: Benzer adlar }
 */
// BENZER KAYITLAR (2026-09-01). Depo adı artık DB seddiyle TEKİLDİR
// (`warehouses_nameFold_key`) — uyarı olmadan kullanıcı mükerrer adı ancak
// KAYDEDERKEN, ham bir hata olarak öğrenirdi. `customer.routes` emsali.
// ⚠️ `/:id`den ÖNCE tanımlı olmalı; sonra gelirse Express "similar-names"i id
// sanar ve `uuid-param` middleware'i 400 döndürür.
// ⚠️ İzin WRITE: uç var olan adları listeler ve yalnız KAYIT AÇAN kişiye lazım.
router.get("/similar-names", verifyToken, requirePermission("warehouse:write"), controller.similarNames);

router.get(
  "/:id",
  verifyToken,
  requireAnyPermission("warehouse:read", "warehouse:write"),
  controller.findById,
);

/**
 * @openapi
 * /api/warehouses:
 *   post:
 *     tags: [Warehouses]
 *     summary: Yeni depo
 *     description: Kod backend'de üretilir (DP+GGAAYY+NNNN) — istemci kodu yok sayılır.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:    { type: string, example: "İkinci Depo" }
 *               address: { type: string }
 *               notes:   { type: string }
 *     responses:
 *       201: { description: Oluşturuldu }
 */
router.post("/", verifyToken, requirePermission("warehouse:write"), controller.create);

/**
 * @openapi
 * /api/warehouses/{id}:
 *   patch:
 *     tags: [Warehouses]
 *     summary: Depoyu güncelle
 *     description: VARSAYILAN depo pasife alınamaz (409) — kural cevapsız kalırdı.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Güncellendi }
 *       409: { description: Varsayılan depo pasife alınamaz }
 */
router.patch("/:id", verifyToken, requirePermission("warehouse:write"), controller.update);

/**
 * @openapi
 * /api/warehouses/{id}/default:
 *   post:
 *     tags: [Warehouses]
 *     summary: Bu depoyu VARSAYILAN yap
 *     description: >
 *       Depo söylenmeyen her giriş varsayılan depoya düşer. Tek tx: önce eski
 *       varsayılan düşürülür, sonra bu depo işaretlenir (ters sıra partial
 *       unique'e çarpar).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Varsayılan yapıldı }
 *       400: { description: Pasif depo varsayılan yapılamaz }
 *       404: { description: Bulunamadı }
 */
router.post("/:id/default", verifyToken, requirePermission("warehouse:write"), async (req, res, next) => {
  try {
    res.status(200).json(await warehouseService.setDefault(req.params.id as string, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warehouses/{id}:
 *   delete:
 *     tags: [Warehouses]
 *     summary: Depoyu pasife al
 *     description: Soft-delete. Varsayılan depo pasife alınamaz.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Pasife alındı }
 *       409: { description: Varsayılan depo }
 */
router.delete("/:id", verifyToken, requirePermission("warehouse:write"), controller.remove);

/**
 * @openapi
 * /api/warehouses/{id}/permanent:
 *   delete:
 *     tags: [Warehouses]
 *     summary: Depoyu KALICI sil
 *     description: >
 *       Yalnız hiç kaydı olmayan (top/fiş/transfer/hareket) ve varsayılan olmayan
 *       depo silinebilir. Bağımlılık varsa 409 + sayılar.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Kalıcı silindi }
 *       409: { description: Bağlı kayıt var / varsayılan depo }
 */
router.delete("/:id/permanent", verifyToken, requirePermission("warehouse:write"), controller.hardRemove);

export default router;
