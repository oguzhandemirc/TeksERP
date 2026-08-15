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
import { buildShipmentInvoiceDraftPreview } from "../services/helpers/shipment-auto-draft.helper";
import { cariService } from "../services/cari.service";
import { invoiceService } from "../services/invoice.service";
import { paymentService } from "../services/payment.service";
import { cashTransactionService } from "../services/cash-transaction.service";
import allocationRoutes from "./finance-allocation.routes";
import { fetchTcmbRates } from "../jobs/exchange-rate.job";

const router = Router();

// Modül kapısı — bu router'daki HER uç için.
router.use(verifyToken, requireFinanceEnabled);

// -----------------------------------------------------------------------------
// FATURA KAPAMA (C2) — alt router
// -----------------------------------------------------------------------------
// ⚠️ Mount BURAYA yapılır, `app.ts`'e DEĞİL: yukarıdaki `router.use(verifyToken,
// requireFinanceEnabled)` bu alt router'ın da kapısıdır. `app.use("/api/finance/
// allocations", ...)` ile bağlanması, bayrak kapalıyken kapama uçlarını açık
// bırakırdı — fabrika sıfır-fark garantisinin sızacağı tek delik.
//
// ⚠️ Mount SIRASI: `/allocations` bu dosyadaki hiçbir yolla çakışmıyor (en yakın
// komşu `/invoices`), yani sıra bugün serbest. Yine de üstte duruyor ki ileride
// eklenecek bir `/:id` deseni onu yutmasın.
router.use("/allocations", allocationRoutes);

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
      // H2 (2026-08-14): "Gecikmiş" kolonu — bayrak verilmeyince servis ek
      // sorgu KOŞMAZ (bugünkü yol bayt-bayt; bekçi kaynak taramasıyla kilitli).
      withOverdue: q.withOverdue === "true",
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

/**
 * @openapi
 * /api/finance/cari/{id}/opening-balance:
 *   post:
 *     tags: [Finance]
 *     summary: Cari açılış/devir bakiyesi
 *     description: >
 *       Sisteme geçişteki mevcut borç/alacağı ADJUSTMENT kaynaklı bir defter
 *       satırı olarak yazar (bakiyeye elle yazmaz — ekstrede görünür ve ters
 *       satırla düzeltilebilir). Cari+para birimi başına TEK; ikincisi 409.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Devir kaydedildi }
 *       409: { description: Devir zaten girilmiş }
 */
router.post("/cari/:id/opening-balance", requirePermission("finance:invoice"), async (req, res, next) => {
  try {
    const b = z
      .object({
        currency: z.enum(["TRY", "USD", "EUR", "GBP", "RUB"]),
        // POZİTİF = cari bize borçlu; NEGATİF = biz ona borçluyuz.
        balance: decimalString,
        description: z.string().max(300).nullable().optional(),
        txnDate: isoDate.optional(),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(
      await cariService.setOpeningBalance(
        {
          cariId: req.params.id as string,
          currency: b.currency,
          balance: b.balance,
          description: b.description ?? null,
          txnDate: b.txnDate ? new Date(b.txnDate) : undefined,
        },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cari/{id}/opening-balance/cancel:
 *   post:
 *     tags: [Finance]
 *     summary: Devir stornosu — açılış/devir bakiyesini tipli ters kayıtla iptal eder
 *     description: >
 *       Aktif (terslenmemiş) ADJUSTMENT devrini ADJUSTMENT_CANCEL kaynaklı ters
 *       satırla kapatır (SAP FB08 modeli — defter append-only, satır silinmez).
 *       Ters kayıt BUGÜNE yazılır: devir kapanmış bir dönemde olsa bile o
 *       dönemin ilan edilmiş fotoğrafı değişmez. Tutar/kur orijinalden aynen
 *       kopyalanır. Sebep ZORUNLU. Sonrasında yeni devir girilebilir.
 *       İzin `finance:invoice` — deftere işleyen her şeyle aynı kapı, yeni izin yok.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Devir iptal edildi (ters kayıt yazıldı) }
 *       404: { description: İptal edilecek aktif devir yok }
 *       409: { description: Devir zaten iptal edilmiş (çift storno) }
 */
router.post("/cari/:id/opening-balance/cancel", requirePermission("finance:invoice"), async (req, res, next) => {
  try {
    const b = z
      .object({
        currency: z.enum(["TRY", "USD", "EUR", "GBP", "RUB"]),
        // Sebep ZORUNLU — storno bir düzeltme kararıdır, gerekçesiz kayda geçmez.
        reason: z.string().trim().min(3).max(300),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(
      await cariService.cancelOpeningBalance(
        { cariId: req.params.id as string, currency: b.currency, reason: b.reason },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

// -----------------------------------------------------------------------------
// KASA HAREKETLERİ — carisiz (masraf · gelir · virman · açılış)
// -----------------------------------------------------------------------------
// ⚠️ Tahsilat/Ödeme uçlarından AYRI: orası CARİ hareketidir, burası kasanın
// kendi defteri. İzin de ayrışmaz — ikisi de `finance:payment` (parayı sayan
// kişi aynı kişidir; ayrı izin, kurulumu gereksiz zorlaştırırdı).

const accountRefSchema = {
  cashBoxId: z.string().uuid().nullable().optional(),
  bankAccountId: z.string().uuid().nullable().optional(),
};

/**
 * @openapi
 * /api/finance/cash-transactions:
 *   get:
 *     tags: [Finance]
 *     summary: Kasa/banka hareketleri (carisiz)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sayfalanmış hareket listesi }
 */
router.get("/cash-transactions", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const result = await cashTransactionService.list({
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      kind: q.kind as never,
      status: q.status as never,
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

/**
 * @openapi
 * /api/finance/cash-transactions:
 *   post:
 *     tags: [Finance]
 *     summary: Masraf / gelir / açılış fişi (carisiz)
 *     description: >
 *       Para birimi HESAPTAN gelir (kasa tek para birimlidir), girdide
 *       sorulmaz. OPENING hesap başına TEKTİR (partial unique + anlamlı 409).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Kaydedildi }
 */
router.post("/cash-transactions", requirePermission("finance:payment"), async (req, res, next) => {
  try {
    const b = z
      .object({
        kind: z.enum(["EXPENSE", "INCOME", "OPENING"]),
        ...accountRefSchema,
        amount: decimalString,
        txnDate: isoDate.optional(),
        category: z.string().max(120).nullable().optional(),
        description: z.string().max(300).nullable().optional(),
        reference: z.string().max(120).nullable().optional(),
        exchangeRate: decimalString.nullable().optional(),
        clientToken: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(
      await cashTransactionService.create(
        { ...b, txnDate: b.txnDate ? new Date(b.txnDate) : undefined },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cash-transactions/transfer:
 *   post:
 *     tags: [Finance]
 *     summary: Virman — kasadan bankaya / bankadan kasaya
 *     description: >
 *       TEK uç İKİ satır üretir (çıkan + giren, aynı tx, transferGroupId ile
 *       bağlı). Para birimleri EŞİT olmalı — farklı birim bir KUR İŞLEMİDİR ve
 *       virman diye kaydedilirse kur farkı sessizce yok sayılır.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Virman kaydedildi (iki belge no) }
 */
router.post("/cash-transactions/transfer", requirePermission("finance:payment"), async (req, res, next) => {
  try {
    const b = z
      .object({
        fromCashBoxId: z.string().uuid().nullable().optional(),
        fromBankAccountId: z.string().uuid().nullable().optional(),
        toCashBoxId: z.string().uuid().nullable().optional(),
        toBankAccountId: z.string().uuid().nullable().optional(),
        amount: decimalString,
        txnDate: isoDate.optional(),
        description: z.string().max(300).nullable().optional(),
        clientToken: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(
      await cashTransactionService.transfer(
        { ...b, txnDate: b.txnDate ? new Date(b.txnDate) : undefined },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cash-transactions/{id}/cancel:
 *   post:
 *     tags: [Finance]
 *     summary: Kasa hareketini iptal et
 *     description: >
 *       Kayıt silinmez, CANCELLED işaretlenir ve bakiye ters yönde düzeltilir.
 *       VİRMAN İPTALİ İKİ BACAĞI BİRDEN alır — tek bacak iptali "para çıktı ama
 *       girmedi" durumunu kalıcı yapardı.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İptal edildi }
 */
router.post("/cash-transactions/:id/cancel", requirePermission("finance:payment"), async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
    res.json(await cashTransactionService.cancel(req.params.id as string, reason, req.user?.userId));
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

/**
 * @openapi
 * /api/finance/invoices/from-goods-receipt/{id}:
 *   post:
 *     tags: [Finance]
 *     summary: Mal kabul fişinden alış faturası taslağı
 *     description: >
 *       Fişin toplarını ürün+renk+FİYAT kırılımında gruplayıp taslak üretir
 *       (20 top = 20 satır DEĞİL). İptal edilmiş toplar dışarıda; miktar
 *       initialQty (fatura mal kabul anını belgeler). Aynı fişin ikinci aktif
 *       faturası partial unique ile engellidir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Taslak oluşturuldu }
 *       409: { description: Fiş zaten faturalanmış / iptal edilmiş }
 */
router.post("/invoices/from-goods-receipt/:id", requirePermission("finance:write"), async (req, res, next) => {
  try {
    res.status(201).json(await invoiceService.createDraftFromGoodsReceipt(req.params.id as string, req.user?.userId));
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

/**
 * Tahsilat/ödeme LİSTE sorgusu (B4).
 *
 * ⚠️ `.strict()` DEĞİL: query string'e panelin eklediği (ya da tarayıcının
 * taşıdığı) fazladan bir anahtar listeyi 400'e düşürmemeli — burası bir OKUMA
 * ucu. Yazma uçlarındaki `.strict()` kararı ayrıdır ve orada doğrudur.
 * ⚠️ CSV taşıyan alanlar (`method`, `cariId`, …) BURADA parçalanmaz: tek kaynak
 * servisteki `readFilterList`/`readIdCondition`tir. İki yerde parçalamak, iki
 * farklı boşluk/boş-eleman kuralı demekti.
 */
const paymentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  direction: z.enum(["IN", "OUT"]).optional(),
  status: z.enum(["ACTIVE", "CANCELLED"]).optional(),
  method: z.string().max(200).optional(),
  cariId: z.string().max(400).optional(),
  cashBoxId: z.string().max(400).optional(),
  bankAccountId: z.string().max(400).optional(),
  search: z.string().max(200).optional(),
  from: isoDate.optional().transform((v) => (v ? new Date(v) : undefined)),
  to: isoDate.optional().transform((v) => (v ? new Date(v) : undefined)),
  dateFrom: isoDate.optional().transform((v) => (v ? new Date(v) : undefined)),
  dateTo: isoDate.optional().transform((v) => (v ? new Date(v) : undefined)),
});

/**
 * @openapi
 * /api/finance/payments:
 *   get:
 *     tags: [Finance]
 *     summary: Tahsilat / ödeme listesi (filtreli)
 *     description: >
 *       Süzme SUNUCUDA yapılır — istemcide süzmek yalnız o anki sayfayı süzer
 *       ve muhasebeci "kayıt yok" sanardı. `cariId` · `method` · `cashBoxId` ·
 *       `bankAccountId` VİRGÜLLÜ LİSTE kabul eder; `direction` ve `status` iki
 *       değerli enum oldukları için TEKİLDİR. Tarih çıpası `paymentDate`tir ve
 *       sınır İSTEMCİNİNDİR (panel yerel gün başı/sonu anını gönderir; backend
 *       ayrıca yuvarlamaz). `dateFrom`/`dateTo`, `from`/`to` ile AYNI alandır
 *       (jenerik query-parser adlandırmasıyla uyum).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: direction
 *         schema: { type: string, enum: [IN, OUT] }
 *       - in: query
 *         name: method
 *         schema: { type: string }
 *         description: CASH · BANK_TRANSFER · CREDIT_CARD · OTHER (virgüllü liste)
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ACTIVE, CANCELLED] }
 *       - in: query
 *         name: cariId
 *         schema: { type: string }
 *         description: Tek uuid ya da virgüllü liste
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200: { description: Sayfalanmış tahsilat/ödeme listesi }
 *       400: { description: Geçersiz yön/yöntem/durum değeri }
 */
router.get("/payments", requirePermission("finance:read"), async (req, res, next) => {
  try {
    // ⚠️ ENUM'LAR ZOD'DAN GEÇER. Eskiden `q.direction as never` ile ham string
    // doğrudan Prisma'ya gidiyordu: yazım hatası `PrismaClientValidationError`
    // → generic *"Geçersiz veri yapısı"* 400'ü, yani HANGİ alanın yanlış
    // olduğunu söylemeyen bir mesaj. Zod alan adını basar.
    const q = paymentListQuerySchema.parse(req.query);
    const result = await paymentService.list({
      page: q.page,
      pageSize: q.pageSize,
      direction: q.direction,
      status: q.status,
      method: q.method,
      cariId: q.cariId,
      cashBoxId: q.cashBoxId,
      bankAccountId: q.bankAccountId,
      search: q.search,
      // `dateFrom`/`dateTo` = `from`/`to` (takma ad). İkisi de gelirse AÇIK
      // olan (`from`) kazanır — sessiz bir birleştirme yerine tek kural.
      from: q.from ?? q.dateFrom,
      to: q.to ?? q.dateTo,
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
// ⚠️ EXPORT bekçi içindir (`test_ticaret_links_and_filters` §5): kur listesinin
// `dateFields` sözleşmesini GERÇEK config üzerinden ölçer. Bekçi kendi
// `BaseService`ini kursaydı, buradan `dateFields` silindiğinde yeşil kalırdı —
// yani tam da koruduğu şeyi göremezdi.
export const exchangeRateService = new BaseService({
  modelName: "exchangeRate",
  tableName: "EXCHANGE_RATE",
  searchFields: [],
  // ⚠️ `dateFields` TANIMSIZ OLDUĞU İÇİN `?dateField=rateDate&dateFrom=…`
  // SESSİZCE YOK SAYILIYORDU (`applyDateRange` whitelist dışını atar). Günlük
  // TCMB çekimi 4 satır üretiyor → 100 satırlık sayfa ≈ 25 günlük geçmiş;
  // "15 Temmuz'daki EUR kuru neydi" (fatura kuru itirazlarının sorusu)
  // cevaplanamıyordu. `rateDate` `@@unique([rateDate, currency])` ve
  // `@@index([currency, rateDate])` ile indeksli — range güvenli.
  // ⚠️ Kolon `@db.Date`tir: istemci mutlak an gönderse bile PG gün bazında
  // karşılaştırır; gün sınırını İSTEMCİ belirler (rapor filtreleriyle aynı
  // sözleşme, backend ekstra yuvarlama YAPMAZ).
  dateFields: ["rateDate"],
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

/**
 * @openapi
 * /api/finance/shipments/{id}/invoice-draft-lines:
 *   get:
 *     tags: [Finance]
 *     summary: Sevkiyattan fatura taslağı SATIR ÖNİZLEMESİ (tek kaynak)
 *     description: >
 *       Panelin "Sevkiyattan Fatura Taslağı" diyaloğu satırları BURADAN alır —
 *       otomatik kanca (finance.autoDraftFromShipmentEnabled) ile elle taslak
 *       aynı kurucuyu paylaşır (C1): ürün kırılımı + sipariş (sözleşme) fiyatı
 *       > D2 zinciri; çelişkili sipariş fiyatı UYDURULMAZ, sayaçla söylenir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ lines, orderPriced, orderConflicts, currency }" }
 *       404: { description: Sevkiyat bulunamadı ya da müşterisiz }
 */
router.get("/shipments/:id/invoice-draft-lines", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    // ⚠️ Sevkiyat okuması + para birimi çözümü SERVİS KATMANINDA (katman kuralı;
    // route'ta `prisma` import etmek ESLint `no-restricted-imports` ile yasak).
    // Para birimi kuralı otomatik kancayla AYNI kaynaktan gelir.
    res.json({ success: true, data: await buildShipmentInvoiceDraftPreview(id) });
  } catch (e) {
    next(e);
  }
});

export default router;
