import express, { Express, NextFunction, Request, Response } from "express";
import { VARSAYILAN_GOVDE_LIMITI, buyukGovdeYolu } from "./constants/body-limits";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import { setupSwagger } from "./config/swagger";
import { APP_VERSION } from "./lib/app-version";
import { errorHandler } from "./middlewares/error.middleware";
import { installDecimalNumberSerializer } from "./utils/json-replacer";
import { redactSecretQueryParams } from "./utils/url-redaction";
import prisma from "./lib/prisma";
import { buildRichHealth } from "./lib/health-snapshot";

// Tüm res.json() çıktısında Prisma Decimal → number çevirir
// (Decimal.prototype.toJSON override'ı). Aksi halde Decimal'ler client'a string
// olarak gider, frontend `toFixed`/aritmetik hataları alır. Bkz. json-replacer.ts.
installDecimalNumberSerializer();

// Routes
import authRoutes from "./routes/auth.routes";
import itemRoutes from "./routes/item.routes";
import customerRoutes from "./routes/customer.routes";
import customerBranchListRoutes from "./routes/customer-branch-list.routes";
import stationRoutes, { machineRouter } from "./routes/station.routes";
import routeRoutes from "./routes/route.routes";
import productRecipeRoutes from "./routes/product-recipe.routes";
import warpSpecRoutes from "./routes/warp-spec.routes";
import warpBeamRoutes from "./routes/warp-beam.routes";
import weavingOrderRoutes from "./routes/weaving-order.routes";
import machineRunRoutes from "./routes/machine-run.routes";
import machineStopRoutes from "./routes/machine-stop.routes";
import machineShiftStatRoutes from "./routes/machine-shift-stat.routes";
import machineSpecRoutes from "./routes/machine-spec.routes";
import machineDoffRoutes from "./routes/machine-doff.routes";
import subcontractorWeavingRoutes from "./routes/subcontractor-weaving.routes";
import inventoryRoutes from "./routes/inventory.routes";
import orderRoutes from "./routes/order.routes";
import recordInfoRoutes from "./routes/record-info.routes";
import scanRoutes from "./routes/scan.routes";
import numberSeriesRoutes from "./routes/number-series.routes";
import workOrderRoutes from "./routes/workorder.routes";
import productionBalanceRoutes from "./routes/production-balance.routes";
import tamburRoutes from "./routes/tambur.routes";
import kursunQcRoutes from "./routes/kursun-qc.routes";
import kursunBypassRoutes from "./routes/kursun-bypass.routes";
import travelerCardRoutes from "./routes/traveler-card.routes";
import travelerTemplateRoutes from "./routes/traveler-template.routes";
import subcontractorRoutes from "./routes/subcontractor.routes";
import batchRoutes from "./routes/batch.routes";
import {
  subcontractorRouter,
  subcontractorCategoryRouter,
} from "./routes/subcontractor-management.routes";
import swatchRoutes from "./routes/swatch.routes";
import kartelaRoutes from "./routes/kartela.routes";
import defectTypeRoutes from "./routes/defect-type.routes";
import qualityGradeRoutes from "./routes/quality-grade.routes";
import colorRoutes from "./routes/color.routes";
import fabricPropertyRoutes from "./routes/fabric-property.routes";
import stationCapabilityRoutes from "./routes/station-capability.routes";
import reasonPresetRoutes from "./routes/reason-preset.routes";
import labelRoutes from "./routes/label.routes";
import labelTemplateRoutes from "./routes/label-template.routes";
import { peripheralRouter } from "./routes/peripheral.routes";
import shippingRoutes from "./routes/shipping.routes";
import printedDocumentRoutes from "./routes/printed-document.routes";
import documentProfileRoutes from "./routes/document-profile.routes";
import freeDocumentRoutes from "./routes/free-document.routes";
import returnRoutes from "./routes/return.routes";
import returnReasonRoutes from "./routes/return-reason.routes";
import warehouseRoutes from "./routes/warehouse.routes";
import goodsReceiptRoutes from "./routes/goods-receipt.routes";
import financeRoutes from "./routes/finance.routes";
import chequeRoutes from "./routes/cheque.routes";
import financePeriodRoutes from "./routes/finance-period.routes";
import cashPeriodRoutes from "./routes/cash-period.routes";
// Resmi ön muhasebe belgeleri (J2 #18) — ikisi de KENDİ kapısını taşır.
import reconciliationLetterRoutes from "./routes/reconciliation-letter.routes";
import chequeDeliveryNoteRoutes from "./routes/cheque-delivery-note.routes";
// Paket D (ticaret) — üçü de KENDİ `verifyToken + requireFinanceEnabled`
// kapısını taşır → app seviyesinde, spesifik ön ekle bağlanırlar.
import yarnRoutes from "./routes/yarn.routes";
import itemPriceRoutes from "./routes/item-price.routes";
import purchaseOrderRoutes from "./routes/purchase-order.routes";
import warehouseTransferRoutes from "./routes/warehouse-transfer.routes";
import stockCountRoutes from "./routes/stock-count.routes";
import currencyRoutes from "./routes/currency.routes";
import featureFlagRoutes from "./routes/feature-flag.routes";
import demoRoutes from "./routes/demo.routes";
import discoveryRoutes from "./routes/discovery.routes";
import importRoutes from "./routes/import.routes";
import masterDataMergeRoutes from "./routes/master-data-merge.routes";
import configBundleRoutes from "./routes/config-bundle.routes";
import adminRoutes from "./routes/admin.routes";
import { verifyToken } from "./middlewares/auth.middleware";
import { requireAnyPermission } from "./middlewares/rbac.middleware";
import dbCopyRoutes from "./routes/db-copy.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import reportsRoutes from "./routes/reports.routes";
import { devicePublicRouter, deviceAdminRouter } from "./routes/device.routes";
import workSessionRoutes from "./routes/work-session.routes";
import { resolveDevice } from "./middlewares/device.middleware";
import { latencyMiddleware } from "./middlewares/latency.middleware";
import { licenseGate } from "./middlewares/license.middleware";
import { clientInfoMiddleware } from "./middlewares/client-info.middleware";
import {
  readWebHardeningConfig,
  createRateLimiter,
  HSTS_MAX_AGE_SEC,
} from "./middlewares/web-hardening";

import { runWithRequestContext } from "./lib/request-context";
import searchRoutes from "./routes/search.routes";
import mobileUpdateRoutes from "./routes/mobile-update.routes";
import clientPolicyRoutes from "./routes/client-policy.routes";
import licenseRoutes from "./routes/license.routes";
import supportRoutes from "./routes/support.routes";
import patronCloudRoutes from "./routes/patron-cloud.routes";
const app: Express = express();

// =============================================================================
// İnternete açma sertleştirmesi (ORTAM DEĞİŞKENİ ARKASINDA)
// =============================================================================
// Gerekçelerin tamamı `middlewares/web-hardening.ts` başlığında. Buradaki tek
// kural: değişken YOKKEN çözülen değerler bugünkü davranışı birebir üretir
// (trustProxy=null → set edilmez · corsOrigins=null → kısıt yok ·
// swaggerEnabled=NODE_ENV!=="production" → mevcut kapı · httpsEnabled=false →
// HSTS kapalı · rateLimit.enabled=false → middleware hiç MOUNT EDİLMEZ).
const hardening = readWebHardeningConfig();

// ⚠️⚠️ EN KRİTİK SATIR. Ters vekil (nginx/Cloudflare) arkasında `trust proxy`
// verilmezse `req.ip` HERKES için kenar sunucusunun IP'sidir. Sonuç sessiz ve
// yıkıcı: giriş kilidi ile hız sınırı tüm ziyaretçileri TEK kovada toplar —
// şifresini yanlış giren ilk ziyaretçi kurulumun tamamını kilitler. Ayrıca
// erişim log'undaki (morgan 'combined') IP de kenar IP'si olur, yani olay
// incelemesi imkânsızlaşır.
// Değişken yoksa Express varsayılanı (`false`) korunur — LAN'da doğrusu odur.
if (hardening.trustProxy !== null) {
  app.set("trust proxy", hardening.trustProxy);
}

// =============================================================================
// Core Middlewares
// =============================================================================
// HTTP-only LAN sunucusu (HTTPS yok). helmet'in varsayilan CSP'sindeki
// `upgrade-insecure-requests` direktifi tarayiciyi TUM alt-istekleri
// (status.js, logo.png, /health fetch) https'e cevirmeye zorlar; sunucu
// yalnizca http://...:4000 konustugu icin bu istekler basarisiz olur ve durum
// sayfasi "Kontrol ediliyor..." ekraninda donar. Direktifi null'a cekip kaldir.
// HSTS de HTTPS olmadigi icin anlamsiz (tarayici http'de zaten yok sayar).
//
// WEB PANELI (OPT-IN, 2026-08-12): `WEB_DIST_DIR` ortam degiskeni dolu ise web
// paneli build'i (Electron/dist-web) ayni origin'den servis edilir — panel ile
// API tek adreste bulusur (CORS/mixed-content/adres-ayari uclusu tamamen duser).
// Degisken YOKKEN davranis bayt-bayt bugunku gibidir; fabrika deploy'u etkilenmez.
const webDistDir = process.env.WEB_DIST_DIR ?? null;

// HSTS + CSP `upgrade-insecure-requests` yalnız operatör HTTPS beyan ettiğinde
// (`HTTPS_ENABLED`): HTTP-only LAN'da aynı başlıklar paneli kırar ve geri dönüş
// kullanıcının HSTS önbelleğindedir.
function buildHelmet(httpsMode: boolean): express.RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // HTTPS_ENABLED verilmedigi surece direktif null'a cekili kalir (yukaridaki
        // gerekce: HTTP-only sunucuda tarayici alt-istekleri https'e cevirir ve
        // durum sayfasi donar). HTTPS arkasinda helmet varsayilani geri gelir:
        // tum alt-istekler zaten ayni origin'den ve https uzerinden geldigi icin
        // pratikte no-op'tur, karisik-icerige (mixed content) karsi ucuz bir seddir.
        ...(httpsMode ? {} : { upgradeInsecureRequests: null }),
        // Panel modunda header CSP'si panelin index.html'indeki meta CSP ile
        // esitlenir (efektif politika iki CSP'nin KESISIMIdir — helmet
        // varsayilanlari daha dar oldugu icin panelin blob: worker'lari ve
        // data: baglantilarini sessizce kirardi). Panel modu disinda helmet
        // varsayilanlari aynen kalir.
        ...(webDistDir
          ? {
              scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
              connectSrc: ["'self'", "data:"],
              imgSrc: ["'self'", "data:", "blob:"],
              fontSrc: ["'self'", "data:"],
              frameSrc: ["'self'", "blob:"],
              workerSrc: ["'self'", "blob:"],
            }
          : {}),
      },
    },
    // HSTS: HTTP-only LAN kurulumunda yalnizca anlamsiz DEGIL, TEHLIKELIDIR —
    // tarayici basligi bir kez gordugunde o host icin https'i AYLARCA zorunlu
    // kilar; sunucu 443 dinlemedigi icin panel acilmaz ve geri donus sunucuda
    // degil kullanicinin HSTS onbelleginde oldugu icin uzaktan duzeltilemez.
    // Bu yuzden ortamin TAHMINIYLE degil operatorun BEYANIYLA (HTTPS_ENABLED) acilir.
    ...(httpsMode
      ? { strictTransportSecurity: { maxAge: HSTS_MAX_AGE_SEC, includeSubDomains: true } }
      : { strictTransportSecurity: false }),
  });
}
// Katman adı helmet'in kendi `helmetMiddleware`idir; `test_middleware_order` sırayı bu ADLA ölçer
// (sarmalayan isimsiz bir arrow katmanı "bulunamadı" yapar).
app.use(buildHelmet(hardening.httpsEnabled));
// exposedHeaders: tarayıcı/Electron renderer'ı cross-origin custom response
// header'larını ancak burada listelenirse JS'e açar. Etiket dili (native baskı
// guard'ı buna bakar) + sunucu saati (apiClient offset) okunabilsin diye gerekli.
//
// ⚠️ ORIGIN KISITI OPT-IN. Varsayılan (CORS_ORIGINS yok) kısıtsız kalır ve bu
// LAN'da bilinçlidir: fabrikada panel/tablet birden çok origin'den konuşuyor
// (Electron renderer, http://<lan-ip>, WEB_DIST_DIR modunda aynı origin) ve
// listeyi eksik yazmak sahayı sessizce durdururdu. İnternete açılırken liste
// verilir; `cors` yalnız eşleşen origin'i yansıtır, eşleşmeyene ACAO başlığını
// HİÇ basmaz ve `Vary: Origin` ekler.
// ⚠️ CORS BİR YETKİ DUVARI DEĞİLDİR — yalnız tarayıcıyı bağlar (curl/mobil
// istemci etkilenmez). Uçların asıl koruması `verifyToken` + `requirePermission`;
// origin listesi onların YERİNE geçmez.
app.use(cors({
  exposedHeaders: ["X-Label-Language", "X-Label-Kind", "X-Label-Count", "X-Label-Template-Id", "X-Label-Variant-Match", "Date"],
  ...(hardening.corsOrigins ? { origin: hardening.corsOrigins } : {}),
}));
// gzip + brotli yoksa sıkıştır — JSON listelerde 60-80% boyut tasarrufu.
// 1KB altı response'lar atlanır (overhead'e değmez).
app.use(compression({ threshold: 1024 }));
// F17: production'da 'combined' (tarih/IP/UA — pm2 dosya log'una ANSI'siz),
// dev'de renkli kısa 'dev'.
const isProd = (process.env.APP_ENV ?? process.env.NODE_ENV) === "production";
// Erişim günlüğü sır taşımaz: `url` ve `referrer` jetonları sır parametrelerinin DEĞERİNİ
// maskeler (etkinleştirme kodu, kurulum token'ı…). İki biçim de (`combined`/`dev`) bu jetonları okur.
morgan.token<Request, Response>("url", (req) => redactSecretQueryParams(req.originalUrl || req.url || ""));
morgan.token<Request, Response>("referrer", (req) => {
  const ref = req.headers.referer ?? req.headers.referrer;
  return ref ? redactSecretQueryParams(String(ref)) : undefined;
});
app.use(morgan(isProd ? "combined" : "dev"));

// Per-endpoint gecikme istatistiği (istek başına O(1)) — morgan'dan sonra,
// resolveDevice'tan ÖNCE: statik/health/swagger dahil her şey ölçülür. Canlı
// sayaçlar bellekte (GET /api/admin/perf); Faz 3 ile ~5dk'da bir istek-güdümlü
// flush günlük özet tablosuna yazar (GET /api/admin/perf/history — trend).
// Bkz. docs/history/SAHA-DAYANIKLILIK-FAZ2.md §B + docs/history/SAHA-DAYANIKLILIK-FAZ3.md §P1.
app.use(latencyMiddleware);

// Bağlı istemci künyesi (`X-Client-*`) — Sistem → Bağlı İstemciler ekranını
// besleyen SÜREÇ-İÇİ defter. FAIL-OPEN ve kapı DEĞİL: hiçbir isteği reddetmez,
// hiçbir `req` alanı doldurmaz, taşıdığı bilgi hiçbir yetki kararına girmez
// (gerekçe: `constants/client-info.ts`). latency'den sonra, resolveDevice'tan
// önce: cihaz çözümüne bağımlı değil (masaüstü panel `x-device-id` GÖNDERMEZ).
app.use(clientInfoMiddleware);

// F16: 1MB limit — toplu uçlar (yüzlerce rollId) 100kb default'u aşınca generic
// 500/İngilizce 'entity.too.large' yerine error.middleware net 413 Türkçe döner.
//
// ⚠️ KONUM: morgan + latency'den SONRA (2026-08-09, denetim F-CORE-OPS-003).
// Eskiden ikisinden de ÖNCEYDİ ve bu bir gözlemlenebilirlik kör noktasıydı:
// bozuk JSON (400) ve 1MB aşımı (413) burada `next(err)` ile hata zincirine
// çıkıyor, hata zinciri sonraki NORMAL middleware'ları ATLIYOR ve o istekler NE
// erişim log'una NE gecikme metriğine düşüyordu. Yani 413 döngüsüne girmiş bir
// tablet `/api/admin/perf` ekranında HİÇ görünmüyordu — uç sanki hiç çağrılmamış
// gibi. Bağımlılık yok: morgan ve latency gövdeyi okumaz, resolveDevice yalnız
// x-device-id başlığına bakar, route handler'ları zaten aşağıda.
//
// ⚠️ `type` FONKSİYONU LOAD-BEARING (2026-08-29 / BULGU-T1-045): içe aktarım ve
// yapılandırma paketi router'ları KENDİ 10 MB'lık `express.json` katmanlarını
// taşıyor, ama bu global katman onlardan ÖNCE mount edildiği için o katmanlar
// HİÇ KOŞMUYORDU — 2 MB'lık bir CSV burada 413'e düşüyordu. `type` false
// dönünce gövde burada okunmaz ve router'ın kendi katmanına kalır.
app.use(
  express.json({
    limit: VARSAYILAN_GOVDE_LIMITI,
    type: (req) => {
      if (buyukGovdeYolu(req.url)) return false;
      return /[/+]json($|[^\w])/i.test(req.headers["content-type"] ?? "");
    },
  }),
);

// =============================================================================
// Swagger UI Documentation
// =============================================================================
// ⚠️ İKİ KAPI, İKİSİ DE FAIL-CLOSED. `setupSwagger` zaten `NODE_ENV==="production"`
// iken erken dönüyor; buradaki kapı ONU KALDIRMAZ, ÖNÜNE geçer. Sebep: internete
// açılan demo `NODE_ENV=production` ile koşmak ZORUNDA değil (dev modda daha hızlı
// teşhis edilebilir) ve o durumda iç API şeması — tüm uç adları, gövde şemaları,
// izin isimleri — kimliksiz herkese açık olurdu. `SWAGGER_ENABLED=false` ortamdan
// bağımsız kapatır. Tersi çalışmaz ve bu bilinçlidir: `SWAGGER_ENABLED=true`
// üretimde de mount ETMEZ, çünkü içerideki eski kapı hâlâ yerinde durur.
if (hardening.swaggerEnabled) {
  setupSwagger(app);
}

// =============================================================================
// Durum Sayfası (kök /) + statik varlıklar
// =============================================================================
// Sunucu adresi tarayıcıda açıldığında (operatör/tablet) Swagger yerine markalı
// bir durum sayfası gösterilir: API + DB bağlantısı OK mu değil mi. Sayfa
// public/ altındaki statik dosyalardan gelir (index.html + status.js + logo.png) —
// helmet'in varsayılan CSP'si inline script'i bloklar; harici 'self' dosyalar geçer.
// CWD = backend kökü (dev) veya app\ (üretimde pm2 `cwd`) → her ikisinde de
// public\ klasörü bunun altındadır.
// Web paneli statigi DURUM SAYFASINDAN ONCE baglanir: panel modunda kok (/)
// artik paneldir (durum bilgisi /health'te yasamaya devam eder). Env yokken bu
// blok hic kosmaz ve kok, asagidaki durum sayfasidir.
if (webDistDir) {
  app.use(express.static(webDistDir));
}

const publicDir = path.join(process.cwd(), "public");
app.use(express.static(publicDir));

// x-device-id header'ı varsa req.device'a Device + machineId çöz.
//
// ⚠️ KONUM: swagger + statik varlıklardan SONRA (2026-08-09 denetimi,
// F-CORE-VER-002). Eskiden ikisinden de ÖNCEYDİ ve bu, mobil istemcinin
// gönderdiği HER statik dosya isteğine (durum sayfası, logo, swagger iç
// varlıkları) bir `device` DB sorgusu bindiriyordu — o sorgunun sonucunu
// statik yolun okuması İMKÂNSIZ. Ölçülen taban: 18 APPROVED cihaz, 5 sn'de bir
// yoklama; kimlik+cihaz çözümü iş sorgusu başlamadan ~11 sorgu/sn ediyordu.
// API route'ları AŞAĞIDA olduğu için `req.device`a bağlı hiçbir yol etkilenmez.
app.use(resolveDevice);
// ── İSTEK BAĞLAMI (Faz B3) ──────────────────────────────────────────────────
// Audit'in "nereden" bilgisini okuyabilmesi için isteği AsyncLocalStorage
// içinde çalıştırır. `req` NESNESİ saklanır, alanları kopyalanmaz: `req.user`
// verifyToken ile SONRA doluyor — kopyalasaydık audit hep boş okurdu.
// resolveDevice'tan SONRA mount edilir ki `req.device` çözülmüş olsun.
app.use((req, _res, next) => runWithRequestContext(req, next));

// Sürüm bilgisi (durum sayfasında gösterilir). Okuma `lib/app-version.ts`e
// taşındı — servis keşfi kimlik ucu da aynı sürümü basıyor ve `app.ts`'ten
// import etmek döngü yaratırdı (app → routes → discovery.service → app).
const appVersion = APP_VERSION;

// Yedek zamanlayıcısının sahibi `lib/health-snapshot.ts`e taşındı; eski içe aktarımlar kırılmasın.
export { backupScheduler } from "./lib/health-snapshot";

// =============================================================================
// Health Check  (durum sayfası ve tepsi paneli buradan beslenir)
// =============================================================================
// API her zaman UP (bu kod çalışıyorsa); ek olarak DB bağlantısını canlı test
// eder. Geriye dönük uyumluluk için HTTP durumu 200 KALIR ve eski alanlar
// (status, message) korunur — yeni alanlar (db, version, uptimeSec, dbSizeBytes,
// dbConnections, lastBackup) eklenir.
// ⚠️ İKİ UÇ, İKİ SÖZLEŞME (2026-08-09 denetimi, F-CORE-GUV-002):
//
//   GET /health             → PUBLIC, YALNIZ CANLILIK (5 alan)
//   GET /api/admin/health   → verifyToken + admin:settings, TAM operasyon panosu
//
// `/health` kimlik doğrulaması TAŞIYAMAZ: Electron login ÖNCESİ sunucu adresini
// onunla test ediyor (ApiEndpointDialog) ve `useServerClock` yanıttaki `Date`
// başlığını okuyor; kök durum sayfası (public/status.js) da onu çağırıyor.
// Ama uç, canlılığın çok ötesinde bir panoyu kimliksiz döndürüyordu: DB boyutu,
// disk doluluğu, havuz içleri, o an online kullanıcı/cihaz sayısı, YEDEK DOSYA
// ADI ve iki HAM hata metni (`lastAuditError`, `lastPoolTimeoutError` —
// içerikleri süzülmüyor; Prisma/pg metinleri şema ve bağlantı ayrıntısı
// taşıyabilir). LAN'daki kimliksiz herhangi bir istemci — CORS `*` sayesinde
// ofis bilgisayarında açılan herhangi bir web sayfası dahil — hepsini tek GET
// ile okuyabiliyordu.
//
// ⚠️ YENİ METRİK EKLERKEN: "bu alan sunucuya erişimi olmayan birine ne söyler?"
// Cevap "operasyonel iç durum" ise `buildRichHealth`e ekle, `/health`e DEĞİL.
// `/health`in alan kümesi DONDURULMUŞTUR.

/**
 * PUBLIC canlılık ucu — SÖZLEŞMESİ DONDURULMUŞ beş alan.
 * DB'ye YALNIZ ucuz bir `SELECT 1` atar: zengin yükün pg_stat sorgusu buraya
 * gerekmiyor ve kimliksiz bir istemcinin onu tetiklemesi için sebep yok.
 *
 * ⚠️ SUNUCU KİMLİĞİ BURAYA EKLENMEZ — `GET /api/discovery/identity` var
 * (`routes/discovery.routes.ts`). Bu ucun dört tüketicisi (deploy/kur.ps1
 * `Saglik`, public/status.js, Electron `useServerClock` ve `ApiEndpointDialog`)
 * alan kümesine bağlı; ayrıca kimlik ucu DB'siz olmak zorunda, bu uç ise
 * `SELECT 1` atıyor.
 */
app.get("/health", async (_req: Request, res: Response) => {
  let db: "UP" | "DOWN" = "DOWN";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "UP";
  } catch {
    db = "DOWN";
  }
  res.status(200).json({
    status: "UP",
    message: "TeksERP API is running.",
    api: "UP",
    db,
    version: appVersion,
    time: new Date().toISOString(),
  });
});

// =============================================================================
// Hız sınırı (OPT-IN — RATE_LIMIT_ENABLED)
// =============================================================================
// ⚠️ KAPALIYKEN MOUNT BİLE EDİLMEZ: bayrak yoksa aşağıdaki blok hiç koşmaz,
// middleware zincirine tek layer eklenmez, istek başına tek satır kod çalışmaz.
// "Devre dışı bir middleware'i her isteğe takmak" fabrikada ölçülebilir bir
// maliyet olmasa da sıfır-fark iddiasını zayıflatırdı.
//
// KONUM: route kayıtlarından hemen ÖNCE, morgan + latency'den SONRA. İkincisi
// F-CORE-OPS-003 dersinin aynısı — reddedilen istek de erişim log'una ve gecikme
// metriğine düşmeli, yoksa 429 fırtınasına girmiş bir istemci hiçbir panoda
// görünmez. Statik varlıklar ve `/health` kapsam DIŞI (sınıflandırma yalnız
// /api altındaki YAZMA metodlarını ve üç giriş ucunu sayar).
if (hardening.rateLimit.enabled) {
  app.use(
    "/api",
    createRateLimiter({
      windowMs: hardening.rateLimit.windowMs,
      limits: { login: hardening.rateLimit.loginMax, write: hardening.rateLimit.writeMax },
      // ⚠️ Giriş kilidiyle AYNI istemci kaynağı: biri kenar IP'sini, diğeri
      // gerçek ziyaretçiyi sayarsa iki koruma farklı kişileri sınırlar.
      clientIpHeader: hardening.clientIpHeader,
    }),
  );
}

// LİSANS KAPISI — rotalardan ÖNCE, yöntem + yol ile sınıflar; kapalı yolda kimlik önce gelir
// (oturumsuz istek rotanın 401'ini alır, kademe yalnız geçerli oturuma). Gözlem kipinde hiçbir
// isteği engellemez (sıfır fark). Açık yol listeleri: `constants/license-routes.ts`; bekçi `test_lisans_kapisi`.
app.use("/api", licenseGate);

// =============================================================================
// API Routes
// =============================================================================
app.use("/api/auth", authRoutes);
app.use("/api/items", itemRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/customer-branches", customerBranchListRoutes);
app.use("/api/stations", stationRoutes);
app.use("/api/machines", machineRouter);
app.use("/api/peripherals", peripheralRouter);
app.use("/api/routes", routeRoutes);
app.use("/api/product-recipes", productRecipeRoutes);
// Çözgü kartları (devere modülü) — router'ın kendi kapısı: verifyToken +
// requireDevereEnabled (ticaret → iplik → devere zinciri) + requirePermission.
app.use("/api/warp-specs", warpSpecRoutes);
app.use("/api/warp-beams", warpBeamRoutes);
// Dokuma modülü (üç router, tek kapı): verifyToken + requireDokumaEnabled
// (production → dokuma zinciri kapının içinde) + requirePermission.
app.use("/api/weaving-orders", weavingOrderRoutes);
// Tezgah koşumu (aç/kapa/geri al) — loom:run · loom:run-revoke.
app.use("/api/machine-runs", machineRunRoutes);
app.use("/api/machine-stops", machineStopRoutes);
app.use("/api/machine-shift-stats", machineShiftStatRoutes);
app.use("/api/machine-specs", machineSpecRoutes);
app.use("/api/machine-doffs", machineDoffRoutes);
app.use("/api/subcontractor-weaving", subcontractorWeavingRoutes);
app.use("/api/rolls", inventoryRoutes);
app.use("/api/orders", orderRoutes);
// ⚠️ MOUNT — "yazıldı ama mount edilmedi" sınıfı hata için bkz. reboot-kurtarma notu.
app.use("/api/record-info", recordInfoRoutes);
app.use("/api/scan", scanRoutes);
app.use("/api/number-series", numberSeriesRoutes);
app.use("/api/work-orders", workOrderRoutes);
app.use("/api/production-balance", productionBalanceRoutes);
app.use("/api/tambur", tamburRoutes);
app.use("/api/kursun-qc", kursunQcRoutes);
app.use("/api/kursun-bypass", kursunBypassRoutes);
app.use("/api/traveler-cards", travelerCardRoutes);
app.use("/api/traveler-templates", travelerTemplateRoutes);
app.use("/api/subcontractor", subcontractorRoutes);
app.use("/api/batches", batchRoutes);
app.use("/api/subcontractors", subcontractorRouter);
app.use("/api/subcontractor-categories", subcontractorCategoryRouter);
app.use("/api/kartela", kartelaRoutes);
app.use("/api/swatches", swatchRoutes);
app.use("/api/defect-types", defectTypeRoutes);
app.use("/api/quality-grades", qualityGradeRoutes);
app.use("/api/colors", colorRoutes);
app.use("/api/fabric-properties", fabricPropertyRoutes);
app.use("/api/station-capabilities", stationCapabilityRoutes);
app.use("/api/reason-presets", reasonPresetRoutes);
app.use("/api/labels", labelRoutes);
app.use("/api/label-templates", labelTemplateRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/printed-documents", printedDocumentRoutes);
app.use("/api/document-profiles", documentProfileRoutes);
app.use("/api/free-documents", freeDocumentRoutes);
app.use("/api/returns", returnRoutes);
app.use("/api/return-reasons", returnReasonRoutes);
app.use("/api/warehouses", warehouseRoutes);
// Mal kabul — 2026-09-02'den beri `verifyToken + requireTicaretEnabled`
// kapısını KENDİ taşır (modül paketinin tek bilinçli davranış farkı).
app.use("/api/goods-receipts", goodsReceiptRoutes);
// Paket D — iplik kg-defteri · kalem fiyatı · alış siparişi. Kapıları
// 2026-09-02'de modül anahtarlarına TAŞINDI: iplik `iplik.enabled` (ticarete
// bağımlı), fiyat + alış siparişi `ticaret.enabled`. Fabrikada üçü de kapalı
// olduğu için hepsi 403 döner (bekçi: scripts/test_finance_regime_gate.ts +
// modül ikizleri).

app.use("/api/yarn", yarnRoutes);
app.use("/api/item-prices", itemPriceRoutes);
app.use("/api/purchase-orders", purchaseOrderRoutes);
// Depolar arası transfer — kendi `verifyToken + requireDepoMultiEnabled`
// kapısını taşır. Depo TANIMI ve DEFTERİ (`/api/warehouses`) rejimsiz KALIR;
// kapı yalnız çoklu depo YÜZEYİNE takılıdır.
app.use("/api/warehouse-transfers", warehouseTransferRoutes);
// Tam stok sayımı (J2 #19) — kendi `verifyToken + requireTicaretEnabled`
// kapısını taşır; fark fişi TOP ve İPLİK defterlerine yazdığı için rejim kapısı
// pazarlık dışıdır (bekçi: scripts/test_finance_regime_gate.ts).
app.use("/api/stock-counts", stockCountRoutes);
// Ön muhasebe — router'ın KENDİSİ `requireFinanceEnabled` taşır (bayrak
// kapalıysa hepsi 403). Tek tek uçlarda tekrarlanmaz.
// ⚠️ Çek/senet router'ı DAHA SPESİFİK prefix taşıdığı için `/api/finance`ten
// ÖNCE kaydedilir: sonra kaydedilseydi istek önce finance router'ına girer,
// orada eşleşme bulamayıp çıkar ve `verifyToken` + `requireFinanceEnabled`
// (bir ayar okuması) her çek isteğinde İKİ KEZ koşardı.
app.use("/api/finance/cheques", chequeRoutes);
// Dönem kapanışı (C3) — AYNI gerekçe, aynı sıra kuralı. Kendi kapısını taşıyan
// her ön muhasebe router'ı buraya, `/api/finance`ten ÖNCE bağlanır; kapısını
// MİRAS ALAN alt router (`/allocations`) ise `finance.routes.ts` İÇİNE bağlanır.
// İkisini karıştırmak ya kapıyı ikilemek ya da hiç koşmamasına yol açar.
app.use("/api/finance/period-closes", financePeriodRoutes);
// Kasa/banka dönem kapanışı (K-1) — aynı desen, aynı sıra kuralı.
app.use("/api/finance/cash-period-closes", cashPeriodRoutes);
// Resmi ön muhasebe belgeleri (J2 #18) — aynı desen, aynı sıra kuralı: kendi
// `verifyToken + requireFinanceEnabled` kapısını taşıdıkları için `/api/finance`
// GENEL ön ekinden ÖNCE bağlanırlar (sonra bağlansalardı her istek önce finance
// router'ına girer, eşleşme bulamayıp çıkar ve kapı iki kez koşardı).
app.use("/api/finance/reconciliation-letters", reconciliationLetterRoutes);
app.use("/api/finance/cheque-delivery-notes", chequeDeliveryNoteRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/currencies", currencyRoutes);
app.use("/api/feature-flags", featureFlagRoutes);
// Demo senaryoları — `demo.modeEnabled` kapalıyken hepsi 403 (requireDemoMode).
app.use("/api/demo", demoRoutes);
// Servis keşfi — KİMLİKSİZ ve DB'siz. İstemci sunucuyu ağda bulduktan sonra
// "doğru kurulum mu" sorusunu buraya sorar; henüz giriş yapmamıştır, o yüzden
// guard TAKILAMAZ (`/health` ile aynı gerekçe).
app.use("/api/discovery", discoveryRoutes);
// Toplu içe/dışa aktarım. ⚠️ Bu router KENDİ `express.json({limit:"10mb"})`
// katmanını taşır (route seviyesinde) — global 1 MB limiti DEĞİŞMEZ; 10.000
// satırlık bir dosya JSON'a çevrilince 1 MB'ı aşar ama gevşemenin diğer TÜM
// uçlara yayılması gereksiz bir saldırı yüzeyi olurdu.
app.use("/api/import", importRoutes);
app.use("/api/master-data", masterDataMergeRoutes);
// Yapılandırma paketi (kurulumlar arası tanım taşıma). Yetki ANAHTAR-KAPSAMLI:
// pakette hangi tür varsa yalnız onun izni aranır (feature-flags guard dersi).
app.use("/api/config-bundle", configBundleRoutes);
// db-copies GENEL admin router'ından ÖNCE: Express 5 prefix eşleşmesinde daha
// spesifik olan önce gelmeli, yoksa admin.routes içindeki bir yakalayıcı öne geçebilir.
app.use("/api/admin/db-copies", dbCopyRoutes);
// ZENGİN sağlık yükü — `/health`ten AYRILDI (F-CORE-GUV-002). adminRoutes'tan
// ÖNCE kaydedilir ki aynı prefix altında bu özel yol önce eşleşsin. Guard'lar
// route satırında açık: kimlik + `admin:settings` (Sunucu Durumu ekranı zaten
// Sistem hub'ının arkasında ve o izni taşıyan kişi tarafından açılıyor).
app.get(
  "/api/admin/health",
  verifyToken,
  requireAnyPermission("admin:settings", "system:server-status"),
  async (_req: Request, res: Response) => {
    res.status(200).json(await buildRichHealth());
  },
);
app.use("/api/admin", adminRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/devices", devicePublicRouter);
app.use("/api/admin/devices", deviceAdminRouter);
app.use("/api/work-sessions", workSessionRoutes);
// Global arama (Ctrl+K) — izin süzgeci ROUTE'ta değil SERVİSTE, kova bazında.
app.use("/api/search", searchRoutes);
// Mobil uzaktan güncelleme (tabletlerin JS paketi + kurulum dosyası).
// Uçların çoğu BİLEREK PUBLIC — tablet güncellemeyi giriş ekranından ÖNCE
// sorar; kimlik aransaydı "açılmayan tablete düzeltme gönderme" yolu, yani
// kurtarmanın ta kendisi kapanırdı. Depo `app\` DIŞINDA durur (deploy silmesin)
// — bkz. src/config/mobile-update.ts.
app.use("/api/mobile", mobileUpdateRoutes);

// İstemci sürüm politikası — PUBLIC (panel giriş ekranından ÖNCE sorar).
// Bkz. src/config/client-version-policy.ts.
app.use("/api/client-policy", clientPolicyRoutes);
// Lisans (fabrika motoru): durum · etkinleştirme · çevrimdışı/aktarma · taşıma · DR ·
// indirme belirteci · veri dışarı · proxy. Bu uçlar kapının HER kademede açık listesindedir.
app.use("/api/license", licenseRoutes);
// Destek talepleri (3d-2): panel → satıcı `/v1/destek`; yanıtlar zil `destek` + yoklamayla döner.
app.use("/api/destek", supportRoutes);
// Patron bulutu (fabrika yüzeyi): teknik kullanıcı + salt okunur bulut hesapları. Gelen kutusu işi `jobs/cloud-inbox.job.ts`.
app.use("/api/patron-bulut", patronCloudRoutes);

// =============================================================================
// JSON 404 — tanımsız /api/* route'lar için
// =============================================================================
// Express default 404'ü HTML döner ("Cannot GET /api/foo") — JSON API contract'ı
// bozar (frontend res.json() üzerinde parse hatası alır). Bu catch-all tüm
// tanımsız /api path'leri için tutarlı JSON yanıt verir.
//
// Yalnız /api altına bind edildi — Swagger UI (/api-docs/*) ve /health
// etkilenmez.
app.use("/api", (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Endpoint bulunamadı: ${req.method} ${req.originalUrl}`,
  });
});

// =============================================================================
// SPA fallback (yalniz panel modunda) — /api* disindaki HTML isteyen GET'ler
// panelin index.html'ine duser. Panel HashRouter kullandigi icin bugun derin
// yol istegi zaten gelmez ("/" + asset'ler yeter); bu blok, router ileride
// BrowserRouter'a gecerse yenileme/derin baglanti 404'lerini simdiden kapatir.
// =============================================================================
if (webDistDir) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api")) return next(); // JSON 404 sozlesmesi bozulmasin
    if (!req.accepts("html")) return next();
    // `root` opsiyonu SART: mutlak yol verilirse `send` yolun ICINDEKI nokta
    // segmentlerini (orn. gelistirme worktree'sindeki `.claude/`) gizli dosya
    // sayip 404 uretir; root'a gore "index.html" ise nokta segmenti tasimaz.
    res.sendFile("index.html", { root: webDistDir });
  });
}

// =============================================================================
// Global Error Handler (must be LAST middleware)
// =============================================================================
app.use(errorHandler);

export default app;
