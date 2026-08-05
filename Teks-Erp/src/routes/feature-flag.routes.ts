// =============================================================================
// TeksERP - Feature Flag Routes
// =============================================================================
// Frontend app açılışında 1 kez okur, context'e koyar. Tüm kullanıcılara
// açık (auth gerekli, özel permission yok). Toggle eden admin (admin:settings).
//
// Backend bu flag'leri ENFORCE ETMEZ — sadece UI'ya rehber. Pricing kapalıyken
// API yine currency/unitPrice kabul eder (admin/test araçları için).
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { systemSettingService } from "../services/system-setting.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const router = Router();

// Tek spec alanı — göster + boyut + kalınlık (default'larla tam nesne üretir).
const DEF_SPEC_FIELD = { show: true, size: "md" as const, weight: "normal" as const };
const specFieldObj = z.object({
  show: z.boolean().default(true),
  size: z.enum(["sm", "md", "lg"]).default("md"),
  weight: z.enum(["light", "normal", "bold"]).default("normal"),
});
const specFieldSchema = specFieldObj.default(DEF_SPEC_FIELD);

// NEDEN `strictObject` (2026-07-31 denetimi): düz `z.object` şemada OLMAYAN bir
// anahtarı SESSİZCE atar. Sonuç: panel yeni bir bayrağı PATCH eder, uç 200 +
// "kaydedildi" der, DB'ye hiçbir şey yazılmaz ve hata/log hiçbir yerde görünmez.
// Bu gece fiilen ısırdı — yeni bayrak eklenip bu şemaya yazılmayınca ayar kayboldu.
// `strictObject` ile bilinmeyen anahtar artık 400 + anahtarın ADI ile patlar.
//
// SÖZLEŞME: buradaki alan kümesi Electron `src/services/featureFlagService.ts`
// `FeatureFlags` arayüzü ile BİREBİR aynı olmalı. Yeni bayrak eklerken üç yer
// birlikte güncellenir: (1) bu şema, (2) `system-setting.service.setFeatureFlags`
// yazma dalı + `getFeatureFlags` okuma dalı, (3) Electron `FeatureFlags` arayüzü.
// Biri eksik kalırsa artık sessiz kalmaz: eksik (1) → 400, eksik (2) → yazılmaz.
//
// İç içe nesneler (travelerCardConfig / defaultLabelMedia / loginMethods) BİLEREK
// gevşek: onların tek kaynağı servisteki normalize/sanitize fonksiyonlarıdır ve
// eski kayıtlardan gelen geriye-uyum alanlarını (örn. `showOrderTotal`) okurlar —
// strict yapılırsa eski istemci/round-trip yükleri 400 alır.
// `export` — mekanik bekçi (`scripts/test_feature_flag_contract.ts`) `.shape`'i
// ÇALIŞMA ZAMANINDA okur. Yorumdaki üç-yer sözleşmesi 2026-08-04'e kadar yalnız
// yazıydı ve fiilen tutulmadı: `kk1DuplicateGuardEnabled` servis + Electron
// ayaklarını aldı, bu şemaya yazılmadı → bayrak panelden hiç açılamadı/KAPATILAMADI.
export const updateSchema = z.strictObject({
  // ERP'nin kurulduğu firmanın adı (panel başlığı + uygulama geneli).
  companyName: z.string().trim().max(120).optional(),
  pricingEnabled: z.boolean().optional(),
  targetQuantityEnabled: z.boolean().optional(),
  rawWidthEnabled: z.boolean().optional(),
  kk1WeightEntryEnabled: z.boolean().optional(),
  // kk1.duplicateGuardEnabled — ham girişte mükerrer top tuzağı (default FALSE).
  // Backend ENFORCE eder: 409 POSSIBLE_DUPLICATE + `confirmDuplicate` ile geçilir.
  // ⚠️ Bu satır aynı zamanda ACİL KAPATMA anahtarıdır — tuzak sahada yanlış pozitif
  // üretirse tek geri dönüş yolu budur (enforcement okuması kasten cache'siz).
  kk1DuplicateGuardEnabled: z.boolean().optional(),
  // Simüle kantardan gelen çuval tartısı kaydedilebilsin mi (false=default → backend
  // ENFORCE, 400). Yalnız demo/eğitim kurulumu açar; kg irsaliyeye/çekiye basılır.
  shippingSimulatedWeightEnabled: z.boolean().optional(),
  returnGradingEnabled: z.boolean().optional(),
  // Kartela kabulünde cm/kg ölçü alanları + listelerde ölçü gösterimi (false=default, yalnız adet).
  kartelaMeasurementEnabled: z.boolean().optional(),
  // İş emri parti kodu otomatik mi üretilsin (true) manuel mi girilsin (false=default).
  partyCodeAuto: z.boolean().optional(),
  // Fason Sevk'te fason talimatını sahadaki operatör telefondan girebilsin mi (false=default).
  fasonNoteMobileEntry: z.boolean().optional(),
  // Mobil cihaz eşleştirmesi zorunlu mu (true=aktif) yoksa pasif mi (false=default).
  devicePairingRequired: z.boolean().optional(),
  // shipping.confirmationEnabled — sevk onay adımı (UI rehberi).
  shipmentConfirmationEnabled: z.boolean().optional(),
  // shipping.undoDispatchSameDayOnly — sevk geri almayı aynı günle sınırla
  // (default false = sınırsız). Backend ENFORCE (undoDispatch).
  shipmentUndoSameDayOnly: z.boolean().optional(),
  // customers.branchesEnabled — müşteri şubeleri (sevk noktaları) UI'da açık mı (default true, UI rehberi).
  customerBranchesEnabled: z.boolean().optional(),
  // tambur.overQuantityEnabled — çıkan top metresi giriş metresini aşabilsin mi (ENFORCE).
  tamburOverQuantityEnabled: z.boolean().optional(),
  // production.kursunBypassEnabled — kurşun istasyonuna tablet konulmayan düzen (default false).
  // ENFORCE edilir ama yalnız YENİ dağıtım oluşturmayı kapılar; dağıtılmış iş emirleri
  // bayrak kapansa da bypass rejiminde biter.
  kursunBypassEnabled: z.boolean().optional(),
  // batch.shortNumberEnabled — parti no kısa ve DÖNEN (P01…P99) mi (default TRUE/AÇIK).
  // Backend ENFORCE eder (generateBatchNumberTx). Kapalıyken eski P+GGAAYY+sıra kalıbı.
  // ⚠️ Bu satır ACİL KAPATMA anahtarıdır — kısa numara sahada sorun çıkarırsa tek
  // geri dönüş yolu budur (kk1DuplicateGuardEnabled ile aynı gerekçe).
  batchShortNumberEnabled: z.boolean().optional(),
  // auth.sessionDurationMinutes — oturum (JWT) ömrü, dakika (1–43200 = 30 gün). Backend ENFORCE (login).
  sessionDurationMinutes: z.number().int().min(1).max(43200).optional(),
  // auth.sessionDurationHours — oturum (JWT) ömrü, saat (1–720). GERİYE-UYUM (dakika alanı öncelikli).
  sessionDurationHours: z.number().int().min(1).max(720).optional(),
  // auth.idleTimeoutMinutes — hareketsizlik zaman aşımı, dakika (0=kapalı, 0–1440). Frontend ENFORCE.
  idleTimeoutMinutes: z.number().int().min(0).max(1440).optional(),
  // workSession.idleTimeoutMinutes — çalışma oturumu idle zaman aşımı, dakika (default 20, 0=kapalı). Backend TEMBEL ENFORCE.
  workSessionIdleTimeoutMinutes: z.number().int().min(0).max(1440).optional(),
  // auth.sameTypeSessionPolicy — aynı-tip 2. girişte davranış (default kick). Backend ENFORCE (login).
  sameTypeSessionPolicy: z.enum(["kick", "notify", "off"]).optional(),
  // auth.autoLogoutOnExpiry — token dolunca istemci otomatik çıkış (default true). Client ENFORCE.
  autoLogoutOnExpiry: z.boolean().optional(),
  // auth.mobileIdleLockEnabled — mobil idle ekran kilidi (default true). Client (mobil) ENFORCE.
  mobileIdleLockEnabled: z.boolean().optional(),
  // auth.mobileIdleLockMinutes — mobil idle kilit süresi, dakika (default 10, 1–120). Client (mobil) ENFORCE.
  mobileIdleLockMinutes: z.number().int().min(1).max(120).optional(),
  // auth.mobileLockOnBackground — uygulama arka plana geçince anında kilitle (default true). Client (mobil) ENFORCE.
  mobileLockOnBackground: z.boolean().optional(),
  // label.mobileRasterEnabled — mobil (HC-06/BT) baskıda raster GW bitmap gönder (default false → komut yolu). Client (mobil) ENFORCE.
  mobileRasterEnabled: z.boolean().optional(),
  // auth.absoluteSessionCapDays — mutlak oturum tavanı, gün (0=süresiz, 0–365). Backend ENFORCE (issueToken).
  absoluteSessionCapDays: z.number().int().min(0).max(365).optional(),
  // auth.pinLockoutEnabled — hızlı PIN/kart deneme kilidi (default true). Backend ENFORCE.
  pinLockoutEnabled: z.boolean().optional(),
  // auth.pinLockoutAttempts — izin verilen yanlış deneme (default 5, 1–20).
  pinLockoutAttempts: z.number().int().min(1).max(20).optional(),
  // backup.hour — otomatik gece yedeğinin saati (0–23, sunucu yerel saati; default 3).
  // Backend ENFORCE eder (backup-scheduler her turda okur → restart gerekmez).
  backupHour: z.number().int().min(0).max(23).optional(),
  // auth.pinLockoutPenaltySec — kısa ceza süresi, saniye (default 60, 5–3600).
  pinLockoutPenaltySec: z.number().int().min(5).max(3600).optional(),
  // auth.pinLockoutEscalateAfter — kaç turdan sonra uzun cezaya geçilir (default 3, 1–20).
  pinLockoutEscalateAfter: z.number().int().min(1).max(20).optional(),
  // auth.pinLockoutLongPenaltyMin — uzun ceza süresi, dakika (default 15, 1–1440).
  pinLockoutLongPenaltyMin: z.number().int().min(1).max(1440).optional(),
  // auth.loginMethods — mobil giriş yöntemleri: list/pin/card + öncelikli. Backend ENFORCE
  // (en az bir etkin + primary ∈ enabled — servis ayrıca doğrular).
  loginMethods: z
    .object({
      enabled: z.array(z.enum(["list", "pin", "card"])).min(1),
      primary: z.enum(["list", "pin", "card"]),
    })
    // F228: cross-field kurallar Zod'a taşındı → servis orta-döngüde throw edemez
    // (kısmi commit imkânsız). Servisteki karşılıkları savunma olarak kalır.
    .refine((v) => v.enabled.includes(v.primary), {
      message: "Öncelikli giriş yöntemi etkin yöntemlerden biri olmalı",
    })
    .refine((v) => new Set(v.enabled).size === v.enabled.length, {
      message: "Giriş yöntemleri listesinde tekrar olamaz",
    })
    .optional(),
  // Saha #6: top etiketi kopya adedi (1–5). (Servis ayrıca doğrular.)
  labelCopies: z.number().int().min(1).max(5).optional(),
  // label.nativeSendEnabled — Faz-2 doğrudan yazıcıya gönderim (default false).
  nativeSendEnabled: z.boolean().optional(),
  // label.defaultMedia — cihazsız baskı/önizleme için sistem varsayılan etiket medyası.
  // Yazıcı cihazı seçildiğinde onun medyası önceliklidir; bu yalnız fallback. (Servis ayrıca doğrular.)
  defaultLabelMedia: z
    .object({
      widthMm: z.number().min(10).max(500),
      heightMm: z.number().min(10).max(500),
      dpi: z.number().int().min(50).max(1200),
      gapMm: z.number().min(0).max(50),
      marginMm: z.number().min(0).max(50),
    })
    .optional(),
  // Refakat kartı marka/içerik ayarı (firma adı + bölüm görünürlükleri).
  travelerCardConfig: z
    .object({
      companyName: z.string().trim().max(120),
      addressLine: z.string().trim().max(200).default(""),
      phone: z.string().trim().max(60).default(""),
      pageSize: z.enum(["A4", "A5"]).default("A5"),
      margins: z
        .object({
          top: z.number().min(0).max(40),
          right: z.number().min(0).max(40),
          bottom: z.number().min(0).max(40),
          left: z.number().min(0).max(40),
        })
        .default({ top: 8, right: 8, bottom: 8, left: 8 }),
      fontScale: z.number().min(0.7).max(1.4).default(1),
      fontWeight: z.enum(["light", "normal", "bold"]).default("normal"),
      showOperationGrid: z.boolean(),
      showNotes: z.boolean(),
      showOrders: z.boolean(),
      showProperties: z.boolean().default(true),
      specFields: z
        .object({
          color: specFieldSchema,
          width: specFieldSchema,
          targetQuantity: specFieldSchema,
          targetWeight: specFieldSchema,
          foldType: specFieldSchema,
          startDate: specFieldSchema,
          endDate: specFieldSchema,
        })
        .default({
          color: DEF_SPEC_FIELD,
          width: DEF_SPEC_FIELD,
          targetQuantity: DEF_SPEC_FIELD,
          targetWeight: DEF_SPEC_FIELD,
          foldType: DEF_SPEC_FIELD,
          startDate: DEF_SPEC_FIELD,
          endDate: DEF_SPEC_FIELD,
        }),
      specColumns: z.number().int().min(1).max(4).default(3),
      orderFields: z
        .object({
          orderNumber: specFieldSchema,
          customer: specFieldSchema,
          item: specFieldSchema,
          color: specFieldSchema,
          quantity: specFieldSchema,
        })
        .default({
          orderNumber: DEF_SPEC_FIELD,
          customer: DEF_SPEC_FIELD,
          item: DEF_SPEC_FIELD,
          color: DEF_SPEC_FIELD,
          quantity: DEF_SPEC_FIELD,
        }),
      orderTotal: specFieldObj.default({ show: true, size: "md", weight: "bold" }),
      // Partiler tablosu — İÇERİK baskı anında canlı çözülür (kart iş emri
      // açılışında donar, parti sonra doğar); burada yalnız GÖRÜNÜM kararı.
      showBatches: z.boolean().default(true),
      batchFields: z
        .object({
          batchNumber: specFieldSchema,
          rollCount: specFieldSchema,
          quantity: specFieldSchema,
          dispatch: specFieldSchema,
        })
        .default({
          batchNumber: DEF_SPEC_FIELD,
          rollCount: DEF_SPEC_FIELD,
          quantity: DEF_SPEC_FIELD,
          dispatch: DEF_SPEC_FIELD,
        }),
      batchTotal: specFieldObj.default({ show: true, size: "md", weight: "bold" }),
      footerNote: z.string().trim().max(500).default(""),
    })
    .optional(),
  // Belge künyesi — irsaliye/çeki üst bloğunda firma adının altına basılır.
  companyLetterhead: z
    .object({
      addressLine: z.string().trim().max(200),
      phone: z.string().trim().max(60),
      taxInfo: z.string().trim().max(120),
      // NEDEN sonradan eklendi (2026-07-31 denetimi): servis `setFeatureFlags`
      // `extraLines`'ı zaten temizleyip kaydediyordu ama Zod şemasında alan
      // OLMADIĞI için parse aşamasında sessizce atılıyordu → panelden girilen
      // IBAN/Mersis/web satırları "kaydedildi" deyip kayboluyordu. Şema aynası
      // eksik kalınca servisteki mantık HİÇ çalışmıyor. Sınırlar Electron
      // formuyla aynı (en fazla 5 satır × 120 karakter).
      extraLines: z
        .array(z.string().max(120, "Ek künye satırı en fazla 120 karakter olabilir"))
        .max(5, "En fazla 5 ek künye satırı girilebilir")
        .optional(),
    })
    .optional(),
  // Yazdırılan belge içerik ayarı — ham map. Alan doğrulaması TEK KAYNAK olan servis
  // katmanı sanitizeDocumentsConfig'te yapılır. Burada alan-alan Zod whitelist'i DRIFT
  // yaratıyordu: footerNotePlacement/style/logoPosition/columns/qr/stamps/blocks/
  // language/blankWidths şemada yoktu → Zod bunları SESSİZCE soyup kaydı engelliyordu.
  // Gevşek record → alanlar geçer, sanitize karar verir (z.any tipi DocumentsConfig'e uyumlu).
  documentsConfig: z.record(z.string(), z.any()).optional(),
}, {
  // Türkçe mesaj + hangi anahtarın tanınmadığını SÖYLE (rota kuralı: hata
  // mesajları Türkçe). Diğer issue kodlarında `undefined` → Zod varsayılanı.
  error: (issue) =>
    issue.code === "unrecognized_keys"
      ? `Tanınmayan ayar anahtarı: ${issue.keys.join(", ")}. ` +
        "Bu alan feature-flag şemasına eklenmemiş — eklemeden gönderilirse kaydedilmez."
      : undefined,
});

/**
 * @openapi
 * /api/feature-flags:
 *   get:
 *     tags: [Feature Flags]
 *     summary: Tüm public feature flag değerleri
 *     description: |
 *       Her kullanıcının erişimi var (auth-only). Frontend app start'ta okuyup
 *       context'e koyar. Şu an: { pricingEnabled }.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: { pricingEnabled: boolean } }
 */
router.get(
  "/",
  verifyToken,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await systemSettingService.getFeatureFlags();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/feature-flags:
 *   patch:
 *     tags: [Feature Flags]
 *     summary: Feature flag toggle (admin)
 *     description: |
 *       Verilmeyen flag'ler dokunulmaz. admin:settings yetkisi gerekli.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               pricingEnabled: { type: boolean }
 *     responses:
 *       200: { description: Güncel flag değerleri }
 */
router.patch(
  "/",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateSchema.parse(req.body);
      const result = await systemSettingService.setFeatureFlags(
        body,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// ── Belge logosu ──────────────────────────────────────────────────────────────
// Base64 data-url tek SystemSetting'de hash-anahtarlı kütüphanede tutulur;
// FeatureFlags yanıtına bilerek KONMAZ (app-start yükünü şişirmesin) — ayrı uç.

const logoSchema = z.object({
  dataUrl: z.string().max(200_000).nullable(),
});

/**
 * @openapi
 * /api/feature-flags/documents-logo:
 *   get:
 *     tags: [Feature Flags]
 *     summary: Güncel belge logosu (data-url; yoksa null)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ dataUrl: string|null }" }
 */
router.get(
  "/documents-logo",
  verifyToken,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await systemSettingService.getDocumentsLogo();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/feature-flags/documents-logo:
 *   put:
 *     tags: [Feature Flags]
 *     summary: Belge logosunu güncelle/kaldır (admin)
 *     description: |
 *       dataUrl=null → logo kaldırılır. PNG/JPEG/SVG base64 data-url, en fazla ~100KB.
 *       Kütüphane append-only: eski donmuş belgeler kendi logolarıyla basılmaya devam eder.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dataUrl]
 *             properties:
 *               dataUrl: { type: string, nullable: true }
 *     responses:
 *       200: { description: Güncel logo }
 *       400: { description: Format/boyut hatası }
 */
router.put(
  "/documents-logo",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = logoSchema.parse(req.body);
      const result = await systemSettingService.setDocumentsLogo(
        body.dataUrl,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
