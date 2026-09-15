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
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";
import {
  DOCUMENT_DESIGN_FLAG_KEYS,
  DOCUMENT_DESIGN_WRITE,
} from "../constants/document-design";
import { MODULE_FLAG_KEYS, SUPERADMIN_ONLY_FLAG_KEYS } from "../constants/module-flags";
import { requireSettingsPassword } from "../middlewares/settings-password.middleware";
import { isSettingsPasswordConfigured } from "../services/settings-password.service";
import {
  systemAccountLockActive,
  refreshSystemAccountRegistry,
} from "../services/helpers/system-account.registry";
import { AuditService } from "../services/audit.service";
import { AppError } from "../utils/app-error";
import "../types/express-augment";

const router = Router();

/**
 * PATCH gövdesine göre DEĞİŞEN yetki kapısı (2026-08-05).
 *
 * Bu uç sistemin TÜM ayarlarını taşır ama Belge Şablonları / Refakat Kartı
 * ekranları da buraya yazar. Ucu tümüyle `document-template:write`e açmak,
 * şablon tasarımcısına oturum ömrünü, yedek saatini ve kk1 tuzağını da
 * vermek olurdu; kapalı bırakmak ise dar iznin hiçbir işe yaramaması demekti.
 *
 * ÜÇ DAL (2026-09-03'te modül dalı eklendi — ayrıntı gövdedeki yorumlarda):
 *   ① gövde EN AZ BİR süperadmin anahtarı taşıyorsa → sistem hesabı (süperadmin) şartı
 *      (küme = dokuz modül anahtarı + `reportsClosedKeys`; Raporlar K3 — rapor görünürlüğü
 *      de kurulumun satın aldığı ürünün sınırıdır, fabrika yöneticisinin ayarı değil)
 *      (sistem hesabı HİÇ YOKSA supap: defter TAZELENİR, hâlâ yoksa ② + ③'e düşer)
 *   ② gövde YALNIZ belge tasarım anahtarları taşıyorsa → dar izin
 *   ③ gerisi → `admin:settings`
 *
 * Kural: gövde YALNIZ belge tasarım anahtarlarını taşıyorsa dar izin yeter.
 * Tek bir yabancı anahtar (ya da BOŞ gövde) → `admin:settings`. FAIL-CLOSED:
 * tanınmayan/beklenmeyen her şey geniş izne düşer, Zod `strictObject`
 * doğrulaması ise bu kapıdan SONRA koşar (kapı yalnız anahtar ADLARINA bakar,
 * değerlere değil — bu yüzden `__proto__` gibi tuhaf anahtarlar da yabancı
 * sayılır ve dar yolu açmaz).
 */
const flagWriteGuard = (req: Request, res: Response, next: NextFunction): void => {
  const keys = Object.keys((req.body ?? {}) as Record<string, unknown>);

  // ── ① SÜPERADMİN DALI — EN ÖNDE ve `.some` ile ───────────────────────────
  // Modül anahtarları (`ticaretEnabled`, `productionEnabled`, …) kurulumun
  // HANGİ ÜRÜNÜ satın aldığını söyler; fabrika yöneticisinin ayarı değildir.
  // `reportsClosedKeys` de aynı dalda (Raporlar K3): rapor kapatmak bir kurulum
  // kararıdır. ⚠️ Küme `MODULE_FLAG_KEYS` DEĞİL `SUPERADMIN_ONLY_FLAG_KEYS` —
  // ikisini tek küme yapmak `MODULE_DEPENDENCIES`/profil makinesini rapor
  // listesiyle karıştırırdı (bkz. `constants/module-flags.ts` başlığı).
  //
  // ⚠️ `.some` — belge dalının `.every`'sinin TERSİ ve bu bilinçlidir. Belge dalı
  //   "yalnız bu anahtarlar varsa DAR izin yeter" der (izin GENİŞLETİR);
  //   modül dalı "içinde bir tane bile varsa süperadmin şartı" der (izin
  //   DARALTIR). `.every` yazılsaydı `{ ticaretEnabled, backupHour }` karma
  //   gövdesi bu dala hiç girmez ve `admin:settings` taşıyan yönetici modülü
  //   sessizce açardı. FAIL-CLOSED.
  // ⚠️ SIRA: dal en önde. Bugün belge dalı `.every` olduğu için karışım zaten
  //   ona düşmez; ama ileride eklenecek dördüncü bir `.some` dalı sessizce öne
  //   geçebilirdi.
  // ⚠️ SENKRON: `req.isSystemAccount` `verifyToken`in doldurduğu istek-taze bir
  //   alandır (JWT claim'i DEĞİL) — bu yüzden burada DB'ye gidilmez ve guard
  //   `next`i aynı tick'te çağırır.
  if (keys.some((k) => SUPERADMIN_ONLY_FLAG_KEYS.has(k))) {
    // EMNİYET SUPABI: sistem hesabı YOKSA (kurulum script'i hiç koşulmamış) kural
    // devre dışıdır — aksi halde modül anahtarını HİÇ KİMSE değiştiremezdi
    // (`constants/document-design.ts`teki "admin:settings dört ekranı da açmaya
    // devam eder" dersi). Hesap doğduğu AN kilit mutlaktır.
    if (systemAccountLockActive()) {
      moduleLockedBranch(req, res, next);
      return;
    }
    // ── SUPAP DALI — TEK ASENKRON YOL (2026-09-03, D1 bulgusu) ─────────────
    // Defter yalnız boot'ta yazılıyordu: süreç hesapsız açılıp DB'ye SONRADAN
    // hesap gelirse (elle SQL, içe aktarım, yedekten geri yükleme) supap bir
    // sonraki restart'a kadar açık kalıyordu — FAIL-OPEN yönde bir pencere.
    // Burada tek indeksli bir sorguyla defter TAZELENİR ve karar ondan sonra
    // verilir.
    //
    // ⚠️ YALNIZ BU DAL ASENKRON. Kilitli dal (yukarıda) SENKRON kalır: fabrikada
    // hesap VARDIR, yani sıcak yol hiç DB'ye gitmez ve bekçi harness'ının
    // "aynı tick" sözleşmesi orada aynen ölçülebilir.
    // ⚠️ Sorgu düşerse `next(err)` → 500, yani YAZMA OLMAZ (fail-closed).
    void refreshSystemAccountRegistry()
      .then((varMi) => {
        if (varMi) {
          // Hesap boot'tan SONRA doğmuş — kilit derhal yürürlüktedir.
          moduleLockedBranch(req, res, next);
          return;
        }
        // Supap gerçekten açık — görünürlük için iz bırak (best-effort).
        void AuditService.logEvent({
          category: "SYSTEM",
          action: "SUPERADMIN_ABSENT_MODULE_WRITE",
          userId: req.user?.userId ?? null,
          tableName: "system_settings",
          payload: { keys: keys.filter((k) => SUPERADMIN_ONLY_FLAG_KEYS.has(k)) },
        });
        belgeVeAdminDallari(keys, req, res, next);
      })
      .catch(next);
    return;
  }

  belgeVeAdminDallari(keys, req, res, next);
};

/** ① modül dalının KİLİTLİ hâli — senkron, `next`i aynı tick'te çağırır. */
function moduleLockedBranch(req: Request, res: Response, next: NextFunction): void {
  if (req.isSystemAccount !== true) {
    next(
      AppError.forbidden("Modül anahtarları yalnız sistem hesabı tarafından değiştirilir.", {
        code: "MODULE_FLAG_SUPERADMIN_ONLY",
      }),
    );
    return;
  }
  // Kimlik VE izin: `["*"]` `admin:settings`i zaten geçer, ama kapı
  // kimliğin izin denetiminin YERİNE geçmediğini yazılı tutar.
  requirePermission("admin:settings")(req, res, next);
}

/** ② + ③ mevcut belge / admin dalları (mantık DEĞİŞMEDİ, yalnız çıkarıldı). */
function belgeVeAdminDallari(
  keys: string[],
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const onlyDocumentKeys =
    keys.length > 0 && keys.every((k) => DOCUMENT_DESIGN_FLAG_KEYS.has(k));
  const guard = onlyDocumentKeys
    ? requireAnyPermission(...DOCUMENT_DESIGN_WRITE)
    : requirePermission("admin:settings");
  guard(req, res, next);
}

// Tek tablo hücresi — göster + boyut + kalınlık (default'larla tam nesne üretir).
// `px` 2026-08-05'te eklendi (panel tek birime geçti); `size` kademesi eski
// kayıtlar + donmuş snapshot'lar için OKUNMAYA DEVAM EDER, silinemez.
const DEF_SPEC_FIELD = { show: true, size: "md" as const, weight: "normal" as const };
const specFieldObj = z.object({
  show: z.boolean().default(true),
  size: z.enum(["sm", "md", "lg"]).default("md"),
  weight: z.enum(["light", "normal", "medium", "bold", "black"]).default("normal"),
  // Sınır (5–48) BİLEREK burada değil `coerceSpecField`te: aşım 400 değil KIRPMA
  // olmalı — tek bir punto yüzünden ayar kaydının tamamı reddedilmemeli.
  px: z.number().optional(),
});
const specFieldSchema = specFieldObj.default(DEF_SPEC_FIELD);

// Alan bazlı görünürlük + yazı ayarı (`travelerCardConfig.fields`) —
// `traveler-card.fields.TravelerFieldStyle` ile AYNI şekil. Kırpma/atma
// `sanitizeTravelerFields`te; burası yalnız tipi tutar.
const travelerFieldStyleSchema = z.record(
  z.string(),
  z.object({
    size: z.number().optional(),
    weight: z.enum(["light", "normal", "medium", "bold", "black"]).optional(),
    hidden: z.boolean().optional(),
  }),
);

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
  // ⚠️ strictObject — burada olmayan anahtar PATCH'i 400 yapar; bayrak eklerken
  // asıl tehlike açamamak değil KAPATAMAMAKtır (2026-08-05 kk1 dersi).
  financeEnabled: z.boolean().optional(),
  // finance.blockNegativeCashEnabled — KASA eksi bakiyeye düşemesin (default KAPALI).
  // Backend ENFORCE: 4 ileri yol 409 (ödeme OUT · masraf fişi · virmanın çıkan kasa
  // bacağı · çek ödeme); BANKA MUAF (kredili mevduat meşru), iptal/storno yolları
  // MUAF. ⚠️ ACİL KAPATMA anahtarı — açılış bakiyeleri girilmemiş bir kurulumda
  // guard her çıkışı keserse tek geri dönüş yolu budur.
  financeBlockNegativeCashEnabled: z.boolean().optional(),
  // finance.defaultVatRate — fatura satırının varsayılan KDV oranı, % (0–100,
  // default 20). Yalnız ÖN-DOLUM: fatura formunun yeni satırı + mal kabulden
  // üretilen alış taslağı bu değerle açılır, satırda değiştirilebilir.
  financeDefaultVatRate: z.number().min(0).max(100).optional(),
  // ---------------------------------------------------------------------------
  // TİCARET/MUHASEBE REJİM ANAHTARLARI (2026-08-14, dalga 1 — yalnız KAYIT)
  // ---------------------------------------------------------------------------
  // ⚠️ Dokuzu da default FALSE ve bugün hiçbir servis okumuyor. Yine de bu şema
  // satırları İLK dalgada yazılır: `z.strictObject` yüzünden burada olmayan
  // anahtar PATCH'i 400 yapar ve asıl tehlike açamamak değil KAPATAMAMAKtır
  // (2026-08-04 `kk1DuplicateGuardEnabled` vakası — bayrak sahada kapatılamadı).
  // Guard'lar sonraki dalgada bağlanınca acil kapatma yolu hazır olacak.
  // finance.riskLimitBlockEnabled — risk limiti aşımında SATIŞ faturası onayı 409.
  // Bugün limit yalnız uyarıdır. MUAF: alış faturası, taslak yolları, iptal/storno.
  financeRiskLimitBlockEnabled: z.boolean().optional(),
  // finance.autoDraftFromShipmentEnabled — sevk onayında otomatik fatura TASLAĞI.
  // Onay her zaman elle; `financeEnabled` kapalıyken kanca no-op.
  financeAutoDraftFromShipmentEnabled: z.boolean().optional(),
  // finance.autoAllocateOnPaymentEnabled — tahsilat/ödemede FIFO otomatik kapama.
  // Artan tutar avansta kalır; otomatik tahsis elle silinebilir.
  financeAutoAllocateOnPaymentEnabled: z.boolean().optional(),
  // yarn.blockNegativeBalanceEnabled — iplik çıkışında eksi bakiye engeli (kasa
  // emsali). MUAF: ters/düzeltme (ADJUST_OUT) ve belge iptali. ⚠️ ACİL KAPATMA
  // anahtarı — açılış bakiyeleri girilmemiş kurulumda her çıkış kesilirse tek
  // geri dönüş yolu budur.
  yarnBlockNegativeBalanceEnabled: z.boolean().optional(),
  // purchase.blockOverReceiptEnabled — siparişe bağlı kabulde fazla miktar engeli.
  // MUAF: siparişsiz kabul, kabul iptali/düzeltmesi. ⚠️ ACİL KAPATMA anahtarı —
  // fiziksel olarak fazla mal gelirse kabul tıkanır, kapatma yolu açık kalmalı.
  purchaseBlockOverReceiptEnabled: z.boolean().optional(),
  // goodsReceipt.requirePriceEnabled — mal kabul satırında birim fiyat zorunlu.
  // ⚠️ ACİL KAPATMA anahtarı — fiyatı henüz belli olmayan mal depoda beklerse
  // kabul hiç yapılamaz.
  goodsReceiptRequirePriceEnabled: z.boolean().optional(),
  // finance.allowZeroPriceLineEnabled — sıfır fiyatlı fatura satırıyla onaya izin
  // (promosyon/numune). İzin verilen SIFIRDIR, boş fiyat değil; negatif yine red.
  financeAllowZeroPriceLineEnabled: z.boolean().optional(),
  // finance.futureDatedDocumentBlockEnabled — ileri tarihli mali belge engeli.
  // Sınır FABRİKA günüdür. MUAF (Sınıf 1): çek keşide/vade tarihi.
  financeFutureDatedDocumentBlockEnabled: z.boolean().optional(),
  // finance.yarnOutOnInvoiceEnabled — satış faturası onayında iplik stoktan düşer
  // (varsayılan depodan). ⚠️ Sevkten de düşen kurulumda ÇİFTE DÜŞÜM olur; rejim
  // sorusudur, ek güvence değil.
  financeYarnOutOnInvoiceEnabled: z.boolean().optional(),
  productionEnabled: z.boolean().optional(),
  // ---------------------------------------------------------------------------
  // MODÜL ANAHTARLARI (2026-09-02) — hepsi REJİM anahtarı, hepsi default KAPALI
  // ---------------------------------------------------------------------------
  // ⚠️ `strictObject` — burada olmayan anahtar PATCH'i 400 yapar; bayrak
  // eklerken asıl tehlike açamamak değil KAPATAMAMAKtır (2026-08-05 kk1 dersi).
  // Bu beşi acil kapatma anahtarıdır: modül sahada yanlış davranırsa tek geri
  // dönüş yolu budur.
  // ⚠️ BAĞIMLILIK burada DEĞİL serviste ölçülür (`assertModuleDependencies`):
  // Zod tek tek alanları görür, "iplik açık + ticaret DB'de kapalı" ise gövde
  // ile DB'nin BİRLEŞİMİNDEN doğar.
  ticaretEnabled: z.boolean().optional(),
  iplikEnabled: z.boolean().optional(),
  depoMultiEnabled: z.boolean().optional(),
  kumasTeknikEnabled: z.boolean().optional(),
  tezgahEnabled: z.boolean().optional(),
  devereEnabled: z.boolean().optional(),
  devereLotRequired: z.boolean().optional(),
  devereMountTracking: z.boolean().optional(),
  devereMountTrackingRequired: z.boolean().optional(),
  // devere.autoConsume — tezgahtan doğan top leventten otomatik tüketim (default false = elle). Backend ENFORCE.
  devereAutoConsume: z.boolean().optional(),
  dokumaEnabled: z.boolean().optional(),
  // reports.closedKeys — KAPALI raporların anahtar listesi (`REPORT_CATALOG` anahtarları).
  // ⚠️ Anahtar doğrulaması BURADA DEĞİL serviste: tanınmayan anahtar 400 `REPORT_KEY_UNKNOWN`
  // ile ADIYLA reddedilir; Zod'un `z.enum(29 anahtar)` hâli yalnız "geçersiz değer" derdi ve
  // panelde hangi anahtarın yanlış olduğu görünmezdi. Şemanın işi TİP, servisin işi KÜME.
  reportsClosedKeys: z.array(z.string()).optional(),
  targetQuantityEnabled: z.boolean().optional(),
  rawWidthEnabled: z.boolean().optional(),
  kk1WeightEntryEnabled: z.boolean().optional(),
  // kk1.duplicateGuardEnabled — ham girişte mükerrer top tuzağı (default FALSE).
  // Backend ENFORCE eder: 409 POSSIBLE_DUPLICATE + `confirmDuplicate` ile geçilir.
  // ⚠️ Bu satır aynı zamanda ACİL KAPATMA anahtarıdır — tuzak sahada yanlış pozitif
  // üretirse tek geri dönüş yolu budur (enforcement okuması kasten cache'siz).
  kk1DuplicateGuardEnabled: z.boolean().optional(),
  // kk1.onlineOnlyEnabled — KK1 ham giriş çevrimdışı kuyruksuz rejim (default FALSE).
  // Client (mobil) ENFORCE: açıkken KK1 çevrimdışı kayıt almaz, kayıt+etiket tek
  // nefeste. ⚠️ Bu satır aynı zamanda ACİL KAPATMA anahtarıdır — rejim sahada
  // sorun çıkarırsa (kesintiler girişleri fazla durduruyorsa) tek geri dönüş yolu.
  kk1OnlineOnlyEnabled: z.boolean().optional(),
  // kk1.historyAllEntriesEnabled — KK1 "Tüm Girişler" tüm operatörleri göstersin
  // (default FALSE: operatör yalnız kendi kayıtlarını görür; enforce istemcide).
  kk1HistoryAllEntriesEnabled: z.boolean().optional(),
  // kk1.labelScanVerifyEnabled — ham girişte etiket geri-okutma doğrulaması
  // (scan-back / print&verify, default FALSE). Client (mobil) ENFORCE: açıkken
  // basılan etiket okutulmadan yeni top girilemez. ⚠️ ACİL KAPATMA anahtarı —
  // doğrulama sahada akışı tıkarsa (kamera arızası vb.) tek geri dönüş yolu.
  kk1LabelScanVerifyEnabled: z.boolean().optional(),
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
  // shipping.manualSackCountEnabled — "araca yüklenen gerçek çuval adedi" alanı
  // (default false). Kapalıyken alan hiç sorulmaz ve belgede çıkmaz.
  shipmentManualSackCountEnabled: z.boolean().optional(),
  // shipping.undoDispatchSameDayOnly — sevk geri almayı aynı günle sınırla
  // (default false = sınırsız). Backend ENFORCE (undoDispatch).
  shipmentUndoSameDayOnly: z.boolean().optional(),
  // ── SEVKİYAT DAVRANIŞ BAYRAKLARI (Dilim 2, 2026-09-03) ─────────────────────
  // ⚠️ `strictObject`: bu dört satır UNUTULURSA bayraklar panelden AÇILAMAZ **ve
  // daha kötüsü KAPATILAMAZ** (PATCH 400) — `kk1DuplicateGuardEnabled` vakası.
  // Bekçi: `scripts/test_feature_flag_contract.ts` §16 (enum ayağı) + §1/§3.
  // shipping.orderRequirement — sevkiyat siparişe bağlansın mı (default warn = bugünkü).
  // ENFORCE edilir ama YALNIZ kurulumda; `block` sahadaki APK güncellenmeden AÇILMAZ.
  shippingOrderRequirement: z.enum(["off", "warn", "block"]).optional(),
  // shipping.weighRequiredEnabled — sevk öncesi tüm çuvallar tartılı olsun (default false).
  // İhracat kuralı bu bayraktan BAĞIMSIZ ve her zaman geçerli.
  shippingWeighRequiredEnabled: z.boolean().optional(),
  // shipping.manualWeightRestrictedEnabled — elle kg yalnız `shipping:write` (default false).
  // ⚠️ Eski istemci `source` göndermez → MANUAL sayılır → bayrak açıkken 403. Panel+APK önce.
  shippingManualWeightRestrictedEnabled: z.boolean().optional(),
  // shipping.invoiceMode — fatura izi rejimi (default dis = bugünkü elle işaret).
  shippingInvoiceMode: z.enum(["dis", "ic", "ikisi"]).optional(),
  // shipping.docItemNameMode — sevk belgesinde ürün adı (default bizdeki = bugünkü
  // çıktı, bayt-bayt). `musterideki` karşılığı olmayan üründe bizim adımıza düşer.
  shippingDocItemNameMode: z.enum(["bizdeki", "musterideki", "ikisi"]).optional(),
  // shipping.docCekiNameMode — YALNIZ çeki bölümü (default devral = genel rejimi
  // izler, yani bugünkü davranış). Ürün listesine dokunmaz.
  shippingDocCekiNameMode: z.enum(["devral", "bizdeki", "musterideki", "ikisi"]).optional(),
  // shipping.orderCoverage — İKİNCİ EKSEN: mal seçili siparişlere yazılabildi mi
  // (default off = bugünkü davranış). `orderRequirement` niyeti, bu SONUCU ölçer.
  shippingOrderCoverage: z.enum(["off", "warn", "block"]).optional(),
  // shipping.docProductColorSplit — ürün listesinde müşteri rengi ayrı sütun
  // (default false = bugünkü birleşik dize, bayt-bayt aynı).
  shippingDocProductColorSplit: z.boolean().optional(),
  packingGroupsEnabled: z.boolean().optional(),
  packingGroupNumbering: z.enum(["artan", "bosluk-doldur"]).optional(),
  sackDumpNameMode: z.enum(["ikisi", "bizdeki", "musterideki"]).optional(),
  // shipping.allocWidthTolerance* — tahsiste EN toleransı (default kapalı = tam eşitlik).
  // ⚠️ Kumaş ve renk toleranstan ETKİLENMEZ.
  shippingAllocWidthToleranceEnabled: z.boolean().optional(),
  shippingAllocWidthToleranceCm: z.number().positive().max(10).nullable().optional(),
  // shipping.allowOverAllocation — fazla sevk deftere yazilsin mi (default false).
  shippingAllowOverAllocation: z.boolean().optional(),
  // customers.branchesEnabled — müşteri şubeleri (sevk noktaları) UI'da açık mı (default true, UI rehberi).
  customerBranchesEnabled: z.boolean().optional(),
  // tambur.overQuantityEnabled — çıkan top metresi giriş metresini aşabilsin mi (ENFORCE).
  tamburOverQuantityEnabled: z.boolean().optional(),
  // Kısa kesim → otomatik A1 (2026-08-19). ⚠️ `strictObject`: bu iki satır
  // eklenmezse panel PATCH'i 400 alır ve ayar hiç kaydedilemez.
  tamburShortCutA1Enabled: z.boolean().optional(),
  // `null` = eşiği temizle (kural inert kalır) — bilinçli olarak geçerli değer.
  tamburShortCutA1ThresholdM: z.number().positive().max(10_000).nullable().optional(),
  // Fason kabulünde çekme uyarısı (2026-08-21). Bayrak = uyarı görünürlüğü,
  // yüzde = eşik. ⚠️ `min(0)` — 0 GEÇERLİ ("tolerans yok, her fark uyarır");
  // `positive()` yazılsaydı panelden sıfır tolerans seçilemezdi.
  fasonShrinkWarnEnabled: z.boolean().optional(),
  fasonShrinkTolerancePct: z.number().min(0).max(100).nullable().optional(),
  // Mükerrer paneli (2026-08-22): bulanık ad eşleştirme bayrağı + eşik (yüzde).
  // `null` = eşiği temizle → fabrika varsayılanı (90). Alt sınır 50 (gürültü).
  demoModeEnabled: z.boolean().optional(),
  duplicatesFuzzyEnabled: z.boolean().optional(),
  duplicatesFuzzyThresholdPct: z.number().min(50).max(100).nullable().optional(),
  // ⚠️ Bu satır UNUTULURSA bayrak panelden AÇILAMAZ **ve daha kötüsü
  // KAPATILAMAZ** (`z.strictObject` → PATCH 400). 2026-08-05'te
  // `kk1DuplicateGuardEnabled` tam bu boşluktan geçti; bekçi:
  // `scripts/test_feature_flag_contract.ts`.
  tamburUndoFullSameDayOnly: z.boolean().optional(),
  // production.kursunBypassEnabled — kurşun istasyonuna tablet konulmayan düzen (default false).
  // ENFORCE edilir ama yalnız YENİ dağıtım oluşturmayı kapılar; dağıtılmış iş emirleri
  // bayrak kapansa da bypass rejiminde biter.
  kursunBypassEnabled: z.boolean().optional(),
  // batch.shortNumberEnabled — parti no kısa ve DÖNEN (P01…P99) mi (default TRUE/AÇIK).
  // Backend ENFORCE eder (generateBatchNumberTx). Kapalıyken eski P+GGAAYY+sıra kalıbı.
  // ⚠️ Bu satır ACİL KAPATMA anahtarıdır — kısa numara sahada sorun çıkarırsa tek
  // geri dönüş yolu budur (kk1DuplicateGuardEnabled ile aynı gerekçe).
  batchShortNumberEnabled: z.boolean().optional(),
  // batch.lastNumberHintEnabled — iş emri formundaki "Son Kullanılan Parti No"
  // rozeti (default TRUE). YALNIZ GÖSTERİM; numara üretimine dokunmaz.
  batchLastNumberHintEnabled: z.boolean().optional(),
  // quality.gradeRequiredEnabled — top kalitesi ZORUNLU mu (default FALSE = bugün).
  // Backend ENFORCE eder ama DAR kapsamda: KK1/manuel giriş · Tambur kalan-kuyruk
  // topu · depo kesimi · WO kapanışının WAREHOUSE/A1_STOCK satırları. Kapsam dışı
  // yüzeyler (cutOpenFabric · fason kabul doğumu · son-adım finalize · iade kabulü)
  // gerekçeleriyle system-setting.service SETTING_KEYS yorumunda.
  // ⚠️ ÖNKOŞUL: Tambur kalan-kuyruk dalı için tablette "kalan parça kalitesi" alanı
  // olan APK gerekir — bkz. panel açıklaması.
  qualityGradeRequiredEnabled: z.boolean().optional(),
  // batch.autoCreateEnabled — açık parti yokken sunucu partiyi KENDİSİ açsın mı
  // (default FALSE = bugün: top partisiz doğar). "Parti zorunlu" DEĞİL: elle parti
  // yaratan uç olmadığı için "zorunlu" çıkışsız bir kapı olurdu.
  batchAutoCreateEnabled: z.boolean().optional(),
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
  // label.scrapGradeLabelEnabled — fire (QualityGrade.skipLabel) kalitede de OTOMATİK etiket bas (default false → fire topa kâğıt çıkmaz). Client (mobil) ENFORCE; elle baskı onayla mümkün.
  scrapGradeLabelEnabled: z.boolean().optional(),
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
      // ALAN BAZLI yazı ayarı (punto/kalınlık) — anahtar kataloğu
      // `document-render/traveler-card.fields.ts`, süzgeç `sanitizeDocFields`.
      // ⚠️ Bu satır olmadan iç nesne düz `z.object` olduğu için anahtar SESSİZCE
      // atılırdı: panel kaydeder, uç 200 der, hiçbir şey yazılmaz (bu şemanın en
      // üstündeki `strictObject` gerekçesinin iç-nesne ikizi).
      // Şekil bilerek AÇIK (komşu `specFields` gibi gevşek değil): bu anahtarın
      // geriye-uyum yükü YOK (2026-08-05'te doğdu), o yüzden "eski istemci 400
      // alır" gerekçesi burada geçerli değil ve tip `TravelerCardConfig["fields"]`
      // ile birebir tutulabiliyor. SINIR (5–48 px) BİLEREK burada değil
      // `sanitizeDocFields`te: sınır aşımı 400 değil KIRPMA olmalı — punto
      // yüzünden ayar kaydının tamamı reddedilmemeli.
      fields: travelerFieldStyleSchema.optional(),
      // BOŞ TABLO (2026-08-13) — şekil belgelerdeki `blankGrid` ile BİREBİR
      // (`printed-document.controller.docConfigSchema`), çünkü tip, sanitize ve
      // renderer da ortak. Sınırlar burada DEĞİL `sanitizeBlankGrid`te: aralık
      // dışı satır/sütun 400 değil KIRPMA olmalı (ayar kaydı bir yazım hatası
      // yüzünden tümden reddedilmemeli — `gridRows` emsali).
      blankGrid: z
        .object({
          enabled: z.boolean().optional(),
          title: z.string().optional(),
          rows: z.number().optional(),
          columns: z.number().optional(),
          columnWidths: z.array(z.number()).optional(),
          headers: z.array(z.string()).optional(),
          position: z.enum(["afterHeader", "beforeSignatures"]).optional(),
        })
        .optional(),
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
      // ⚠️ `settingsPasswordRequired` FeatureFlags'IN İÇİNDE DEĞİL, yanıta
      // EKLENİR — iki bağımsız gerekçe:
      //  ① O bir bayrak değil, bir DURUM: `getFeatureFlags` 30 sn önbelleklidir
      //     ve şifre iptal edildiği an kapı uyumalıdır. Önbelleğe girseydi panel
      //     TTL boyunca kaldırılmış bir şifreyi sormaya devam ederdi.
      //  ② Bayrak olsaydı DÖRT KAPIDAN geçmesi gerekirdi (SETTING_KEYS +
      //     sanitize + Zod + Electron aynası) ve o zincir onu YAZILABİLİR
      //     yapardı — hash'in tanımlı olup olmadığı yazılacak bir ayar değildir.
      // SIR DEĞİLDİR: istemci "kaydederken şifre soracağım" kararını buradan
      // verir; bilgi zaten ilk 403 `SETTINGS_PASSWORD_REQUIRED` ile de öğrenilir.
      res.status(200).json({
        ...result,
        data: {
          ...result.data,
          settingsPasswordRequired: await isSettingsPasswordConfigured(),
        },
      });
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
 *       Verilmeyen flag'ler dokunulmaz. Kural olarak `admin:settings` gerekli;
 *       gövde YALNIZ belge tasarım anahtarlarını (documentsConfig,
 *       travelerCardConfig) taşıyorsa `document-template:write` de yeterlidir.
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
  flagWriteGuard,
  // ⚠️ `flagWriteGuard`DAN SONRA (2026-09-03 / P3). Sıra load-bearing: izin
  // kararı ÖNCE verilir, yoksa yetkisiz bir kullanıcı da şifre denemesi yaparak
  // kilit sayacını doldurur (meşru yöneticiye DoS). Ayrıca guard SENKRON
  // kalmak zorundadır (bekçi harness'ı `next`i aynı tick'te bekler) — bu kapı
  // ondan sonra geldiği için kendi DB okumasını serbestçe yapabilir.
  requireSettingsPassword,
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
// ⚠️ BİLEREK `admin:settings` — `document-template:write` buraya EKLENMEDİ.
// Logo firmanın KİMLİĞİDİR, bir şablon ayarı değil; ayrıca onu yazan tek ekran
// (Genel Ayarlar → Firma) zaten `admin:settings` arkasında, yani dar izinli
// kullanıcının bu uca ulaşacağı bir yol yok. Aynı gerekçe `companyName` ve
// `companyLetterhead` için de geçerli (bkz. constants/document-design.ts).
router.put(
  "/documents-logo",
  verifyToken,
  requirePermission("admin:settings"),
  // Firma kimliği de ayar şifresine tabidir (gövde belge-tasarım anahtarı
  // TAŞIMAZ → muafiyet dalına düşmez; `{ dataUrl }` yabancı anahtardır).
  requireSettingsPassword,
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
