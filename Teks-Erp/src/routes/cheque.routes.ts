// =============================================================================
// ÇEK / SENET PORTFÖY ROTALARI (Paket C1)
// =============================================================================
// ⚠️ HER uç İKİ kapıdan geçer: `requireFinanceEnabled` (bu kurulum bu modülü
// kullanıyor mu) + `requirePermission` (bu kişi bunu yapabilir mi). Bayrak
// kapısını atlayan tek bir uç, fabrikada modülü fiilen açık bırakır.
//
// ⚠️ İZİN AYRIMI — OKUMA `finance:read`, YAZMA `finance:cheque`:
//   • Portföy listesi bir TUTAR GÖRÜNÜMÜDÜR ve `finance:read` zaten "tutar
//     görme kapısı" olarak tanımlı. Ayrı izne kapamak, cari ekstresinde çekin
//     defter satırını gören muhasebeciyi aynı çeki portföyde göremez hale
//     getirirdi — aynı bilgi bir ekranda var bir ekranda yok.
//   • Geçişler ise HEM cari deftere HEM banka/kasa bakiyesine yazar ve geri
//     alınamaz (terminal durumlar). Bu yüzden kendi izni var: `finance:read`
//     taşıyan herkes çek tahsil edememeli.
//
// ⚠️ AYRI ROUTER (finance.routes'a eklenmedi): çek/senet kendi yaşam döngüsü
// olan bir varlıktır ve `finance.routes` zaten dört alt alan taşıyor. Mount
// `/api/finance/cheques` altında — istemci için tek "finance" ağacı görünür.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireFinanceEnabled } from "../middlewares/finance.middleware";
import { chequeService } from "../services/cheque.service";
import { resolveDateRange } from "../services/reports/_shared";
import chequeReversalRoutes from "./cheque-reversal.routes";

const router = Router();

// Modül kapısı — bu router'daki HER uç için.
router.use(verifyToken, requireFinanceEnabled);

// Storno alt router'ı kapıyı BURADAN miras alır (app.ts'e bağlanmaz).
router.use("/", chequeReversalRoutes);

const decimalString = z.union([z.number(), z.string()]);
const isoDate = z.string().datetime({ offset: true }).or(z.string().date());
const currencyEnum = z.enum(["TRY", "USD", "EUR", "GBP", "RUB"]);
const statusEnum = z.enum([
  "PORTFOLIO",
  "AT_BANK",
  "ENDORSED",
  "COLLECTED",
  "BOUNCED",
  "RETURNED",
  "ISSUED",
  "PAID",
  "CANCELLED",
]);

/** Olay uçlarının ortak gövdesi — tarih + not. */
const eventBase = {
  eventDate: isoDate.optional(),
  notes: z.string().max(300).nullable().optional(),
};

/** Kasa XOR banka — XOR'un KENDİSİ serviste doğrulanır (tek kaynak). */
const accountRef = {
  cashBoxId: z.string().uuid().nullable().optional(),
  bankAccountId: z.string().uuid().nullable().optional(),
};

// -----------------------------------------------------------------------------
// OKUMA
// -----------------------------------------------------------------------------

/**
 * @openapi
 * /api/finance/cheques:
 *   get:
 *     tags: [Finance]
 *     summary: Çek/senet portföyü
 *     description: >
 *       Vade sıralı liste. `status` CSV kabul eder (portföy ekranı "canlı
 *       olanlar" için PORTFOLIO,AT_BANK,ENDORSED gönderir). `cariId` süzgeci
 *       ciro edilen tarafı DA kapsar.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sayfalanmış portföy listesi }
 */
router.get("/", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    // CSV → dizi: çoklu durum seçimi portföy ekranının varsayılan kullanımı
    // (`buildWhereClause` yolundan geçmiyoruz, bu uç filtresini elle okuyor).
    const statuses = q.status
      ? q.status
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const parsed = z
      .object({
        page: z.coerce.number().int().positive().optional(),
        pageSize: z.coerce.number().int().positive().max(200).optional(),
        kind: z.enum(["RECEIVED", "ISSUED"]).optional(),
        docType: z.enum(["CHEQUE", "PROMISSORY_NOTE"]).optional(),
        status: z.array(statusEnum).optional(),
        cariId: z.string().uuid().optional(),
        currency: currencyEnum.optional(),
        bankAccountId: z.string().uuid().optional(),
        dueFrom: isoDate.optional(),
        dueTo: isoDate.optional(),
        search: z.string().max(120).optional(),
      })
      .parse({
        page: q.page,
        pageSize: q.pageSize,
        kind: q.kind,
        docType: q.docType,
        status: statuses.length > 0 ? statuses : undefined,
        cariId: q.cariId,
        currency: q.currency,
        bankAccountId: q.bankAccountId,
        dueFrom: q.dueFrom,
        dueTo: q.dueTo,
        search: q.search,
      });

    const result = await chequeService.list({
      ...parsed,
      dueFrom: parsed.dueFrom ? new Date(parsed.dueFrom) : undefined,
      dueTo: parsed.dueTo ? new Date(parsed.dueTo) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheques/summary:
 *   get:
 *     tags: [Finance]
 *     summary: Portföy özeti (durum × para birimi)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kırılım listesi }
 */
// ⚠️ `/:id`'den ÖNCE — aksi halde "summary" bir uuid sanılır ve 400 döner
// (`/rolls/stats` emsali).
router.get("/summary", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const kind = q.kind === "RECEIVED" || q.kind === "ISSUED" ? q.kind : undefined;
    res.json(await chequeService.summary({ kind }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheques/due-summary:
 *   get:
 *     tags: [Finance]
 *     summary: Vade kovaları + haftalık/aylık vade takvimi
 *     description: >
 *       Eksen VADE tarihidir (işlem tarihi değil) ve kapsam PARA BEKLENEN
 *       çeklerdir: aldığımız çeklerden PORTFOLIO/AT_BANK, verdiğimiz çeklerden
 *       ISSUED. Tahsil edilmiş / karşılıksız / iade / iptal çekler GİRMEZ; CİRO
 *       EDİLEN de girmez (alacak üçüncü tarafa geçti). Kapsam yanıtta
 *       `liveStatuses` + `notes` ile açıkça söylenir.
 *       İKİ ZAMAN ANLAYIŞI: `buckets` portföyün TAMAMINI kapsar ve pencereden
 *       BAĞIMSIZDIR; `weeks`/`months` yalnız pencereyi. Pencere İLERİ bakar —
 *       varsayılan bugün + 30 gün (rapor katmanının "son 30 gün" varsayılanı
 *       burada anlamsızdır).
 *       `dateFrom`/`dateTo` BİRLİKTE gönderilir; ortak `resolveDateRange` ile
 *       doğrulanır (366 gün tavanı).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kovalar + takvim + kapsam notları }
 *       400: { description: Yalnız bir tarih ucu gönderildi / geçersiz aralık }
 *       403: { description: Ön muhasebe modülü kapalı ya da yetki yok }
 */
// ⚠️ `/:id`'den ÖNCE — `/summary` ile aynı gerekçe (aksi halde "due-summary"
// bir uuid sanılır ve 400 döner).
//
// ⚠️ İZİN İKİ KAPILI (`finance:read` VEYA `report:finance`) ve İKİSİ DE GEREKLİ:
// bu uç HEM portföy ekranındaki vade kartını (kullanıcısı `finance:read`) HEM
// Raporlar altındaki vade takvimini (kullanıcısı `report:finance`) besler. Tek
// izne bağlansaydı iki ekrandan biri sessiz 403 alır ve boş görünürdü — tam da
// `Reports/Finance/tile-config.ts`'te yazılı "cari seçici 403" tuzağı. Katalog
// DEĞİŞMEDİ: yeni izin kodu YOK, mevcut ikisinden biri yeterli.
router.get(
  "/due-summary",
  requireAnyPermission("finance:read", "report:finance"),
  async (req, res, next) => {
    try {
      const q = z
        .object({
          dateFrom: isoDate.optional(),
          dateTo: isoDate.optional(),
        })
        .strict()
        // Tek uç gönderilirse `resolveDateRange` eksik ucu GERİYE bakan
        // varsayılanla doldurur (son 30 gün) — vade takviminde bu, kullanıcının
        // hiç istemediği bir pencereyi sessizce kurmaktır. Açıkça reddedilir.
        .refine((v) => Boolean(v.dateFrom) === Boolean(v.dateTo), {
          message: "Vade penceresi için dateFrom ve dateTo BİRLİKTE gönderilmelidir.",
        })
        .parse(req.query);

      const range =
        q.dateFrom && q.dateTo
          ? resolveDateRange({ dateFrom: q.dateFrom, dateTo: q.dateTo })
          : null;
      res.json(await chequeService.dueSummary({ from: range?.from, to: range?.to }));
    } catch (e) {
      next(e);
    }
  },
);

router.get("/:id", requirePermission("finance:read"), async (req, res, next) => {
  try {
    res.json(await chequeService.findById(req.params.id as string));
  } catch (e) {
    next(e);
  }
});

// -----------------------------------------------------------------------------
// DOĞUŞ
// -----------------------------------------------------------------------------

/**
 * @openapi
 * /api/finance/cheques:
 *   post:
 *     tags: [Finance]
 *     summary: Çek/senet girişi (alınan) veya çıkışı (verilen)
 *     description: >
 *       DEFTER ANI: alınan çek ALINDIĞI AN cariyi alacaklandırır, verilen çek
 *       borçlandırır. Doğuş durumunu `kind` belirler (RECEIVED→PORTFOLIO,
 *       ISSUED→ISSUED). İKİ TARİH: `issueDate` KEŞİDE tarihidir (kâğıdın
 *       bilgisi, TTK 796); `postingDate` İŞLEM tarihidir — kur, belge no,
 *       defter satırı ve dönem kilidi ONDAN okunur. `postingDate` verilmezse
 *       BUGÜN kabul edilir (eski panel göndermez → bugüne düşer, doğru davranış).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Kaydedildi }
 */
router.post("/", requirePermission("finance:cheque"), async (req, res, next) => {
  try {
    const b = z
      .object({
        kind: z.enum(["RECEIVED", "ISSUED"]),
        docType: z.enum(["CHEQUE", "PROMISSORY_NOTE"]).optional(),
        cariId: z.string().uuid().nullable().optional(),
        customerId: z.string().uuid().nullable().optional(),
        subcontractorId: z.string().uuid().nullable().optional(),
        currency: currencyEnum.optional(),
        exchangeRate: decimalString.nullable().optional(),
        amount: decimalString,
        issueDate: isoDate.optional(),
        postingDate: isoDate.optional(),
        dueDate: isoDate,
        serialNo: z.string().max(64).nullable().optional(),
        bankName: z.string().max(100).nullable().optional(),
        branchName: z.string().max(100).nullable().optional(),
        drawerName: z.string().max(150).nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
        clientToken: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.body);

    res.status(201).json(
      await chequeService.create(
        {
          ...b,
          issueDate: b.issueDate ? new Date(b.issueDate) : undefined,
          postingDate: b.postingDate ? new Date(b.postingDate) : undefined,
          dueDate: new Date(b.dueDate),
        },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

// -----------------------------------------------------------------------------
// GEÇİŞLER — hepsi ATOMİK CLAIM (ikinci istek 409)
// -----------------------------------------------------------------------------

/**
 * @openapi
 * /api/finance/cheques/{id}/deposit:
 *   post:
 *     tags: [Finance]
 *     summary: Tahsile/teminata bankaya verme
 *     description: >
 *       PARA HAREKETİ YOK — çek henüz tahsil edilmedi. Bayrak
 *       `finance.chequeNoteMovementEnabled` açıkken tek satırlı teslim bordrosu keser;
 *       cevapta ek alan `data.deliveryNote {id, docNo}` (yalnız ekler).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Bankaya verildi }
 *       409: { description: Durum uygun değil / yarış }
 */
router.post("/:id/deposit", requirePermission("finance:cheque"), async (req, res, next) => {
  try {
    const b = z
      .object({ bankAccountId: z.string().uuid(), ...eventBase })
      .strict()
      .parse(req.body);
    res.json(
      await chequeService.deposit(
        req.params.id as string,
        { ...b, eventDate: b.eventDate ? new Date(b.eventDate) : undefined },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheques/{id}/collect:
 *   post:
 *     tags: [Finance]
 *     summary: Tahsil (banka VEYA kasa)
 *     description: >
 *       Banka/kasa bakiyesi +tutar. CARİ DEFTERE SATIR YAZILMAZ — müşterinin
 *       borcu çek alındığında kapandı; ikinci satır aynı tahsilatı iki kez sayardı.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Tahsil edildi }
 */
router.post("/:id/collect", requirePermission("finance:cheque"), async (req, res, next) => {
  try {
    const b = z
      .object({ ...accountRef, ...eventBase })
      .strict()
      .parse(req.body);
    res.json(
      await chequeService.collect(
        req.params.id as string,
        { ...b, eventDate: b.eventDate ? new Date(b.eventDate) : undefined },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheques/{id}/collect-cancel:
 *   post:
 *     tags: [Finance]
 *     summary: Tahsil stornosu (yanlış COLLECT geri alınır)
 *     description: >
 *       Para AYNI hesaptan ters hareketle geri çekilir (hesap pasifleşmiş olsa
 *       da — para gerçeği), durum COLLECT olayının tükettiği duruma
 *       (PORTFOLIO/AT_BANK) döner, olay defterine COLLECT_CANCEL satırı yazılır.
 *       Sebep ZORUNLU. Cari deftere ve faturaya kapamalara DOKUNULMAZ — tahsil
 *       stornosu çekin varlığını yok etmez.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Storno yapıldı }
 *       409: { description: Çek COLLECTED değil / yarış }
 */
router.post("/:id/collect-cancel", requirePermission("finance:cheque"), async (req, res, next) => {
  try {
    const b = z
      .object({
        reason: z
          .string()
          .trim()
          .min(1, "Tahsil stornosu için sebep zorunludur.")
          .max(300),
      })
      .strict()
      .parse(req.body ?? {});
    res.json(await chequeService.cancelCollect(req.params.id as string, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheques/{id}/endorse:
 *   post:
 *     tags: [Finance]
 *     summary: Ciro (borcumuzu bu çekle kapatırız)
 *     description: >
 *       Ciro edilen cariye BORÇ satırı yazılır; çeki veren cariye dokunulmaz. Bayrak
 *       `finance.chequeNoteMovementEnabled` açıkken tek satırlı teslim bordrosu keser;
 *       cevapta ek alan `data.deliveryNote {id, docNo}` (yalnız ekler).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Ciro edildi }
 */
router.post("/:id/endorse", requirePermission("finance:cheque"), async (req, res, next) => {
  try {
    const b = z
      .object({
        toCariId: z.string().uuid().nullable().optional(),
        toCustomerId: z.string().uuid().nullable().optional(),
        toSubcontractorId: z.string().uuid().nullable().optional(),
        ...eventBase,
      })
      .strict()
      .parse(req.body);
    res.json(
      await chequeService.endorse(
        req.params.id as string,
        { ...b, eventDate: b.eventDate ? new Date(b.eventDate) : undefined },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheques/{id}/bounce:
 *   post:
 *     tags: [Finance]
 *     summary: Karşılıksız kaydı (ters kayıtla defteri geri alır)
 *     description: >
 *       Müşteriye BORÇ satırı; çek ciro edilmişse ciro carisine de ters ALACAK
 *       satırı yazılır (onun eline geçen çek ödenmedi).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Karşılıksız kaydedildi }
 */
router.post("/:id/bounce", requirePermission("finance:cheque"), async (req, res, next) => {
  try {
    const b = z.object({ ...eventBase }).strict().parse(req.body);
    res.json(
      await chequeService.bounce(
        req.params.id as string,
        { ...b, eventDate: b.eventDate ? new Date(b.eventDate) : undefined },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheques/{id}/return:
 *   post:
 *     tags: [Finance]
 *     summary: Sahibine iade (çek geri verildi)
 *     description: Doğuş satırının TERSİ yazılır — iade karşılıksızlık DEĞİLDİR.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İade edildi }
 */
router.post("/:id/return", requirePermission("finance:cheque"), async (req, res, next) => {
  try {
    const b = z.object({ ...eventBase }).strict().parse(req.body);
    res.json(
      await chequeService.returnToDrawer(
        req.params.id as string,
        { ...b, eventDate: b.eventDate ? new Date(b.eventDate) : undefined },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheques/{id}/pay:
 *   post:
 *     tags: [Finance]
 *     summary: Kendi çekimiz ödendi (banka/kasa −tutar)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Ödendi }
 */
router.post("/:id/pay", requirePermission("finance:cheque"), async (req, res, next) => {
  try {
    const b = z
      .object({ ...accountRef, ...eventBase })
      .strict()
      .parse(req.body);
    res.json(
      await chequeService.pay(
        req.params.id as string,
        { ...b, eventDate: b.eventDate ? new Date(b.eventDate) : undefined },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cheques/{id}/cancel:
 *   post:
 *     tags: [Finance]
 *     summary: Kayıt hatası stornosu
 *     description: Satır SİLİNMEZ; defter ters kayıtla geri alınır. Ciro edilmiş çek iptal edilemez.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İptal edildi }
 */
router.post("/:id/cancel", requirePermission("finance:cheque"), async (req, res, next) => {
  try {
    const b = z
      .object({ reason: z.string().max(300).optional() })
      .strict()
      .parse(req.body ?? {});
    res.json(await chequeService.cancel(req.params.id as string, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
