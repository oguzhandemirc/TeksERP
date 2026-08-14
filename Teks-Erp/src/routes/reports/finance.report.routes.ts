// =============================================================================
// ÖN MUHASEBE RAPORLARI — yaşlandırma · kasa/banka defteri · cari ekstre
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
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import { requireFinanceEnabled } from "../../middlewares/finance.middleware";
import { dateRangeSchema, reportEnvelope, resolveDateRange } from "../../services/reports/_shared";
import { getAgingReport } from "../../services/reports/finance-aging.report";
import { getCashBookReport } from "../../services/reports/cash-book.report";
import { cariService } from "../../services/cari.service";
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
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Para birimi bazında yaşlandırma blokları }
 *       403: { description: Ön muhasebe modülü kapalı ya da yetki yok }
 */
router.get("/aging", guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z
      .object({
        // ⚠️ `dateFrom`/`dateTo` BİLİNÇLİ olarak KABUL EDİLMEZ (`.strict()`):
        // yaşlandırmaya aralık göndermek anlamsızdır ve sessizce yok saymak,
        // kullanıcıya filtrelediğini sandırırdı.
        asOf: z.string().datetime({ offset: true }).optional(),
        cariId: z.string().uuid().optional(),
        kind: z.enum(["CUSTOMER", "SUBCONTRACTOR"]).optional(),
        currency: z.enum(CURRENCIES).optional(),
        onlyOverdue: boolish,
        detail: boolish,
      })
      .strict()
      .parse(req.query);

    const asOf = q.asOf ? new Date(q.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw AppError.badRequest("Geçersiz asOf tarihi");

    const data = await getAgingReport({
      asOf,
      cariId: q.cariId,
      kind: q.kind,
      currency: q.currency,
      onlyOverdue: q.onlyOverdue,
      // Fatura kırılımı yalnız TEK cari seçiliyken üretilir: tüm cariler için
      // satır dökümü, ekranın hiç kullanmayacağı on binlerce satırlık bir yanıt
      // olurdu (perf kuralı 7 — yalnız gereken alan).
      includeDetail: q.detail && Boolean(q.cariId),
    });
    res.status(200).json({ success: true, data });
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
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Hesap özetleri (+ tek hesapta satır dökümü) }
 */
router.get("/cash-book", guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z
      .object({
        dateFrom: z.string().datetime({ offset: true }).optional(),
        dateTo: z.string().datetime({ offset: true }).optional(),
        accountId: z.string().uuid().optional(),
        accountKind: z.enum(["CASH", "BANK"]).optional(),
        includeInactive: boolish,
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
    });
    res.status(200).json(reportEnvelope(data, range));
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
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Devir + hareketler + yürüyen bakiye }
 */
router.get("/statement", guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z
      .object({
        cariId: z.string().uuid(),
        currency: z.enum(CURRENCIES),
        dateFrom: z.string().datetime({ offset: true }).optional(),
        dateTo: z.string().datetime({ offset: true }).optional(),
      })
      .strict()
      .parse(req.query);

    const range = resolveDateRange(dateRangeSchema.parse({ dateFrom: q.dateFrom, dateTo: q.dateTo }));
    const result = await cariService.statement({
      cariId: q.cariId,
      currency: q.currency,
      from: range.from,
      to: range.to,
    });
    res.status(200).json(reportEnvelope(result.data, range));
  } catch (e) {
    next(e);
  }
});

export default router;
