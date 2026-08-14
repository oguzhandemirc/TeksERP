// =============================================================================
// ÇEK / SENET TESLİM BORDROSU ROTALARI (2026-08-15, J2 #18)
// =============================================================================
// ⚠️ HER uç İKİ kapıdan geçer: `requireFinanceEnabled` + `requirePermission`.
//
// ⚠️ İZİN AYRIMI — okuma `finance:read`, yazma `finance:write` (`finance:cheque`
// DEĞİL) ve bu bilinçli: `finance:cheque` çekin DURUM MAKİNESİNİ oynatan
// geçişler içindir (tahsil · ciro · karşılıksız — cari deftere VE banka/kasa
// bakiyesine yazarlar, geri alınamazlar). Bordro yalnız KÂĞIT üretir; çekin
// durumuna, deftere ve bakiyeye DOKUNMAZ. Yazmayı `finance:cheque`e bağlamak,
// "teslim tutanağı bastırmak" isteyen kişiye çek tahsil etme yetkisi vermek
// olurdu — görev ayrılığının tersi.
//
// ⚠️ AYRI ROUTER, mount `/api/finance/cheque-delivery-notes`
// (`cheque.routes` emsali). `/api/finance/cheques` prefix'iyle ÇAKIŞMAZ:
// Express prefix eşleşmesi tam segment bazlıdır ("cheques" ≠
// "cheque-delivery-notes"), yine de `app.ts`te ikisi de `/api/finance`ten ÖNCE
// bağlanır (kendi kapısını taşıyan router kuralı).
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireFinanceEnabled } from "../middlewares/finance.middleware";
import { chequeDeliveryNoteService } from "../services/cheque-delivery-note.service";
import { resolveRangeEnd, resolveRangeStart } from "../constants/time";

const router = Router();

// Modül kapısı — bu router'daki HER uç için.
router.use(verifyToken, requireFinanceEnabled);

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());
const kindEnum = z.enum(["RECEIVED", "ISSUED"]);
const statusEnum = z.enum(["ACTIVE", "CANCELLED"]);

/**
 * ⚠️ TARİH SINIRLARI — `new Date(...)` ile ELLE kurma. Gün-yalnız değer
 * (`2026-07-31`) ECMAScript'te UTC gece yarısıdır; `lte` tarafında o günün
 * neredeyse tamamını, `gte` tarafında gece vardiyasını sessizce düşürür.
 * Sözleşme + gerekçe: `constants/time`. (`deliveryDate` bir SINIR değil bir
 * OLAY ANIDIR — `Payment.paymentDate` emsali; gün-yalnız gelirse o günün başı
 * meşru bir okumadır ve belge yalnız GÜNÜ basar.)
 */
const endBoundary = (v: string | undefined): Date | undefined =>
  v === undefined ? undefined : resolveRangeEnd(v);
const startBoundary = (v: string | undefined): Date | undefined =>
  v === undefined ? undefined : resolveRangeStart(v);

/**
 * @openapi
 * /api/finance/cheque-delivery-notes:
 *   get:
 *     tags: [Finance]
 *     summary: Çek/senet teslim bordroları (offset sayfalama — düşük hacimli belge)
 *     description: >
 *       `from`/`to` TESLİM tarihine göre süzer. Satırda kıymet adedi
 *       (`_count.items`) döner — snapshot JSON'u çekilmeden.
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
        kind: kindEnum.optional(),
        status: statusEnum.optional(),
        cariId: z.string().uuid().optional(),
        bankAccountId: z.string().uuid().optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        search: z.string().max(120).optional(),
      })
      .parse(req.query);

    const result = await chequeDeliveryNoteService.list({
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
 * /api/finance/cheque-delivery-notes/{id}:
 *   get:
 *     tags: [Finance]
 *     summary: Bordro detayı — çekler CANLI durumlarıyla + para birimi bazlı toplam
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Bordro + satırlar + ara toplamlar }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", requirePermission("finance:read"), async (req, res, next) => {
  try {
    res.json(await chequeDeliveryNoteService.findById(req.params.id as string));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheque-delivery-notes:
 *   post:
 *     tags: [Finance]
 *     summary: Teslim bordrosu düzenle (belge OLUŞTURMADA donar)
 *     description: >
 *       ⚠️ ÇEKİN DURUMUNA DOKUNMAZ (v1 belge-only): "bankaya verdim" / "ciro
 *       ettim" olayları kendi uçlarından geçer. Üç kural fail-closed uygulanır:
 *       bir bordro TEK YÖN taşır (aldığımız ⊻ verdiğimiz) · iptal edilmiş kayıt
 *       giremez · hedef banka VEYA cari olabilir (ikisi birden değil, ikisi de
 *       opsiyonel; serbest metin `targetLabel` yanlarına yazılır).
 *       Farklı para birimleri TOPLANMAZ — belgede para birimi bazlı ara toplam
 *       basılır, tek TOPLAM yalnız liste tek para birimindeyse yazılır.
 *       Seçimdeki bir kıymet ZATEN AKTİF bir bordrodaysa uç 409
 *       (`code: ALREADY_IN_ACTIVE_NOTE`) döner — ENGEL DEĞİL ONAYLATMA:
 *       `confirmDuplicate: true` ile geçilir (aynı çek meşru olarak yeniden
 *       teslim edilebilir; yanlışlıkla ikinci resmi belge kesmek ise sessiz
 *       kalmamalı).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [chequeIds]
 *             properties:
 *               chequeIds: { type: array, minItems: 1, maxItems: 500, items: { type: string, format: uuid } }
 *               deliveryDate: { type: string, format: date-time }
 *               bankAccountId: { type: string, format: uuid, nullable: true }
 *               cariId: { type: string, format: uuid, nullable: true }
 *               targetLabel: { type: string, maxLength: 200, nullable: true }
 *               notes: { type: string, maxLength: 500, nullable: true }
 *               confirmDuplicate: { type: boolean, description: "Aktif bordro uyarısını onayla" }
 *     responses:
 *       201: { description: Bordro düzenlendi (belge v1 ACTIVE) }
 *       400: { description: Boş seçim / bulunamayan çek / iptal edilmiş kayıt / karışık yön / çift hedef }
 *       409: { description: "Seçimdeki kıymet(ler) zaten aktif bir bordroda — confirmDuplicate ile geçilir" }
 */
router.post("/", requirePermission("finance:write"), async (req, res, next) => {
  try {
    const b = z
      .object({
        // ⚠️ TAVAN 500: tek bir teslim tutanağı için fazlasıyla geniş, ama
        // sınırsız bırakmak tek istekle on binlerce pivot satırı yazdırırdı.
        chequeIds: z.array(z.string().uuid()).min(1).max(500),
        deliveryDate: isoDate.optional(),
        bankAccountId: z.string().uuid().nullable().optional(),
        cariId: z.string().uuid().nullable().optional(),
        targetLabel: z.string().max(200).nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
        // "Zaten aktif bir bordroda" uyarısını gördüm, yine de kes.
        confirmDuplicate: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);

    res.status(201).json(
      await chequeDeliveryNoteService.create(
        { ...b, deliveryDate: b.deliveryDate ? new Date(b.deliveryDate) : undefined },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheque-delivery-notes/{id}/cancel:
 *   post:
 *     tags: [Finance]
 *     summary: Bordroyu iptal et (kayıt ve satırlar silinmez, belge VOIDED)
 *     description: >
 *       Çekin durumu bordro kesilirken DEĞİŞMEMİŞTİ → iptalde geri alınacak bir
 *       şey yok. Pivot satırları KALIR: "hangi çekler bu bordrodaydı" sorusunun
 *       cevabı iptalden sonra da gerekir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İptal edildi }
 *       404: { description: Bulunamadı }
 *       409: { description: Zaten iptal edilmiş }
 */
router.post("/:id/cancel", requirePermission("finance:write"), async (req, res, next) => {
  try {
    const { reason } = z
      .object({ reason: z.string().max(300).optional() })
      .parse(req.body ?? {});
    res.json(
      await chequeDeliveryNoteService.cancel(req.params.id as string, reason, req.user?.userId),
    );
  } catch (e) {
    next(e);
  }
});

export default router;
