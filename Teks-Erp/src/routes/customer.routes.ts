// =============================================================================
// TeksERP - Customer (Müşteri / Fasoncu) Routes
// =============================================================================

import { Router } from "express";
import { z } from "zod";
import { BaseController } from "../controllers/base.controller";
import { CustomerService } from "../services/customer.service";
import { quickCreate } from "../services/customer-quick-create.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { matchesPermission, requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";
import { SETTING_KEYS, readFinanceEnabled } from "../services/system-setting.service";
import { licenseModuleError } from "../lib/license/module-ceiling";
import { AppError } from "../utils/app-error";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { withCustomerListBalances } from "../services/helpers/customer-list-balance.helper";

const MOBILE_CUSTOMER_READ = ["mobile:tarti-paket", "mobile:sevkiyat", "mobile:fason-sevk", "mobile:fason-kabul", "mobile:tambur", "mobile:siparis", "mobile:hizli-is-emri"] as const;
import branchRoutes from "./customer-branch.routes";
import aliasRoutes from "./customer-alias.routes";
import templateRouteRoutes from "./customer-template-route.routes";
import { customerLabelOptionRoutes } from "./label-template-option.routes";
import standaloneLabelRoutes from "./customer-standalone-label.routes";
import periodSummaryRoutes from "./customer-period-summary.routes";
import { settingScreenPath } from "../constants/panel-ayar-yolu";

export const customerService = new CustomerService({
  modelName: "customer",
  tableName: "CUSTOMER",
  // exportCode aramada: sevk belgesindeki ihracat kodundan müşteri bulunabilsin.
  searchFields: ["name"],
  // ⚠️ Kod/rakam alanları KOD kovasında: `taxNumber`/`exportCode` katlanmaz
  // (rakam) ve eskiden bir müşteri ADI araması bu alanlara da varyant
  // üretiyordu — tamamen boşa giden koşullar. Kod-biçimli terimde koşarlar.
  codeSearchFields: ["code", "taxNumber", "exportCode"],
  // Fason = carinin rolü (2026-09-17): liste/detayda bağlı fason PROFİLİ hafif (`{id,isActive}`) —
  // Cariler'de "Fason" rol rozeti ve tedarikçi seçicide tek satır bundan okunur; pasif profil rol DEĞİLDİR.
  defaultInclude: { subcontractor: { select: { id: true, isActive: true } } },
  uniqueField: "code",
  duplicateNameField: "name",
  entityLabel: "müşteri",
  // Tek-adım müşteri+şube: create body'sindeki opsiyonel `branches[]` sanitize'ı
  // geçip Prisma nested-create'e (`{ create: [...] }`) sarılır. CustomerService.create
  // diziyi ÖNCE doğrular/şekillendirir (mass-assignment guard); update'te düşürülür.
  nestedCreateFields: ["branches"],
});

const controller = new BaseController(customerService);
const router = Router();

// ── Z-A: kart formunun "Finans" bölümü (cari kart ↔ hesap birleşimi, karar A) ─────────────────────
// Gövdedeki OPSİYONEL `finance` alt nesnesi hesaba yazılır (terimler HESAPTA kalır). İki kapı: `finance:write`
// (403 PERMISSION_DENIED, required) ve `finance.enabled` (403 MODULE_DISABLED). Zod burada çünkü `sanitizeWriteData`
// DMMF-dışı anahtarı SESSİZCE düşürür — alan iki uçta da sözleşmede. Okuma opt-in: `finance:read` taşıyan istek DTO'da
// `cariAccountId` + `finance` görür; operasyon kullanıcısına muhasebe alanı sızmaz.
const financeSubSchema = z
  .object({
    paymentTermDays: z.number().int().min(0).max(3650).nullable().optional(),
    defaultCurrency: z.enum(["TRY", "USD", "EUR", "GBP", "RUB"]).optional(),
    taxOffice: z.string().max(100).nullable().optional(),
    riskLimit: z.union([z.number(), z.string()]).nullable().optional(),
    // H8b (K2b): Finans → Cari diyaloğuyla aynı alan; değer kümesi + müşteri carisi şartı `cariService.update`te.
    serviceBillingTrigger: z.string().max(20).nullable().optional(),
  })
  .strict();

async function takeFinanceSub(req: { body?: unknown; user?: { permissions: string[] } }): Promise<z.infer<typeof financeSubSchema> | null> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!("finance" in body)) return null;
  const finance = financeSubSchema.nullable().parse(body.finance);
  delete body.finance;
  if (finance === null) return null;
  if (!matchesPermission(req.user?.permissions ?? [], "finance:write")) {
    throw AppError.forbidden("Cari terimleri (vade, para birimi, vergi dairesi, risk limiti, hizmet faturası tetiği) için 'finance:write' yetkisi gerekli.", { code: "PERMISSION_DENIED", required: "finance:write" });
  }
  if (!(await readFinanceEnabled())) {
    throw licenseModuleError(SETTING_KEYS.FINANCE_ENABLED, "Ön muhasebe") ?? AppError.forbidden(`Ön muhasebe modülü bu kurulumda kapalı — cari terimleri yazılamaz. ${settingScreenPath("modules")} ekranından açılabilir.`, { code: "MODULE_DISABLED", modul: "finance" });
  }
  return finance;
}

router.use("/:customerId/branches", branchRoutes);
// /api/customers/:customerId/{aliases/suggest, item-aliases/:itemId, color-aliases/:colorId}
router.use("/:customerId", aliasRoutes);
// /api/customers/:customerId/template-routes — müşteriye özel etiket şablonu ataması
router.use("/:customerId", templateRouteRoutes);
router.use("/:customerId/label-template-options", customerLabelOptionRoutes);
// /api/customers/:customerId/standalone-labels — müşteriye bağlı serbest etiketler (M:N; rota DEĞİL)
router.use("/:customerId", standaloneLabelRoutes);
// /api/customers/:customerId/period-summary — kayıt sayfası dönem özeti; yol dar bağlanır (alt router'ın toplu kapısı
// yalnız bu yola uygulanır, `/:id` uçlarına sızmaz).
router.use("/:customerId/period-summary", periodSummaryRoutes);

/**
 * @openapi
 * /api/customers:
 *   get:
 *     tags: [Customers]
 *     summary: Müşteri/Fasoncu listesi
 *     description: Tüm müşterileri filtre, sıralama ve sayfalama ile listeler.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Kod, isim veya vergi numarasında arama
 *       - in: query
 *         name: filter[type]
 *         description: "Eski istemci süzgeci — türetilmiş tip (CUSTOMER/SUPPLIER/BOTH); yeni istemci filter[role] kullanır"
 *         schema: { type: string, enum: [CUSTOMER, SUPPLIER, BOTH] }
 *       - in: query
 *         name: filter[role]
 *         description: "Rol süzgeci, CSV = OR: customer · supplier · subcontractor (rol bayrakları); tanınmayan değer 400"
 *         schema: { type: string }
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string, enum: [true, false] }
 *     responses:
 *       200:
 *         description: "Sayfalanmış müşteri listesi; `finance:read` ∧ finans modülü açıkken satırda `balances: [{currency, balance}]` (sıfır olmayan, para birimi başına), değilse alan yok"
 */
router.get("/", verifyToken, requireAnyPermission("customer:read", ...MOBILE_CUSTOMER_READ), async (req, res, next) => {
  try {
    const canReadFinance = matchesPermission(req.user?.permissions ?? [], "finance:read");
    res.status(200).json(await withCustomerListBalances(await customerService.findAll(req), canReadFinance));
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/customers/{id}:
 *   get:
 *     tags: [Customers]
 *     summary: Müşteri detayı
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Müşteri detayı
 *       404:
 *         description: Kayıt bulunamadı
 */
// BENZER KAYITLAR — mükerreri REDDETMEK yerine ÖNLEMEK için (2026-08-19).
// ⚠️ `/:id`den ÖNCE tanımlı olmalı; sonra gelirse Express "similar-names"i id
// sanar ve `uuid-param` middleware'i 400 döndürür.
// ⚠️ İzin WRITE: bu uç var olan adları listeler ve yalnız KAYIT AÇAN kişiye
// lazımdır; okuma iznine bakmak görünürlüğü gereksiz genişletirdi.
router.get("/similar-names", verifyToken, requirePermission("customer:write"), controller.similarNames);

/**
 * @openapi
 * /api/customers/quick-create:
 *   post:
 *     tags: [Customers]
 *     summary: Belgeden iş emri formunda hızlı müşteri kaydı — yalnız ad
 *     description: >
 *       Tablet belgeden İE formu okunan müşteri adı kayıtlı değilse kartı adla açar (rol Müşteri; kod, ad seddi,
 *       cari hesap ve audit genel kart yoluyla aynı). Seçicinin "Yeni ekle" formu "Diğer" bölümünden opsiyonel iletişim
 *       alanlarını da gönderebilir. `clientToken` deneme başına; aynı token tekrarı aynı kartı döner.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, clientToken]
 *             properties:
 *               name: { type: string, example: "YENİ TEKSTİL" }
 *               clientToken: { type: string, format: uuid }
 *               taxNumber: { type: string, description: "Opsiyonel; 10-15 hane, aktif kartta mükerrer 409" }
 *               contactName: { type: string }
 *               contactPhone: { type: string }
 *               email: { type: string }
 *               city: { type: string }
 *               district: { type: string }
 *               address: { type: string }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: Müşteri oluşturuldu (ya da aynı token'ın kaydı döndü)
 *       403:
 *         description: "'customer:write' ya da 'gelen-belge:write' yetkisi gerekli"
 *       409:
 *         description: Aynı adda müşteri zaten var (CUSTOMER_NAME_DUPLICATE) ya da token çakışması
 */
// Belgeden İE formunu açan tablet kullanıcısı `gelen-belge:write` taşır (form bağlamı o izinle okunur); yeni izin kodu yok.
// Gövde `.strict()`: ad + token + kartın opsiyonel iletişim alanları (seçicinin "Diğer" bölümü, 2026-11-10) — rol/kod/finans
// istemciden GELMEZ. Biçim (e-posta, vergi no) ve uzunluk kartla aynı doğrulamadan (`CustomerService`) geçer.
const QUICK_CREATE_PERMISSIONS = ["customer:write", "gelen-belge:write"] as const;
const optText = (label: string, max: number) => z.string({ message: `${label} metin olmalı` }).max(max, `${label} en fazla ${max} karakter olabilir`).optional();
const quickCreateBody = z
  .object({
    name: z.string().trim().min(1, "Müşteri adı zorunlu").max(100, "Müşteri adı en fazla 100 karakter olabilir"),
    clientToken: z.string().uuid("Geçersiz işlem kimliği"),
    taxNumber: optText("Vergi numarası", 32),
    contactName: optText("Yetkili adı", 120),
    contactPhone: optText("Telefon", 40),
    email: optText("E-posta", 200),
    city: optText("Şehir", 80),
    district: optText("İlçe", 80),
    address: optText("Adres", 500),
    notes: optText("Notlar", 500),
  })
  .strict();
router.post("/quick-create", verifyToken, requireAnyPermission(...QUICK_CREATE_PERMISSIONS), async (req, res, next) => {
  try {
    res.status(201).json(await quickCreate(customerService, quickCreateBody.parse(req.body), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

router.get("/:id", verifyToken, requireAnyPermission("customer:read", ...MOBILE_CUSTOMER_READ), async (req, res, next) => {
  try {
    const result = await customerService.findByIdFor(assertValidUuid(req.params.id, "id"), { canReadFinance: matchesPermission(req.user?.permissions ?? [], "finance:read") });
    res.status(result.success ? 200 : 404).json(result);
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/customers:
 *   post:
 *     tags: [Customers]
 *     summary: Yeni müşteri/fasoncu oluştur
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               code: { type: string, example: "MUS-010" }
 *               name: { type: string, example: "Yeni Tekstil Ltd." }
 *               taxNumber: { type: string }
 *               isCustomerRole: { type: boolean, description: "Müşteri rolü (rol modeli 2026-09-17)" }
 *               isSupplierRole: { type: boolean, description: "Tedarikçi rolü" }
 *               isSubcontractorRole: { type: boolean, description: "Fason rolü — gövdeden YAZILAMAZ (düşer); fason profili bağı türetir" }
 *               subcontractorRole: { type: boolean, description: "Yalnız oluşturmada: true ise kart + fason profili TEK tx'te doğar (Tedarikçi rolü şart, yoksa 400; aynı adda bağsız fason varsa 409)" }
 *               type: { type: string, enum: [CUSTOMER, SUPPLIER, BOTH], description: "TÜRETİLMİŞ (yalnız okunur); eski istemci gönderirse rollere çevrilir, en az bir rol zorunlu" }
 *               exportCode: { type: string, description: "İhracat kodu — sevk belgelerinde şube kodu yoksa basılır" }
 *               address: { type: string }
 *               city: { type: string }
 *               district: { type: string }
 *               country: { type: string }
 *               defaultDestination: { type: string, enum: [DOMESTIC, EXPORT], nullable: true, description: "Sevk yönü KİLİDİ — şube yönü boşsa sevkiyat bu yönle kurulur, istemcinin farklı değeri uyarıyla yok sayılır; boş = ilk sevkte seçilir ve buraya yazılır" }
 *               contactName: { type: string }
 *               contactPhone: { type: string }
 *               email: { type: string }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: Müşteri oluşturuldu
 *       409:
 *         description: Kod zaten mevcut
 */
router.post("/", verifyToken, requirePermission("customer:write"), async (req, res, next) => {
  try {
    const finance = await takeFinanceSub(req);
    res.status(201).json(await customerService.create(req.body, req.user?.userId, { finance }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/customers/{id}:
 *   patch:
 *     tags: [Customers]
 *     summary: Müşteri bilgilerini güncelle
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               taxNumber: { type: string }
 *               type: { type: string, enum: [CUSTOMER, SUPPLIER, BOTH] }
 *               exportCode: { type: string }
 *               address: { type: string }
 *               city: { type: string }
 *               district: { type: string }
 *               country: { type: string }
 *               defaultDestination: { type: string, enum: [DOMESTIC, EXPORT], nullable: true, description: "Sevk yönü KİLİDİ — şube yönü boşsa sevkiyat bu yönle kurulur, istemcinin farklı değeri uyarıyla yok sayılır; boş = ilk sevkte seçilir ve buraya yazılır" }
 *               contactName: { type: string }
 *               contactPhone: { type: string }
 *               email: { type: string }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Güncellendi
 */
router.patch("/:id", verifyToken, requirePermission("customer:write"), async (req, res, next) => {
  try {
    const finance = await takeFinanceSub(req);
    const id = assertValidUuid(req.params.id, "id");
    const result = await customerService.update(id, req.body, req.user?.userId);
    if (finance) {
      const { cariAccountId } = await customerService.updateFinanceTerms(id, finance, req.user?.userId);
      res.status(200).json({ ...result, data: { ...(result.data as Record<string, unknown>), cariAccountId } });
      return;
    }
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/customers/{id}:
 *   delete:
 *     tags: [Customers]
 *     summary: Müşteriyi pasife al
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Pasife alındı
 */
router.delete("/:id", verifyToken, requirePermission("customer:write"), controller.remove);

/**
 * @openapi
 * /api/customers/{id}/permanent:
 *   delete:
 *     tags: [Customers]
 *     summary: Müşteriyi kalıcı olarak sil
 *     description: Veriyi veritabanından tamamen kaldırır. Bu işlem geri alınamaz.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Kalıcı olarak silindi
 *       404:
 *         description: Kayıt bulunamadı
 */
router.delete("/:id/permanent", verifyToken, requirePermission("customer:write"), controller.hardRemove);

export default router;
