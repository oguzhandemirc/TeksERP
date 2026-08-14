// =============================================================================
// CARİ MUTABAKAT MEKTUBU ROTALARI (2026-08-15, J2 #18)
// =============================================================================
// ⚠️ HER uç İKİ kapıdan geçer: `requireFinanceEnabled` (bu kurulum bu modülü
// kullanıyor mu) + `requirePermission` (bu kişi bunu yapabilir mi). Bayrak
// kapısını atlayan tek bir uç, fabrikada modülü fiilen açık bırakır.
//
// ⚠️ YENİ İZİN KODU YOK (bilinçli). Mutabakat mektubu cari defterin bir
// OKUMASINI resmileştirir; para/stok/defter oynatmaz. Okuma `finance:read`
// ("TUTAR GÖRME kapısı" — ekstreyi zaten o izin açıyor), yazma `finance:write`.
// `finance:invoice`/`finance:payment` gibi görev-ayrılığı izinleri deftere
// YAZAN işler içindir; buraya bağlamak, mektup kesebilmek için birine fatura
// onaylama yetkisi vermek olurdu.
//
// ⚠️ AYRI ROUTER (finance.routes'a eklenmedi): `finance.routes` zaten dört alt
// alan taşıyor ve mutabakat mektubu kendi yaşam döngüsü olan bir BELGEdir
// (`cheque.routes` emsali). Mount `/api/finance/reconciliation-letters` —
// istemci için tek "finance" ağacı görünür.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireFinanceEnabled } from "../middlewares/finance.middleware";
import { reconciliationLetterService } from "../services/reconciliation-letter.service";
import { resolveRangeEnd, resolveRangeStart } from "../constants/time";

const router = Router();

// Modül kapısı — bu router'daki HER uç için.
router.use(verifyToken, requireFinanceEnabled);

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());
const statusEnum = z.enum(["ACTIVE", "CANCELLED"]);

/**
 * ⚠️ HER TARİH SINIRI BURADAN GEÇER (`asOf`, liste `from`/`to`) — bu router'da
 * `new Date(...)` ile ELLE tarih kurma.
 *
 * `isoDate` bilerek gün-yalnız biçimi de kabul ediyor (`2026-07-31`); ama o
 * biçim ECMAScript'te UTC gece yarısıdır, yani Europe/Istanbul'da bir gün
 * sınırı DEĞİL, günün içinde rastgele bir andır. `asOf` için sonuç şudur:
 * "31 Temmuz itibarıyla" yazan DONMUŞ bir resmi belge o günün hareketlerini
 * SESSİZCE dışarıda bırakır. Sözleşme + gerekçe: `constants/time`.
 */
const endBoundary = (v: string | undefined): Date | undefined =>
  v === undefined ? undefined : resolveRangeEnd(v);
const startBoundary = (v: string | undefined): Date | undefined =>
  v === undefined ? undefined : resolveRangeStart(v);

/**
 * @openapi
 * /api/finance/reconciliation-letters:
 *   get:
 *     tags: [Finance]
 *     summary: Mutabakat mektupları (offset sayfalama — düşük hacimli belge)
 *     description: >
 *       `from`/`to` DÜZENLEME tarihine (createdAt) göre süzer; bakiye kesiti
 *       (`asOf`) satırda ayrıca döner ve farklı bir gün olabilir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sayfalanmış liste }
 *       403: { description: Ön muhasebe modülü kapalı ya da yetki yok }
 */
router.get("/", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const q = z
      .object({
        page: z.coerce.number().int().positive().optional(),
        pageSize: z.coerce.number().int().positive().max(200).optional(),
        cariId: z.string().uuid().optional(),
        status: statusEnum.optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        search: z.string().max(120).optional(),
      })
      .parse(req.query);

    const result = await reconciliationLetterService.list({
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
 * /api/finance/reconciliation-letters/{id}:
 *   get:
 *     tags: [Finance]
 *     summary: Mutabakat mektubu detayı (bakiye satırları CANLI türetilir)
 *     description: >
 *       Resmi rakam DONMUŞ belgededir (`/api/printed-documents/
 *       RECONCILIATION_LETTER/{id}/current`). Bu uçtaki satırlar ekran içindir;
 *       geçmişe tarihli bir hareket sonradan girilirse ikisi ayrışabilir ve o
 *       fark bir HATA değil revizyon (`reissue`) sinyalidir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Mektup + para birimi bazlı bakiye satırları }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", requirePermission("finance:read"), async (req, res, next) => {
  try {
    res.json(await reconciliationLetterService.findById(req.params.id as string));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/reconciliation-letters:
 *   post:
 *     tags: [Finance]
 *     summary: Mutabakat mektubu düzenle (belge OLUŞTURMADA donar)
 *     description: >
 *       Bakiyeler `cari_transactions`tan `txnDate <= asOf` ile TÜRETİLİR
 *       (`cari_balances` OKUNMAZ — o BUGÜNKÜ bakiyedir, `asOf` keyfî olabilir).
 *       Sıfır bakiyeli ama hareketli para birimi de satır olarak basılır.
 *       Defter/kasa/bakiye OYNAMAZ.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cariId]
 *             properties:
 *               cariId: { type: string, format: uuid }
 *               asOf:
 *                 type: string
 *                 description: >
 *                   Bakiye kesiti (DAHİL) — verilmezse şimdi. GÜN-YALNIZ değer
 *                   (`2026-07-31`) o günün SONUNA çözülür: "31 Temmuz itibarıyla"
 *                   denince 31 Temmuz'un hareketleri belgeye GİRER. Tam ISO
 *                   damgası aynen kullanılır.
 *               notes: { type: string, maxLength: 500, nullable: true }
 *     responses:
 *       201: { description: Mektup düzenlendi (belge v1 ACTIVE) }
 *       400: { description: Cari bulunamadı }
 *       409: { description: Cari hesap pasif }
 */
router.post("/", requirePermission("finance:write"), async (req, res, next) => {
  try {
    const b = z
      .object({
        cariId: z.string().uuid(),
        asOf: isoDate.optional(),
        notes: z.string().max(500).nullable().optional(),
      })
      .strict()
      .parse(req.body);

    res.status(201).json(
      await reconciliationLetterService.create(
        // ⚠️ `endBoundary` — `new Date(b.asOf)` DEĞİL. Gün-yalnız değerde ham
        // dönüşüm UTC gece yarısı verir ve DONMUŞ belge o günün hareketlerini
        // sessizce dışarıda bırakır (dosya başındaki gerekçe).
        { ...b, asOf: endBoundary(b.asOf) },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/reconciliation-letters/{id}/cancel:
 *   post:
 *     tags: [Finance]
 *     summary: Mutabakat mektubunu iptal et (kayıt silinmez, belge VOIDED)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İptal edildi — belge İPTAL filigranıyla basılabilir }
 *       404: { description: Bulunamadı }
 *       409: { description: Zaten iptal edilmiş }
 */
router.post("/:id/cancel", requirePermission("finance:write"), async (req, res, next) => {
  try {
    const { reason } = z
      .object({ reason: z.string().max(300).optional() })
      .parse(req.body ?? {});
    res.json(
      await reconciliationLetterService.cancel(req.params.id as string, reason, req.user?.userId),
    );
  } catch (e) {
    next(e);
  }
});

export default router;
