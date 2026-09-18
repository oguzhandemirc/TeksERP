// =============================================================================
// İPLİK KG-STOK ROTALARI (Paket D1)
// =============================================================================
// ⚠️ HER uç İKİ kapıdan geçer: `requireIplikEnabled` (bu kurulum iplik
// modülünü kullanıyor mu) + `requirePermission` (bu kişi bunu yapabilir mi).
// ⚠️ Kapı 2026-09-02'de `requireFinanceEnabled`ten TAŞINDI ve BAĞIMLIDIR:
// `requireIplikEnabled` önce TİCARETİ ölçer (iplik ticaret paketinin parçası),
// ticaret kapalıysa 403 mesajı eksik olan anahtarı — ticareti — söyler.
// Bayrak kapısını atlayan TEK bir uç, fabrikada modülü fiilen açık bırakır ve
// "sıfır-fark" garantisi oradan sızar (adresi bilen ya da eski sekmesi açık
// kalan kullanıcı yine yazar).
//
// ⚠️ OKUMA İZNİ YENİ DEĞİL — `warehouse:read`. İplik stoğu bir DEPO sorusudur
// ("depoda ne var"); ayrı bir `yarn:read` açmak, kurulumda atanması unutulacak
// bir adım daha demekti ve depocu kendi deposunu göremezdi. YAZMA ayrı bir
// yetkidir (`yarn:write`): stok hareketi yazmak defteri değiştirir.
//
// ⚠️ DÜZELTME/SİLME UCU YOK ve EKLENMEZ: defter append-only'dir, yanlış giriş
// ters kayıtla (ADJUST_OUT/ADJUST_IN) kapatılır. Bir `PATCH /movements/:id`
// eklemek geçmişi yeniden yazmak olurdu.
// =============================================================================
import { YarnLotQualityStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireIplikEnabled } from "../middlewares/module.middleware";
import { yarnService } from "../services/yarn.service";
import { yarnLotService } from "../services/yarn-lot.service";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { readFilterList } from "../utils/query-parser";

const router = Router();

// Modül kapısı — bu router'daki HER uç için.
router.use(verifyToken, requireIplikEnabled);

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

/**
 * Tekil UUID **ya da** virgüllü UUID listesi (`FilterBar` çoklu seçim sözleşmesi).
 *
 * ⚠️ NEDEN DOĞRULANIR: ham metin doğrudan Prisma'ya giderse uuid kolonunda
 * P2007 doğar ve `error.middleware` onu jenerik *"Geçersiz veri formatı (örn.
 * hatalı ID)"* 400'üne çevirir — HANGİ alanın hatalı olduğu hiçbir yerde
 * yazmaz. `.uuid()` ile doğrulamak aynı 400'ü ALANIN ADIYLA verir. Aynı ders
 * `/movements` ucunda uygulanmıştı; `/stocks` CSV desteklediği için atlanmıştı
 * ve tam da CSV'nin bir elemanı bozukken sessizleşiyordu.
 */
const uuidCsv = z
  .string()
  .refine(
    (v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .every((s) => z.string().uuid().safeParse(s).success),
    { message: "Geçersiz kimlik: tekil UUID ya da virgülle ayrılmış UUID listesi bekleniyor." },
  );

/**
 * @openapi
 * /api/yarn/stocks:
 *   get:
 *     tags: [Yarn]
 *     summary: İplik kg bakiyeleri (kalem × depo)
 *     description: >
 *       Bakiye EKSİ olabilir ve bu bilinçlidir — sayım girilmeden çıkış
 *       yapıldıysa eksik kayıt görünür kalmalıdır.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: itemId
 *         schema: { type: string }
 *         description: UUID ya da virgüllü UUID listesi
 *       - in: query
 *         name: warehouseId
 *         schema: { type: string }
 *       - in: query
 *         name: onlyNonZero
 *         schema: { type: boolean }
 *         description: Yalnız bakiyesi sıfır olmayan satırlar
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: Bakiye listesi + filtrenin kg toplamı }
 */
router.get("/stocks", requirePermission("warehouse:read"), async (req, res, next) => {
  try {
    const q = z
      .object({
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(200).optional(),
        itemId: uuidCsv.optional(),
        warehouseId: uuidCsv.optional(),
        onlyNonZero: z.enum(["true", "false"]).optional(),
        search: z.string().max(200).optional(),
      })
      .parse(req.query);

    res.json(
      await yarnService.listStocks({
        page: q.page,
        pageSize: q.pageSize,
        itemId: q.itemId,
        warehouseId: q.warehouseId,
        onlyNonZero: q.onlyNonZero === "true",
        search: q.search,
      }),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/yarn/movements:
 *   get:
 *     tags: [Yarn]
 *     summary: İplik hareket dökümü (cursor'lu)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, maximum: 200 }
 *       - in: query
 *         name: itemId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: warehouseId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: kind
 *         schema: { type: string, enum: [IN, OUT, ADJUST_IN, ADJUST_OUT, WARP_ISSUE, WARP_ISSUE_REVERSAL, WARP_RETURN, WARP_RETURN_REVERSAL, SUBCONTRACT_OUT, SUBCONTRACT_OUT_CANCEL, SUBCONTRACT_RETURN, SUBCONTRACT_RETURN_CANCEL] }
 *       - in: query
 *         name: goodsReceiptId
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
router.get("/movements", requirePermission("warehouse:read"), async (req, res, next) => {
  try {
    // ⚠️ UUID alanları `.uuid()` ile doğrulanır: ham CSV/serbest metin doğrudan
    // Prisma'ya giderse P2007 → 400 "Geçersiz veri formatı" olur ve sebebi
    // hiçbir yerde yazmaz (2026-08-12 Tambur filtre dersi).
    const q = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        itemId: z.string().uuid().optional(),
        warehouseId: z.string().uuid().optional(),
        // Liste süzgeci TÜM türleri tanır; WARP_* satırları yalnız levent yazıcısından doğar (create şeması onları KABUL ETMEZ).
        kind: z.enum(["IN", "OUT", "ADJUST_IN", "ADJUST_OUT", "WARP_ISSUE", "WARP_ISSUE_REVERSAL", "WARP_RETURN", "WARP_RETURN_REVERSAL", "SUBCONTRACT_OUT", "SUBCONTRACT_OUT_CANCEL", "SUBCONTRACT_RETURN", "SUBCONTRACT_RETURN_CANCEL"]).optional(),
        goodsReceiptId: z.string().uuid().optional(),
        lotId: z.string().uuid().optional(),
        dateFrom: isoDate.optional(),
        dateTo: isoDate.optional(),
      })
      .parse(req.query);

    res.json(
      await yarnService.listMovements({
        cursor: q.cursor,
        limit: q.limit,
        itemId: q.itemId,
        warehouseId: q.warehouseId,
        kind: q.kind,
        goodsReceiptId: q.goodsReceiptId,
        lotId: q.lotId,
        dateFrom: q.dateFrom ? new Date(q.dateFrom) : undefined,
        dateTo: q.dateTo ? new Date(q.dateTo) : undefined,
      }),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/yarn/movements:
 *   post:
 *     tags: [Yarn]
 *     summary: Elle iplik hareketi (giriş / çıkış / sayım düzeltmesi)
 *     description: >
 *       Miktar HER ZAMAN POZİTİFTİR; yönü `kind` söyler (DB CHECK ile kilitli).
 *       Çıkış bakiyeyi eksiye düşürse bile REDDEDİLMEZ — yazılır ve yanıt
 *       mesajında uyarı verilir. Yanlış kayıt SİLİNMEZ, ters kayıtla
 *       (ADJUST_OUT / ADJUST_IN) kapatılır.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Hareket yazıldı; yeni bakiye döner }
 */
router.post("/movements", requirePermission("yarn:write"), async (req, res, next) => {
  try {
    const body = z
      .object({
        itemId: z.string().uuid(),
        warehouseId: z.string().uuid(),
        kind: z.enum(["IN", "OUT", "ADJUST_IN", "ADJUST_OUT"]),
        // Sayı VEYA sayı-metni: panel input'u string gönderir ve `z.number()`
        // onu sessizce reddederdi.
        qtyKg: z.union([z.number().positive(), z.string().min(1)]),
        reason: z.string().max(300).nullable().optional(),
        // Devere Faz 2: lot etiketi opsiyonel; kalem uyumu + lot bakiyesi sunucuda.
        lotId: z.string().uuid().nullable().optional(),
      })
      // ⚠️ `.strict()`: `z.object` tanımadığı anahtarı SESSİZCE ATAR — panel
      // yeni bir alan gönderip backend onu düşürürse hata da log da çıkmaz
      // (2026-08-13 "kat sessizce düşüyordu" dersi).
      .strict()
      .parse(req.body);

    res.status(201).json(await yarnService.createMovement(body, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

// ── İPLİK LOTLARI (devere Faz 2) ─────────────────────────────────────────────
// İzin: liste `warehouse:read` (iplik stok listesiyle aynı), yazma `yarn:write` — yeni kod açılmadı (1e L3).

/**
 * @openapi
 * /api/yarn/lots:
 *   get:
 *     tags: [Yarn]
 *     summary: İplik lotları (cursor) — satırda TÜRETİLEN bakiye (Σ hareket), süzme kalem/tedarikçi/arama/aktiflik
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Lot sayfası }
 */
router.get("/lots", requirePermission("warehouse:read"), async (req, res, next) => {
  try {
    const q = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        itemId: z.string().uuid().optional(),
        supplierId: z.string().uuid().optional(),
        search: z.string().max(100).optional(),
        isActive: z.enum(["true", "false"]).optional(),
        /** Kalite durumu — CSV (`RELEASED,ON_HOLD`); tanınmayan değer Zod 400 (fail-closed). */
        qualityStatus: z.string().max(100).optional(),
      })
      .strict()
      .parse(req.query);
    const qualityStatus = z.array(z.nativeEnum(YarnLotQualityStatus)).parse(readFilterList(q.qualityStatus));
    res.json(await yarnLotService.list({ ...q, qualityStatus, isActive: q.isActive === undefined ? undefined : q.isActive === "true" }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/yarn/lots:
 *   post:
 *     tags: [Yarn]
 *     summary: Elle lot aç — `[kalem, lotNo]` tekil; lotNo irsaliye metni (TRIM, ayrıştırılmaz)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Lot açıldı }
 *       409: { description: YARN_LOT_EXISTS }
 */
router.post("/lots", requirePermission("yarn:write"), async (req, res, next) => {
  try {
    const body = z
      .object({
        itemId: z.string().uuid(),
        lotNo: z.string().max(64),
        supplierId: z.string().uuid().nullable().optional(),
        notes: z.string().max(300).nullable().optional(),
        /** G3 emanet: lotun sahibi (müşteri); yalnız açılışta — PATCH almaz (E2b). Emanet kapalıyken 403. */
        ownerCustomerId: z.string().uuid().nullable().optional(),
      })
      .strict()
      .parse(req.body ?? {});
    res.status(201).json(await yarnLotService.create(body, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/yarn/lots/{id}:
 *   patch:
 *     tags: [Yarn]
 *     summary: Lot notu / aktiflik / tedarikçi — lotNo ve kalem DEĞİŞMEZ (kimlik); silme yok, pasife alma
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Güncellendi }
 */
router.patch("/lots/:id", requirePermission("yarn:write"), async (req, res, next) => {
  try {
    const body = z
      .object({
        notes: z.string().max(300).nullable().optional(),
        isActive: z.boolean().optional(),
        supplierId: z.string().uuid().nullable().optional(),
      })
      .strict()
      .parse(req.body ?? {});
    res.json(await yarnLotService.update(assertValidUuid(req.params.id, "id"), body, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/yarn/lots/{id}/quality:
 *   patch:
 *     tags: [Yarn]
 *     summary: Lot kalite kararı — RELEASED / ON_HOLD / BLOCKED (karar damgalanır); izin `quality:write`, pasif lot 400
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Karar yazıldı }
 *       400: { description: YARN_LOT_INACTIVE }
 */
router.patch("/lots/:id/quality", requirePermission("quality:write"), async (req, res, next) => {
  try {
    const body = z
      .object({
        status: z.nativeEnum(YarnLotQualityStatus),
        note: z.string().max(300).nullable().optional(),
      })
      .strict()
      .parse(req.body ?? {});
    res.json(await yarnLotService.decideQuality(assertValidUuid(req.params.id, "id"), body, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
