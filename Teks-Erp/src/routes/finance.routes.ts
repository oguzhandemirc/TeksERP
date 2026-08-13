// =============================================================================
// ÖN MUHASEBE ROTALARI — cari · fatura · tahsilat · kasa/banka/kur
// =============================================================================
// ⚠️ HER uç İKİ kapıdan geçer: `requireFinanceEnabled` (bu kurulum bu modülü
// kullanıyor mu) + `requirePermission` (bu kişi bunu yapabilir mi). Bayrak
// kapısını atlayan tek bir uç, fabrikada modülü fiilen açık bırakır.
//
// ⚠️ GÖREV AYRILIĞI uçlara yansır: taslak `finance:write`, ONAY/İPTAL
// `finance:invoice`, tahsilat `finance:payment`. Üçünü tek izne bağlamak,
// ayrımı yalnız kâğıt üstünde bırakırdı.
// =============================================================================
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { BaseController } from "../controllers/base.controller";
import { BaseService } from "../services/base.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireFinanceEnabled } from "../middlewares/finance.middleware";
import { cariService } from "../services/cari.service";
import { invoiceService } from "../services/invoice.service";
import { paymentService } from "../services/payment.service";
import { fetchTcmbRates } from "../jobs/exchange-rate.job";

const router = Router();

// Modül kapısı — bu router'daki HER uç için.
router.use(verifyToken, requireFinanceEnabled);

const decimalString = z.union([z.number(), z.string()]);
const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

// -----------------------------------------------------------------------------
// CARİ HESAPLAR
// -----------------------------------------------------------------------------

const cariCreateSchema = z
  .object({
    customerId: z.string().uuid().nullable().optional(),
    subcontractorId: z.string().uuid().nullable().optional(),
    taxOffice: z.string().max(100).nullable().optional(),
    defaultCurrency: z.enum(["TRY", "USD", "EUR", "GBP", "RUB"]).optional(),
    paymentTermDays: z.number().int().min(0).max(3650).nullable().optional(),
    riskLimit: decimalString.nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .strict();

router.get("/cari", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const result = await cariService.list({
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      search: q.search,
      kind: q.kind === "CUSTOMER" || q.kind === "SUBCONTRACTOR" ? q.kind : undefined,
      isActive: q.isActive === undefined ? undefined : q.isActive === "true",
      onlyWithBalance: q.onlyWithBalance === "true",
    });
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

router.get("/cari/:id", requirePermission("finance:read"), async (req, res, next) => {
  try {
    res.json(await cariService.findById(req.params.id as string));
  } catch (e) {
    next(e);
  }
});

/**
 * CARİ EKSTRE — para birimi ZORUNLU.
 *
 * İki para birimini tek ekstrede yürüyen bakiyeyle göstermek matematiksel
 * olarak anlamsızdır; varsayılan seçmek de yanlış (hangi birim "asıl"?).
 */
router.get("/cari/:id/statement", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        currency: z.enum(["TRY", "USD", "EUR", "GBP", "RUB"]),
        from: isoDate,
        to: isoDate,
      })
      .parse(req.query);
    res.json(
      await cariService.statement({
        cariId: req.params.id as string,
        currency: parsed.currency,
        from: new Date(parsed.from),
        to: new Date(parsed.to),
      }),
    );
  } catch (e) {
    next(e);
  }
});

router.post("/cari", requirePermission("finance:write"), async (req, res, next) => {
  try {
    const body = cariCreateSchema.parse(req.body);
    res.status(201).json(await cariService.create(body, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

router.patch("/cari/:id", requirePermission("finance:write"), async (req, res, next) => {
  try {
    const body = cariCreateSchema
      .omit({ customerId: true, subcontractorId: true })
      .extend({ isActive: z.boolean().optional() })
      .parse(req.body);
    res.json(await cariService.update(req.params.id as string, body, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

// -----------------------------------------------------------------------------
// FATURALAR
// -----------------------------------------------------------------------------

const lineSchema = z.object({
  itemId: z.string().uuid().nullable().optional(),
  description: z.string().min(1).max(300),
  qty: decimalString,
  unit: z.string().max(16).optional(),
  unitPrice: decimalString,
  discountRate: decimalString.optional(),
  vatRate: decimalString.optional(),
  withholdingRate: decimalString.optional(),
});

const invoiceCreateSchema = z
  .object({
    type: z.enum(["SALES", "PURCHASE", "SALES_RETURN", "PURCHASE_RETURN"]),
    customerId: z.string().uuid().nullable().optional(),
    subcontractorId: z.string().uuid().nullable().optional(),
    currency: z.enum(["TRY", "USD", "EUR", "GBP", "RUB"]).optional(),
    exchangeRate: decimalString.nullable().optional(),
    issueDate: isoDate.optional(),
    dueDate: isoDate.nullable().optional(),
    externalNo: z.string().max(64).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    lines: z.array(lineSchema).min(1).max(500),
    shipmentId: z.string().uuid().nullable().optional(),
    directShipmentId: z.string().uuid().nullable().optional(),
    returnGroupId: z.string().uuid().nullable().optional(),
    subcontractorReceiptId: z.string().uuid().nullable().optional(),
    clientToken: z.string().uuid().optional(),
  })
  .strict();

router.get("/invoices", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const result = await invoiceService.list({
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      search: q.search,
      type: q.type as never,
      status: q.status as never,
      cariId: q.cariId,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

router.get("/invoices/:id", requirePermission("finance:read"), async (req, res, next) => {
  try {
    res.json(await invoiceService.findById(req.params.id as string));
  } catch (e) {
    next(e);
  }
});

router.post("/invoices", requirePermission("finance:write"), async (req, res, next) => {
  try {
    const b = invoiceCreateSchema.parse(req.body);
    res.status(201).json(
      await invoiceService.createDraft(
        {
          ...b,
          issueDate: b.issueDate ? new Date(b.issueDate) : undefined,
          dueDate: b.dueDate ? new Date(b.dueDate) : null,
        },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

router.patch("/invoices/:id", requirePermission("finance:write"), async (req, res, next) => {
  try {
    const b = z
      .object({
        lines: z.array(lineSchema).min(1).max(500).optional(),
        dueDate: isoDate.nullable().optional(),
        externalNo: z.string().max(64).nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
        exchangeRate: decimalString.optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await invoiceService.updateDraft(
        req.params.id as string,
        { ...b, dueDate: b.dueDate === undefined ? undefined : b.dueDate ? new Date(b.dueDate) : null },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

router.delete("/invoices/:id", requirePermission("finance:write"), async (req, res, next) => {
  try {
    res.json(await invoiceService.deleteDraft(req.params.id as string, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

// ⚠️ ONAY ve İPTAL `finance:invoice` — taslak hazırlayan ile deftere işleyen
// aynı kişi olmak zorunda değil (SoD).
router.post("/invoices/:id/confirm", requirePermission("finance:invoice"), async (req, res, next) => {
  try {
    res.json(await invoiceService.confirm(req.params.id as string, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

router.post("/invoices/:id/cancel", requirePermission("finance:invoice"), async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
    res.json(await invoiceService.cancel(req.params.id as string, reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

// -----------------------------------------------------------------------------
// TAHSİLAT / ÖDEME
// -----------------------------------------------------------------------------

router.get("/payments", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const result = await paymentService.list({
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      direction: q.direction as never,
      status: q.status as never,
      cariId: q.cariId,
      cashBoxId: q.cashBoxId,
      bankAccountId: q.bankAccountId,
      search: q.search,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

router.post("/payments", requirePermission("finance:payment"), async (req, res, next) => {
  try {
    const b = z
      .object({
        direction: z.enum(["IN", "OUT"]),
        method: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD", "OTHER"]),
        customerId: z.string().uuid().nullable().optional(),
        subcontractorId: z.string().uuid().nullable().optional(),
        currency: z.enum(["TRY", "USD", "EUR", "GBP", "RUB"]).optional(),
        exchangeRate: decimalString.nullable().optional(),
        amount: decimalString,
        cashBoxId: z.string().uuid().nullable().optional(),
        bankAccountId: z.string().uuid().nullable().optional(),
        paymentDate: isoDate.optional(),
        reference: z.string().max(120).nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
        clientToken: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(
      await paymentService.create(
        { ...b, paymentDate: b.paymentDate ? new Date(b.paymentDate) : undefined },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

router.post("/payments/:id/cancel", requirePermission("finance:payment"), async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
    res.json(await paymentService.cancel(req.params.id as string, reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

// -----------------------------------------------------------------------------
// KASA · BANKA · KUR (BaseService CRUD)
// -----------------------------------------------------------------------------
// ⚠️ Bakiye alanı bu uçlardan YAZILAMAZ: `balance` yalnız tahsilat/ödeme
// transaction'ında hareket eder. Elle düzeltmeye açmak, defterle bakiyenin
// ayrışmasına en kısa yoldur (ve mutabakat bekçisi o günden sonra kırmızı kalır).
// Açılış bakiyesi gerekiyorsa doğru yol bir ADJUSTMENT tahsilatıdır.

const cashBoxService = new BaseService({
  modelName: "cashBox",
  tableName: "CASH_BOX",
  searchFields: ["code", "name"],
  uniqueField: "code",
  duplicateNameField: "name",
  entityLabel: "kasa",
  autoCode: { prefix: "KS" },
});
const bankAccountService = new BaseService({
  modelName: "bankAccount",
  tableName: "BANK_ACCOUNT",
  searchFields: ["code", "name", "bankName", "iban"],
  uniqueField: "code",
  duplicateNameField: "name",
  entityLabel: "banka hesabı",
  autoCode: { prefix: "BN" },
});
const exchangeRateService = new BaseService({
  modelName: "exchangeRate",
  tableName: "EXCHANGE_RATE",
  searchFields: [],
  entityLabel: "kur",
});

/**
 * Bakiye/defter alanlarını gövdeden AYIKLAR.
 *
 * ⚠️ Yorum yeterli değil: generic CRUD controller gövdeyi olduğu gibi Prisma'ya
 * geçirir. `balance` elle yazılırsa `SUM(defter) === bakiye` mutabakatı o
 * günden sonra kalıcı olarak bozulur ve sebebi hiçbir yerde görünmez.
 * Açılış bakiyesi gerekiyorsa doğru yol bir tahsilat/ödeme kaydıdır.
 */
const stripBalance = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.body && typeof req.body === "object") {
    delete (req.body as Record<string, unknown>).balance;
  }
  next();
};

const cashBoxCtl = new BaseController(cashBoxService);
const bankCtl = new BaseController(bankAccountService);
const rateCtl = new BaseController(exchangeRateService);

router.get("/cash-boxes", requirePermission("finance:read"), cashBoxCtl.findAll);
router.post("/cash-boxes", requirePermission("finance:write"), stripBalance, cashBoxCtl.create);
router.patch("/cash-boxes/:id", requirePermission("finance:write"), stripBalance, cashBoxCtl.update);

router.get("/bank-accounts", requirePermission("finance:read"), bankCtl.findAll);
router.post("/bank-accounts", requirePermission("finance:write"), stripBalance, bankCtl.create);
router.patch("/bank-accounts/:id", requirePermission("finance:write"), stripBalance, bankCtl.update);

router.get("/exchange-rates", requirePermission("finance:read"), rateCtl.findAll);
router.post("/exchange-rates", requirePermission("finance:write"), rateCtl.create);
router.patch("/exchange-rates/:id", requirePermission("finance:write"), rateCtl.update);

/**
 * @swagger
 * /api/finance/exchange-rates/fetch-tcmb:
 *   post:
 *     summary: TCMB'den güncel döviz kurlarını çek (USD/EUR/GBP/RUB)
 *     description: >
 *       today.xml'den ForexBuying (döviz ALIŞ — VUK gereği fatura/değerleme
 *       çevrimi bu kurla yapılır) okunur, Unit'e bölünerek normalize edilir ve
 *       BÜLTEN tarihine yazılır (fetch gününe değil). Aynı güne elle girilmiş
 *       (MANUAL) kur varsa DOKUNULMAZ; mevcut TCMB satırı güncellenir. Yanıt
 *       özeti yazılan/atlanan/değişmeyen kurları ayrı ayrı listeler.
 *     tags: [Finance]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: "{ fetched, written[], skippedManual[], unchanged[], missing[] }"
 *       502:
 *         description: TCMB'ye ulaşılamadı ya da XML ayrıştırılamadı
 */
router.post("/exchange-rates/fetch-tcmb", requirePermission("finance:write"), async (req, res, next) => {
  try {
    const summary = await fetchTcmbRates(req.user?.userId);
    res.json({ success: true, data: summary });
  } catch (e) {
    next(e);
  }
});

export default router;
