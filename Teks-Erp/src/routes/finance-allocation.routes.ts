// =============================================================================
// FATURA KAPAMA ROTALARI (Paket C2) — `PaymentAllocation`
// =============================================================================
// ⚠️ BU ROUTER KENDİ BAŞINA MOUNT EDİLMEZ. `finance.routes.ts` altına
// `router.use("/allocations", allocationRoutes)` ile bağlanır ve oradaki
// `router.use(verifyToken, requireFinanceEnabled)` kapısını MİRAS ALIR. Ayrı
// olarak `app.ts`'e bağlanırsa bayrak kapısı atlanır ve fabrikada kapalı olması
// gereken modül fiilen açılır — `test_finance_flag_off` §4'ün önlediği şeyin
// tam olarak arka kapıdan tekrarı olurdu.
//
// ⚠️ HER UÇ AYRICA `requirePermission` TAŞIR ve satırın KENDİSİNDE taşır:
// `test_finance_flag_off` §4c ile `test_payment_allocation` §9 bunu SATIR BAZLI
// regex ile tarıyor. Guard'ı ayrı bir satıra/değişkene taşımak taramayı kör
// eder — tarama "guard yok" der ya da (daha kötüsü) desen değişince hiçbir şey
// demez.
//
// ⚠️ İZİN: yeni izin AÇILMADI (plan kararı). Okuma `finance:read`, yazma
// `finance:payment` — parayı sayan kişi ile faturayı parayla eşleyen kişi aynı
// kişidir; üçüncü bir izin kurulum gününde atanması unutulacak bir adım daha
// demekti (2026-08-01 kurşun bypass vakası).
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../middlewares/rbac.middleware";
import { paymentAllocationService } from "../services/payment-allocation.service";

const router = Router();

const decimalString = z.union([z.number(), z.string()]);
const currencyEnum = z.enum(["TRY", "USD", "EUR", "GBP", "RUB"]);
const directionEnum = z.enum(["IN", "OUT"]);

/**
 * @openapi
 * /api/finance/allocations/open-invoices:
 *   get:
 *     tags: [Finance]
 *     summary: Açık faturalar + FIFO kapama ÖNERİSİ
 *     description: >
 *       `status=CONFIRMED AND paidTotal < grandTotal` olan faturaları efektif
 *       vade (dueDate ?? issueDate) sırasıyla döner. `amount` verilirse her
 *       satıra `suggested` alanı eklenir — bu YALNIZ BİR ÖNERİDİR, hiçbir şey
 *       kapatmaz; kapama her zaman POST ile ve açıkça yapılır.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ data[], totalOpen }" }
 */
router.get("/open-invoices", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const q = z
      .object({
        // İkisinden TAM BİRİ (servis XOR'u 400 ile ölçer): `cariId` (Fatura Kapama) ya da `customerId` (ödeme diyaloğu —
        // kartı bilir, hesabı değil; hesap yoksa boş liste, YARATMAZ).
        cariId: z.string().uuid().optional(),
        customerId: z.string().uuid().optional(),
        currency: currencyEnum,
        direction: directionEnum.optional(),
        amount: decimalString.optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query);
    const result = await paymentAllocationService.listOpenInvoices({
      cariId: q.cariId ?? null,
      customerId: q.customerId ?? null,
      currency: q.currency,
      direction: q.direction,
      amount: q.amount ?? null,
      limit: q.limit,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/allocations/unallocated-payments:
 *   get:
 *     tags: [Finance]
 *     summary: Faturaya bağlanmamış (serbest) tahsilat/ödemeler
 *     description: >
 *       `allocatedTotal < amount` olan AKTİF tahsilatlar. "Bu para hangi
 *       faturaya ait" sorusunun listesi; yaşlandırma raporunun sanal FIFO
 *       mahsubu da aynı kümeyi okur.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ data[], totalFree }" }
 */
router.get("/unallocated-payments", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const q = z
      .object({
        cariId: z.string().uuid(),
        currency: currencyEnum,
        direction: directionEnum.optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query);
    res.json({ success: true, ...(await paymentAllocationService.listUnallocatedPayments(q)) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/allocations:
 *   get:
 *     tags: [Finance]
 *     summary: Kapama satırları (fatura / tahsilat / çek bazında)
 *     description: >
 *       En az bir süzgeç ZORUNLU. Süzgeçsiz çağrı 400 döner — tüm kapama
 *       tarihçesini tek listede döndürmek hiçbir ekranın işine yaramaz ve
 *       sessizce boş/dev bir liste dönmek sebebi gizlerdi.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kapama satırları }
 */
router.get("/", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const q = z
      .object({
        invoiceId: z.string().uuid().optional(),
        paymentId: z.string().uuid().optional(),
        chequeId: z.string().uuid().optional(),
      })
      .parse(req.query);
    res.json({ success: true, ...(await paymentAllocationService.list(q)) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/allocations:
 *   post:
 *     tags: [Finance]
 *     summary: Faturayı tahsilat/çekle kapat (tek satır)
 *     description: >
 *       Kaynak TAHSİLAT ya da ÇEK (XOR). Kurallar bilinçli dar: aynı cari, aynı
 *       para birimi, yön eşleşmesi (IN↔SATIŞ, OUT↔ALIŞ). Sayaçlar RAW ATOMİK
 *       UPDATE ile yazılır; fatura tutarını ya da kaynağın kalanını aşan kapama
 *       409 alır. Deftere satır YAZILMAZ — bakiye onay+tahsilatta zaten oynadı.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Kapama yazıldı }
 *       409: { description: Aşırı kapama / iptal edilmiş kaynak / onaysız fatura }
 */
router.post("/", requirePermission("finance:payment"), async (req, res, next) => {
  try {
    const b = z
      .object({
        invoiceId: z.string().uuid(),
        paymentId: z.string().uuid().nullable().optional(),
        chequeId: z.string().uuid().nullable().optional(),
        amount: decimalString,
        notes: z.string().max(300).nullable().optional(),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(await paymentAllocationService.allocate(b, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/allocations/bulk:
 *   post:
 *     tags: [Finance]
 *     summary: Tek tahsilatı/çeki N faturaya dağıt (HEPSİ-YA-HİÇ)
 *     description: >
 *       TEK transaction. Kurşun toplu dağıtımının BİLİNÇLİ TERSİ: orada satırlar
 *       bağımsız işlerdi ve parçalı sonuç doğruydu; burada satırlar TEK BİR
 *       DAĞITIMIN parçalarıdır ("1000 TL'yi şu üç faturaya böl"). Biri sığmazsa
 *       diğerlerini yazmak, kullanıcının hiç istemediği bir dağıtımı kalıcı yapar.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Dağıtım yazıldı }
 *       409: { description: Satırlardan biri sığmadı — hiçbiri yazılmadı }
 */
router.post("/bulk", requirePermission("finance:payment"), async (req, res, next) => {
  try {
    const b = z
      .object({
        paymentId: z.string().uuid().nullable().optional(),
        chequeId: z.string().uuid().nullable().optional(),
        items: z
          .array(
            z.object({
              invoiceId: z.string().uuid(),
              amount: decimalString,
              notes: z.string().max(300).nullable().optional(),
            }),
          )
          .min(1)
          // Tavan: tek dağıtımda 100 fatura zaten olağandışı; sınırsız liste
          // tek tx'i dakikalarca açık tutup kilit biriktirirdi (perf kuralı 10).
          .max(100),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(await paymentAllocationService.allocateBulk(b, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/allocations/{id}:
 *   delete:
 *     tags: [Finance]
 *     summary: Kapamayı çöz (yanlış faturaya bağlandı)
 *     description: >
 *       Satır FİZİKSEL olarak silinir ve sayaçlar aynı tx'te düşer. Bu, "soft
 *       delete" kuralının YAZILI istisnasıdır: kapama bir defter kaydı değil bir
 *       EŞLEŞMEDİR; paranın ve faturanın izleri append-only defterde durmaya
 *       devam eder. Çözme izi audit'e yazılır.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kapama çözüldü }
 */
router.delete("/:id", requirePermission("finance:payment"), async (req, res, next) => {
  try {
    res.json(await paymentAllocationService.deallocate(req.params.id as string, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
