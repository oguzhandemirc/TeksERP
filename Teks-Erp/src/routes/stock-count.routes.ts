// =============================================================================
// TAM STOK SAYIMI ROTALARI (2026-08-15, J2 #19)
// =============================================================================
// ⚠️ HER uç İKİ kapıdan geçer: `requireTicaretEnabled` (bu kurulum ticaret
// paketini kullanıyor mu — 2026-09-02'de `requireFinanceEnabled`ten taşındı)
// + `requirePermission` (bu kişi bunu yapabilir mi).
// Bayrak kapısını atlayan tek bir uç, fabrikada modülü fiilen açık bırakır —
// ve bu servis iplik defterine yazıyor, yani fabrika sıfır-fark garantisi
// doğrudan buradan kırılırdı.
//
// ⚠️ YENİ İZİN KODU YOK (bilinçli). Üç mevcut izin, üç farklı soruyu yanıtladığı
// için seçildi:
//   • `warehouse:read`     → OKUMA. Sayımı okumak depoyu okumaktır.
//   • `warehouse:transfer` → ÇALIŞMA KÂĞIDI (aç · işaretle · iptal et). Bu adım
//     hiçbir deftere yazmaz; taşıma yetkisiyle aynı sınıf bir depo işidir.
//     `warehouse:write` BİLİNÇLE SEÇİLMEDİ: o "depo TANIMI" iznidir ve
//     kataloğun kendi gerekçesi ("depo ADINI düzeltebilen herkesin STOK
//     TAŞIYABİLMESİ istenmiyor") burada da aynen geçerlidir.
//   • `roll:manual-adjust` + `yarn:write` → TAMAMLAMA. Fark fişi TOPLARI
//     kayıttan düşer ve İPLİK defterine yazar; iki middleware zinciri VE
//     anlamındadır ve tam olarak dokunduğu iki defteri temsil eder.
//     Süpervizör yetkisi olmadan stok yazılamaz (SoD).
//
// ⚠️ TAMAMLAMA İZNİ PAYLOAD'A GÖRE DEĞİŞMEZ: "iplik satırı yoksa `yarn:write`
// aranmasın" cazip ama YANLIŞ — yetkinin belgenin İÇERİĞİNE göre değişmesi,
// aynı kullanıcının bir sayımı tamamlayıp diğerinde 403 almasına yol açar ve
// sebebi hiçbir ekranda yazmaz. Yetki BELGEYE verilir, satırına değil.
//
// ⚠️ AYRI ROUTER (warehouse.routes'a eklenmedi): sayımın kendi yaşam döngüsü
// (DRAFT → COMPLETED/CANCELLED) ve kendi belgesi var — `cheque.routes` /
// `reconciliation-letter.routes` emsali.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireTicaretEnabled } from "../middlewares/module.middleware";
import { stockCountService } from "../services/stock-count.service";
import { resolveRangeEnd, resolveRangeStart } from "../constants/time";

const router = Router();

// Modül kapısı — bu router'daki HER uç için.
router.use(verifyToken, requireTicaretEnabled);

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());
const statusEnum = z.enum(["DRAFT", "COMPLETED", "CANCELLED"]);

/**
 * ⚠️ HER TARİH SINIRI BURADAN GEÇER — bu router'da `new Date(...)` ile ELLE
 * tarih kurma. Gün-yalnız değer (`2026-08-15`) ECMAScript'te UTC gece
 * yarısıdır, yani Europe/Istanbul'da bir gün sınırı DEĞİL; liste süzgeci o
 * günün sayımlarını sessizce dışarıda bırakırdı. Sözleşme: `constants/time`.
 */
const endBoundary = (v: string | undefined): Date | undefined =>
  v === undefined ? undefined : resolveRangeEnd(v);
const startBoundary = (v: string | undefined): Date | undefined =>
  v === undefined ? undefined : resolveRangeStart(v);

/**
 * @openapi
 * /api/stock-counts:
 *   get:
 *     tags: [StockCount]
 *     summary: Stok sayımları (offset sayfalama — düşük hacimli belge)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sayfalanmış liste }
 *       403: { description: Ticaret modülü kapalı ya da yetki yok }
 */
router.get("/", requirePermission("warehouse:read"), async (req, res, next) => {
  try {
    const q = z
      .object({
        page: z.coerce.number().int().positive().optional(),
        pageSize: z.coerce.number().int().positive().max(200).optional(),
        warehouseId: z.string().uuid().optional(),
        status: statusEnum.optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        search: z.string().max(120).optional(),
      })
      .parse(req.query);

    const result = await stockCountService.list({
      ...q,
      from: startBoundary(q.from),
      to: endBoundary(q.to),
    });
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/stock-counts/{id}:
 *   get:
 *     tags: [StockCount]
 *     summary: Sayım detayı — satırlarıyla (sayım ekranının veri kaynağı)
 *     description: >
 *       Resmi rakam DONMUŞ belgededir (`/api/printed-documents/STOCK_COUNT/{id}/current`).
 *       Bu uç ekran içindir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sayım + satırlar }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", requirePermission("warehouse:read"), async (req, res, next) => {
  try {
    res.json(await stockCountService.findById(req.params.id as string));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/stock-counts:
 *   post:
 *     tags: [StockCount]
 *     summary: Sayım aç — depo fotoğrafı AYNI transaction'da satırlara yazılır
 *     description: >
 *       Depodaki sayılabilir toplar (STOCK / WAREHOUSE / A1_STOCK, sevkiyata
 *       atanmamış) ROLL satırı, sıfır olmayan iplik bakiyeleri YARN satırı olur.
 *       Hiçbir deftere yazmaz. Aynı depoda ikinci açık sayım 409.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [warehouseId]
 *             properties:
 *               warehouseId: { type: string, format: uuid }
 *               notes: { type: string, maxLength: 500, nullable: true }
 *     responses:
 *       201: { description: Sayım açıldı (DRAFT + satır fotoğrafı) }
 *       400: { description: Depo bulunamadı ya da pasif }
 *       409: { description: Bu depoda zaten açık sayım var }
 */
router.post("/", requirePermission("warehouse:transfer"), async (req, res, next) => {
  try {
    const b = z
      .object({
        warehouseId: z.string().uuid(),
        notes: z.string().max(500).nullable().optional(),
      })
      .strict()
      .parse(req.body);

    res.status(201).json(await stockCountService.create(b, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/stock-counts/{id}/lines/{lineId}:
 *   patch:
 *     tags: [StockCount]
 *     summary: Sayım satırını işaretle (yalnız DRAFT)
 *     description: >
 *       `found` ÜÇ DURUMLUDUR: `true` bulundu · `false` BULUNAMADI (tamamlamada
 *       top kayıttan düşülür) · `null` henüz sayılmadı. ROLL satırında
 *       `countedQty` BİLGİ NOTUDUR — metraj düzeltmesi ayrı bir akıştır
 *       (`POST /api/rolls/{id}/adjust-qty`). YARN satırında `countedQty` farkın
 *       kaynağıdır.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Satır güncellendi }
 *       404: { description: Satır bulunamadı }
 *       409: { description: Sayım artık taslak değil }
 */
router.patch(
  "/:id/lines/:lineId",
  requirePermission("warehouse:transfer"),
  async (req, res, next) => {
    try {
      const b = z
        .object({
          found: z.boolean().nullable().optional(),
          countedQty: z.union([z.number(), z.string().max(32)]).nullable().optional(),
          notes: z.string().max(300).nullable().optional(),
        })
        .strict()
        .parse(req.body);

      res.json(
        await stockCountService.markLine(
          {
            stockCountId: req.params.id as string,
            lineId: req.params.lineId as string,
            ...b,
          },
          req.user?.userId,
        ),
      );
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/stock-counts/{id}/mark-all-found:
 *   post:
 *     tags: [StockCount]
 *     summary: Sayılmamış TÜM top satırlarını "bulundu" yap
 *     description: >
 *       ⚠️ Yalnız BULUNDU yönünde çalışır — toplu "hepsi eksik" tek tuşla
 *       deponun tamamını kayıttan düşürürdü. Zaten işaretli satıra dokunmaz.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Güncellenen satır sayısı }
 *       409: { description: Sayım artık taslak değil }
 */
router.post(
  "/:id/mark-all-found",
  requirePermission("warehouse:transfer"),
  async (req, res, next) => {
    try {
      res.json(await stockCountService.markAllFound(req.params.id as string, req.user?.userId));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/stock-counts/{id}/complete:
 *   post:
 *     tags: [StockCount]
 *     summary: Sayımı tamamla — FARK FİŞİ + donmuş belge (tek transaction)
 *     description: >
 *       Eksik işaretli toplar KAYIT DÜZELTMESİ olarak iptal edilir (`qtyOut=0`
 *       storno + sapma defteri; FİRE DEĞİL), sayılan iplik kalemlerinde fark
 *       ADJUST_IN/ADJUST_OUT olarak yazılır ve belge aynı tx'te donar.
 *       Bu sırada taşınmış/sevk edilmiş satırlar İPTAL EDİLMEZ, "kapsam dışı"
 *       olarak sebebiyle belgeye yazılır. TERMİNALDİR — geri alınamaz.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Tamamlandı (fark fişi yazıldı, belge v1 ACTIVE) }
 *       400: { description: Eksik satır sayısı üst sınırı aşıyor }
 *       409: { description: Sayım zaten tamamlanmış/iptal edilmiş }
 */
router.post(
  "/:id/complete",
  // İki middleware = VE. Fark fişi iki deftere yazar; ikisinin de yetkisi aranır.
  requirePermission("roll:manual-adjust"),
  requirePermission("yarn:write"),
  async (req, res, next) => {
    try {
      res.json(await stockCountService.complete(req.params.id as string, req.user?.userId));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/stock-counts/{id}/cancel:
 *   post:
 *     tags: [StockCount]
 *     summary: Taslak sayımı iptal et (satırlar durur, belge doğmamıştır)
 *     description: >
 *       TAMAMLANMIŞ sayım iptal EDİLEMEZ (409): fark fişi iki deftere işledi ve
 *       geri alma yolu kendi ters kayıtlarıdır.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İptal edildi }
 *       404: { description: Bulunamadı }
 *       409: { description: Tamamlanmış ya da zaten iptal edilmiş }
 */
router.post("/:id/cancel", requirePermission("warehouse:transfer"), async (req, res, next) => {
  try {
    const { reason } = z
      .object({ reason: z.string().max(300).optional() })
      .parse(req.body ?? {});
    res.json(await stockCountService.cancel(req.params.id as string, reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
