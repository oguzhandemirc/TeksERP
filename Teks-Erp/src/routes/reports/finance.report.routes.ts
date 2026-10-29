// =============================================================================
// ÖN MUHASEBE RAPORLARI — yaşlandırma · kasa/banka defteri · cari ekstre · KDV özeti
// =============================================================================
// ⚠️ HER uç İKİ kapıdan geçer: `requireFinanceEnabled` (bu kurulum bu modülü
// kullanıyor mu) + `requirePermission("report:finance")` (bu kişi bunu görebilir
// mi). Bayrak kapısı burada da ZORUNLU: fabrikada `finance.enabled` KAPALI ve
// rapor uçları o kapıyı taşımasaydı, adresi bilen bir kullanıcı ön muhasebe
// verisini rapor tarafından okuyabilirdi — "fabrika sıfır-fark" garantisi
// modülün EN SESSİZ kapısından delinirdi.
//
// ⚠️ İzin `report:finance`, `finance:read` DEĞİL. İkisi farklı kişilerdir:
// `finance:read` fatura/tahsilat EKRANLARINI açar (kayıt üzerinde çalışan
// muhasebeci), `report:finance` ise özet/analiz yüzeyidir (yönetim). Katalogdaki
// tanım da bunu böyle söylüyor ("Cari bakiye · yaşlandırma · ekstre · kasa-banka
// raporları") — bu yüzden EKSTRE de bu iznin altındadır.
//
// ⚠️ RAPOR PDF'İ `document-render/` DÜNYASINA GİRMEZ. Orası müşteriye giden
// RESMİ belgelerin alanıdır (donmuş snapshot · versiyon · revizyon). Rapor
// çıktısı Electron tarafındaki ortak `ReportExportSpec` ile üretilir; ikisi
// karıştırılırsa hem resmi belge disiplini hem rapor esnekliği zarar görür.
//
// ⚠️ MOUNT: `routes/reports.routes.ts` içine `router.use("/finance", ...)`
// satırı ANA OTURUM tarafından eklenir (o dosya paralel çalışan başka bir
// ajanda). Bu dosya kendi başına hiçbir yere bağlanmaz.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { CariKind, CariTxnSource, type Currency } from "@prisma/client";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import { requireReportOpen } from "../../middlewares/report.middleware";
import { requireFinanceEnabled } from "../../middlewares/finance.middleware";
import { dateRangeSchema, reportEnvelope, resolveDateRange } from "../../services/reports/_shared";
import { cariEkseni, filterEcho } from "../../services/reports/_filters";
import { getAgingReport } from "../../services/reports/finance-aging.report";
import { getCashBookReport } from "../../services/reports/cash-book.report";
import { getVatSummaryReport, VAT_YONLERI } from "../../services/reports/finance-vat.report";
import { getFxDiffReport } from "../../services/reports/finance-fx-diff.report";
import { buildCashBookNarrative, buildFxDiffNarrative, buildVatNarrative } from "../../services/reports/temel/expert-narrative";
import { cariService } from "../../services/cari.service";
import type { ExpenseSummary } from "../../services/helpers/expense-summary.helper";
import { EXPENSE_SUMMARY_KEY } from "../../services/reports/expense-summary.sunum";
import { EXPENSE_SUMMARY_DIMS, expenseSummaryRunner } from "../../services/reports/temel/core-runs";
import { runCoreWithExtras, variantQueryKeys } from "../../services/reports/temel/_variant";
import { coreDayRangeQuerySchema, resolveCoreDayRange } from "../../services/reports/temel/_day-range";
import { REPORT_BY_KEY } from "../../constants/report-catalog";
import { AppError } from "../../utils/app-error";

const router = Router();

// Modül kapısı + kimlik — bu router'daki HER uç için.
router.use(verifyToken, requireFinanceEnabled);
const guard = requirePermission("report:finance");

const CURRENCIES = ["TRY", "USD", "EUR", "GBP", "RUB"] as const;

/** Query string'de boolean: `?onlyOverdue=true`. */
const boolish = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

// -----------------------------------------------------------------------------
// YAŞLANDIRMA
// -----------------------------------------------------------------------------

/**
 * @openapi
 * /api/reports/finance/aging:
 *   get:
 *     tags: [Reports]
 *     summary: Cari yaşlandırma (aging) — kesit raporu
 *     description: >
 *       `asOf` bir KESİTTİR, tarih aralığı DEĞİL: yaşlandırma "şu ana kadar
 *       birikmiş açık"ı sorar. Kovalar para birimi bazında AYRI bloklarda döner;
 *       TL karşılığı rapor günü kuruyla ve dipnotlu verilir (kur yoksa BASILMAZ).
 *       Kapamaya bağlanmamış tahsilat/çek rapor anında FIFO ile SANAL mahsup
 *       edilir — deftere hiçbir şey yazılmaz. Her satır `reconDiff` taşır:
 *       Σ(kovalar) − kapanmamış kredi − cari bakiyesi; SIFIR olmak zorundadır.
 *       SÜZGEÇ: `cariId` LİSTE (CSV ya da tekrarlı anahtar, ≤50; tek öge bugünkü tekil davranışa düşer ve `detail` kırılımını korur). `meta.secenekler.cariId` seçici kaynağıdır — süzgeçten BAĞIMSIZ: cari süzgeçli istek toplayıcıyı bir kez daha cari süzgeci olmadan koşar.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Para birimi bazında yaşlandırma blokları }
 *       403: { description: Ön muhasebe modülü kapalı ya da yetki yok }
 */
router.get("/aging", requireReportOpen("finance/aging"), guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z
      .object({
        // ⚠️ `dateFrom`/`dateTo` BİLİNÇLİ olarak KABUL EDİLMEZ (`.strict()`):
        // yaşlandırmaya aralık göndermek anlamsızdır ve sessizce yok saymak,
        // kullanıcıya filtrelediğini sandırırdı.
        asOf: z.string().datetime({ offset: true }).optional(),
        ...cariEkseni,
        kind: z.enum(["CUSTOMER", "SUBCONTRACTOR"]).optional(),
        currency: z.enum(CURRENCIES).optional(),
        onlyOverdue: boolish,
        detail: boolish,
      })
      .strict()
      .parse(req.query);

    const asOf = q.asOf ? new Date(q.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw AppError.badRequest("Geçersiz asOf tarihi");

    // ⚠️ TEK ÖGELİ LİSTE `cariId`ye DÜŞER (`idWhere` semantiği): bugünkü davranış
    // bayt bayt korunur — `includeDetail` "tek cari seçili mi" sorusuna bakıyor ve
    // listeye çevirmek onu sessizce kapatırdı.
    const tekCari = q.cariId.length === 1 ? q.cariId[0] : undefined;
    const { secenekler, ...data } = await getAgingReport({
      asOf,
      cariId: tekCari,
      cariIds: q.cariId.length > 1 ? q.cariId : undefined,
      kind: q.kind,
      currency: q.currency,
      onlyOverdue: q.onlyOverdue,
      // Fatura kırılımı yalnız TEK cari seçiliyken üretilir: tüm cariler için
      // satır dökümü, ekranın hiç kullanmayacağı on binlerce satırlık bir yanıt
      // olurdu (perf kuralı 7 — yalnız gereken alan).
      includeDetail: q.detail && Boolean(tekCari),
    });
    // ⚠️ `aging` bir KESİT: `reportEnvelope` tarih aralığı ister, yaşlandırmanın
    // aralığı YOKTUR. Zarfın yalnız `suzgec`/`secenekler` ayağı kullanılır ve
    // gövde bugünkü `{ success, data }` biçimini KORUR (istemci kırılmaz).
    res.status(200).json({
      success: true,
      data,
      ...(filterEcho(q, ["cariId"]) ? { suzgec: filterEcho(q, ["cariId"]) } : {}),
      meta: { secenekler },
    });
  } catch (e) {
    next(e);
  }
});

// -----------------------------------------------------------------------------
// KASA / BANKA DEFTERİ
// -----------------------------------------------------------------------------

/**
 * @openapi
 * /api/reports/finance/cash-book:
 *   get:
 *     tags: [Reports]
 *     summary: Kasa/banka defteri — devir + dönem hareketleri + yürüyen bakiye
 *     description: >
 *       Üç yazarı birden toplar: `Payment` (carili tahsilat/ödeme),
 *       `CashTransaction` (carisiz masraf/gelir/virman/açılış) ve `ChequeEvent`
 *       (COLLECT/PAY). Devir, dönemden önceki hareketlerin toplamıdır — saklanan
 *       bakiyeden geriye hesaplanmaz; `storedDiff` bu iki yolun mutabakatıdır.
 *       Satır dökümü ve yürüyen bakiye YALNIZ tek hesap seçiliyse döner.
 *       Yanıt ayrıca dönem hareketlerinin KAYNAK kırılımını (`categories`)
 *       taşır — kasa hareketleri kendi serbest kategorisiyle, carili
 *       tahsilat/ödeme · çek · virman kendi sabit kovalarında; kırılım hesap
 *       özetiyle AYNI hareket kümesinden türetilir (mutabakat bekçili).
 *       SÜZGEÇ: `kategori` (CASH_TXN·TRANSFER·PAYMENT·CHEQUE) ve `yon` (IN/OUT) YALNIZ satır dökümünü daraltır — özet, kategori kırılımı ve yürüyen bakiye dönemin TAMAMINDAN doğar; `suzgec.dusenSatir` elenen satırı sayar.
 *       SÜZGEÇ: `cariId` LİSTE de eklendi ve o da YALNIZ satır dökümünü daraltır. `meta.secenekler`: `cariId` (pencerede geçen cariler) + `accountId` (kasa/banka kataloğu) — ikinci sorgu YOK, çünkü süzgeç zaten dökümde uygulanıyor.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Hesap özetleri (+ tek hesapta satır dökümü) }
 */
router.get("/cash-book", requireReportOpen("finance/cash-book"), guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z
      .object({
        dateFrom: z.string().datetime({ offset: true }).optional(),
        dateTo: z.string().datetime({ offset: true }).optional(),
        accountId: z.string().uuid().optional(),
        accountKind: z.enum(["CASH", "BANK"]).optional(),
        includeInactive: boolish,
        // ⚠️ İkisi de YALNIZ satır dökümünü daraltır (özet dönem gerçeğidir) —
        // gerekçe `cash-book.report.ts` `suzgec` alanında.
        kategori: z.enum(["CASH_TXN", "TRANSFER", "PAYMENT", "CHEQUE"]).optional(),
        yon: z.enum(["IN", "OUT"]).optional(),
        ...cariEkseni,
      })
      .strict()
      .parse(req.query);

    // Ortak katman: varsayılan son 30 gün + 366 gün tavanı + saat dilimi
    // sözleşmesi (gün sınırını İSTEMCİ çizer).
    const range = resolveDateRange(dateRangeSchema.parse({ dateFrom: q.dateFrom, dateTo: q.dateTo }));
    const data = await getCashBookReport({
      range,
      accountId: q.accountId,
      accountKind: q.accountKind,
      includeInactive: q.includeInactive,
      kategori: q.kategori,
      yon: q.yon,
      cariId: q.cariId,
    });
    const { suzgec, secenekler, ...govde } = data;
    // `anlati` EK alan ("Ne görüyoruz?"); mevcut alanlar aynen.
    res.status(200).json(reportEnvelope({ ...govde, anlati: buildCashBookNarrative(govde) }, range, null, { suzgec, secenekler }));
  } catch (e) {
    next(e);
  }
});

// -----------------------------------------------------------------------------
// MASRAF ÖZETİ (D4-H1) — kategori × fabrika ayı, v2 sunum zarfı
// -----------------------------------------------------------------------------

/** Gün aralığı + kıyas (rapor v2 gün sözleşmesi); tanınmayan anahtar 400. */
export const expenseSummaryQuerySchema = coreDayRangeQuerySchema.extend({
  currency: z.string().transform((v) => v.split(",").filter(Boolean))
    .pipe(z.array(z.enum(CURRENCIES, { message: "Tanınmayan para birimi" })).min(1, "Para birimi boş olamaz")).optional(),
  ...variantQueryKeys(EXPENSE_SUMMARY_DIMS),
}).strict();

/**
 * @openapi
 * /api/reports/finance/masraf-ozeti:
 *   get:
 *     tags: [Reports]
 *     summary: Masraf özeti — kategori × fabrika ayı TL (RaporSunumu)
 *     description: >
 *       Tek kaynak `expense-summary.helper` — kasa defterinin EXPENSE satırlarıyla aynı evren (TL karşılığı).
 *       İptal edilen masraf İPTAL AYINDA eksi yazılır (geçmiş ay değişmez). Sıra: TL azalan, eşitlikte kategori anahtarı.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: kiyas, schema: { type: string, enum: [none, prev, prevYear] } }
 *       - { in: query, name: currency, description: "Masrafın asıl para birimi (CSV: TRY,USD…); tutar yine TL karşılığı", schema: { type: string } }
 *       - { in: query, name: varyant, schema: { type: string, enum: [paraBirimi] } }
 *       - { in: query, name: donemler, description: "ay:6 · hafta:8 · gun:7", schema: { type: string } }
 *     responses:
 *       200: { description: "RaporSunumu (data) + data.detay (months · categories[key, label, totalTry, cells[]] · monthTotals · totalTry · currencies)" }
 *       400: { description: Tanınmayan ya da geçersiz parametre }
 *       403: { description: Ön muhasebe kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/masraf-ozeti", requireReportOpen("finance/masraf-ozeti"), guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = expenseSummaryQuerySchema.parse(req.query);
    const window = resolveCoreDayRange(input, REPORT_BY_KEY.get(EXPENSE_SUMMARY_KEY)?.varsayilanGun ?? 90);
    let detay: ExpenseSummary | null = null;
    const { sunum } = await runCoreWithExtras({
      range: window.range, compareRange: window.compareRange, dims: EXPENSE_SUMMARY_DIMS, varyant: input.varyant, donemler: input.donemler,
      run: expenseSummaryRunner(window, input.currency as Currency[] | undefined, (s) => { detay = s; }),
    });
    res.status(200).json(reportEnvelope({ ...sunum, detay }, window.range, window.compareRange, { warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

// -----------------------------------------------------------------------------
// CARİ EKSTRE
// -----------------------------------------------------------------------------

/**
 * @openapi
 * /api/reports/finance/statement:
 *   get:
 *     tags: [Reports]
 *     summary: Cari ekstre (rapor yüzeyi)
 *     description: >
 *       Para birimi ZORUNLUDUR — iki para birimini tek ekstrede yürüyen
 *       bakiyeyle göstermek matematiksel olarak anlamsızdır. Ekstrenin gövdesi
 *       `cariService.statement`'tan gelir; burada YENİDEN YAZILMAZ. Aksi halde
 *       aynı cari için iki farklı devir/yürüyen bakiye üreten iki ekran doğardı
 *       (ve dönem kapanışı devri yalnız birine eklenirdi).
 *       SÜZGEÇ: `belgeTipi` (`CariTxnSource`) YALNIZ satır dökümünü daraltır — devir, bakiye ve toplamlar dönem gerçeğidir; `suzgec.dusenSatir` elenen satırı sayar.
 *       ⚠️ `cariId` BİLEREK TEKİL kalır (liste DEĞİL): ekstre TEK cari içindir, yürüyen bakiye iki cariyle TANIMSIZdır. `meta.secenekler.belgeTipi` pencerede geçen tipleri taşır; `ad` HAM ENUM değeridir — Türkçe etiketin tek kaynağı panelde (`audit-labels`), backend ikinci bir etiket tablosu tutmaz.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Devir + hareketler + yürüyen bakiye }
 */
router.get("/statement", requireReportOpen("finance/statement"), guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z
      .object({
        cariId: z.string().uuid(),
        currency: z.enum(CURRENCIES),
        dateFrom: z.string().datetime({ offset: true }).optional(),
        dateTo: z.string().datetime({ offset: true }).optional(),
        // Belge tipi — YALNIZ satır dökümünü daraltır; devir/bakiye/toplamlar
        // dönem gerçeğidir (gerekçe `cari.service.statement` imzasında).
        belgeTipi: z.nativeEnum(CariTxnSource).optional(),
      })
      .strict()
      .parse(req.query);

    const range = resolveDateRange(dateRangeSchema.parse({ dateFrom: q.dateFrom, dateTo: q.dateTo }));
    const result = await cariService.statement({
      cariId: q.cariId,
      currency: q.currency,
      from: range.from,
      to: range.to,
      belgeTipi: q.belgeTipi,
    });
    const { suzgec, secenekler, ...govde } = result.data;
    res.status(200).json(reportEnvelope(govde, range, null, { suzgec, secenekler }));
  } catch (e) {
    next(e);
  }
});

// -----------------------------------------------------------------------------
// KDV DÖNEM ÖZETİ
// -----------------------------------------------------------------------------

/**
 * @openapi
 * /api/reports/finance/vat-summary:
 *   get:
 *     tags: [Reports]
 *     summary: KDV dönem özeti — satış/alış ayrı, oran kırılımlı (beyanname DEĞİL)
 *     description: >
 *       Muhasebeciye giden dönem özetidir; resmî beyan dış programda yapılır.
 *       Dönem çıpası FATURA TARİHİDİR (tahakkuk); yalnız ONAYLANMIŞ faturalar
 *       girer. Kırılım satır `vatRate` gruplarından toplanır (karışık oranlı
 *       fatura her oranda kendi payıyla görünür); iade faturaları kendi
 *       bloklarında AYRI satırdır ve blok toplamına negatif girer. TL kolonları
 *       her belgenin KENDİ kur damgasıyla çevrilir; kuruş kalıntısı en büyük
 *       matrah satırına yazılır, `totalsTry.reconDiff` "0.00" olmak zorundadır.
 *       SÜZGEÇ: `yon` (4 `InvoiceType` değeri, iadeler AYRI) ve `oran` (sabit 2 hane, örn. `20.00`) WHERE'e iner; `meta.suzgec` düşen belge ve satırı sayar.
 *       SÜZGEÇ SEÇİCİSİ: `yon` kapalı bir enum (panel statik çizer), `oran` AÇIK küme ⇒ `meta.secenekler.oran` pencerede geçen oranları taşır (`code` sorgu biçiminde `"18.00"`, `ad` gösterim `"%18"`), süzgeçten BAĞIMSIZ.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Satış + alış blokları (oran kırılımı, para birimi grupları, TL toplamlar) }
 *       403: { description: Ön muhasebe modülü kapalı ya da yetki yok }
 */
router.get("/vat-summary", requireReportOpen("finance/vat-summary"), guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z
      .object({
        dateFrom: z.string().datetime({ offset: true }).optional(),
        dateTo: z.string().datetime({ offset: true }).optional(),
        // ⚠️ `yon` İADE YÖNLERİNİ AYRI değer olarak taşır: rapor bloğu SALES/PURCHASE
        // olsa da iade faturası blok içinde ayrı satırdır ve "yalnız iadeleri göster"
        // meşru bir sorudur. İkiye indirmek o soruyu sorulamaz yapardı.
        yon: z.enum(VAT_YONLERI).optional(),
        // Oran GRUPLAMA ANAHTARININ KENDİSİYLE aynı biçimde alınır (sabit 2 hane):
        // "20" ile "20.00" iki ayrı anahtar olsaydı süzgeç sessizce boş dönerdi.
        oran: z.string().regex(/^\d{1,3}\.\d{2}$/, "Oran 2 haneli olmalı (örn. 20.00)").optional(),
      })
      .strict()
      .parse(req.query);

    // Ortak katman: varsayılan son 30 gün + 366 gün tavanı + saat dilimi
    // sözleşmesi (gün sınırını İSTEMCİ çizer).
    const range = resolveDateRange(dateRangeSchema.parse({ dateFrom: q.dateFrom, dateTo: q.dateTo }));
    // ⚠️ `suzgec` CEVABIN KÖKÜNE gider, `data`nın içine DEĞİL (R5b-c2 tek adres):
    // panel tek bileşen okuyacak; iki adres, süzgeç şeridini rapor başına yazdırırdı.
    const { suzgec, secenekler, ...data } = await getVatSummaryReport({ range, yon: q.yon, oran: q.oran });
    res.status(200).json(reportEnvelope({ ...data, anlati: buildVatNarrative(data) }, range, null, { suzgec, secenekler }));
  } catch (e) {
    next(e);
  }
});

// -----------------------------------------------------------------------------
// KUR FARKI
// -----------------------------------------------------------------------------

/**
 * @openapi
 * /api/reports/finance/fx-diff:
 *   get:
 *     tags: [Reports]
 *     summary: Kur farkı listesi — dövizli kapamalarda gerçekleşen TL farkı
 *     description: >
 *       Dövizli faturayı kapatan her tahsilat/çek satırı için TL kur farkını
 *       TÜRETİR (saklanmaz): tutar × (kaynak kuru − fatura kuru), yön
 *       `invoiceLedgerSide`dan (+ lehte / − aleyhte). Dönem çıpası KAPAMANIN
 *       anıdır; kapama çözülürse satır listeden kendiliğinden düşer. Satır
 *       bazında kuruşa yuvarlanır, özet toplam satır toplamına birebir eşittir.
 *       DEFTERE YAZMAZ — dekont bacağı ayrı bir üründür (yol haritası J).
 *       SÜZGEÇ: `kind` (CUSTOMER/SUBCONTRACTOR) WHERE'e iner ve `summary` onunla birlikte daralır (kur farkı bakiye değil, kümenin toplamıdır); `suzgec.dusenSatir` elenen satırı sayar.
 *       SÜZGEÇ: `cariId` LİSTE. `meta.secenekler.cariId` süzgeçten BAĞIMSIZ (süzgeçli istek ikinci bir hafif sorgu koşar).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kapama bazında kur farkı satırları + lehte/aleyhte özet }
 *       403: { description: Ön muhasebe modülü kapalı ya da yetki yok }
 */
router.get("/fx-diff", requireReportOpen("finance/fx-diff"), guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z
      .object({
        dateFrom: z.string().datetime({ offset: true }).optional(),
        dateTo: z.string().datetime({ offset: true }).optional(),
        ...cariEkseni,
        currency: z.enum(CURRENCIES.filter((c) => c !== "TRY") as [string, ...string[]]).optional(),
        // `aging` bu ekseni taşıyordu, kardeşi taşımıyordu — asimetri kapandı.
        kind: z.nativeEnum(CariKind).optional(),
      })
      .strict()
      .parse(req.query);

    const range = resolveDateRange(dateRangeSchema.parse({ dateFrom: q.dateFrom, dateTo: q.dateTo }));
    const { suzgec, secenekler, ...govde } = await getFxDiffReport({ range, cariId: q.cariId, currency: q.currency, kind: q.kind });
    res.status(200).json(reportEnvelope({ ...govde, anlati: buildFxDiffNarrative(govde) }, range, null, { suzgec, secenekler }));
  } catch (e) {
    next(e);
  }
});

export default router;
